# kinetone

介護施設・サ高住向けの運動アプリ群です。Web カメラ 1 台とブラウザだけで動き、
**カメラ映像はすべて端末内で処理し、外部に送信も保存もしません**（バックエンド無し）。

共通のホーム画面から各ゲームへ遷移する構成を予定しており、この 1 リポジトリで管理します。

## 収録アプリ

| フォルダ | 内容 | 姿勢推定 | Firebase プロジェクト（配信先） |
|---|---|---|---|
| `stepping/` | おさんぽ足踏み（その場足踏みリハビリゲーム）と、2分間足踏みテストの測定アプリ | MediaPipe Tasks Vision | `kinetone-stepping`（おさんぽ）<br>`kinetone-steptest`（測定） |
| `multi-flower/` | アトラクト画面（多人数骨格 × 花の演出）※ 準備でき次第このリポジトリに取り込み | TensorFlow.js MoveNet | `kinetone-multi-flower` |

各アプリは独立した Vite プロジェクトです。依存関係もビルドも配信先も別々なので、
**作業はそのフォルダの中で行います**（リポジトリのルートに `package.json` は置いていません）。

```bash
cd stepping
npm install
npm run setup:mediapipe   # 姿勢推定のランタイムとモデル（初回のみ）
npm run dev
```

デプロイも同じくフォルダの中から実行します。

```bash
cd stepping && npm run deploy                          # おさんぽ・測定の両サイト
npx firebase-tools deploy --only hosting:walk          # おさんぽだけ配信したいとき
```

詳しい仕様・設計は各フォルダの README を参照してください。

## multi-flower の取り込み方（未実施）

いまは `multi-flower/` を独立したリポジトリのまま置いてあり、ルートの `.gitignore` で
追跡対象から外しています。準備ができたら、未コミットの変更を先にコミットしたうえで、
履歴ごと取り込みます。

```bash
# 1. ルートの .gitignore から /multi-flower/ の行を消す
# 2. 履歴を保ったまま取り込む
git subtree add --prefix=multi-flower ./multi-flower main
```

## リポジトリの方針

- **大きな素材は「使うものだけ」追跡する。** 音声・動画・BGM はリポジトリを重くするため、
  未使用の素材は `.gitignore` で除外しています（例: `stepping/assets/BGM/`）。
  曲を差し替えるときは、その曲だけ明示的に `git add` してください。
- **モデル・WASM は追跡しない。** `npm run setup:mediapipe` などのスクリプトで再取得できます。
- **ビルド成果物（`dist/`）は追跡しない。** 配信は各アプリの predeploy でビルドしてから行います。
