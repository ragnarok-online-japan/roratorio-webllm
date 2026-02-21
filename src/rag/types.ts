/**
 * ラグナロクオンライン装備最適化RAGシステムの型定義
 * YAML データソースに基づいた型定義
 */

// ============================================================================
// 職業（Job）定義
// ============================================================================

export interface JobDataParameter {
    id_name: string
    id_num: number
    is_doram: boolean
    name: string
    name_ja: string
    name_alias: string[]
    is_rebirthed: boolean
    job_type_num: number
    job_type_name: string
    weight_correction: number
    weapons_aspd: Record<number, number>
    additional_status: Record<
        number,
        {
            name: string
            add_value: number
        }
    >
    hp_basic_values: number[]
    sp_basic_values: number[]
    learned_skills: Record<
        string,
        {
            id: string
            id_num: number
        }
    >
    passive_skills: Record<
        string,
        {
            id: string
            id_num: number
        }
    >
    attack_skills: Record<
        string,
        {
            id: string
            id_num: number
        }
    >
    allow_equipment_weapons_type: number[]
    base_lv_min: number
    base_lv_max: number
    job_lv_max: number
    status_basic_max: number
    status_talent_max: number
    _mig_id_num?: number
}

// ============================================================================
// スキル（Skill）定義
// ============================================================================

export interface SkillDataParameter {
    attack_range: Record<number, number> | null
    id: string
    id_num: number
    max_lv: number | null
    name: string | null
    need_skill_list: Array<{
        need_lv: number
        skill_id: string
    }>
    separate_lv: boolean | null
    sp_amount: Record<number, number> | null
    type: string | null
    _mig_id_num?: number | null
    _mig_id_name?: string | null
    _mig_name?: string | null
}

// ============================================================================
// アイテム（Item）定義
// ============================================================================

export interface ItemDataParameter {
    // 基本
    id: number
    displayname: string
    description: string
    is_card: boolean
    is_enchant: boolean
    resname: string
    type: string | null
    slot: number | undefined

    // 抽出フィールド
    series?: string | null
    position?: string | null
    card_position?: string | null
    attribute?: string | null
    def?: number
    mdef?: number
    atk?: number
    matk?: number
    weapon_lv?: number
    is_refine?: boolean
    is_breakable?: boolean
    weight?: number
    required_lv?: number
    jobs?: string[]

    // 効果カテゴリ
    stats?: Array<{ stat: string; value: number }>
    damage_bonus?: Array<{ condition: string; value: number }>
    race_bonus?: Array<{ target: string; value: number }>
    race_resist?: Array<{ target: string; value: number }>
    status_resist?: Array<{ status: string; value: number }>
    auto_spells?: Array<{ skill: string; level: number; chance?: string }>

    refine_bonus?: Array<{ per: number; stats: Array<{ stat: string; value: number }> }>
    refine_skill_bonus?: Array<{
        with?: string[]
        per: number
        skills: Array<{ name: string; bonus: number }>
    }>
    set_bonus?: Array<{
        with?: string[]
        with_any?: string[]
        refine?: number
        effects: unknown[]
    }>
    set_penalty?: Array<{
        with: string[]
        disable: string[]
    }>
    status_inflict?: Array<{
        condition: string
        status: string
        chance?: string
    }>
}

// ============================================================================
// RAGコンテキスト
// ============================================================================

export interface RAGContext {
    jobs: Map<number | string, JobDataParameter>
    skills: Map<number | string, SkillDataParameter>
    items: Map<number, ItemDataParameter>
    lastUpdated: number
    source: string
}

// ============================================================================
// RAG検索結果
// ============================================================================

export interface RAGSearchResult {
    type: 'item' | 'skill' | 'job'
    id: number | string
    name: string
    relevanceScore: number
    data: JobDataParameter | SkillDataParameter | ItemDataParameter
    matchReason: string
}

// ============================================================================
// RAGレスポンス
// ============================================================================

export interface RAGResponse {
    results: RAGSearchResult[]
    executionTime: number
    totalResults: number
}

// ============================================================================
// プレイヤープロフィール（装備最適化の入力）
// ============================================================================

export interface PlayerProfile {
    jobId: number | string
    jobName: string
    baseLevel: number
    jobLevel: number
    str?: number
    agi?: number
    vit?: number
    int?: number
    dex?: number
    luk?: number
    currentEquipment?: Record<string, number>
    preferences?: {
        prioritizeAttack?: boolean
        prioritizeMagic?: boolean
        prioritizeDefense?: boolean
        prioritizeSpeed?: boolean
    }
}

// ============================================================================
// 装備推奨
// ============================================================================

export interface EquipmentRecommendation {
    jobId: number | string
    jobName: string
    equipmentSet: Map<string, ItemDataParameter>
    totalAtk?: number
    totalMatk?: number
    totalDef?: number
    totalMdef?: number
    skillSynergies: string[]
    reasoning: string
    confidence: number
}

// ============================================================================
// RAG設定
// ============================================================================

export const RAG_CONFIG = {
    ITEM_URL: 'https://roratorio-hub.github.io/ratorio/dist/item.yaml.zst',
    SKILL_URL: 'https://roratorio-hub.github.io/ratorio/dist/skill.yaml.zst',
    JOB_URL: 'https://roratorio-hub.github.io/ratorio/dist/job.yaml.zst',
    CACHE_DB_NAME: 'RoDataCache',
    CACHE_DB_VERSION: 1,
    CACHE_STORE_NAME: 'rawData',
    CACHE_TTL_MS: 24 * 60 * 60 * 1000, // 24時間
    SEARCH_MAX_RESULTS: {
        items: 5,
        skills: 5,
        jobs: 3,
    },
} as const
