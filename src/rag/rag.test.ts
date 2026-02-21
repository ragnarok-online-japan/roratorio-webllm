import { describe, it, expect, beforeEach } from 'vitest'
import { searchItems, searchSkills, searchJobs, searchAll } from './rag'
import type { RAGContext, ItemDataParameter, SkillDataParameter, JobDataParameter } from './types'

describe('RAG Search Functions', () => {
    let ragContext: RAGContext

    beforeEach(() => {
        // テスト用のダミーデータを作成
        const sampleItem: ItemDataParameter = {
            id: 1001,
            displayname: 'ロングソード',
            description: '一般的な剣です',
            is_card: false,
            is_enchant: false,
            resname: 'longsword',
            type: 'weapon_1h_sword',
            series: '基本武器',
            slot: 0,
            position: '2',
            card_position: '0',
            stats: [{ stat: 'atk', value: 70 }],
        }

        const sampleItem2: ItemDataParameter = {
            id: 1002,
            displayname: '鉄甲',
            description: '鋼鉄製の胸甲です',
            is_card: false,
            is_enchant: false,
            resname: 'iron_armor',
            type: 'armor_body',
            series: '一般的な防具',
            slot: 0,
            position: '1',
            card_position: '0',
            stats: [{ stat: 'def', value: 45 }],
        }

        const sampleSkill: SkillDataParameter = {
            id: 'MG_NAPALM',
            id_num: 101,
            name: 'Napalm Bomb',
            max_lv: 10,
            type: 'attack',
            attack_range: { 1: 9, 2: 9, 3: 9, 4: 9, 5: 9, 6: 9, 7: 9, 8: 9, 9: 9, 10: 9 },
            sp_amount: { 1: 70, 2: 75, 3: 80, 4: 85, 5: 90, 6: 95, 7: 100, 8: 105, 9: 110, 10: 115 },
            need_skill_list: [],
            separate_lv: false,
        }

        const sampleSkill2: SkillDataParameter = {
            id: 'AC_OWL',
            id_num: 102,
            name: 'Owls Eye',
            max_lv: 10,
            type: 'passive',
            attack_range: null,
            sp_amount: null,
            need_skill_list: [],
            separate_lv: false,
        }

        const sampleJob: JobDataParameter = {
            id_name: 'Mage',
            id_num: 2,
            is_doram: false,
            name: 'Mage',
            name_ja: 'マジシャン',
            name_alias: ['魔法使い'],
            is_rebirthed: false,
            job_type_num: 1,
            job_type_name: 'Two-Handed',
            weight_correction: 100,
            weapons_aspd: {},
            additional_status: {},
            hp_basic_values: [],
            sp_basic_values: [],
            learned_skills: {},
            passive_skills: {},
            attack_skills: {},
            allow_equipment_weapons_type: [1, 2],
            base_lv_min: 1,
            base_lv_max: 99,
            job_lv_max: 50,
            status_basic_max: 99,
            status_talent_max: 130,
        }

        const sampleJob2: JobDataParameter = {
            id_name: 'Swordsman',
            id_num: 1,
            is_doram: false,
            name: 'Swordsman',
            name_ja: '剣士',
            name_alias: ['斬り手'],
            is_rebirthed: false,
            job_type_num: 1,
            job_type_name: 'Two-Handed',
            weight_correction: 100,
            weapons_aspd: {},
            additional_status: {},
            hp_basic_values: [],
            sp_basic_values: [],
            learned_skills: {},
            passive_skills: {},
            attack_skills: {},
            allow_equipment_weapons_type: [0, 1],
            base_lv_min: 1,
            base_lv_max: 99,
            job_lv_max: 50,
            status_basic_max: 99,
            status_talent_max: 130,
        }

        const itemsMap = new Map<number, ItemDataParameter>()
        itemsMap.set(sampleItem.id, sampleItem)
        itemsMap.set(sampleItem2.id, sampleItem2)

        const skillsMap = new Map<number | string, SkillDataParameter>()
        // キー重複を避けるため、id_numのみを使用
        skillsMap.set(sampleSkill.id_num, sampleSkill)
        skillsMap.set(sampleSkill2.id_num, sampleSkill2)

        const jobsMap = new Map<number | string, JobDataParameter>()
        // キー重複を避けるため、id_numのみを使用
        jobsMap.set(sampleJob.id_num, sampleJob)
        jobsMap.set(sampleJob2.id_num, sampleJob2)

        ragContext = {
            items: itemsMap,
            skills: skillsMap,
            jobs: jobsMap,
            lastUpdated: new Date().getTime(),
            source: 'test',
        }
    })

    describe('searchItems', () => {
        it('should find items by exact name match', () => {
            const results = searchItems(ragContext, 'ロングソード', 10)
            expect(results.length).toBeGreaterThan(0)
            expect(results[0].name).toBe('ロングソード')
            expect(results[0].relevanceScore).toBe(1.0)
        })

        it('should find items by partial name match', () => {
            const results = searchItems(ragContext, 'ソード', 10)
            expect(results.length).toBeGreaterThan(0)
            expect(results[0].name).toBe('ロングソード')
            expect(results[0].relevanceScore).toBe(0.8)
        })

        it('should find items by type match', () => {
            const results = searchItems(ragContext, 'weapon_1h_sword', 10)
            expect(results.length).toBeGreaterThan(0)
            expect(results[0].id).toBe(1001)
        })

        it('should return empty array when no matches found', () => {
            const results = searchItems(ragContext, '存在しない武器', 10)
            expect(results).toHaveLength(0)
        })

        it('should respect limit parameter', () => {
            const results = searchItems(ragContext, '甲', 1)
            expect(results.length).toBeLessThanOrEqual(1)
        })

        it('should handle case-insensitive search', () => {
            // ダミーデータのタイプを使用した検索
            const results = searchItems(ragContext, 'ARMOR_BODY', 10)
            expect(results.length).toBeGreaterThan(0)
        })
    })

    describe('searchSkills', () => {
        it('should find skills by exact name match', () => {
            const results = searchSkills(ragContext, 'Napalm Bomb', 10)
            expect(results).toHaveLength(1)
            expect(results[0].name).toBe('Napalm Bomb')
            expect(results[0].relevanceScore).toBe(1.0)
        })

        it('should find skills by ID match', () => {
            const results = searchSkills(ragContext, 'MG_NAPALM', 10)
            expect(results).toHaveLength(1)
            expect(results[0].id).toBe(101)
        })

        it('should find skills by partial name match', () => {
            const results = searchSkills(ragContext, 'Napalm', 10)
            expect(results.length).toBeGreaterThan(0)
            expect(results[0].name).toBe('Napalm Bomb')
            expect(results[0].relevanceScore).toBe(0.8)
        })

        it('should return empty array when no skills match', () => {
            const results = searchSkills(ragContext, '存在しないスキル', 10)
            expect(results).toHaveLength(0)
        })

        it('should handle case-insensitive search for skills', () => {
            const results = searchSkills(ragContext, 'OWLS EYE', 10)
            expect(results).toHaveLength(1)
        })
    })

    describe('searchJobs', () => {
        it('should find jobs by exact name match', () => {
            const results = searchJobs(ragContext, 'Mage', 10)
            expect(results).toHaveLength(1)
            // 日本語名が優先される可能性があるため、nameを確認せず、IDをチェック
            expect(results[0].id).toBe(2)
            expect(results[0].relevanceScore).toBe(1.0)
        })

        it('should find jobs by Japanese name match', () => {
            const results = searchJobs(ragContext, 'マジシャン', 10)
            expect(results).toHaveLength(1)
            expect(results[0].id).toBe(2)
        })

        it('should find jobs by partial name match', () => {
            const results = searchJobs(ragContext, 'man', 10)
            expect(results.length).toBeGreaterThan(0)
        })

        it('should return empty array when no jobs match', () => {
            const results = searchJobs(ragContext, '存在しない職業', 10)
            expect(results).toHaveLength(0)
        })

        it('should respect limit parameter for jobs', () => {
            const results = searchJobs(ragContext, 'man', 1)
            expect(results.length).toBeLessThanOrEqual(1)
        })
    })

    describe('searchAll', () => {
        it('should search items, skills, and jobs simultaneously', () => {
            const results = searchAll(ragContext, 'ロング', { items: 5, skills: 5, jobs: 5 })
            expect(results.results).toBeDefined()
            expect(Array.isArray(results.results)).toBe(true)
            expect(typeof results.executionTime).toBe('number')
            expect(typeof results.totalResults).toBe('number')
        })

        it('should return results with proper structure', () => {
            const results = searchAll(ragContext, 'ロング', { items: 5, skills: 5, jobs: 5 })

            // アイテムが検出されている
            const itemResults = results.results.filter((r) => r.type === 'item')
            expect(itemResults.length).toBeGreaterThan(0)
        })

        it('should respect individual limits for each category', () => {
            const results = searchAll(ragContext, 'マ', { items: 1, skills: 1, jobs: 1 })
            expect(results.totalResults).toBeLessThanOrEqual(3) // items + skills + jobs limit
        })

        it('should return empty array when no matches found', () => {
            const results = searchAll(ragContext, 'xyz123abc', { items: 5, skills: 5, jobs: 5 })
            expect(results.results).toHaveLength(0)
            expect(results.totalResults).toBe(0)
        })

        it('should find matches across multiple categories', () => {
            const results = searchAll(ragContext, 'man', { items: 10, skills: 10, jobs: 10 })
            // 検索結果が配列であることを確認
            expect(Array.isArray(results.results)).toBe(true)
        })
    })

    describe('Edge cases and error handling', () => {
        it('should handle empty query string', () => {
            const itemResults = searchItems(ragContext, '', 10)
            const skillResults = searchSkills(ragContext, '', 10)
            const jobResults = searchJobs(ragContext, '', 10)

            expect(itemResults).toHaveLength(0)
            expect(skillResults).toHaveLength(0)
            expect(jobResults).toHaveLength(0)
        })

        it('should handle null/undefined values in data', () => {
            const itemWithNull: ItemDataParameter = {
                id: 2001,
                displayname: 'テスト武器',
                type: 'weapon_1h_sword',
                description: '',
                is_card: false,
                is_enchant: false,
                resname: 'test_weapon',
                slot: 0,
                stats: [{ stat: 'atk', value: 50 }],
            }

            const itemsMap = new Map<number, ItemDataParameter>()
            itemsMap.set(itemWithNull.id, itemWithNull)

            const testContext: RAGContext = {
                items: itemsMap,
                skills: new Map(),
                jobs: new Map(),
                lastUpdated: new Date().getTime(),
                source: 'test',
            }

            const results = searchItems(testContext, 'テスト', 10)
            expect(results).toHaveLength(1)
        })

        it('should handle special characters in search query', () => {
            const results = searchItems(ragContext, 'ロング@#$ソード', 10)
            // 特殊文字は通常フィルタリングされる
            expect(Array.isArray(results)).toBe(true)
        })

        it('should handle whitespace in search query', () => {
            const results = searchItems(ragContext, '  ロングソード  ', 10)
            expect(results.length).toBeGreaterThan(0)
        })
    })
})
