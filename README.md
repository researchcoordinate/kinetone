# kinetone — 統合サイト

介護施設・サ高住向けの運動アプリ群 **kinetone** のホーム画面と、
「どのゲームをどのバージョンで載せるか」の一覧を持つリポジトリです。

**https://kinetone.web.app/** — Firebase プロジェクト `kinetone`

**ゲームのソースはここにはありません。**各ゲームは独立したリポジトリで開発し、
そこで作られた**ビルド済みの成果物（GitHub Release の zip）を取り込んで**配信します。
このリポジトリがゲームをビルドすることはありません。

```
ゲームのリポジトリ            このリポジトリ                Firebase Hosting
─────────────────           ──────────────                ────────────────
コードを直す
  ↓
git tag v0.2.0 && push
  ↓
CI が型チェック・テスト・
ビルドをして Release を作る ──→ kinetone.json の tag を
                                v0.2.0 に上げる
                                  ↓
                                deploy ──────────────────→ 本番に反映
```

この形にしている理由は 3 つあります。

- **他人の作業中のコードが本番に混ざらない。** 固定したタグの成果物しか取り込みません。
- **複数人が同時に開発してもコミットが衝突しない。** 別々のリポジトリで作業します。
- **壊れたものが本番に出ない。** 各ゲームの CI が型チェックとテストを通さないと Release が作られません。

利用者の名簿と記録をアプリ間で共有するため、**すべてを 1 つの origin にまとめて**配信します
（ブラウザの localStorage はサイトごとに分かれるので、別 URL では共有できません）。
カメラの選択もこの仕組みで全アプリ共通になっています。

---

## 前提

| 必要なもの | 用途 | 確認 |
|---|---|---|
| Node.js 20 以上 | ビルドスクリプト | `node -v` |
| [`gh` CLI](https://cli.github.com/)（ログイン済み） | private リポジトリの Release を取得する | `gh auth status` |
| Firebase CLI（ログイン済み） | 配信 | `npx firebase-tools login` |

`gh` の認証をそのまま使うので、**開発者ごとのトークン設定は要りません。**

---

## ゲームの新しい版を本番に出す（いちばんよく使う操作）

1. ゲーム側のリポジトリでタグを打つ（`git tag v0.2.0 && git push origin v0.2.0`）
2. CI が通って Release ができたことを確認する（`gh release view v0.2.0 --repo researchcoordinate/<repo>`）
3. このリポジトリで `kinetone.json` の該当 `tag` を書き換えてデプロイする

```bash
npx firebase-tools deploy --only hosting   # 取得 → site/ を組み立て → 配信
```

**戻したいときは `tag` を前のバージョンに戻して、もう一度デプロイするだけです。**
ゲーム側でタグを打っただけでは本番は変わりません。

---

## ゲームを新しく追加する

### 0. ひな形から始める

**[`kinetone-template`](https://github.com/researchcoordinate/kinetone-template) を複製してください。**
下の「約束ごと」を満たした状態から始められます（カメラの選択・配信パスの設定・
リリースのワークフロー・画面づくりの作法まで入っています）。**public なので誰でも読めます。**

**リポジトリ名は `kinetone-` で始めてください**（下の「リポジトリの名前と表示」を参照）。

```bash
gh repo create researchcoordinate/kinetone-<id> --private --template researchcoordinate/kinetone-template
```

複製したら、まず配信パス（`/example/` になっている箇所）を書き換えます。
詳しい手順はテンプレートの README にあります。

#### AI に作らせるとき

次の 2 つを読ませてから頼むと、統合できる形のものが出てきます。どちらも public です。

- このファイル（`https://github.com/researchcoordinate/kinetone/blob/main/README.md`）
- ひな形（`https://github.com/researchcoordinate/kinetone-template`）

> kinetone の README とひな形（kinetone-template）を読んで、
> 「〇〇するゲーム」を作ってください。配信パスは `/〇〇/` です。

**GitHub の操作に慣れていない人は、ゲームを作るところまでを担当し、リポジトリ作成・
タグ付け・`kinetone.json` への登録・デプロイは慣れた人が引き取る**のが確実です。
手続きの部分がいちばん GitHub 慣れを要求します。

### 1. ゲーム側が満たすこと（統合の約束ごと）

| 項目 | 内容 |
|---|---|
| **リポジトリ名** | `kinetone-<id>`（例: `kinetone-flower`）。下の「リポジトリの名前と表示」を参照 |
| **配信パス** | `/<id>/` で配信します。`id` は `kinetone.json` に書くキーで、リポジトリ名から `kinetone-` を除いたもの |
| **ビルド時の base** | Vite なら `KINETONE_BASE=/<id>/` を渡してビルドする。**Service Worker の scope もこれで決まる**ので、成果物は配信パスに固定される |
| **成果物の形** | 配信するファイルの**中身**を固めた zip（展開して `site/<id>/` にそのまま置く。`dist/` という階層は作らない） |
| **入口** | 既定は `index.html`。別名なら `kinetone.json` の `entry` に書く |
| **外部依存** | **実行時に外部の CDN やモデル配信元へ取りに行かないこと**（後述の「方針」参照） |
| **CI** | タグ push で型チェック・テスト・ビルドをして Release に zip を添付する |

ひな形を使えばここは満たされています。既存のゲームに合わせる場合は、
[chair-stand](https://github.com/researchcoordinate/kinetone-chair-stand/blob/main/.github/workflows/release.yml)（Vite）か
[hanabi](https://github.com/researchcoordinate/kinetone-hanabi/blob/main/.github/workflows/release.yml)（静的サイト）の
ワークフローを写してください。

Vite の場合、`KINETONE_BASE` の受け方はこうします。**base は Vite のアセット URL だけでなく、
Service Worker の scope と start_url も決めます。**ここが配信パスと食い違うと、本番で画面が
真っ白になったり、別のゲームのキャッシュを掴んだりします。

```ts
// vite.config.ts
const base = process.env.KINETONE_BASE ?? '/'   // 単体で動かすときは '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',   // 施設では開きっぱなしなので自動で入れ替える
      base,
      scope: base,
      manifest: { start_url: base, scope: base /* ... */ },
    }),
  ],
})
```

成果物は `dist/` の**中身**を固めます（`cd dist && zip -qr ../dist.zip .`）。
`dist/` という階層を含めると、展開先が `site/<id>/dist/...` になって配信されません。

### 2. サムネイルを用意する

`home/thumbs/<name>.jpg` に置きます。

- **480 × 270（16:9）の JPEG**
- ゲームの開始画面か、遊んでいる場面を実際に撮ったもの（見て中身が分かるように）

撮り方の例（ローカルサーバーで開いて撮影 → 縮小）:

```bash
python3 -m http.server 8080 --directory site
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --screenshot=/tmp/shot.png --window-size=1024,576 http://localhost:8080/<id>/
sips -s format jpeg -s formatOptions 80 -z 270 480 /tmp/shot.png --out home/thumbs/<name>.jpg
```

**ゲームの中で使う BGM と画像は、出どころが決まっています。**
下の「[素材（BGM・画像）](#素材bgm画像)」を読んでから用意してください。

### 3. `kinetone.json` に 2 か所足す

```jsonc
"apps": {
  "<id>": {
    "build": { "kind": "github-release", "repo": "researchcoordinate/<repo>",
               "tag": "v0.1.0", "asset": "dist.zip" },
    "spa": true                      // SPA なら true（どのパスで来ても入口を返す）
  }
},
"cards": [
  { "group": "together",             // ホームのどの見出しに置くか（下表）
    "app": "<id>",
    "name": "ゲームの名前",
    "desc": "ホームに出す一行説明",
    "tag": "全身を動かす",             // 何を動かすか・何をはかるか
    "note": "※〜",                    // 任意。説明の下に、色を変えて小さく出る
    "thumb": "<name>.jpg" }
]
```

**`group` は「いつ使うか」で選びます。**施設ではレクの時間と個別の運動の時間は別なので、
職員が今どれを開くかで迷わないように分けています。

| `group` | 見出し | 使う場面 |
|---|---|---|
| `together` | みんなで動く | レクの時間。何人かで集まってやる |
| `train` | 楽しく鍛える | 個別の運動。ひとりで、日々続ける |
| `measure` | 体力をはかる | 定期的な評価。年代の基準と比べる |

**「あそぶ」とは呼びません。**現役時代に仕事や役割を持っていた方ほど、「遊び」と言われると
子ども扱いに感じて参加を拒むことがあります。やることは同じでも「鍛える」なら目的のある
活動になります。かといって「鍛える」だけにすると体力に自信のない方には要求に聞こえるので、
「楽しく」を残しています。**利用者に見せる文言は、この線で書いてください。**

音声の `kind`（`play` / `measure`）はこの区分とは別です。`together` と `train` はどちらも
`play` の声（Despina）を使います。

### 4. 反映して配信する

```bash
node scripts/build-site.mjs --write-config   # firebase.json の rewrites を更新（要コミット）
npx firebase-tools deploy --only hosting
```

---

## リポジトリの名前と表示

**kinetone のリポジトリは、すべて `kinetone-` で始めます。**会社の GitHub には
みまもりや別プロジェクトのリポジトリも並ぶため、一覧で見分けられるようにするためです。
以前は `flower` `hanabi` のようなゲーム名だけでしたが、数が増えて紛らわしくなったので
揃えました。

新しく作るときは 3 つとも設定してください。

| 項目 | 決めごと | 例 |
|---|---|---|
| リポジトリ名 | `kinetone-<id>` | `kinetone-flower` |
| 説明 | **`【kinetone】`** で始める | `【kinetone】みんなの花畑 — カメラの前で体を動かすと足元に花が育つ体感ゲーム` |
| トピック | `kinetone` を付ける | GitHub 上で絞り込めます |

```bash
gh repo create researchcoordinate/kinetone-<id> --private \
  --description "【kinetone】<ゲーム名> — <一行説明>" \
  --template researchcoordinate/kinetone-template
gh api -X PUT repos/researchcoordinate/kinetone-<id>/topics \
  --input - <<< '{"names":["kinetone"]}'
```

**配信パスとホームのカードでは `kinetone-` を付けません。** `kinetone.json` のキー（`id`）と
URL は `flower` のように短いままです。長い URL を利用者に見せないためです。

| | 名前 |
|---|---|
| リポジトリ | `researchcoordinate/kinetone-flower` |
| `kinetone.json` のキー | `flower` |
| 配信 URL | `https://kinetone.web.app/flower/` |

## `kinetone.json` の読み方

**このファイルだけが配信内容を決めます。**ビルドスクリプトにアプリ名は書きません。

| やりたいこと | 直す場所 |
|---|---|
| ゲームのバージョンを上げる／戻す | その `apps` の `tag` |
| ホームの並び順を変える | `cards` 配列の順番（そのまま画面の順番） |
| 名前・説明・タグを直す | 該当する `cards` の項目 |
| 開発中のゲームを配信から外す | その `apps` に `"enabled": false`（いまは `block` がこれ） |
| 1 つの成果物を 2 つの入口で使う | 2 つ目の `apps` に同じ `build` と、違う `entry` |

`apps.<id>.build.kind` が「どこから持ってくるか」です。

| `kind` | 意味 |
|---|---|
| `github-release` | **別リポジトリの Release から zip を取り込む**（通常はこれ） |
| `vite` | このリポジトリ内の Vite プロジェクトをビルドする（いまは未使用） |
| `static` | このリポジトリ内の静的ファイルをコピーする（いまは未使用） |

`vite` / `static` は、切り出す前のゲームを一時的に手元で試すための逃げ道として残してあります。

`shared` は、ホームが直接読む共通モジュールの取り込み先とタグです。

---

## 仕組み

`scripts/build-site.mjs` が `kinetone.json` を読んで `site/` を組み立てます。
デプロイの predeploy で自動的に走ります。

```
site/
  index.html          ホーム（home/index.html にカードを流し込んだもの）
  thumbs/             サムネイル
  shared/camera/      共通モジュール（ホームが <script type="module"> で読む）
  <id>/               各ゲーム（Release の zip を展開したもの）
```

**取り込んだ HTML には 1 つだけ手を入れます。**そのゲームの**すべてのページ**に
「ホームへもどる」を差し込みます（`injectHomeLink`）。入口が複数あるゲームが
あるためです（`stepping/measure.html`、`chair-stand/cs30/index.html` など）。iPad のホーム画面に置くと Safari の枠ごと
「戻る」が消えるため、ゲームからホームへ帰る道が要るからです。

各ゲームのリポジトリには入れていません。7 本を別々に直すと、リリースとデプロイが
7 回必要になり、書き方が少しずつずれ、次に作るゲームでまた忘れられます。
**ゲーム側で用意する必要はありません。**左上に自動で付きます。

覚えておくと役に立つ点が 4 つあります。

**取得したものはキャッシュされます**（`.cache/`）。同じタグなら再ダウンロードしません。

**`firebase.json` の rewrites も `kinetone.json` から決まります。**ただし Firebase CLI は
デプロイ開始時に `firebase.json` を読むため、predeploy で書き換えてもその回には効きません。
そのため既定では**食い違いを検出してデプロイを止める**だけにし、書き換えは
`--write-config` を付けたときだけ行います（更新したらコミットしてください）。

**入口は必ず `index.html` として置かれます。** Firebase Hosting は `/xxx/` の要求に対して
静的な `index.html` を rewrites より先に返すので、rewrites だけでは入口を差し替えられません。
`entry` を指定すると、その HTML が配信ディレクトリの `index.html` になります
（あいうべ体操は 1 つの zip を 2 つの入口で使っています）。

**ホームのカードは `home/index.html` の `<!--{{cards}}-->` に流し込まれます。**
`home/index.html` を直接ブラウザで開くとカードは出ません。`site/index.html` を見てください。

---

## 共通モジュール

アプリをまたいで同じであるべきものは、別リポジトリに置いてタグで固定して取り込みます。

| モジュール | 中身 |
|---|---|
| [`@kinetone/camera`](https://github.com/researchcoordinate/kinetone-camera) | カメラの選択・保存・再接続と、歯車の設定パネル。依存なし・素の ES モジュールなので、Vite のアプリからもビルドの無い静的サイトからも使えます |
| [`@kinetone/voice`](https://github.com/researchcoordinate/kinetone-voice) | 案内・ペットの音声を Google Cloud TTS で作る（ビルド時のみ）。**あそぶ = Despina / はかる = ja-JP-Neural2-B** の使い分けをここが持ちます |
| [`@kinetone/motion`](https://github.com/researchcoordinate/kinetone-motion) | **画面の動きだけを見る検出**（骨格推定を使わない）。1 コマ 1ms 未満で、古いタブレットでも動きます。「検出されない人が出ない」ので、うまく動けない方が弾かれません |
| [`kinetone-template`](https://github.com/researchcoordinate/kinetone-template) | ゲームを新しく作るときのひな形（モジュールではありませんが、共通の作法はここに集めています） |

**public リポジトリなので、開発者ごと・CI ごとのトークン設定は要りません。**

```jsonc
// Vite のアプリ（package.json）
"@kinetone/camera": "github:researchcoordinate/kinetone-camera#v0.1.0"
```

ビルドの無い静的サイト（hanabi・あいうべ体操）は、単体でも動かせるように
`shared/camera/` へファイルを同梱しています（更新時は手で入れ替えます）。
ホームは `build-site.mjs` が同じタグのソースを取得して `site/shared/camera/` に置きます。

**音声も全アプリで共通の声を使います。**ビルド前に mp3 を作って同梱し、実行時には
TTS を呼びません。課金先は `GOOGLE_TTS_PROJECT=kinetone` を必ず指定します
（省くと ADC の既定に引きずられ、別製品のプロジェクトで課金されます）。

**カメラの選択は全アプリで共通です。**ホーム画面の右下の小さな歯車で 1 回選べば、
どのゲームでもそのカメラで開きます（施設や展示で使うカメラは 1 台なので、アプリごとに
選ばせる意味がありません）。同じ origin で配信しているから成り立っています。

---

## 素材（BGM・画像）

**アプリをまたいで雰囲気をそろえるため、素材の出どころを決めています。**
ゲームごとに調子がばらばらだと、ホームから続けて開いたときに別のサービスに見えます。
権利の確認先も、出どころが決まっていれば 1 か所で済みます。

### BGM

**次の 3 か所からダウンロードして使ってください。**

| 配布元 | URL |
|---|---|
| 甘茶の音楽工房 | https://amachamusic.chagasi.com/index.html |
| ノスタルジア | http://nostalgiamusic.info/index.html |
| PeriTune | https://peritune.com/ |

いずれも商用利用できるフリー素材です。甘茶の音楽工房とノスタルジアには施設で流すのに
向いた穏やかな曲が、PeriTune には和風・お囃子などの場面に合わせた曲がそろっています
（hanabi の `PerituneMaterial_Ohayashi.mp3` がこれです）。
**ほかのサイトの曲は使わないでください。**新しい曲が要るときは、まずこの 3 か所で
近いものを探します。

- 置き場所は `assets/BGM/<曲名>.mp3`（例: `kinetone-flower/public/assets/BGM/pokapokayouki.mp3`）
- **ファイル名は配布元の曲名のまま**にします。後から出どころを辿れるようにするためです
- クレジット表記の要否は配布元の規約に従います。**ダウンロードのたびに規約を確認してください**

### 画像

**Adobe Firefly の、商用利用が許諾されたモデルで生成してください。**
Adobe が学習データの権利を処理している Firefly の画像生成モデルを選びます。
**Firefly の画面から選べる他社モデル（パートナーモデル）は使わないでください。**
出力の扱いが Adobe の許諾の範囲から外れます。

写真素材や別の生成 AI の画像を混ぜると、権利の確認先がアプリごとに散らばって
追えなくなります。**素材は Firefly に寄せてください。**

`home/thumbs/` のサムネイルはこの対象外です（実際の画面を撮ったものなので生成しません）。

---

## 収録アプリ

| リポジトリ | 配信パス | 内容 |
|---|---|---|
| [`flower`](https://github.com/researchcoordinate/kinetone-flower) | `/flower/` | みんなの花畑（体を動かすと足元に花が育つ。ペット・BGM つき） |
| [`hanabi`](https://github.com/researchcoordinate/kinetone-hanabi) | `/hanabi/` | 夏だ！みんなで花火（みんなで手を振ると花火が上がる） |
| [`stepping`](https://github.com/researchcoordinate/kinetone-stepping) | `/stepping/` | おさんぽ足踏み（その場足踏みで石畳の街が進む） |
| 同上 | `/steptest/` | 2分間足踏みテスト（同じ成果物の `measure.html`） |
| [`chair-stand`](https://github.com/researchcoordinate/kinetone-chair-stand) | `/chair-stand/` | 5回椅子立ち上がりテスト（FTSST） |
| 同上 | `/chair-stand/cs30/` | 30秒椅子立ち上がりテスト（CS-30。同じ成果物の別ページ） |
| [`aiube`](https://github.com/researchcoordinate/kinetone-aiube) | `/aiube/` | あいうべ体操・自分の顔版 |
| 同上 | `/aiube-avatar/` | あいうべ体操・キャラクター版（同じ zip・入口だけ違う） |
| [`block`](https://github.com/researchcoordinate/kinetone-block) | （未配信） | 運動を積み上げて街をつくるゲーム（開発中） |
| [`one-leg-stand`](https://github.com/researchcoordinate/kinetone-one-leg-stand) | `/one-leg-stand/` | 開眼片足立ちテスト（片足で立っていられる時間。**正面から撮影**） |

新しく作るときの出発点は [`kinetone-template`](https://github.com/researchcoordinate/kinetone-template) です。

各ゲームの仕様・設計は、それぞれのリポジトリの README を参照してください。

---

## 旧配信先（1 ゲーム 1 プロジェクト時代の名残り）

統合サイトへ移す前は、ゲームごとに Firebase プロジェクトと URL を持っていました。
これらのサイトは**削除せず、統合サイトへの案内ページに差し替えてあります**
（`scripts/legacy-redirect.mjs`）。旧 URL をブックマークしている端末が、古いビルドを
使い続けてしまうのを防ぐためです。

| 旧 URL | 送り先 |
|---|---|
| kinetone-multi-flower.web.app | `/flower/` |
| kinetone-hanabi.web.app | `/hanabi/` |
| kinetone-stepping.web.app | `/stepping/` |
| kinetone-steptest.web.app | `/steptest/` |
| kinetone-chairstand.web.app | `/chair-stand/` |
| aiube-taisou-demo.web.app | `/aiube-avatar/` |
| aiube-mesh-demo.web.app | `/aiube/` |

案内ページには、旧 PWA の Service Worker を解除する `sw.js` も置いています
（放っておくとキャッシュから古い画面が出続けて、案内ページに辿り着けないため）。
送り先を変えるときは `scripts/legacy-redirect.mjs` を書き換えて再実行します。

---

## 方針

- **実行時に外部の CDN やモデル配信元へ取りに行かない。** hanabi は以前 jsDelivr と
  tfhub.dev から実行時に読み込んでいましたが、tfhub.dev が廃止されて kaggle.com へ
  リダイレクトされるようになり、**社内ネットワークのフィルタで止められた端末が起動
  できなくなりました**。開発機ではブラウザキャッシュに残っていて気づけません
  （「自分の PC では動くのに他の PC では起動しない」という形で現れます）。
  ライブラリもモデルも**必ず同梱**し、CI で機械的に確認してください。
- **モデル・WASM は原則追跡しない。**取得スクリプトで再取得できるようにします。
  ただしビルドの無い静的サイト（hanabi・あいうべ体操）は、clone してそのまま動く状態を
  保つため追跡しています。
- **大きな素材は「使うものだけ」追跡する。** 未使用の音声・動画・BGM は `.gitignore` で
  除外し、差し替えるときにその 1 つだけ `git add` します。
- **ビルド成果物（`dist/`）は追跡しない。**
- **カメラは HTTPS か localhost でしか使えません。**実機での確認は、プレビューチャンネルで行います。

```bash
npx firebase-tools hosting:channel:deploy preview --expires 7d
```
