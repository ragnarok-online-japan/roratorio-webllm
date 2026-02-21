/**
 * ラグナロクオンラインデータローダー
 * YAML形式のアイテム・スキル・職業データをzstd圧縮から取得・解凍・パース
 */

import YAML from 'js-yaml'
import type { ItemDataParameter, SkillDataParameter, JobDataParameter, RAGContext } from './types'
import { RAG_CONFIG } from './types'

// Zstd インスタンスのキャッシュ（初期化済みインスタンス）
let zstdInstance: any = null
// 初期化中の Promise をキャッシュ（並列呼び出しでも 1 回だけロード）
let zstdInstancePromise: Promise<any> | null = null

/**
 * Zstdインスタンスの初期化（統一された初期化関数）
 */
export async function initializeZstd(): Promise<any> {
    // 既に初期化済みならそのまま返す
    if (zstdInstance) {
        return zstdInstance
    }

    if (!zstdInstancePromise) {
        // 初期化中の Promise をキャッシュし、失敗時はキャッシュをリセットして再試行可能にする
        zstdInstancePromise = (async () => {
            const { Zstd } = await import('@hpcc-js/wasm-zstd')
            const instance = await Zstd.load()
            zstdInstance = instance  // 初期化完了後、インスタンスをキャッシュ
            return instance
        })()
            .catch((err) => {
                // 初期化に失敗した場合は次回の呼び出しで再試行できるようにリセット
                console.error('[RAG] zstd initialization failed:', err)
                zstdInstancePromise = null
                throw err
            })
    }
    return zstdInstancePromise
}

/**
 * ファイル読み込み
 */
async function loadFileAsUint8Array(url: string): Promise<Uint8Array> {
    const response = await fetch(url)
    return new Uint8Array(await response.arrayBuffer())
}

/**
 * zstdで展開（非同期）
 */
async function zstdDecompressAsync(compressed: Uint8Array): Promise<Uint8Array | null> {
    try {
        const zstd = await initializeZstd()
        // zstd.decompress() で zstd データを展開
        const result = await zstd.decompress(compressed)
        return result
    } catch (err) {
        console.error('[RAG] Error decompressing:', err)
        return null
    }
}

/**
 * zstdで展開して文字列に変換
 */
async function zstdDecompressString(compressed: Uint8Array): Promise<string | null> {
    const decompressed = await zstdDecompressAsync(compressed)
    if (decompressed) {
        const decoder = new TextDecoder()
        return decoder.decode(decompressed)
    }
    return null
}

/**
 * zstd圧縮ファイルを取得・解凍
 */
async function fetchAndDecompressZstd(url: string): Promise<string> {
    console.log(`[RAG] Fetching from ${url}`)

    try {
        // ファイルを取得
        const compressed = await loadFileAsUint8Array(url)
        console.log(`[RAG] Decompressing ${compressed.byteLength} bytes`)

        // zstdで展開して文字列に変換
        const text = await zstdDecompressString(compressed)
        if (!text) {
            throw new Error('Failed to decompress zstd data')
        }

        return text
    } catch (error) {
        console.error('[RAG] zstd decompression error:', error)
        throw new Error(`Failed to decompress ${url}: ${error instanceof Error ? error.message : String(error)}`)
    }
}

/**
 * YAMLをパース
 * YAML形式: キー・バリュー形式のオブジェクト { id: data, id: data, ... }
 * 配列に変換して返す
 */
function parseYaml<T>(content: string): T[] {
    try {
        const parsed = YAML.load(content)

        // ルートがオブジェクトの場合、Object.values()で配列に変換
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const values = Object.values(parsed)
            if (values.length > 0) {
                console.log(`[RAG] Converted object with ${values.length} entries to array`)
                return values as T[]
            }
        }

        // 既に配列の場合はそのまま返す
        if (Array.isArray(parsed)) {
            return parsed as T[]
        }

        console.warn('[RAG] YAML parse result is neither object nor array:', typeof parsed)
        return []
    } catch (error) {
        console.error('[RAG] YAML parse error:', error)
        throw new Error(`Failed to parse YAML: ${error instanceof Error ? error.message : String(error)}`)
    }
}

/**
 * キャッシュからデータを取得
 */
async function getCachedData<T>(db: IDBDatabase, key: string): Promise<T | null> {
    return new Promise((resolve) => {
        try {
            const transaction = db.transaction([RAG_CONFIG.CACHE_STORE_NAME], 'readonly')
            const store = transaction.objectStore(RAG_CONFIG.CACHE_STORE_NAME)
            const request = store.get(key)

            request.onsuccess = () => {
                const cached = request.result as { data: T; timestamp: number } | undefined
                if (cached && Date.now() - cached.timestamp < RAG_CONFIG.CACHE_TTL_MS) {
                    resolve(cached.data)
                } else {
                    resolve(null)
                }
            }

            request.onerror = () => {
                console.warn(`[RAG] Failed to read cache for ${key}`)
                resolve(null)
            }

            transaction.onerror = () => {
                console.warn(`[RAG] Transaction error reading cache for ${key}`)
                resolve(null)
            }
        } catch (error) {
            console.warn(`[RAG] Error accessing cache for ${key}:`, error)
            resolve(null)
        }
    })
}

/**
 * キャッシュにデータを保存
 */
async function setCacheData<T>(db: IDBDatabase, key: string, data: T): Promise<void> {
    return new Promise((resolve) => {
        try {
            const transaction = db.transaction([RAG_CONFIG.CACHE_STORE_NAME], 'readwrite')
            const store = transaction.objectStore(RAG_CONFIG.CACHE_STORE_NAME)
            const request = store.put({ key, data, timestamp: Date.now() })

            request.onerror = () => {
                console.warn(`[RAG] Failed to write cache for ${key}`)
                resolve()  // エラーでも続行
            }

            request.onsuccess = () => resolve()

            transaction.onerror = () => {
                console.warn(`[RAG] Transaction error writing cache for ${key}`)
                resolve()  // エラーでも続行
            }
        } catch (error) {
            console.warn(`[RAG] Error writing cache for ${key}:`, error)
            resolve()  // エラーでも続行
        }
    })
}

/**
 * アイテムデータを取得
 */
export async function loadItems(db?: IDBDatabase): Promise<ItemDataParameter[]> {
    try {
        // キャッシュをチェック
        if (db) {
            const cached = await getCachedData<ItemDataParameter[]>(db, 'items')
            if (cached) {
                console.log('[RAG] Items loaded from cache')
                return cached
            }
        }

        // リモートから取得
        const yaml_text = await fetchAndDecompressZstd(RAG_CONFIG.ITEM_URL)
        const items = parseYaml<ItemDataParameter>(yaml_text)

        // キャッシュに保存
        if (db) {
            await setCacheData(db, 'items', items).catch(console.error)
        }

        console.log(`[RAG] Loaded ${items.length} items`)
        return items
    } catch (error) {
        console.error('[RAG] Failed to load items:', error)
        return []
    }
}

/**
 * スキルデータを取得
 */
export async function loadSkills(db?: IDBDatabase): Promise<SkillDataParameter[]> {
    try {
        if (db) {
            const cached = await getCachedData<SkillDataParameter[]>(db, 'skills')
            if (cached) {
                console.log('[RAG] Skills loaded from cache')
                return cached
            }
        }

        const yaml_text = await fetchAndDecompressZstd(RAG_CONFIG.SKILL_URL)
        const skills = parseYaml<SkillDataParameter>(yaml_text)

        if (db) {
            await setCacheData(db, 'skills', skills).catch(console.error)
        }

        console.log(`[RAG] Loaded ${skills.length} skills`)
        return skills
    } catch (error) {
        console.error('[RAG] Failed to load skills:', error)
        return []
    }
}

/**
 * 職業データを取得
 */
export async function loadJobs(db?: IDBDatabase): Promise<JobDataParameter[]> {
    try {
        if (db) {
            const cached = await getCachedData<JobDataParameter[]>(db, 'jobs')
            if (cached) {
                console.log('[RAG] Jobs loaded from cache')
                return cached
            }
        }

        const yaml_text = await fetchAndDecompressZstd(RAG_CONFIG.JOB_URL)
        const jobs = parseYaml<JobDataParameter>(yaml_text)

        if (db) {
            await setCacheData(db, 'jobs', jobs).catch(console.error)
        }

        console.log(`[RAG] Loaded ${jobs.length} jobs`)
        return jobs
    } catch (error) {
        console.error('[RAG] Failed to load jobs:', error)
        return []
    }
}

/**
 * RAGコンテキストを初期化
 */
export async function initializeRAGContext(db?: IDBDatabase): Promise<RAGContext> {
    try {
        console.log('[RAG] Initializing RAG context...')

        const [items, skills, jobs] = await Promise.all([
            loadItems(db),
            loadSkills(db),
            loadJobs(db),
        ])

        const itemMap = new Map<number, ItemDataParameter>()
        const skillMap = new Map<number | string, SkillDataParameter>()
        const jobMap = new Map<number | string, JobDataParameter>()

        items.forEach((item) => itemMap.set(item.id, item))
        skills.forEach((skill) => {
            skillMap.set(skill.id_num, skill)
            skillMap.set(skill.id, skill)
        })
        jobs.forEach((job) => {
            jobMap.set(job.id_num, job)
            jobMap.set(job.id_name, job)
            jobMap.set(job.name, job)
        })

        const context: RAGContext = {
            items: itemMap,
            skills: skillMap,
            jobs: jobMap,
            lastUpdated: Date.now(),
            source: 'https://roratorio-hub.github.io/ratorio',
        }

        console.log('[RAG] RAG context initialized successfully')
        return context
    } catch (error) {
        console.error('[RAG] Failed to initialize RAG context:', error)
        throw error
    }
}
/**
 * ブラウザ環境でのみ初期化を実行（アプリケーション起動時にzstdをプリロード）
 */
if (typeof window !== 'undefined') {
    initializeZstd()
        .then(() => {
            console.log('[RAG] Zstd initialized successfully on application startup')
        })
        .catch((err) => {
            console.error('[RAG] zstd initialization failed on startup:', err)
        })
}
