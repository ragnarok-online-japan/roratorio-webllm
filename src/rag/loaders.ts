/**
 * ラグナロクオンラインデータローダー
 * YAML形式のアイテム・スキル・職業データをzstd圧縮から取得・解凍・パース
 */

import YAML from 'js-yaml'
import type { ItemDataParameter, SkillDataParameter, JobDataParameter, RAGContext } from './types'
import { RAG_CONFIG } from './types'

/**
 * zstd圧縮ファイルを取得・解凍
 */
async function fetchAndDecompressZstd(url: string): Promise<string> {
    console.log(`[RAG] Fetching from ${url}`)

    try {
        const response = await fetch(url)
        if (!response.ok) {
            throw new Error(`Failed to fetch ${url}: ${response.statusText}`)
        }

        const compressed = await response.arrayBuffer()
        console.log(`[RAG] Decompressing ${compressed.byteLength} bytes`)

        // @hpcc-js/wasm-zstd を動的にインポート
        const zstdModule = await import('@hpcc-js/wasm-zstd') as any
        // decompress 関数を取得（モジュール構造に応じて対応）
        const decompress = zstdModule.decompress || zstdModule.default?.decompress || zstdModule.Zstd?.decompress
        if (!decompress) {
            throw new Error('decompress function not found in zstd module')
        }
        const decompressed = decompress(new Uint8Array(compressed))
        const text = new TextDecoder().decode(decompressed)

        return text
    } catch (error) {
        console.error('[RAG] zstd decompression error:', error)
        throw new Error(`Failed to decompress ${url}: ${error instanceof Error ? error.message : String(error)}`)
    }
}

/**
 * YAMLをパース
 */
function parseYaml<T>(content: string): T[] {
    try {
        const parsed = YAML.load(content)
        if (!Array.isArray(parsed)) {
            console.warn('[RAG] YAML parse result is not an array')
            return []
        }
        return parsed as T[]
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

        request.onerror = () => resolve(null)
    })
}

/**
 * キャッシュにデータを保存
 */
async function setCacheData<T>(db: IDBDatabase, key: string, data: T): Promise<void> {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([RAG_CONFIG.CACHE_STORE_NAME], 'readwrite')
        const store = transaction.objectStore(RAG_CONFIG.CACHE_STORE_NAME)
        const request = store.put({ key, data, timestamp: Date.now() })

        request.onerror = () => reject(new Error(`Failed to cache ${key}`))
        request.onsuccess = () => resolve()
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
