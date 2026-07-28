# kinetone

介護施設・サ高住向けの運動アプリ群です。Web カメラ 1 台とブラウザだけで動き、
**カメラ映像はすべて端末内で処理し、外部に送信も保存もしません**（バックエンド無し）。

共通のホーム画面から各ゲームへ遷移する構成を予定しており、この 1 リポジトリで管理します。

## 配信構成（統合サイト）

利用者の名簿と記録をアプリ間で共有するため、**すべてを 1 つの origin にまとめて**配信します
（ブラウザの localStorage はサイトごとに分かれるため、別 URL では名簿を共有できません）。

**https://kinetone.web.app/** — Firebase プロジェクト `kinetone`

| パス | アプリ | 配信元 |
|---|---|---|
| `/` | ホーム（アプリ選択） | `home/` |
| `/flower/` | みんなの花畑 | `multi-flower/`（`KINETONE_BASE=/flower/`） |
| `/stepping/` | おさんぽ足踏み | `stepping/`（`KINETONE_BASE=/stepping/` でビルド） |
| `/steptest/` | 2分間足踏みテスト | 同上（`measure.html` に rewrite） |
| `/chair-stand/` | 5回椅子立ち上がり | `chair-stand-test/`（`KINETONE_BASE=/chair-stand/`） |
| `/hanabi/` | みんなで花火 | `hanabi/` |
| `/aiube/` `/aiube-avatar/` | あいうべ体操 | `aiube-exercise*/public/` |

```bash
node scripts/build-site.mjs                # site/ を作る（各アプリをサブパス向けにビルド）
npx firebase-tools deploy --only hosting   # 統合サイトへ配信（predeploy で上のビルドが走る）
```

各アプリは**単体サイトとしても**ビルドできます（`KINETONE_BASE` 未指定なら base は `/`）。
下表の単体 URL は従来どおり生きていますが、名簿を共有できるのは統合サイトの方だけです。

## 収録アプリ（単体配信）

| フォルダ | 内容 | 姿勢推定 | 公開 URL |
|---|---|---|---|
| `stepping/` | おさんぽ足踏み（その場足踏みリハビリゲーム） | MediaPipe Tasks Vision | https://kinetone-stepping.web.app |
| `stepping/` | 2分間足踏みテストの測定アプリ（同じソースの `measure.html`） | MediaPipe Tasks Vision | https://kinetone-steptest.web.app |
| `aiube-exercise/` | あいうべ体操デモ・フェイスメッシュ版（静的サイト） | MediaPipe Face Landmarker | https://aiube-mesh-demo.web.app |
| `aiube-exercise-avatar/` | あいうべ体操デモ・アバター版（静的サイト） | MediaPipe Face Landmarker | https://aiube-taisou-demo.web.app |
| `hanabi/` | 夏だ！みんなで花火（みんなで手を振ると花火が上がる静的サイト） | TensorFlow.js MoveNet MultiPose | https://kinetone-hanabi.web.app |
| `chair-stand-test/` | 5回椅子立ち上がりテスト（FTSST）の測定アプリ | MediaPipe Tasks Vision | https://kinetone-chairstand.web.app |
| `multi-flower/` | みんなの花畑（体を動かすと足元に花が育つ演出。ペット・BGM・効果音つき） | MediaPipe（既定）/ MoveNet 切替可 | https://kinetone-multi-flower.web.app |

各アプリは独立しています（`stepping/` `chair-stand-test/` `multi-flower/` は Vite プロジェクト、
`aiube-exercise*/` と `hanabi/` はビルド不要の静的サイト）。依存関係もビルドも配信先も別々なので、
**作業はそのフォルダの中で行います**（リポジトリのルートに `package.json` は置いていません）。

### 配信先の構成（Firebase Hosting）

| Firebase プロジェクト | Hosting サイト | deploy ターゲット | 配信元 | URL |
|---|---|---|---|---|
| `kinetone-stepping` | `kinetone-stepping` | `walk` | `stepping/dist/` | https://kinetone-stepping.web.app |
| `kinetone-stepping` | `kinetone-steptest` | `measure` | `stepping/dist-measure/` | https://kinetone-steptest.web.app |
| `aiube-taisou-demo` | `aiube-mesh-demo` | （既定） | `aiube-exercise/public/` | https://aiube-mesh-demo.web.app |
| `aiube-taisou-demo` | `aiube-taisou-demo` | （既定） | `aiube-exercise-avatar/public/` | https://aiube-taisou-demo.web.app |
| `kinetone-hanabi` | `kinetone-hanabi` | （既定） | `hanabi/`（開発用ファイルは除外） | https://kinetone-hanabi.web.app |
| `kinetone-chairstand` | `kinetone-chairstand` | （既定） | `chair-stand-test/dist/` | https://kinetone-chairstand.web.app |
| `kinetone-multi-flower` | `kinetone-multi-flower` | （既定） | `multi-flower/dist/` | https://kinetone-multi-flower.web.app （**使っていない**。`npm run deploy:standalone` のときだけ） |

stepping の 2 サイトは同じ Firebase プロジェクト **`kinetone-stepping`**（プロジェクト番号 708164199952）内の
2 サイトです。`measure.html` を `index.html` として置いた `dist-measure/` を測定サイトに配信することで、
同じソースから 2 つの URL を出しています（`stepping/scripts/split-measure-dist.mjs`）。

あいうべ体操は別プロジェクト **`aiube-taisou-demo`**（プロジェクト番号 526661656403）で、
フェイスメッシュ版とアバター版をそれぞれ別サイトに配信しています。
2 つの差分は `public/index.html` だけなので、判定ロジックを直すときは両方に反映してください。

multi-flower は Firebase プロジェクト **`kinetone-multi-flower`** を作成し、
https://kinetone-multi-flower.web.app に公開済みです（既定サイト・配信元 `multi-flower/dist/`）。
カメラ至近の一人が主なので既定エンジンは MediaPipe。展示会の多人数用途は `?engine=movenet`。

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
cd hanabi                && npx firebase-tools deploy --only hosting  # みんなで花火（ビルド不要）

cd multi-flower          && npm run deploy                            # みんなの花畑 → 統合サイト（下記）
```

みんなの花畑は単体サイトを使わなくなったので、`npm run deploy` は**統合サイト**へ配信します
（リポジトリ直下の `npx firebase-tools deploy --only hosting` を呼ぶだけ）。全アプリが
まとめてビルドし直されるため、他のアプリの作業中の変更も一緒に公開される点に注意。
単体サイトへ出したいときだけ `npm run deploy:standalone`。

詳しい仕様・設計は各フォルダの README を参照してください。

## リポジトリの方針

- **大きな素材は「使うものだけ」追跡する。** 音声・動画・BGM はリポジトリを重くするため、
  未使用の素材は `.gitignore` で除外しています（例: `stepping/assets/BGM/`）。
  曲を差し替えるときは、その曲だけ明示的に `git add` してください。
- **モデル・WASM は追跡しない。** `npm run setup:mediapipe` などのスクリプトで再取得できます。
  ただし **multi-flower は現状オフライン優先でモデル・WASM も追跡しています**（数十MB）。
  リポジトリ軽量化のため、他アプリと同様に setup スクリプトでの再取得へ揃えるのが望ましい（要検討）。
- **ビルド成果物（`dist/`）は追跡しない。** 配信は各アプリの predeploy でビルドしてから行います。
