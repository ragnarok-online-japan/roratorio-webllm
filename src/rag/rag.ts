/**
 * ラグナロクオンライン装備最適化RAGロジック
 */

import type {
    RAGContext,
    RAGSearchResult,
    RAGResponse,
    PlayerProfile,
    EquipmentRecommendation,
    ItemDataParameter,
} from './types'
import { RAG_CONFIG } from './types'

/**
 * テキスト正規化（検索用）
 */
function normalizeText(text: string | null | undefined): string {
    if (!text) return ''
    return String(text)
        .toLowerCase()
        .replace(/[ー—−]/g, '') // 長音記号を削除
        .trim()
}

/**
 * 関連性スコア計算（キーワード一致度）
 */
function calculateRelevanceScore(text: string | null | undefined, query: string): number {
    const normalized = normalizeText(text)
    const normalizedQuery = normalizeText(query)

    if (!normalized || !normalizedQuery) return 0
    if (normalized === normalizedQuery) return 1.0
    if (normalized.includes(normalizedQuery)) return 0.8
    if (query.split(' ').some((word) => normalized.includes(normalizeText(word)))) return 0.5
    return 0
}

/**
 * RAGコンテキストでアイテムを検索
 */
export function searchItems(
    context: RAGContext,
    query: string,
    limit: number = RAG_CONFIG.SEARCH_MAX_RESULTS.items
): RAGSearchResult[] {
    const results: RAGSearchResult[] = []

    context.items.forEach((item) => {
        let score = 0
        let matchReason = ''

        // 名前での一致
        const nameScore = calculateRelevanceScore(item.displayname, query)
        if (nameScore > 0) {
            score = Math.max(score, nameScore)
            matchReason = `Name match: "${item.displayname}"`
        }

        // 説明での一致
        if (item.description) {
            const descScore = calculateRelevanceScore(item.description, query)
            if (descScore > 0 && descScore > score) {
                score = descScore
                matchReason = `Description match`
            }
        }

        // タイプでの一致
        const typeScore = calculateRelevanceScore(item.type, query)
        if (typeScore > 0 && typeScore > score) {
            score = typeScore
            matchReason = `Type match: "${item.type}"`
        }

        // シリーズでの一致
        if (item.series) {
            const seriesScore = calculateRelevanceScore(item.series, query)
            if (seriesScore > 0 && seriesScore > score) {
                score = seriesScore
                matchReason = `Series match: "${item.series}"`
            }
        }

        if (score > 0) {
            results.push({
                type: 'item',
                id: item.id,
                name: item.displayname,
                relevanceScore: score,
                data: item,
                matchReason,
            })
        }
    })

    // スコアでソート
    return results.sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, limit)
}

/**
 * RAGコンテキストでスキルを検索
 */
export function searchSkills(
    context: RAGContext,
    query: string,
    limit: number = RAG_CONFIG.SEARCH_MAX_RESULTS.skills
): RAGSearchResult[] {
    const results: RAGSearchResult[] = []

    context.skills.forEach((skill) => {
        let score = 0
        let matchReason = ''

        const nameScore = calculateRelevanceScore(skill.name, query)
        if (nameScore > 0) {
            score = nameScore
            matchReason = `Name match: "${skill.name}"`
        }

        // スキルID での一致
        const idScore = calculateRelevanceScore(skill.id, query)
        if (idScore > 0 && idScore > score) {
            score = idScore
            matchReason = `ID match: "${skill.id}"`
        }

        if (score > 0) {
            results.push({
                type: 'skill',
                id: skill.id_num,
                name: skill.name || `Skill ${skill.id_num}`,
                relevanceScore: score,
                data: skill,
                matchReason,
            })
        }
    })

    return results.sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, limit)
}

/**
 * RAGコンテキストで職業を検索
 */
export function searchJobs(
    context: RAGContext,
    query: string,
    limit: number = RAG_CONFIG.SEARCH_MAX_RESULTS.jobs
): RAGSearchResult[] {
    const results: RAGSearchResult[] = []

    context.jobs.forEach((job) => {
        let score = 0
        let matchReason = ''

        // 名前（英語）での一致
        const nameScore = calculateRelevanceScore(job.name, query)
        if (nameScore > 0) {
            score = nameScore
            matchReason = `Name match: "${job.name}"`
        }

        // 名前（日本語）での一致
        if (!score || score < 0.9) {
            const nameJaScore = calculateRelevanceScore(job.name_ja, query)
            if (nameJaScore > score) {
                score = nameJaScore
                matchReason = `Japanese name match: "${job.name_ja}"`
            }
        }

        // 別名での一致
        if (job.name_alias && !score) {
            for (const alias of job.name_alias) {
                const aliasScore = calculateRelevanceScore(alias, query)
                if (aliasScore > score) {
                    score = aliasScore
                    matchReason = `Alias match: "${alias}"`
                }
            }
        }

        if (score > 0) {
            results.push({
                type: 'job',
                id: job.id_num,
                name: job.name_ja || job.name,
                relevanceScore: score,
                data: job,
                matchReason,
            })
        }
    })

    return results.sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, limit)
}

/**
 * 統合検索（アイテム・スキル・職業）
 */
export function searchAll(
    context: RAGContext,
    query: string,
    limits?: { items?: number; skills?: number; jobs?: number }
): RAGResponse {
    const startTime = performance.now()

    const itemResults = searchItems(context, query, limits?.items ?? RAG_CONFIG.SEARCH_MAX_RESULTS.items)
    const skillResults = searchSkills(context, query, limits?.skills ?? RAG_CONFIG.SEARCH_MAX_RESULTS.skills)
    const jobResults = searchJobs(context, query, limits?.jobs ?? RAG_CONFIG.SEARCH_MAX_RESULTS.jobs)

    const allResults = [...itemResults, ...skillResults, ...jobResults]

    const executionTime = performance.now() - startTime

    return {
        results: allResults,
        executionTime,
        totalResults: allResults.length,
    }
}

/**
 * 装備最適化推奨エンジン
 */
export function recommendEquipment(
    context: RAGContext,
    profile: PlayerProfile
): EquipmentRecommendation {
    // プレイヤーの職業情報を取得
    const job = context.jobs.get(profile.jobId) || context.jobs.get(profile.jobName)

    if (!job) {
        throw new Error(`Job not found: ${profile.jobId || profile.jobName}`)
    }

    const equipmentSet = new Map<string, ItemDataParameter>()
    const availableItems = Array.from(context.items.values())
        .filter((item) => {
            // 職業要件のチェック
            if (item.jobs && Array.isArray(item.jobs)) {
                const isCompatible = item.jobs.includes(job.name) || item.jobs.includes(job.name_ja)
                if (!isCompatible) return false
            }

            // レベル要件のチェック
            if (item.required_lv && item.required_lv > profile.baseLevel) {
                return false
            }

            return true
        })
        .sort((a, b) => {
            // 攻撃力優先でソート（カスタマイズ可能）
            const aAtk = (a.atk || 0) + (a.matk || 0)
            const bAtk = (b.atk || 0) + (b.matk || 0)
            return bAtk - aAtk
        })

    // 推奨装備セットを構築
    const recommendedSlots = ['weapon', 'armor', 'garment', 'footgear', 'accessory']
    let totalDef = 0
    let totalMdef = 0
    const skillSynergies: string[] = []

    recommendedSlots.forEach((slot) => {
        const suitable = availableItems.find((item) => {
            if (
                item.position === slot ||
                item.card_position === slot ||
                String(item.type).toLowerCase().includes(slot)
            ) {
                if (!equipmentSet.has(slot)) {
                    return true
                }
            }
            return false
        })

        if (suitable) {
            equipmentSet.set(slot, suitable)
            totalDef += suitable.def || 0
            totalMdef += suitable.mdef || 0
        }
    })

    // サポートスキルを検索
    if (profile.baseLevel <= 50) {
        // 低レベル推奨スキル
        const basicSkills = Array.from(context.skills.values()).filter(
            (skill) => skill.max_lv && skill.max_lv <= 5
        )
        skillSynergies.push(...basicSkills.slice(0, 3).map((s) => s.name || `Skill ${s.id}`))
    }

    return {
        jobId: job.id_num,
        jobName: job.name_ja || job.name,
        equipmentSet,
        totalDef,
        totalMdef,
        skillSynergies,
        reasoning: `Recommended equipment set for ${job.name_ja || job.name} (Level ${profile.baseLevel})`,
        confidence: 0.7,
    }
}
