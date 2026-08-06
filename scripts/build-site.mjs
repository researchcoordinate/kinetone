/**
 * 統合サイト（https://kinetone.web.app）用の配信ディレクトリ site/ を作る。
 *
 * 各アプリは別々の Vite プロジェクト／静的サイトだが、利用者の名簿を共有するには
 * 同じ origin に載っている必要がある（localStorage はサイトごとに分かれるため）。
 * そこで、それぞれをサブパス向けにビルドして site/ の下に並べる。
 *
 * **何を載せるかは kinetone.json だけが決める。**このスクリプトにアプリ名は書かない。
 * ゲームを増やす・並べ替える・一時的に外すときは kinetone.json を直す。
 *
 *   site/                 ホーム（kinetone.json からカードを生成）
 *   site/<app id>/        各アプリ
 *
 * Vite プロジェクトには KINETONE_BASE でサブパスを渡す（vite.config.ts が読む）。
 * 静的サイトは相対パスで書かれているので、そのままコピーするだけで動く。
 *
 * firebase.json の rewrites も kinetone.json から決まる。ただし Firebase CLI は
 * デプロイ開始時に firebase.json を読むので、predeploy でここが書き換えても
 * 次回デプロイまで反映されない。そのため既定では**食い違いを検出して止める**だけにし、
 * 書き換えは明示的に `--write-config` を付けたときだけ行う。
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const site = resolve(root, 'site')
const writeConfig = process.argv.includes('--write-config')

const manifest = JSON.parse(await readFile(resolve(root, 'kinetone.json'), 'utf8'))

/** 配信するアプリ（enabled: false は開発中なので載せない）。 */
const apps = Object.entries(manifest.apps)
  .filter(([, app]) => app.enabled !== false)
  .map(([id, app]) => ({ id, ...app }))

const appById = new Map(apps.map((app) => [app.id, app]))
const cards = manifest.cards.filter((card) => appById.has(card.app))

const skipped = Object.entries(manifest.apps).filter(([, app]) => app.enabled === false)
const hiddenCards = manifest.cards.filter((card) => !appById.has(card.app))

const exists = async (p) => {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

const run = (cmd, args, cwd, env = {}) =>
  execFileSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } })

const escape = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// ---------------------------------------------------------------------------
// ホーム画面（カードを kinetone.json から組み立てる）
// ---------------------------------------------------------------------------

/** カードの中の URL。指定が無ければ /<app id>/。 */
const cardUrl = (card) => card.url ?? `/${card.app}/`

function renderCard(card, group) {
  const tileClass = ['tile', group.tileClass].filter(Boolean).join(' ')
  const tags = [
    `<span class="tag">${escape(card.tag)}</span>`,
    card.people === 'group' ? '<span class="tag tag--group">みんなで</span>' : '',
    card.people === 'solo' ? '<span class="tag tag--solo">ひとりで</span>' : '',
  ].join('')
  return `      <li><a class="${tileClass}" href="${escape(cardUrl(card))}">
        <img src="thumbs/${escape(card.thumb)}" alt="" width="480" height="270">
        <span class="body">
          <span class="tags">${tags}</span>
          <span class="name">${escape(card.name)}</span>
          <span class="desc">${escape(card.desc)}</span>
          ${card.note ? `<span class="note">${escape(card.note)}</span>` : ''}
        </span>
      </a></li>`
}

function renderCards() {
  return manifest.groups
    .map((group) => {
      const list = cards.filter((card) => card.group === group.id)
      if (list.length === 0) return ''
      return `    <h2>${escape(group.title)}</h2>
    <ul class="tiles">
${list.map((card) => renderCard(card, group)).join('\n')}
    </ul>`
    })
    .filter(Boolean)
    .join('\n\n')
}

/**
 * ホームが直接読む共通モジュールを配る。
 *
 * ホームはビルドの無い静的ページなので、<script type="module"> で site/shared/ から読む。
 * Vite の各アプリは npm の依存（同じ公開リポジトリの同じタグ）で取り込むので、
 * ここで面倒をみるのはホーム用の配布だけ。取り込むタグは kinetone.json が決める。
 */
async function copySharedModules() {
  for (const [name, spec] of Object.entries(manifest.shared ?? {})) {
    console.log(`\n▶ 共通モジュール ${spec.repo} ${spec.tag} を取得`)
    const from = await fetchTag(spec)
    const to = resolve(site, 'shared', name)
    await mkdir(to, { recursive: true })
    for (const file of spec.files) {
      await cp(resolve(from, file), resolve(to, file))
    }
  }
}

/**
 * 公開リポジトリのタグ付きソースを取ってくる。
 * public なので認証は要らない（開発者ごとのトークン設定を増やさないため public にしてある）。
 */
async function fetchTag({ repo, tag }) {
  const cacheDir = resolve(root, '.cache/shared', repo.replace('/', '__'), tag)
  const unpacked = resolve(cacheDir, 'src')
  if (await exists(unpacked)) {
    console.log('  ・キャッシュを使います')
    return unpacked
  }
  await mkdir(unpacked, { recursive: true })
  const url = `https://github.com/${repo}/archive/refs/tags/${tag}.tar.gz`
  const tgz = resolve(cacheDir, 'src.tar.gz')
  run('curl', ['-fsSL', url, '-o', tgz], root)
  // 先頭のディレクトリ（<repo>-<tag>/）を剥がして中身だけ取り出す
  run('tar', ['-xzf', tgz, '-C', unpacked, '--strip-components=1'], root)
  return unpacked
}

/** home/index.html の目印を、生成したカードに差し替える。 */
async function buildHome() {
  const template = await readFile(resolve(root, 'home/index.html'), 'utf8')
  const marker = '<!--{{cards}}-->'
  if (!template.includes(marker)) {
    throw new Error(`home/index.html に ${marker} が見つかりません`)
  }
  await cp(resolve(root, 'home'), site, { recursive: true })
  await writeFile(resolve(site, 'index.html'), template.replace(marker, renderCards().trimStart()))
}

// ---------------------------------------------------------------------------
// firebase.json の rewrites
// ---------------------------------------------------------------------------

/**
 * SPA は「どのパスで来ても入口の HTML を返す」必要がある。
 * カードが独自の URL を持つ場合（/steptest/ など）は、アプリ本体より先に置く。
 */
function expectedRewrites() {
  const rewrites = []
  for (const card of cards.filter((c) => c.rewriteTo)) {
    const path = cardUrl(card).replace(/\/$/, '')
    rewrites.push({ source: path, destination: card.rewriteTo })
    rewrites.push({ source: `${path}/**`, destination: card.rewriteTo })
  }
  for (const app of apps) {
    if (app.spa === false) continue
    rewrites.push({ source: `/${app.id}/**`, destination: `/${app.id}/${app.entry ?? 'index.html'}` })
  }
  rewrites.push({ source: '**', destination: '/index.html' })
  return rewrites
}

async function syncFirebaseConfig() {
  const path = resolve(root, 'firebase.json')
  const config = JSON.parse(await readFile(path, 'utf8'))
  const expected = expectedRewrites()
  if (JSON.stringify(config.hosting.rewrites) === JSON.stringify(expected)) return

  if (!writeConfig) {
    console.error('\n✖ firebase.json の rewrites が kinetone.json と食い違っています。')
    console.error('  node scripts/build-site.mjs --write-config で直してからコミットしてください。')
    console.error(`\n  期待する内容:\n${JSON.stringify(expected, null, 2)}\n`)
    process.exit(1)
  }
  config.hosting.rewrites = expected
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`)
  console.log('▶ firebase.json の rewrites を更新しました（コミットしてください）')
}

// ---------------------------------------------------------------------------
// アプリのビルド・コピー
// ---------------------------------------------------------------------------

async function buildApp(app) {
  const { build } = app
  const to = resolve(site, app.id)
  // dir はこのリポジトリの中にあるものだけが持つ（github-release には無い）
  const from = build.dir ? resolve(root, build.dir) : null

  if (build.kind === 'vite') {
    const path = `/${app.id}/`
    console.log(`\n▶ ${build.dir} を ${path} 向けにビルド`)
    // 追跡していないモデル・WASM は、無ければ取得スクリプトで用意する
    if (build.setup && build.needs && !(await exists(resolve(from, build.needs)))) {
      run('npm', ['run', build.setup], from)
    }
    run('npx', ['tsc', '-b'], from)
    run('npx', ['vite', 'build'], from, { KINETONE_BASE: path })
    // ビルド後の生成物（Service Worker など）はアプリ側のスクリプトに任せる
    for (const script of build.post ?? []) {
      run('node', [script], from, { KINETONE_BASE: path })
    }
    await cp(resolve(from, 'dist'), to, { recursive: true })
    return
  }

  if (build.kind === 'static') {
    console.log(`\n▶ ${build.dir} をコピー`)
    if (build.files) {
      await mkdir(to, { recursive: true })
      for (const file of build.files) {
        await cp(resolve(from, file), resolve(to, file), { recursive: true })
      }
    } else {
      await cp(from, to, { recursive: true })
    }
    return
  }

  if (build.kind === 'github-release') {
    console.log(`\n▶ ${build.repo} ${build.tag} を取得`)
    const dir = await fetchRelease(build)
    await cp(dir, to, { recursive: true })
    return
  }

  throw new Error(`${app.id}: 未対応の build.kind です（${build.kind}）`)
}

/**
 * 配信ディレクトリの index.html を、必ずそのアプリの入口にする。
 *
 * Firebase Hosting は `/xxx/` の要求に対して**静的な index.html を先に返す**ので、
 * rewrites では入口を差し替えられない。1 つの成果物を複数の入口で使うとき
 * （あいうべ体操のメッシュ版とアバター版は同じ zip）に、別の版が出てしまう。
 */
/*
  「ホームへもどる」。

  iPad のホーム画面に置くと Safari の枠ごと「戻る」が消えるので、ゲームから
  ホームへ帰る道が要る（左端からのスワイプでも戻れるが、職員には分かりにくい）。

  **各ゲームのリポジトリには入れない。**7 本を別々に直すと、リリースとデプロイが
  7 回必要になり、書き方が少しずつずれ、次に作るゲームでまた忘れられる。
  ここで差し込めば 1 か所で済み、新しいゲームにも自動で付く。

  置き場所は左上。カメラの歯車が右下なので、ぶつからない。利用者の手は画面の
  中央から下に来るので、うっかり押されにくい。
*/
const HOME_LINK = `
<a class="kinetone-home" href="/" aria-label="キネトーンのホームへもどる">
  <span aria-hidden="true">←</span> ホーム
</a>
<style>
.kinetone-home{
  position:fixed; top:10px; left:10px; z-index:2147483000;
  display:inline-flex; align-items:center; gap:.35em;
  /* 押しやすさは要るが、目立たせない。利用者ではなく職員のためのもの */
  min-height:44px; padding:0 16px; border-radius:999px;
  font-family:"Hiragino Maru Gothic ProN","Hiragino Kaku Gothic ProN","Yu Gothic",sans-serif;
  font-size:15px; font-weight:700; line-height:1; text-decoration:none;
  /* 明るい画面にも暗い画面にも載るよう、暗い地に白文字＋薄い縁 */
  color:#fff; background:rgba(12,20,32,.55); border:1px solid rgba(255,255,255,.34);
  -webkit-backdrop-filter:blur(4px); backdrop-filter:blur(4px);
  -webkit-user-select:none; user-select:none; touch-action:manipulation;
  opacity:.72;
}
.kinetone-home:hover, .kinetone-home:focus-visible{ opacity:1; }
.kinetone-home:active{ transform:translateY(1px); }
</style>
`

/**
 * 「ホームへもどる」を、そのゲームの**すべての HTML** に差し込む。
 *
 * 入口の 1 ファイルだけでは足りない。ゲームによっては入口が複数ある。
 *
 *   stepping/index.html         おさんぽ足踏み
 *   stepping/measure.html       2分間足踏みテスト
 *   chair-stand/index.html      5回椅子立ち上がりテスト
 *   chair-stand/cs30/index.html 30秒椅子立ち上がりテスト
 *
 * どれもホームのカードから直接開くので、全部に要る。入口だけ入れていた時期が
 * あり、測定 3 種のうち 2 つに戻る道が無かった。
 *
 * ensureEntry より**前**に呼ぶこと。入口が index.html 以外のゲーム（花火）でも、
 * 差し込んだものがそのまま index.html にコピーされる。
 */
async function injectHomeLink(app) {
  const dir = resolve(site, app.id)
  const entry = app.entry ?? 'index.html'
  if (!(await exists(resolve(dir, entry)))) {
    throw new Error(`${app.id}: 入口の ${entry} が見つかりません`)
  }

  const names = await readdir(dir, { recursive: true })
  const pages = names.filter((name) => name.endsWith('.html'))
  let done = 0
  for (const name of pages) {
    const file = resolve(dir, name)
    const html = await readFile(file, 'utf8')
    if (html.includes('kinetone-home')) continue // 二重に入れない
    if (!html.includes('</body>')) continue // 断片など、ページでないものは触らない
    await writeFile(file, html.replace('</body>', `${HOME_LINK}</body>`))
    done += 1
  }
  if (done > 1) console.log(`  ・「ホームへもどる」を ${done} ページに入れました`)
  await refreshServiceWorker(app, pages)
}

/**
 * 差し込んだページを、Service Worker に取り直させる。
 *
 * **これが無いと、端末では永久に直らない。**
 *
 * Service Worker の先読み一覧は `{url, revision}` で、revision はゲーム側の
 * ビルド時に決まる。「ホームへもどる」は取り込み時に後から差し込むので、
 * 中身は変わっても revision は変わらない。Service Worker は「変わっていない」と
 * 判断して、古いページを配り続ける（30秒椅子立ち上がりテストで実際に起きた）。
 *
 * 差し込んだあとの中身から revision を作り直して書き戻す。sw.js の中身も
 * 変わるので、ブラウザが新しい Service Worker として入れ直す。
 */
async function refreshServiceWorker(app, pages) {
  const swFile = resolve(site, app.id, 'sw.js')
  if (!(await exists(swFile))) return

  let sw = await readFile(swFile, 'utf8')
  let updated = 0
  for (const page of pages) {
    const url = page.split('\\').join('/')
    const body = await readFile(resolve(site, app.id, page))
    const revision = createHash('md5').update(body).digest('hex')
    // 先読み一覧の形は "<url>",revision:"<hex>"（圧縮後）
    const pattern = new RegExp(`("${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}",revision:")[^"]*(")`)
    if (!pattern.test(sw)) continue
    sw = sw.replace(pattern, `$1${revision}$2`)
    updated += 1
  }
  if (updated > 0) {
    await writeFile(swFile, sw)
    console.log(`  ・Service Worker に ${updated} ページを取り直させます`)
  }
}

async function ensureEntry(app) {
  const entry = app.entry ?? 'index.html'
  if (entry === 'index.html') return
  const dir = resolve(site, app.id)
  if (!(await exists(resolve(dir, entry)))) {
    throw new Error(`${app.id}: 入口の ${entry} が見つかりません`)
  }
  await cp(resolve(dir, entry), resolve(dir, 'index.html'))
  console.log(`  ・${entry} を入口（index.html）にしました`)
}

/**
 * 別リポジトリの GitHub Release から、ビルド済みの成果物を取ってくる。
 *
 * ソースからビルドしないのが要点。各自が好きなときに publish でき、
 * 他人の作業中のコードが統合サイトに混ざらない。壊れたゲームがあっても
 * 統合サイトのビルドは落ちない（tag を戻すだけで復旧できる）。
 *
 * 取得は gh CLI に任せる。開発者はすでに GitHub の認証を持っているので、
 * private リポジトリでも追加のトークン設定が要らない。
 */
async function fetchRelease({ repo, tag, asset }) {
  const cacheDir = resolve(root, '.cache/artifacts', repo.replace('/', '__'), tag)
  const unpacked = resolve(cacheDir, 'unpacked')
  // tag ごとにキャッシュする（同じ tag の中身は変わらない前提）
  if (await exists(unpacked)) {
    console.log('  ・キャッシュを使います')
    return unpacked
  }

  await mkdir(cacheDir, { recursive: true })
  const zip = resolve(cacheDir, asset)
  if (!(await exists(zip))) {
    run('gh', ['release', 'download', tag, '--repo', repo, '--pattern', asset, '--dir', cacheDir], root)
  }
  await mkdir(unpacked, { recursive: true })
  run('unzip', ['-q', '-o', zip, '-d', unpacked], root)
  return unpacked
}

// ---------------------------------------------------------------------------

await syncFirebaseConfig()

await rm(site, { recursive: true, force: true })
await mkdir(site, { recursive: true })

for (const app of apps) {
  await buildApp(app)
  await injectHomeLink(app)
  await ensureEntry(app)
}

console.log('\n▶ ホーム画面を組み立て')
await buildHome()
await copySharedModules()

for (const [id] of skipped) {
  console.log(`  － ${id} は enabled: false のため載せていません`)
}
for (const card of hiddenCards) {
  console.log(`  － カード「${card.name}」は ${card.app} が載っていないため出していません`)
}

console.log(
  `\n✓ site/ を作成しました（アプリ ${apps.length} 個 / カード ${cards.length} 枚）` +
    '\n  npx firebase-tools deploy --only hosting で配信',
)
