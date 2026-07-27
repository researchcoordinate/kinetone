# kinetone

介護施設・サ高住向けの運動アプリ群です。Web カメラ 1 台とブラウザだけで動き、
**カメラ映像はすべて端末内で処理し、外部に送信も保存もしません**（バックエンド無し）。

共通のホーム画面から各ゲームへ遷移する構成を予定しており、この 1 リポジトリで管理します。

## 収録アプリ

| フォルダ | 内容 | 姿勢推定 | 公開 URL |
|---|---|---|---|
| `stepping/` | おさんぽ足踏み（その場足踏みリハビリゲーム） | MediaPipe Tasks Vision | https://kinetone-stepping.web.app |
| `stepping/` | 2分間足踏みテストの測定アプリ（同じソースの `measure.html`） | MediaPipe Tasks Vision | https://kinetone-steptest.web.app |
| `aiube-exercise/` | あいうべ体操デモ・フェイスメッシュ版（静的サイト） | MediaPipe Face Landmarker | https://aiube-mesh-demo.web.app |
| `aiube-exercise-avatar/` | あいうべ体操デモ・アバター版（静的サイト） | MediaPipe Face Landmarker | https://aiube-taisou-demo.web.app |
| `multi-flower/` | アトラクト画面（多人数骨格 × 花の演出）※ 準備でき次第このリポジトリに取り込み | TensorFlow.js MoveNet | 未デプロイ |

各アプリは独立しています（`stepping/` と `multi-flower/` は Vite プロジェクト、
`aiube-exercise*/` はビルド不要の静的サイト）。依存関係もビルドも配信先も別々なので、
**作業はそのフォルダの中で行います**（リポジトリのルートに `package.json` は置いていません）。

### 配信先の構成（Firebase Hosting）

| Firebase プロジェクト | Hosting サイト | deploy ターゲット | 配信元 | URL |
|---|---|---|---|---|
| `kinetone-stepping` | `kinetone-stepping` | `walk` | `stepping/dist/` | https://kinetone-stepping.web.app |
| `kinetone-stepping` | `kinetone-steptest` | `measure` | `stepping/dist-measure/` | https://kinetone-steptest.web.app |
| `aiube-taisou-demo` | `aiube-mesh-demo` | （既定） | `aiube-exercise/public/` | https://aiube-mesh-demo.web.app |
| `aiube-taisou-demo` | `aiube-taisou-demo` | （既定） | `aiube-exercise-avatar/public/` | https://aiube-taisou-demo.web.app |

stepping の 2 サイトは同じ Firebase プロジェクト **`kinetone-stepping`**（プロジェクト番号 708164199952）内の
2 サイトです。`measure.html` を `index.html` として置いた `dist-measure/` を測定サイトに配信することで、
同じソースから 2 つの URL を出しています（`stepping/scripts/split-measure-dist.mjs`）。

あいうべ体操は別プロジェクト **`aiube-taisou-demo`**（プロジェクト番号 526661656403）で、
フェイスメッシュ版とアバター版をそれぞれ別サイトに配信しています。
2 つの差分は `public/index.html` だけなので、判定ロジックを直すときは両方に反映してください。

multi-flower は `.firebaserc` に `kinetone-multi-flower` と書かれていますが、
**その Firebase プロジェクトはまだ作成されていません**（初回デプロイ時に作成が必要）。

```bash
cd stepping
npm install
npm run setup:mediapipe   # 姿勢推定のランタイムとモデル（初回のみ）
npm run dev
```

デプロイも同じくフォルダの中から実行します。

```bash
cd stepping && npm run deploy                    # 両サイト（walk + measure）
npx firebase-tools deploy --only hosting:walk    # おさんぽ（kinetone-stepping）だけ
npx firebase-tools deploy --only hosting:measure # 測定（kinetone-steptest）だけ

cd aiube-exercise        && npx firebase-tools deploy --only hosting  # あいうべ体操・メッシュ版（ビルド不要）
cd aiube-exercise-avatar && npx firebase-tools deploy --only hosting  # あいうべ体操・アバター版（ビルド不要）
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
