import './style.css'
import * as webllm from '@mlc-ai/web-llm'
import { initializeRAGContext } from './rag/loaders'
import { searchAll } from './rag/rag'
import type { RAGContext } from './rag/types'
import {
    loadPromptConfig,
    compileMessageWithSystemPrompt,
    getInjectionWarningMessage,
    shouldBlockMessage,
} from './prompts/loaders'
import type { PromptConfig } from './prompts/types'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

// セキュリティ設定
const SECURITY_CONFIG = {
    MAX_MESSAGE_LENGTH: 2000,
    MAX_CHAT_HISTORY: 50,
    MAX_DAILY_REQUESTS: 1000,
    MESSAGE_TIMEOUT_MS: 120000, // 2分
} as const

// IndexedDB設定
const DB_CONFIG = {
    DB_NAME: 'ROratorio-WebLLM',
    DB_VERSION: 1,
    STORE_NAME: 'messages',
    INDEX_NAME: 'timestamp',
} as const

// 型定義
interface Message {
    role: 'user' | 'assistant'
    content: string
}

interface StoredMessage extends Message {
    id?: number
    timestamp: number
}

interface ChatStats {
    promptTokens: number
    completionTokens: number
    prefillSpeed: number | null
    decodingSpeed: number | null
}

interface AppState {
    engine: webllm.MLCEngine | null
    messages: Message[]
    isLoading: boolean
    selectedModel: string
    requestCount: number
    db: IDBDatabase | null
    ragContext: RAGContext | null
    promptConfig: PromptConfig | null
    lastStats: ChatStats | null
}

const AVAILABLE_MODELS = [
    'gemma-2-2b-jpn-it-q4f16_1-MLC',
    'Llama-3.1-8B-Instruct-q4f32_1-MLC',
    // 'Mistral-7B-Instruct-v0.3-q4f32_1-MLC', //Disabled
    // 'NeuralHermes-2.5-Mistral-7B-q4f16_1-MLC', //Disabled
] as const

const state: AppState = {
    engine: null,
    messages: [],
    isLoading: false,
    selectedModel: AVAILABLE_MODELS[0],
    requestCount: 0,
    db: null,
    ragContext: null,
    promptConfig: null,
    lastStats: null,
}

// DOM要素の取得
const chatMessages = document.querySelector<HTMLDivElement>('#chat-messages')!
const messageInput = document.querySelector<HTMLInputElement>('#message-input')!
const sendButton = document.querySelector<HTMLButtonElement>('#send-button')!
const modelSelect = document.querySelector<HTMLSelectElement>('#model-select')!
const statusElement = document.querySelector<HTMLDivElement>('#status')!
const clearButton = document.querySelector<HTMLButtonElement>('#clear-button')!
const errorDialog = document.querySelector<HTMLDivElement>('#error-dialog')!
const dialogCloseButton = document.querySelector<HTMLButtonElement>('#dialog-close-button')!
const spinnerContainer = document.querySelector<HTMLDivElement>('#spinner-container')!
const configErrorDialog = document.querySelector<HTMLDivElement>('#config-error-dialog')!
const configErrorCloseButton = document.querySelector<HTMLButtonElement>('#config-error-close-button')!
const configErrorMessage = document.querySelector<HTMLDivElement>('#config-error-message')!
const statPrompt = document.querySelector<HTMLSpanElement>('#stat-prompt')!
const statCompletion = document.querySelector<HTMLSpanElement>('#stat-completion')!
const statTotal = document.querySelector<HTMLSpanElement>('#stat-total')!
const statPrefill = document.querySelector<HTMLSpanElement>('#stat-prefill')!
const statDecoding = document.querySelector<HTMLSpanElement>('#stat-decoding')!

// ============================================================================
// IndexedDB管理
// ============================================================================

async function initializeDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_CONFIG.DB_NAME, DB_CONFIG.DB_VERSION)

        request.onerror = () => {
            console.error('Database initialization failed:', request.error)
            reject(new Error('Failed to initialize database'))
        }

        request.onsuccess = () => {
            state.db = request.result
            console.log('Database initialized successfully')
            resolve()
        }

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result

            // チャット履歴用オブジェクトストア作成
            if (!db.objectStoreNames.contains(DB_CONFIG.STORE_NAME)) {
                const store = db.createObjectStore(DB_CONFIG.STORE_NAME, {
                    keyPath: 'id',
                    autoIncrement: true,
                })
                store.createIndex(DB_CONFIG.INDEX_NAME, 'timestamp', {
                    unique: false,
                })
            }

            // RAGキャッシュ用オブジェクトストア作成
            if (!db.objectStoreNames.contains('rawData')) {
                db.createObjectStore('rawData', {
                    keyPath: 'key',
                })
            }
        }
    })
}

async function saveMessage(message: Message): Promise<void> {
    if (!state.db) return

    return new Promise((resolve, reject) => {
        const transaction = state.db!.transaction(
            [DB_CONFIG.STORE_NAME],
            'readwrite'
        )
        const store = transaction.objectStore(DB_CONFIG.STORE_NAME)

        const storedMessage: StoredMessage = {
            ...message,
            timestamp: Date.now(),
        }

        const request = store.add(storedMessage)

        request.onerror = () => {
            console.error('Failed to save message:', request.error)
            reject(new Error('Failed to save message'))
        }

        request.onsuccess = () => {
            resolve()
        }
    })
}

async function loadMessages(): Promise<Message[]> {
    if (!state.db) return []

    return new Promise((resolve, reject) => {
        const transaction = state.db!.transaction(
            [DB_CONFIG.STORE_NAME],
            'readonly'
        )
        const store = transaction.objectStore(DB_CONFIG.STORE_NAME)
        const index = store.index(DB_CONFIG.INDEX_NAME)

        const request = index.getAll()

        request.onerror = () => {
            console.error('Failed to load messages:', request.error)
            reject(new Error('Failed to load messages'))
        }

        request.onsuccess = () => {
            const storedMessages = (request.result as StoredMessage[]) || []
            // タイムスタンプで昇順に並べ替え
            storedMessages.sort((a, b) => a.timestamp - b.timestamp)
            // idとtimestampを除去してMessage型に戻す
            const messages = storedMessages.map(({ id, timestamp, ...msg }) => msg)
            resolve(messages)
        }
    })
}

async function clearMessages(): Promise<void> {
    if (!state.db) return

    return new Promise((resolve, reject) => {
        const transaction = state.db!.transaction(
            [DB_CONFIG.STORE_NAME],
            'readwrite'
        )
        const store = transaction.objectStore(DB_CONFIG.STORE_NAME)
        const request = store.clear()

        request.onerror = () => {
            console.error('Failed to clear messages:', request.error)
            reject(new Error('Failed to clear messages'))
        }

        request.onsuccess = () => {
            resolve()
        }
    })
}

// バリデーション関数
function isValidModel(model: string): model is typeof AVAILABLE_MODELS[number] {
    return AVAILABLE_MODELS.includes(model as any)
}

// WebGPUエラー検出関数
function isWebGPUError(error: unknown): boolean {
    const errorMessage = String(error)
    const webgpuKeywords = [
        'GPU',
        'WebGPU',
        'compatible',
        'browser supports',
        'Unable to find',
    ]
    return webgpuKeywords.some((keyword) =>
        errorMessage.toLowerCase().includes(keyword.toLowerCase())
    )
}

// WebGPUエラーダイアログ表示関数
function showWebGPUErrorDialog(): void {
    errorDialog.style.display = 'flex'
    // アプリケーションの入力要素を無効化
    sendButton.disabled = true
    messageInput.disabled = true
    modelSelect.disabled = true
}

// WebGPUエラーダイアログを閉じる関数
function closeWebGPUErrorDialog(): void {
    errorDialog.style.display = 'none'
}

// 設定エラーダイアログを表示する関数
function showConfigErrorDialog(message: string): void {
    configErrorMessage.textContent = message
    configErrorDialog.style.display = 'flex'
    // アプリケーションの入力要素を無効化
    sendButton.disabled = true
    messageInput.disabled = true
    modelSelect.disabled = true
}

// 設定エラーダイアログを閉じる関数
function closeConfigErrorDialog(): void {
    configErrorDialog.style.display = 'none'
}

// Chat Stats更新関数
function updateChatStats(stats: ChatStats): void {
    state.lastStats = stats

    statPrompt.textContent = String(stats.promptTokens)
    statCompletion.textContent = String(stats.completionTokens)
    statTotal.textContent = String(stats.promptTokens + stats.completionTokens)
    statPrefill.textContent =
        stats.prefillSpeed !== null ? `${stats.prefillSpeed.toFixed(1)} tok/s` : '-'
    statDecoding.textContent =
        stats.decodingSpeed !== null ? `${stats.decodingSpeed.toFixed(1)} tok/s` : '-'
}

function validateMessage(message: string): { valid: boolean; error?: string } {
    const trimmed = message.trim()

    if (trimmed.length === 0) {
        return { valid: false, error: 'メッセージが空です' }
    }

    if (trimmed.length > SECURITY_CONFIG.MAX_MESSAGE_LENGTH) {
        return {
            valid: false,
            error: `メッセージは${SECURITY_CONFIG.MAX_MESSAGE_LENGTH}文字以内にしてください`,
        }
    }

    return { valid: true }
}

function trimChatHistory(): void {
    if (state.messages.length > SECURITY_CONFIG.MAX_CHAT_HISTORY) {
        state.messages = state.messages.slice(
            -SECURITY_CONFIG.MAX_CHAT_HISTORY
        )
    }
}

function getRateLimitStatus(): { allowed: boolean; message?: string } {
    if (state.requestCount >= SECURITY_CONFIG.MAX_DAILY_REQUESTS) {
        return {
            allowed: false,
            message: 'リクエスト数の上限に達しました。後でお試しください。',
        }
    }

    return { allowed: true }
}

// イベントリスナー設定
modelSelect.addEventListener('change', async (e: Event) => {
    const target = e.target as HTMLSelectElement
    const selectedValue = target.value

    // モデルの検証
    if (!isValidModel(selectedValue)) {
        console.error('Invalid model selected:', selectedValue)
        statusElement.textContent = '無効なモデルが選択されました'
        return
    }

    state.selectedModel = selectedValue
    statusElement.textContent = 'モデルを切り替えています...'
    await initializeEngine()
})

sendButton.addEventListener('click', async () => {
    const message = messageInput.value.trim()
    const validation = validateMessage(message)

    if (!validation.valid) {
        statusElement.textContent = validation.error || 'エラーが発生しました'
        return
    }

    if (!state.isLoading && state.engine) {
        await sendMessage(message)
    }
})

messageInput.addEventListener('keypress', async (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !state.isLoading && state.engine) {
        e.preventDefault()
        const message = messageInput.value.trim()
        const validation = validateMessage(message)

        if (!validation.valid) {
            statusElement.textContent = validation.error || 'エラーが発生しました'
            return
        }

        await sendMessage(message)
    }
})

// エンジン初期化
async function initializeEngine(): Promise<void> {
    try {
        if (state.engine) {
            state.engine = null
            state.messages = []
        }

        statusElement.textContent = `${state.selectedModel} をロード中...`
        sendButton.disabled = true
        messageInput.disabled = true
        modelSelect.disabled = true

        // MLCEngineの初期化
        state.engine = new webllm.MLCEngine({
            initProgressCallback: (progress: webllm.InitProgressReport) => {
                statusElement.textContent = `ロード中: ${progress.text}`
            },
        })

        await state.engine.reload(state.selectedModel)
        statusElement.textContent = `${state.selectedModel} の準備完了`
        sendButton.disabled = false
        messageInput.disabled = false
        modelSelect.disabled = false
    } catch (error) {
        console.error('Engine initialization error:', error)

        // WebGPUエラーの判定
        if (isWebGPUError(error)) {
            showWebGPUErrorDialog()
            statusElement.textContent = 'WebGPUが利用できません'
        } else {
            statusElement.textContent =
                'モデルのロードに失敗しました。ページをリロードしてお試しください。'
            sendButton.disabled = true
            messageInput.disabled = true
            modelSelect.disabled = false
        }
    }
}

// スピナーを表示
function showSpinner(): void {
    spinnerContainer.style.display = 'flex'
}

// スピナーを非表示
function hideSpinner(): void {
    spinnerContainer.style.display = 'none'
}

// メッセージ送信
async function sendMessage(userMessage: string): Promise<void> {
    if (!state.engine || !state.promptConfig) return

    // プロンプトインジェクション検知
    const messageWithPrompt = compileMessageWithSystemPrompt(
        state.promptConfig.system_prompt,
        userMessage,
        state.promptConfig
    )

    if (messageWithPrompt.injectionDetection.isDetected) {
        // インジェクション検知時の処理
        if (state.promptConfig.injection_detection.actions.notify) {
            renderMessage(
                'assistant',
                getInjectionWarningMessage(messageWithPrompt.injectionDetection)
            )
        }

        if (shouldBlockMessage(
            messageWithPrompt.injectionDetection,
            state.promptConfig
        )) {
            statusElement.textContent = 'セキュリティ警告: メッセージを処理できません'
            return
        }
    }

    // レート制限チェック
    const rateLimit = getRateLimitStatus()
    if (!rateLimit.allowed) {
        statusElement.textContent = rateLimit.message || 'エラーが発生しました'
        return
    }

    state.isLoading = true
    sendButton.disabled = true
    messageInput.value = ''
    showSpinner()

    // ユーザーメッセージを追加
    state.messages.push({ role: 'user', content: userMessage })
    renderMessage('user', userMessage)

    // IndexedDBに保存
    await saveMessage({ role: 'user', content: userMessage })

    // チャット履歴の制限
    trimChatHistory()

    try {
        state.requestCount++

        // RAG検索を実行（コンテキスト情報を取得）
        let ragContextMessage = ''
        if (state.ragContext) {
            try {
                const ragResults = searchAll(state.ragContext, userMessage, {
                    items: 3,
                    skills: 2,
                    jobs: 1,
                })

                if (ragResults.totalResults > 0) {
                    ragContextMessage = `\n\n【ラグナロクオンライン情報】\n${ragResults.results
                        .slice(0, 5)
                        .map((r) => `- ${r.name} (${r.type}): ${r.matchReason}`)
                        .join('\n')}`
                }
            } catch (ragError) {
                console.error('RAG search error:', ragError)
                // RAGエラーはスキップして続行
            }
        }

        // LLMのメッセージ配列を構築
        // システムプロンプト + チャット履歴 + RAGコンテキスト
        const messagesForLLM: Array<{ role: string; content: string }> = [
            {
                role: 'system',
                content: state.promptConfig.system_prompt,
            },
            ...state.messages.map((msg, index) => {
                if (index === state.messages.length - 1 && msg.role === 'user') {
                    return {
                        ...msg,
                        content: msg.content + ragContextMessage,
                    }
                }
                return msg
            }),
        ]

        // タイムアウトラッパー付きでストリーミング実行
        const stream = await Promise.race([
            state.engine.chat.completions.create({
                messages: messagesForLLM as any,
                temperature: 0.7,
                max_tokens: 512,
                stream: true,
                stream_options: {
                    include_usage: true,
                },
            }),
            new Promise((_, reject) =>
                setTimeout(
                    () => reject(new Error('Request timeout')),
                    SECURITY_CONFIG.MESSAGE_TIMEOUT_MS
                )
            ),
        ]) as any

        let assistantMessage = ''
        let lastMessageElement: HTMLDivElement | null = null

        // ストリーミングレスポンスを処理
        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content
            if (content) {
                assistantMessage += content

                // 初回メッセージ表示の場合
                if (lastMessageElement === null) {
                    lastMessageElement = document.createElement('div')
                    lastMessageElement.className = 'message message-assistant'
                    const contentDiv = document.createElement('div')
                    contentDiv.className = 'message-content'
                    contentDiv.textContent = content
                    lastMessageElement.appendChild(contentDiv)
                    chatMessages.appendChild(lastMessageElement)
                } else {
                    // 既存のメッセージにテキストを追加
                    const contentDiv =
                        lastMessageElement.querySelector('.message-content')
                    if (contentDiv) {
                        contentDiv.textContent = assistantMessage
                    }
                }
                chatMessages.scrollTop = chatMessages.scrollHeight
            }

            // 最後のチャンクで統計情報を取得
            if (chunk.usage) {
                const promptTokens = chunk.usage.prompt_tokens || 0
                const completionTokens = chunk.usage.completion_tokens || 0
                const prefillSpeed =
                    chunk.usage.extra?.prefill_tokens_per_s || null
                const decodingSpeed =
                    chunk.usage.extra?.decode_tokens_per_s || null

                const stats: ChatStats = {
                    promptTokens,
                    completionTokens,
                    prefillSpeed,
                    decodingSpeed,
                }
                updateChatStats(stats)
            }
        }

        // メッセージを保存
        if (assistantMessage) {
            state.messages.push({ role: 'assistant', content: assistantMessage })
            await saveMessage({ role: 'assistant', content: assistantMessage })
        }

        trimChatHistory()
    } catch (error) {
        console.error('Message send error:', error)
        // ユーザー向けの安全なエラーメッセージ
        const errorMessage =
            error instanceof Error && error.message === 'Request timeout'
                ? 'リクエストがタイムアウトしました。もう一度お試しください。'
                : 'メッセージの送信に失敗しました。もう一度お試しください。'
        renderMessage('assistant', errorMessage)
    } finally {
        state.isLoading = false
        sendButton.disabled = false
        hideSpinner()
        messageInput.focus()
    }
}

// Markdownを安全なHTMLに変換する関数
function renderMarkdownString(markdown: string): DocumentFragment {
    try {
        // Markdownをパース
        const parsed = marked(markdown, {
            breaks: true,
            gfm: true, // GitHub Flavored Markdownを有効化
        })

        if (parsed instanceof Promise) {
            throw new Error('Async markdown rendering is not supported')
        }

        // DOMPurifyでサニタイズ（XSS対策）
        let sanitized = DOMPurify.sanitize(parsed as string, {
            ALLOWED_TAGS: [
                'p', 'br', 'strong', 'em', 'u', 'del', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                'blockquote', 'code', 'pre', 'ul', 'ol', 'li', 'a', 'img', 'table',
                'thead', 'tbody', 'tr', 'th', 'td', 'hr',
            ],
            ALLOWED_ATTR: ['href', 'title', 'alt', 'src'],
            KEEP_CONTENT: true,
        })

        // 不要な改行とbrタグを削除
        sanitized = (sanitized as string)
            .replace(/<p><br><\/p>/g, '') // 空のp+brを削除
            .replace(/<p><\/p>/g, '') // 空のpを削除
            .replace(/<br\s*\/?>\s*<br\s*\/?>/g, '<br>') // 連続するbrを1つに統合

        // DocumentFragmentに変換
        const fragment = document.createDocumentFragment()
        const tempDiv = document.createElement('div')
        tempDiv.innerHTML = sanitized as string
        while (tempDiv.firstChild) {
            fragment.appendChild(tempDiv.firstChild)
        }

        return fragment
    } catch (error) {
        console.error('Markdown rendering error:', error)
        // エラー時はプレーンテキストを返す
        const fragment = document.createDocumentFragment()
        const textNode = document.createTextNode(markdown)
        fragment.appendChild(textNode)
        return fragment
    }
}

// メッセージをUIに表示
function renderMessage(role: 'user' | 'assistant', content: string): void {
    const messageDiv = document.createElement('div')
    messageDiv.className = `message message-${role}`

    const contentDiv = document.createElement('div')
    contentDiv.className = 'message-content'

    // Assistantメッセージはmarkdown対応、Userメッセージはテキストのまま
    if (role === 'assistant') {
        const markdownContent = renderMarkdownString(content)
        contentDiv.appendChild(markdownContent)
    } else {
        contentDiv.textContent = content
    }

    messageDiv.appendChild(contentDiv)
    chatMessages.appendChild(messageDiv)
    chatMessages.scrollTop = chatMessages.scrollHeight
}

// 初期化
async function initialize(): Promise<void> {
    try {
        // モデル選択肢を安全に設定（innerHTML の代わりに createElement を使用）
        for (const model of AVAILABLE_MODELS) {
            const option = document.createElement('option')
            option.value = model
            option.textContent = model
            modelSelect.appendChild(option)
        }

        // IndexedDB初期化
        await initializeDatabase()

        // プロンプト設定を読み込み
        try {
            statusElement.textContent = 'プロンプト設定を読み込み中...'
            state.promptConfig = await loadPromptConfig()
            console.log('[App] Prompt configuration loaded successfully')
            statusElement.textContent = 'プロンプト設定の読み込み完了'
        } catch (promptError) {
            console.error('Prompt configuration loading error:', promptError)
            const errorMessage =
                promptError instanceof Error
                    ? promptError.message
                    : 'プロンプト設定の読み込みに失敗しました'
            showConfigErrorDialog(errorMessage)
            throw promptError
        }

        // RAGコンテキストを初期化
        try {
            statusElement.textContent = 'RAGデータを読み込み中...'
            state.ragContext = await initializeRAGContext(state.db || undefined)

            // RAGContext初期化確認
            if (state.ragContext) {
                console.log('[App] RAGContext initialized successfully')
                console.log(`[App] RAGContext status:`)
                console.log(`  - Items: ${state.ragContext.items.size}`)
                console.log(`  - Skills: ${state.ragContext.skills.size}`)
                console.log(`  - Jobs: ${state.ragContext.jobs.size}`)
                console.log(`[App] RAG search is now available for chat context`)
                statusElement.textContent = 'RAGデータの読み込み完了'
            } else {
                console.warn('[App] RAGContext is null after initialization')
                statusElement.textContent = 'RAGデータの読み込みに失敗しました（メッセージ送信は可能）'
            }
        } catch (ragError) {
            console.error('RAG initialization error:', ragError)
            statusElement.textContent = 'RAGデータの読み込みに失敗しました（メッセージ送信は可能）'
            // RAGのエラーはスキップして続行
        }

        // 過去の会話を読み込み
        const savedMessages = await loadMessages()
        if (savedMessages.length > 0) {
            state.messages = savedMessages
            // UIに表示
            for (const message of savedMessages) {
                renderMessage(message.role, message.content)
            }
            statusElement.textContent = `${savedMessages.length}件の過去の会話を読み込みました`
        }

        await initializeEngine()
    } catch (error) {
        console.error('Initialization error:', error)
        statusElement.textContent =
            'アプリケーションの初期化に失敗しました。ページをリロードしてください。'
    }
}

// クリアボタンのイベントリスナー
clearButton.addEventListener('click', async () => {
    if (!confirm('会話履歴を削除してもよろしいですか？\nこの操作は元に戻せません。')) {
        return
    }

    try {
        await clearMessages()
        state.messages = []
        chatMessages.innerHTML = ''
        statusElement.textContent = '会話履歴をクリアしました'
        messageInput.focus()
    } catch (error) {
        console.error('Failed to clear messages:', error)
        statusElement.textContent = '会話履歴のクリアに失敗しました'
    }
})

// WebGPUエラーダイアログのクローズボタン
dialogCloseButton.addEventListener('click', () => {
    closeWebGPUErrorDialog()
})

// 設定エラーダイアログのクローズボタン
configErrorCloseButton.addEventListener('click', () => {
    closeConfigErrorDialog()
})

initialize().catch((error) => {
    console.error('Initialization error:', error)
    statusElement.textContent =
        'アプリケーションの初期化に失敗しました。ページをリロードしてください。'
})
