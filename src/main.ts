import './style.css'
import * as webllm from '@mlc-ai/web-llm'

// セキュリティ設定
const SECURITY_CONFIG = {
    MAX_MESSAGE_LENGTH: 2000,
    MAX_CHAT_HISTORY: 50,
    MAX_DAILY_REQUESTS: 1000,
    MESSAGE_TIMEOUT_MS: 120000, // 2分
} as const

// IndexedDB設定
const DB_CONFIG = {
    DB_NAME: 'WebLLMChat',
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

interface AppState {
    engine: webllm.MLCEngine | null
    messages: Message[]
    isLoading: boolean
    selectedModel: string
    requestCount: number
    db: IDBDatabase | null
}

const AVAILABLE_MODELS = [
    'Llama-3.1-8B-Instruct-q4f32_1-MLC',
    'Mistral-7B-Instruct-v0.3-q4f32_1-MLC',
    'NeuralHermes-2.5-Mistral-7B-q4f16_1-MLC',
] as const

const state: AppState = {
    engine: null,
    messages: [],
    isLoading: false,
    selectedModel: AVAILABLE_MODELS[0],
    requestCount: 0,
    db: null,
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

            // オブジェクトストアが存在しない場合に作成
            if (!db.objectStoreNames.contains(DB_CONFIG.STORE_NAME)) {
                const store = db.createObjectStore(DB_CONFIG.STORE_NAME, {
                    keyPath: 'id',
                    autoIncrement: true,
                })
                store.createIndex(DB_CONFIG.INDEX_NAME, 'timestamp', {
                    unique: false,
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
    if (!state.engine) return

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

        // タイムアウトラッパー付きで実行
        const response = await Promise.race([
            state.engine.chat.completions.create({
                messages: state.messages,
                temperature: 0.7,
                max_tokens: 512,
            }),
            new Promise((_, reject) =>
                setTimeout(
                    () => reject(new Error('Request timeout')),
                    SECURITY_CONFIG.MESSAGE_TIMEOUT_MS
                )
            ),
        ])

        const completionsResponse = response as any
        const assistantMessage =
            completionsResponse.choices[0]?.message?.content ||
            'エラーが発生しました'

        state.messages.push({ role: 'assistant', content: assistantMessage })
        renderMessage('assistant', assistantMessage)

        // IndexedDBに保存
        await saveMessage({ role: 'assistant', content: assistantMessage })

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

// メッセージをUIに表示
function renderMessage(role: 'user' | 'assistant', content: string): void {
    const messageDiv = document.createElement('div')
    messageDiv.className = `message message-${role}`

    const contentDiv = document.createElement('div')
    contentDiv.className = 'message-content'
    // XSS対策: textContentを使用（HTMLとして解析しない）
    contentDiv.textContent = content

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

initialize().catch((error) => {
    console.error('Initialization error:', error)
    statusElement.textContent =
        'アプリケーションの初期化に失敗しました。ページをリロードしてください。'
})
