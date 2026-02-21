/**
 * プロンプト管理システムの型定義
 */

/** プロンプト設定 */
export interface PromptConfig {
    /** システムプロンプト本体 */
    system_prompt: string

    /** インジェクション検知設定 */
    injection_detection: InjectionDetectionConfig
}

/** インジェクション検知設定 */
export interface InjectionDetectionConfig {
    /** インジェクション検知を有効化するか */
    enabled: boolean

    /** 検知対象のキーワード */
    keywords: string[]

    /** 危険度スレッショルド (0.0-1.0) */
    danger_threshold: number

    /** インジェクション検知時のアクション */
    actions: InjectionActions
}

/** インジェクション検知時のアクション */
export interface InjectionActions {
    /** ユーザーに警告を表示するか */
    notify: boolean

    /** コンソールにログを出力するか */
    log: boolean

    /** メッセージを処理しないか */
    block: boolean
}

/** インジェクション検知結果 */
export interface InjectionDetectionResult {
    /** インジェクションの可能性がアるか */
    isDetected: boolean

    /** 危険度スコア (0.0-1.0) */
    dangerScore: number

    /** 検知されたキーワード */
    detectedKeywords: string[]

    /** 警告メッセージ */
    warningMessage: string
}

/** メッセージとシステムプロンプトのペア */
export interface MessageWithSystemPrompt {
    /** フルシステムプロンプト */
    systemPrompt: string

    /** ユーザーメッセージ */
    userMessage: string

    /** インジェクション検知結果 */
    injectionDetection: InjectionDetectionResult
}
