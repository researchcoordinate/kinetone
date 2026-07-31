# kinetone

介護施設・サ高住向けの運動アプリ群です。Web カメラ 1 台とブラウザだけで動き、
**カメラ映像はすべて端末内で処理し、外部に送信も保存もしません**（バックエンド無し）。

共通のホーム画面から各ゲームへ遷移する構成です。ゲームは開発者ごとに独立したリポジトリへ
移していく途中で、このリポジトリは**ホームと、まだ移していないゲーム**を持ちます。
何を配信するかは `kinetone.json` が決めます。

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

`apps.<id>.build.kind` が「どこから持ってくるか」です。

| `kind` | 意味 |
|---|---|
| `vite` | このリポジトリの Vite プロジェクトをビルドする |
| `static` | このリポジトリの静的ファイルをコピーする |
| `github-release` | **別リポジトリの Release からビルド済みの zip を取り込む** |

`github-release` は `tag` でバージョンを固定するので、**他の開発者の作業中コードが
本番に混ざりません**。取得は `gh` CLI に任せているため、private リポジトリでも
開発者ごとのトークン設定は不要です（既存の GitHub 認証をそのまま使います）。
zip は `.cache/artifacts/` にキャッシュします。

```jsonc
"hanabi": {
  "build": { "kind": "github-release", "repo": "researchcoordinate/hanabi",
             "tag": "v0.1.0", "asset": "dist.zip" },
  "entry": "hanabi_game.html"
}
```

ゲーム側でタグを打っただけでは本番は変わりません。**ここの `tag` を上げてデプロイした
時点で反映**され、戻したいときは前の `tag` に戻すだけです。

`entry` を指定すると、その HTML が配信ディレクトリの `index.html` になります。
Firebase Hosting は `/xxx/` の要求に静的な `index.html` を先に返すため、rewrites だけでは
入口を差し替えられません（あいうべ体操は 1 つの zip を 2 つの入口で使っています）。
**ゲームは 1 つずつ、好きな順番で外部リポジトリへ移せます。**

```bash
node scripts/build-site.mjs                # site/ を作る（各アプリをサブパス向けにビルド）
node scripts/build-site.mjs --write-config # kinetone.json に合わせて firebase.json を更新
npx firebase-tools deploy --only hosting   # 統合サイトへ配信（predeploy で上のビルドが走る）
```

`firebase.json` は Firebase CLI がデプロイ開始時に読むため、predeploy の中で書き換えても
その回には反映されません。そのため既定では**食い違いを検出してデプロイを止める**だけにし、
書き換えは `--write-config` を付けたときだけ行います（更新したらコミットしてください）。

各アプリは**単体サイトとしても**ビルドできます（`KINETONE_BASE` 未指定なら base は `/`）。

## 共通モジュール

アプリをまたいで同じであるべきものは、別リポジトリに置いてタグで固定して取り込みます。
アプリを 1 つずつ別リポジトリへ分けていく方針なので、隣のフォルダを参照する形
（`file:`）にはしません。

| モジュール | 中身 |
|---|---|
| [`@kinetone/camera`](https://github.com/researchcoordinate/kinetone-camera) | カメラの選択・保存・再接続と、歯車の設定パネル。依存なし・素の ES モジュールなので、Vite のアプリからもビルドの無い静的サイトからも使えます |

Vite の各アプリは npm の依存として取り込みます。**public リポジトリなので、
開発者ごと・CI ごとのトークン設定は要りません。**

```jsonc
"@kinetone/camera": "github:researchcoordinate/kinetone-camera#v0.1.0"
```

ホームはビルドが無いので、`build-site.mjs` が同じタグのソースを取得して
`site/shared/camera/` に置き、`<script type="module">` で読みます。取り込むタグは
`kinetone.json` の `shared` が決めます（`.cache/shared/` にキャッシュします）。

あいうべ体操（別リポジトリ）は、ビルドが無く単体でも動かせるようにするため、
`public/shared/camera/` にファイルを同梱しています（更新時は手で入れ替えます）。

**カメラの選択は全アプリで共通です。**ホーム画面の右下の小さな歯車で 1 回選べば、
どのゲームでもそのカメラで開きます（施設や展示で使うカメラは 1 台なので、アプリごとに
選ばせる意味がありません）。

## 収録アプリ

| フォルダ | 統合サイトのパス | 内容 | 姿勢推定 |
|---|---|---|---|
| `multi-flower/` | `/flower/` | みんなの花畑（体を動かすと足元に花が育つ演出。ペット・BGM・効果音つき） | MediaPipe（既定）/ MoveNet 切替可 |
| **別リポジトリ** [`researchcoordinate/hanabi`](https://github.com/researchcoordinate/hanabi) | `/hanabi/` | 夏だ！みんなで花火（みんなで手を振ると花火が上がる静的サイト） | TensorFlow.js MoveNet MultiPose |
| `stepping/` | `/stepping/` | おさんぽ足踏み（その場足踏みリハビリゲーム） | MediaPipe Tasks Vision |
| `stepping/` | `/steptest/` | 2分間足踏みテストの測定アプリ（同じソースの `measure.html`） | MediaPipe Tasks Vision |
| **別リポジトリ** [`researchcoordinate/chair-stand`](https://github.com/researchcoordinate/chair-stand) | `/chair-stand/` | 5回椅子立ち上がりテスト（FTSST）の測定アプリ | MediaPipe Tasks Vision |
| **別リポジトリ** [`researchcoordinate/aiube`](https://github.com/researchcoordinate/aiube) | `/aiube-avatar/` | あいうべ体操・アバター版（静的サイト） | MediaPipe Face Landmarker |
| 同上 | `/aiube/` | あいうべ体操・フェイスメッシュ版（同じ Release の zip・入口だけ違う） | MediaPipe Face Landmarker |
| `block/` | （未配信） | 運動を積み上げて街をつくるゲーム（開発中） | MediaPipe Tasks Vision |

このリポジトリに残っているアプリ（`stepping/` `multi-flower/` `block/`）はいずれも Vite
プロジェクトで、依存関係もビルドも別々です。**作業はそのフォルダの中で行います**
（リポジトリのルートに `package.json` は置いていません）。

別リポジトリへ出したゲームは、ビルド済みの成果物（Release の zip）を取り込むだけなので、
**このリポジトリでビルドされません。**壊れたものを publish しない関門は各ゲーム側の CI です
（型チェックとテストが通らないとリリースされません）。

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

> **注意**: このリポジトリに残る各アプリのフォルダには当時の `firebase.json` があります。
> フォルダの中で `npx firebase-tools deploy` を実行すると、この案内ページを**古いアプリで
> 上書きしてしまいます**。配信は必ずリポジトリ直下から行ってください。上書きしてしまった
> 場合は `node scripts/legacy-redirect.mjs` で戻せます。

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

**このリポジトリに残っているアプリは、まとめてビルドし直されます。**そのため作業中の変更も
一緒に公開されてしまいます。出したくないものは `kinetone.json` で `"enabled": false` に
してください。`github-release` へ移したゲーム（hanabi）はこの影響を受けません（固定した
`tag` の成果物しか取り込まないため）。**残りのゲームも順に移していく方針です。**

詳しい仕様・設計は各フォルダの README を参照してください。

## リポジトリの方針

- **大きな素材は「使うものだけ」追跡する。** 音声・動画・BGM はリポジトリを重くするため、
  未使用の素材は `.gitignore` で除外しています（例: `stepping/assets/BGM/`）。
  曲を差し替えるときは、その曲だけ明示的に `git add` してください。
- **モデル・WASM は原則追跡しない。** `npm run setup:mediapipe` などのスクリプトで再取得できます。
  ただし例外が 2 つあります。
  - **multi-flower** は現状オフライン優先でモデル・WASM も追跡しています（数十MB）。
  - **hanabi**（別リポジトリ）はビルドの無い静的サイトで、clone してそのまま動く状態を
    保ちたいため、TensorFlow.js とモデルを追跡しています（約 10MB）。
- **実行時に外部のCDNやモデル配信元へ取りに行かない。** hanabi は以前 jsDelivr と tfhub.dev から
  実行時に読み込んでいましたが、tfhub.dev が廃止されて kaggle.com へリダイレクトされるように
  なり、社内ネットワークのフィルタで止められると起動できませんでした。開発機ではブラウザ
  キャッシュに残っていて気づけないため、**必ず同梱**してください。
- **ビルド成果物（`dist/`）は追跡しない。** 配信は各アプリの predeploy でビルドしてから行います。
