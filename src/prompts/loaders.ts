/**
 * プロンプト管理モジュール
 * YAML形式のプロンプト設定を読み込み、インジェクション検知を行う
 */

import type {
    PromptConfig,
    InjectionDetectionResult,
    MessageWithSystemPrompt,
} from './types'

/** yaml-jsライクの簡易YAML解析器 */
function parseYaml(yamlText: string): Record<string, any> {
    const lines = yamlText.split('\n')
    const result: Record<string, any> = {}
    let currentKey: string | null = null
    let currentIndent = 0

    for (const line of lines) {
        // コメント行と空行をスキップ
        if (line.trim().startsWith('#') || line.trim() === '') {
            continue
        }

        // インデント計算
        const indent = line.length - line.trimStart().length
        const trimmed = line.trim()

        // キー値のパース
        if (trimmed.includes(':')) {
            const colonIndex = trimmed.indexOf(':')
            const key = trimmed.substring(0, colonIndex).trim()
            let value: string | null = trimmed.substring(colonIndex + 1).trim()

            if (!value) {
                // パイプ記号でマルチラインテキスト開始
                if (
                    trimmed.endsWith('|') ||
                    trimmed.endsWith('|-') ||
                    trimmed.endsWith('|+')
                ) {
                    result[key] = ''
                    currentKey = key
                    currentIndent = indent
                } else {
                    result[key] = null
                }
            } else {
                // クォートを削除
                if ((value.startsWith("'") && value.endsWith("'")) ||
                    (value.startsWith('"') && value.endsWith('"'))) {
                    value = value.slice(1, -1)
                }

                // 単純な値の場合
                if (value === 'true') {
                    result[key] = true
                } else if (value === 'false') {
                    result[key] = false
                } else if (value === 'null') {
                    result[key] = null
                } else if (!isNaN(Number(value))) {
                    result[key] = Number(value)
                } else {
                    result[key] = value
                }
            }
        } else if (currentKey && line.startsWith(' ')) {
            // マルチラインテキストの続きの行
            if (typeof result[currentKey] === 'string') {
                result[currentKey] += '\n' + line.substring(currentIndent + 2)
            }
        }
    }

    return result
}

/**
 * YAMLファイルからプロンプト設定を読み込む
 * @returns PromptConfig オブジェクト
 */
export async function loadPromptConfig(): Promise<PromptConfig> {
    try {
        // publicフォルダからYAMLファイルを取得
        const response = await fetch('/prompts.yaml')

        if (!response.ok) {
            throw new Error(
                `Failed to fetch prompts.yaml: ${response.status} ${response.statusText}`
            )
        }

        const yamlText = await response.text()

        // 簡易YAML解析器を使用してパース
        const parsed = parseYaml(yamlText) as Record<string, any>

        // インジェクション検知キーワードがネストしている場合の処理
        const injectionKeywords = Array.isArray(parsed.injection_detection?.keywords)
            ? parsed.injection_detection.keywords
            : Array.isArray(parsed.keywords)
                ? parsed.keywords
                : []

        // PromptConfigに変換
        const config: PromptConfig = {
            system_prompt: parsed.system_prompt || '',
            injection_detection: {
                enabled: parsed.injection_detection?.enabled ?? true,
                keywords: injectionKeywords,
                danger_threshold: parseFloat(
                    parsed.injection_detection?.danger_threshold || '0.5'
                ),
                actions: {
                    notify: parsed.injection_detection?.actions?.notify ?? true,
                    log: parsed.injection_detection?.actions?.log ?? true,
                    block: parsed.injection_detection?.actions?.block ?? true,
                },
            },
        }

        console.log('[Prompts] Configuration loaded successfully')
        return config
    } catch (error) {
        console.error('[Prompts] Failed to load configuration:', error)
        const errorMessage =
            error instanceof Error
                ? error.message
                : 'Unknown error occurred'
        throw new Error(`プロンプト設定の読み込みに失敗しました。設定を確認してください。[${errorMessage}]`)
    }
}

/**
 * ユーザーメッセージからプロンプトインジェクションを検知する
 * @param userMessage ユーザーメッセージ
 * @param config プロンプト設定
 * @returns 検知結果
 */
export function detectInjection(
    userMessage: string,
    config: PromptConfig
): InjectionDetectionResult {
    const result: InjectionDetectionResult = {
        isDetected: false,
        dangerScore: 0,
        detectedKeywords: [],
        warningMessage: '',
    }

    if (!config.injection_detection.enabled) {
        return result
    }

    const messageLower = userMessage.toLowerCase()
    const detectedKeywords: string[] = []

    // キーワード検索
    for (const keyword of config.injection_detection.keywords) {
        if (messageLower.includes(keyword.toLowerCase())) {
            detectedKeywords.push(keyword)
        }
    }

    // 危険度スコアを計算（検知されたキーワード数による）
    const dangerScore = Math.min(
        1.0,
        detectedKeywords.length * 0.3 // 各キーワード検知で危険度0.3を追加
    )

    result.detectedKeywords = detectedKeywords
    result.dangerScore = dangerScore

    // スレッショルド以上なら検知
    if (dangerScore >= config.injection_detection.danger_threshold) {
        result.isDetected = true
        result.warningMessage = `⚠️ 警告: 不適切な命令パターンが検出されました。\nシステムメッセージの改変を試みないようお願いします。\n検知パターン: ${detectedKeywords.join(', ')}`

        if (config.injection_detection.actions.log) {
            console.warn(
                `[Prompts] Injection detected in message:`,
                {
                    message: userMessage,
                    detectedKeywords,
                    dangerScore,
                }
            )
        }
    }

    return result
}

/**
 * ユーザーメッセージにシステムプロンプトを付与する
 * @param systemPrompt システムプロンプト
 * @param userMessage ユーザーメッセージ
 * @param config プロンプト設定
 * @returns メッセージとシステムプロンプトの組み合わせ、およびインジェクション検知結果
 */
export function compileMessageWithSystemPrompt(
    systemPrompt: string,
    userMessage: string,
    config: PromptConfig
): MessageWithSystemPrompt {
    // インジェクション検知
    const injectionDetection = detectInjection(userMessage, config)

    return {
        systemPrompt,
        userMessage,
        injectionDetection,
    }
}

/**
 * インジェクションが検知された場合の警告メッセージを取得
 */
export function getInjectionWarningMessage(
    result: InjectionDetectionResult
): string {
    return result.warningMessage
}

/**
 * ユーザーメッセージがプロンプトインジェクションの可能性があるかチェック
 */
export function shouldBlockMessage(
    result: InjectionDetectionResult,
    config: PromptConfig
): boolean {
    return result.isDetected && config.injection_detection.actions.block
}
