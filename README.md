# kinetone

介護施設・サ高住向けの運動アプリ群です。Web カメラ 1 台とブラウザだけで動き、
**カメラ映像はすべて端末内で処理し、外部に送信も保存もしません**（バックエンド無し）。

共通のホーム画面から各ゲームへ遷移する構成を予定しており、この 1 リポジトリで管理します。

## 配信構成（統合サイト）

利用者の名簿と記録をアプリ間で共有するため、**すべてを 1 つの origin にまとめて**配信します
（ブラウザの localStorage はサイトごとに分かれるため、別 URL では名簿を共有できません）。

**https://kinetone.web.app/** — Firebase プロジェクト `kinetone`（このプロジェクトの Hosting サイトはこれ 1 つ）

### 何を載せるかは `kinetone.json` だけが決める

ホームのカード・`site/` の組み立て・`firebase.json` の rewrites は、すべて
リポジトリ直下の **`kinetone.json`** から生成します。ビルドスクリプトにアプリ名は書きません。

| やりたいこと | 直す場所 |
|---|---|
| ゲームを追加する | `kinetone.json` の `apps` に 1 つ、`cards` に 1 つ、`home/thumbs/` にサムネイル 1 枚 |
| ホームの並び順を変える | `cards` 配列の順番（そのまま画面の順番） |
| 名前・説明・タグを直す | 該当する `cards` の項目 |
| 開発中のゲームを配信から外す | その `apps` に `"enabled": false`（いまは `block` がこれ） |

`apps.<id>.build.kind` が「どこから持ってくるか」です。いまは全部このリポジトリの中
（`vite` / `static`）ですが、別リポジトリへ出したゲームは `kind` を成果物取得に変える
だけで済むようにしてあります。**ゲームを 1 つずつ、好きな順番で外部リポジトリへ移せます。**

```bash
node scripts/build-site.mjs                # site/ を作る（各アプリをサブパス向けにビルド）
node scripts/build-site.mjs --write-config # kinetone.json に合わせて firebase.json を更新
npx firebase-tools deploy --only hosting   # 統合サイトへ配信（predeploy で上のビルドが走る）
```

`firebase.json` は Firebase CLI がデプロイ開始時に読むため、predeploy の中で書き換えても
その回には反映されません。そのため既定では**食い違いを検出してデプロイを止める**だけにし、
書き換えは `--write-config` を付けたときだけ行います（更新したらコミットしてください）。

各アプリは**単体サイトとしても**ビルドできます（`KINETONE_BASE` 未指定なら base は `/`）。

## 収録アプリ

| フォルダ | 統合サイトのパス | 内容 | 姿勢推定 |
|---|---|---|---|
| `multi-flower/` | `/flower/` | みんなの花畑（体を動かすと足元に花が育つ演出。ペット・BGM・効果音つき） | MediaPipe（既定）/ MoveNet 切替可 |
| `hanabi/` | `/hanabi/` | 夏だ！みんなで花火（みんなで手を振ると花火が上がる静的サイト） | TensorFlow.js MoveNet MultiPose |
| `stepping/` | `/stepping/` | おさんぽ足踏み（その場足踏みリハビリゲーム） | MediaPipe Tasks Vision |
| `stepping/` | `/steptest/` | 2分間足踏みテストの測定アプリ（同じソースの `measure.html`） | MediaPipe Tasks Vision |
| `chair-stand-test/` | `/chair-stand/` | 5回椅子立ち上がりテスト（FTSST）の測定アプリ | MediaPipe Tasks Vision |
| `aiube-exercise-avatar/` | `/aiube-avatar/` | あいうべ体操・アバター版（静的サイト） | MediaPipe Face Landmarker |
| `aiube-exercise/` | `/aiube/` | あいうべ体操・フェイスメッシュ版（静的サイト） | MediaPipe Face Landmarker |
| `block/` | （未配信） | 運動を積み上げて街をつくるゲーム（開発中） | MediaPipe Tasks Vision |

各アプリは独立しています（`stepping/` `chair-stand-test/` `multi-flower/` は Vite プロジェクト、
`aiube-exercise*/` と `hanabi/` はビルド不要の静的サイト）。依存関係もビルドも配信先も別々なので、
**作業はそのフォルダの中で行います**（リポジトリのルートに `package.json` は置いていません）。

### 旧配信先（1 ゲーム 1 プロジェクト時代の名残り）

統合サイトへ移す前は、ゲームごとに Firebase プロジェクトと URL を持っていました。
これらのサイトは**削除せず、統合サイトへの案内ページに差し替えてあります**
（`scripts/legacy-redirect.mjs`）。旧 URL をブックマークしている端末が、古いビルドを
使い続けてしまうのを防ぐためです。

| 旧 URL | 送り先 | Firebase プロジェクト |
|---|---|---|
| kinetone-multi-flower.web.app | `/flower/` | `kinetone-multi-flower` |
| kinetone-hanabi.web.app | `/hanabi/` | `kinetone-hanabi` |
| kinetone-stepping.web.app | `/stepping/` | `kinetone-stepping` |
| kinetone-steptest.web.app | `/steptest/` | `kinetone-stepping` |
| kinetone-chairstand.web.app | `/chair-stand/` | `kinetone-chairstand` |
| aiube-taisou-demo.web.app | `/aiube-avatar/` | `aiube-taisou-demo` |
| aiube-mesh-demo.web.app | `/aiube/` | `aiube-taisou-demo` |

> **注意**: 各アプリのフォルダには当時の `firebase.json` が残っています。フォルダの中で
> `npx firebase-tools deploy` を実行すると、この案内ページを**古いアプリで上書きしてしまいます**。
> 配信は必ずリポジトリ直下から行ってください。上書きしてしまった場合は
> `node scripts/legacy-redirect.mjs` で戻せます。

あいうべ体操のメッシュ版とアバター版の差分は `public/index.html` だけなので、
判定ロジックを直すときは両方に反映してください。

みんなの花畑は、カメラ至近の一人が主なので既定エンジンは MediaPipe。
展示会の多人数用途は `?engine=movenet`。

```bash
cd stepping
npm install
npm run setup:mediapipe   # 姿勢推定のランタイムとモデル（初回のみ）
npm run dev
```

**デプロイはリポジトリ直下から**行います（各アプリのフォルダからではありません）。

```bash
npx firebase-tools deploy --only hosting   # 統合サイトへ配信（predeploy で全アプリをビルド）
```

いまは全アプリがまとめてビルドし直されるため、**他のアプリの作業中の変更も一緒に公開されます**。
出したくないものは `kinetone.json` で `"enabled": false` にしてください。
（この結合を無くすため、ゲームごとに「ビルド済み成果物を publish → 統合サイトはそれを取り込む」
形へ移行する予定です。`build.kind` がその切り替え口になります。）

詳しい仕様・設計は各フォルダの README を参照してください。

## リポジトリの方針

- **大きな素材は「使うものだけ」追跡する。** 音声・動画・BGM はリポジトリを重くするため、
  未使用の素材は `.gitignore` で除外しています（例: `stepping/assets/BGM/`）。
  曲を差し替えるときは、その曲だけ明示的に `git add` してください。
- **モデル・WASM は追跡しない。** `npm run setup:mediapipe` などのスクリプトで再取得できます。
  ただし **multi-flower は現状オフライン優先でモデル・WASM も追跡しています**（数十MB）。
  リポジトリ軽量化のため、他アプリと同様に setup スクリプトでの再取得へ揃えるのが望ましい（要検討）。
- **ビルド成果物（`dist/`）は追跡しない。** 配信は各アプリの predeploy でビルドしてから行います。
