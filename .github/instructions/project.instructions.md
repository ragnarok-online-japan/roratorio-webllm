---
applyTo: "**"
---

# ROラトリオ WebLLM 実装ガイドライン

## 概要

- WebGPUを活用するROラトリオ WebLLMのフロントエンドアプリケーションを提供すること

## アーキテクチャ
- WebLLM : https://github.com/mlc-ai/web-llm
- Forkされたリポジトリ: https://github.com/m10i-0nyx/webllm-vanilla-framework
- 開発言語はTypeScriptを使用すること
- パッケージマネージャーはpnpmを使用すること

## 基本
- 日本語で回答してください
- 必要に応じて、ユーザに質問を行い、要求を明確にすること
- 作業後、作業内容とユーザが次に取れる行動を説明すること
- 作業項目が多い場合は、段階に区切り、git commit を行いながら進めること
  - semantic commit を使用する
  - コミットメッセージは英語で記述すること
  - コミットメッセージの最初は add, fix, modify, clean のいずれかで始めること
- 簡潔で分かりやすい説明を心がけてください
- ベストプラクティスの具体例を提示してください
- 学習リソースの提案を積極的に行ってください
- 常に日本語で分かりやすい言葉を選び、丁寧な表現を心がけてください
- スケーラビリティとパフォーマンスを重点的にチェックしてください

## コードレビュー専用指示
### レビューの基本方針
以下のプレフィックスを使用してレビューコメントを分類してください：
- `[must]` - 必須修正項目（セキュリティ、バグ、重大な設計問題）
- `[recommend]` - 推奨修正項目（パフォーマンス、可読性の大幅改善）
- `[nits]` - 軽微な指摘（コードスタイル、タイポ等）

## 実装履歴

### セキュリティ対策
実装日: 2026-02-21

**実装内容:**
- **XSS対策**: `innerHTML` → `createElement` + `textContent` に変更
- **入力値検証**: メッセージ長の制限（最大2000文字）
- **モデル検証**: ホワイトリスト照合による型安全な実装
- **レート制限**: 日次リクエスト上限1000に設定
- **タイムアウト**: 120秒のリクエストタイムアウト実装
- **エラーハンドリング**: 詳細情報をコンソールのみに表示
- **メモリ管理**: チャット履歴を最大50メッセージに制限

### IndexedDB永続化機能
実装日: 2026-02-21

**実装内容:**
- **永続化**: IndexedDBを使用して会話履歴をブラウザに保存
- **自動読み込み**: アプリケーション起動時に過去の会話を自動復元
- **手動クリア**: Clear履歴をクリアするボタンと確認ダイアログ
- **トランザクション管理**: IDBトランザクションで安全なデータ操作

**主要機能:**
- `initializeDatabase()`: IndexedDB初期化
- `saveMessage()`: メッセージをDBに保存
- `loadMessages()`: 保存されたメッセージを読み込み
- `clearMessages()`: 全メッセージを削除

**ストレージ構成:**
```
データベース: WebLLMChat (v1)
オブジェクトストア: messages
- キー: id (autoIncrement)
- インデックス: timestamp (昇順)
- 制限: 最大50メッセージ
```

### RAG（検索拡張生成）機能 - ラグナロクオンライン装備最適化
実装日: 2026-02-21

**概要:**
ラグナロクオンライン（Ragnarok Online）の装備最適化を目的としたRAG機能を実装。zstd圧縮形式のYAMLファイルからアイテム・スキル・職業情報を取得し、LLMの質問に対してゲーム内容を踏まえた回答を生成します。

**実装内容:**

#### データソース
- **アイテムデータ**: https://roratorio-hub.github.io/ratorio/dist/item.yaml.zst
- **スキルデータ**: https://roratorio-hub.github.io/ratorio/dist/skill.yaml.zst
- **職業データ**: https://roratorio-hub.github.io/ratorio/dist/job.yaml.zst

#### ファイル構成
```
src/rag/
  ├── types.ts          # 型定義（JobDataParameter, SkillDataParameter, ItemDataParameter等）
  ├── loaders.ts        # YAML取得・zstd解凍・キャッシング
  └── rag.ts            # 検索・装備推奨ロジック
```

#### 主要機能

**1. zstd圧縮ファイルの解凍 (loaders.ts)**
- `@hpcc-js/wasm-zstd`を使用してWebAssemblyでzstd解凍
- フェッチ → 解凍 → パース の流れを実装
- エラーハンドリング完備

**2. キャッシング機構 (loaders.ts)**
- IndexedDB (`RoDataCache v1`) に取得したデータを保存
- キャッシュ有効期限: 7日間
- ネットワーク障害時の代替手段として機能

**3. 検索機能 (rag.ts)**
- `searchItems()`: キーワードでアイテムを検索
- `searchSkills()`: キーワードでスキルを検索
- `searchJobs()`: キーワードで職業を検索
- `searchAll()`: 統合検索（アイテム・スキル・職業）

**4. 検索アルゴリズム**
- テキスト正規化: 長音記号削除、小文字統一
- 関連性スコア計算:
  - 完全一致: 1.0
  - 部分一致: 0.8
  - キーワード包含: 0.5
- スコア順にソート、指定件数を返却

**5. 装備最適化推奨エンジン (rag.ts)**
- `recommendEquipment()`: プレイヤープロフィールに基づいて装備を推奨
- 職業別の制約チェック
- 各装備スロット（武器、防具、ガーメント等）の最適化

#### LLM統合
- ユーザーメッセージをRAGで検索
- 検索結果をシステムプロンプトに追加
- LLMが回答時にゲーム情報を参照可能

**実装例:**
```typescript
// ユーザーの質問: "ウォーロックの装備について教えて"
// RAG検索結果を自動抽出
const ragResults = searchAll(ragContext, userMessage, { items: 3, skills: 2, jobs: 1 });
// LLMメッセージに追加: "【ラグナロクオンライン情報】..."
```

#### 型定義
- `JobDataParameter`: ラグナロクオンライン職業データ
  - 基本属性: `id_name`, `id_num`, `name`, `name_ja`, `name_alias`
  - ステータス: `hp_basic_values`, `sp_basic_values`, `status_basic_max`
  - スキル: `learned_skills`, `passive_skills`, `attack_skills`
  - 装備: `allow_equipment_weapons_type`

- `SkillDataParameter`: ラグナロクオンラインスキルデータ
  - 基本属性: `id`, `id_num`, `name`, `max_lv`
  - コスト: `sp_amount`（レベル別）
  - 範囲: `attack_range`（レベル別）
  - 要件: `need_skill_list`（依存スキル）

- `ItemDataParameter`: ラグナロクオンラインアイテムデータ
  - 基本属性: `id`, `displayname`, `type`, `slot`
  - ステータス: `atk`, `matk`, `def`, `mdef`
  - 装備位置: `position`, `card_position`
  - 効果: `stats`, `damage_bonus`, `auto_spells`
  - セット効果: `set_bonus`, `set_penalty`
  - 精錬ボーナス: `refine_bonus`, `refine_skill_bonus`

- `RAGContext`: キャッシュ化されたRA Gデータセット
  - `items`: アイテムマップ（ID → ItemDataParameter）
  - `skills`: スキルマップ（ID/名前 → SkillDataParameter）
  - `jobs`: 職業マップ（ID/名前 → JobDataParameter）
  - `lastUpdated`: データ更新時刻

- `PlayerProfile`: プレイヤープロフィール
  - 職業: `jobId`, `jobName`
  - レベル: `baseLevel`, `jobLevel`
  - ステータス: `str`, `agi`, `vit`, `int`, `dex`, `luk`

- `EquipmentRecommendation`: 装備推奨結果
  - 職業: `jobId`, `jobName`
  - 装備セット: `equipmentSet`（スロット → ItemDataParameter）
  - スコア: `totalAtk`, `totalMatk`, `totalDef`, `totalMdef`
  - スキルシナジー: `skillSynergies`

#### エラーハンドリング
- ネットワークエラー：キャッシュにフォールバック、データなしで継続
- YAML解析エラー：詳細ログ出力、空配列を返却
- RAG検索エラー：検索スキップしてメッセージ送信継続
- zstd解凍エラー：詳細エラーログ出力

**依存パッケージ:**
- `@hpcc-js/wasm-zstd`: zstd圧縮ファイルの仕様WAフォーマット解凍
- `js-yaml`: YAMLファイルのパース

**キャッシング構成:**
```
データベース: RoDataCache (v1)
オブジェクトストア: rawData
- キー: "items", "skills", "jobs"
- 値: { key, data, timestamp }
- TTL: 7日間
```

**パフォーマンス最適化:**
- zstd解凍後のYAMLパース結果をMapキャッシュ
- Mapキーとして id_num, id_name, name を複数記録
- 検索結果はキャッシュではなく毎回計算（常に最新の関連性スコア）
