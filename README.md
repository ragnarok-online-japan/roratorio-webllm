# ROラトリオ WebLLM

WebGPUを活用した高性能ブラウザ内LLMチャットアプリケーション

## 概要

ROラトリオ WebLLM は、[WebLLM](https://github.com/mlc-ai/web-llm) とWebGPU を使用して、
サーバーサイド処理なしにブラウザ内で大規模言語モデル（LLM）を実行できるVanilla TypeScriptチャットアプリケーションです。

すべての計算はブラウザ内で完結するため、プライバシー保護と高速なレスポンスを実現します。

## ✨ 主な特徴

- 🚀 **ブラウザ内実行**: サーバーが不要。すべての推論がWebGPUで加速
- 🔒 **プライバシー重視**: 会話データはローカルに保存。外部サーバーへ送信なし
- 📱 **複数モデル対応**: Llama 3.1、Mistral、NeuralHermes などを選択可能
- 💾 **永続化**: IndexedDB でチャット履歴を保存。リロード後も会話を復元
- 🛡️ **セキュリティ重視**: XSS対策、入力値検証、レート制限を実装
- 🎨 **モダンUI**: ダークテーマ、レスポンシブデザイン

## 🚀 クイックスタート

### 前提条件

- Node.js v22+
- pnpm v10+
- モダンブラウザ（WebGPU サポート）

### インストール

```bash
git clone https://github.com/ragnarok-online-japan/webllm-roratorio
cd webllm-roratorio
pnpm install
```

### 開発サーバー起動

```bash
pnpm dev
```

ブラウザで `http://localhost:5173` を開くと、アプリケーションが起動します。

### ビルド

```bash
pnpm build
```

## 🏗️ アーキテクチャ

### 技術スタック

- **フロントエンド**: Vanilla TypeScript + Vite
- **推論エンジン**: WebLLM (v0.2.81)
- **GPU加速**: WebGPU
- **ローカルストレージ**: IndexedDB
- **スタイリング**: CSS3

### デバイスサポート

- ✅ Desktop（Chrome, Edge など）
- ✅ 一部のモバイルデバイス（WebGPU サポート必須）

## 📖 使用方法

### 基本操作

1. **モデル選択**: ヘッダーのドロップダウンからLLMを選択
2. **メッセージ入力**: テキストエリアにメッセージを入力
3. **送信**: 「送信」ボタンをクリック（または Shift+Enter）
4. **履歴削除**: 「🗑️ クリア」ボタンで会話履歴をクリア

### 利用可能なモデル

- **Llama-3.1-8B-Instruct-q4f32_1-MLC**: 最高精度（推奨）
- **Mistral-7B-Instruct-v0.3-q4f32_1-MLC**: バランス型
- **NeuralHermes-2.5-Mistral-7B-q4f16_1-MLC**: スリム・軽量

## 🔒 セキュリティ機能

| 機能 | 説明 |
|------|------|
| **XSS対策** | DOM操作は `createElement`・`textContent` で安全に実装 |
| **入力値検証** | メッセージ長を最大2000文字に制限 |
| **モデル検証** | ホワイトリストベースのモデル照合 |
| **レート制限** | 1日最大1000リクエスト |
| **タイムアウト** | 120秒でリクエストをタイムアウト |
| **エラー隠蔽** | 詳細エラーはコンソールのみ、ユーザーには簡潔なメッセージ表示 |
| **メモリ管理** | チャット履歴は最大50メッセージに制限 |

## 💾 データ永続化

チャット履歴は IndexedDB に以下の構成で保存されます：

```
データベース: WebLLMChat (v1)
├── オブジェクトストア: messages
│   ├── キー: id (autoIncrement)
│   ├── インデックス: timestamp (昇順)
│   └── 制限: 最大50メッセージ
```

### 永続化機能

- ✅ 自動保存: 送受信メッセージを自動的に IndexedDB に保存
- ✅ 自動復元: ページロード時に過去の会話を自動復元
- ✅ 手動削除: 「クリア」ボタンで全履歴を削除

## ⚙️ 設定

セキュリティ設定は `src/main.ts` で カスタマイズ可能です：

```typescript
const SECURITY_CONFIG = {
    MAX_MESSAGE_LENGTH: 2000,        // メッセージ最大長
    MAX_CHAT_HISTORY: 50,             // チャット履歴上限
    MAX_DAILY_REQUESTS: 1000,        // 日次リクエスト上限
    MESSAGE_TIMEOUT_MS: 120000,      // 2分タイムアウト
}
```

## 📦 構成

```
webllm-vanilla-framework/
├── index.html                 # エントリーポイント
├── src/
│   ├── main.ts               # メインロジック
│   └── style.css             # スタイル
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## 🔧 開発

### TypeScript

本プロジェクトは完全な型安全性を備えています：

```typescript
interface Message {
    role: 'user' | 'assistant'
    content: string
}

function isValidModel(model: string): model is typeof AVAILABLE_MODELS[number] {
    return AVAILABLE_MODELS.includes(model as any)
}
```

### コード品質チェック

```bash
# ビルド（型チェック含む）
pnpm build

# 開発サーバーでエラーを確認
pnpm dev
```

## 📚 学習リソース

### WebLLM

- [公式ドキュメント](https://webllm.mlc.ai/docs/)
- [GitHub リポジトリ](https://github.com/mlc-ai/web-llm)
- [デモアプリ](https://chat.webllm.ai/)

### WebGPU

- [MDN WebGPU](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API)
- [WebGPU チュートリアル](https://www.w3.org/TR/webgpu/)

### IndexedDB

- [MDN IndexedDB](https://developer.mozilla.org/ja/docs/Web/API/IndexedDB_API)

### Fork元
- [WebLLM Vanilla Framework](https://github.com/m10i-0nyx/webllm-vanilla-framework)

## 🐛 トラブルシューティング

### モデルが読み込めない

- ブラウザのコンソールでエラーを確認してください
- WebGPU をサポートしているブラウザを使用してください
- ディスク空き容量が十分にあるか確認（モデルは数GB）

### キャッシュが古い

```bash
# ブラウザキャッシュをクリア
# DevTools → Application → Cache Storage から削除
```

### IndexedDB が満杯

「クリア」ボタンで履歴を削除してください。

### Windows での GPU パフォーマンス設定が有効にならない

**既知の制限事項**: Windows 環境では Chromium のバグ（[crbug.com/369219127](https://crbug.com/369219127)）により、WebGPU の `powerPreference` オプションが無視されます。

- **影響**: GPU パフォーマンス最適化の設定が反映されない可能性あり
- **対応**: 現在、このバグに対する回避策はありません。Chromium のアップデートを待つ必要があります
- **詳細**: このバグは Windows 環境特有の問題で、Mac/Linux では影響を受けません

詳細は Chromium の公式バグレポートをご参照ください。

## 📄 ライセンス

このプロジェクトは MIT ライセンスの下でライセンスされています。  
詳細は [LICENSE](LICENSE) ファイルを参照してください。

## 🙏 謝辞

- [MLC AI](https://mlc.ai/) - WebLLM プロジェクト
- [The Apache Software Foundation](https://www.apache.org/) - TVM コミュニティ
- [WebGPU Contributors](https://github.com/gpuweb/gpuweb) - WebGPU 仕様

## 📞 サポート

問題が発生した場合:

1. コンソールエラーを確認
2. ブラウザを再起動してリトライ
3. GitHub Issues で既存の報告を確認


## ⚠️ 注意事項
- このアプリケーションは WebGPU が必要です。対応するブラウザをご使用ください。
- このプロジェクトは、Claude Haiku 4.5 を用いて開発されました
