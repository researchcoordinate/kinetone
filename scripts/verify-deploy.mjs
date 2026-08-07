#!/usr/bin/env node
/**
 * 配信できているかを、本番と照合して確かめる。
 *
 * `firebase.json` の postdeploy に入れてあるので、デプロイのたびに自動で走る。
 * 単独で走らせて、今の本番と手元の site/ がずれていないか調べることもできる。
 *
 *   node scripts/verify-deploy.mjs
 *
 * ── なぜ要るか ────────────────────────────────────────────────
 *
 * 「デプロイした」と「本番が変わった」は同じではない。実際に次のことが起きた。
 *
 *   - `kinetone.json` の tag を上げたのに、デプロイを忘れて本番が古いままだった
 *   - 名前を直してコミットしたのに、本番へ出ておらず前の名前が出ていた
 *   - Service Worker の precache が古いままで、直した HTML が端末に届かなかった
 *
 * どれも**画面を見ただけでは気づけない。**手元では直っているので、確かめた
 * つもりになってしまう。だから機械に突き合わせさせる。
 *
 * ── どうやって照合するか ──────────────────────────────────────
 *
 * Firebase Hosting の ETag は、**中身を gzip(level 9) にかけた sha256** である。
 * 手元で同じ計算をすれば、本文を 1 バイトも落とさずに中身を突き合わせられる。
 * site/ は 376MB あるので、全部取得して比べるのは現実的でない。
 *
 * 送られてくる ETag は、brotli で配信されるときだけ `...-br` の形になる。
 * 先頭の 64 桁だけを見ればよい。
 *
 * ── 404 が 200 に化ける件 ─────────────────────────────────────
 *
 * `firebase.json` の rewrites には受け皿（`**`）があるため、**無いファイルを
 * 頼んでも 404 ではなく 200 でホームの HTML が返る。**「200 だから出ている」と
 * 判断すると取り違える。ETag が食い違うのでここでは検出できるが、原因が
 * 「中身が違う」ではなく「そもそも無い」ときに分かるよう、別の言葉で報せる。
 */
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** 同時に投げる数。HEAD だけなので軽いが、行儀よく抑えておく。 */
const CONCURRENCY = 16

/**
 * 食い違ったものを、少し待ってからもう一度だけ確かめる。
 * 配信は即時に切り替わるが、取り出し口によっては数秒遅れることがある。
 * デプロイ直後に走らせるので、その揺れで騒がないようにする。
 */
const RETRY_WAIT_MS = 4000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 中身から、本番の ETag と同じ値を作る。 */
const etagOf = (buf) => createHash('sha256').update(gzipSync(buf, { level: 9 })).digest('hex')

/** 送られてきた ETag から、先頭の 64 桁だけを取り出す（`-br` などが付く）。 */
function normalizeEtag(raw) {
  const m = /[0-9a-f]{64}/.exec(raw ?? '')
  return m ? m[0] : null
}

/** 配信先の URL を決める。`.firebaserc` の既定プロジェクトから作る。 */
async function siteUrl() {
  if (process.env.KINETONE_SITE_URL) return process.env.KINETONE_SITE_URL.replace(/\/+$/, '')
  const rc = JSON.parse(await readFile(join(ROOT, '.firebaserc'), 'utf8'))
  const project = rc.projects?.default
  if (!project) throw new Error('.firebaserc に既定のプロジェクトがありません')
  return `https://${project}.web.app`
}

/**
 * 配信されるファイルを並べる。
 * `firebase.json` の ignore と同じものを外す（隠しファイルと node_modules）。
 */
async function deployedFiles(publicDir) {
  const all = await readdir(publicDir, { recursive: true, withFileTypes: true })
  return all
    .filter((e) => e.isFile())
    .map((e) => relative(publicDir, join(e.parentPath ?? e.path, e.name)))
    .filter((p) => !p.split(sep).some((seg) => seg.startsWith('.') || seg === 'node_modules'))
    .sort()
}

/** 相対パスを URL にする。日本語のファイル名があるので必ず符号化する。 */
const toUrl = (base, rel) => `${base}/${rel.split(sep).map(encodeURIComponent).join('/')}`

/**
 * 1 つ確かめる。
 * @returns null なら一致。食い違えば、その中身を返す
 */
async function check(base, publicDir, rel) {
  let want
  try {
    want = etagOf(await readFile(join(publicDir, rel)))
  } catch (e) {
    // 走っている最中に site/ が作り直されると、並べた時点では在ったファイルが
    // 消える。照合そのものが成り立たないので、**止めずに報せて先へ進む**
    if (e?.code === 'ENOENT') return { rel, kind: '手元から消えた', detail: '照合中に site/ が作り直された' }
    throw e
  }
  let res
  try {
    res = await fetch(toUrl(base, rel), { method: 'HEAD', redirect: 'manual' })
  } catch (e) {
    return { rel, kind: 'つながらない', detail: String(e?.message ?? e) }
  }
  if (res.status !== 200) return { rel, kind: `応答 ${res.status}`, detail: '' }

  const got = normalizeEtag(res.headers.get('etag'))
  if (got === want) return null

  // 受け皿の rewrite に拾われると、無いファイルでも 200 で HTML が返る。
  // 「中身が違う」ではなく「置かれていない」と伝えたほうが直しやすい
  const type = res.headers.get('content-type') ?? ''
  if (!rel.endsWith('.html') && type.includes('text/html')) {
    return { rel, kind: '本番に無い', detail: 'HTML が返っている（受け皿の rewrite に拾われた）' }
  }
  return { rel, kind: '中身が違う', detail: `本番 ${got?.slice(0, 12) ?? '(ETag なし)'} / 手元 ${want.slice(0, 12)}` }
}

/** 決めた数ずつ流す。 */
async function pool(items, worker) {
  const out = []
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (i < items.length) out.push(await worker(items[i++]))
    }),
  )
  return out
}

async function main() {
  const config = JSON.parse(await readFile(join(ROOT, 'firebase.json'), 'utf8'))
  const publicDir = join(ROOT, config.hosting.public)
  const base = await siteUrl()

  const files = await deployedFiles(publicDir)
  process.stdout.write(`本番と照合します（${files.length} 件）… `)

  let bad = (await pool(files, (rel) => check(base, publicDir, rel))).filter(Boolean)

  // 取り出し口の遅れかもしれないので、食い違ったものだけもう一度確かめる
  if (bad.length > 0) {
    await sleep(RETRY_WAIT_MS)
    bad = (await pool(bad.map((b) => b.rel), (rel) => check(base, publicDir, rel))).filter(Boolean)
  }

  if (bad.length === 0) {
    console.log(`一致しました（${base}）`)
    return
  }

  console.log('')
  console.error(`\n本番と食い違っています（${bad.length} / ${files.length} 件）\n`)
  for (const b of bad.slice(0, 40)) {
    console.error(`  ${b.kind.padEnd(10, '　')} ${b.rel}${b.detail ? `\n             ${b.detail}` : ''}`)
  }
  if (bad.length > 40) console.error(`  … ほか ${bad.length - 40} 件`)
  console.error('\n  手元の site/ が本番へ出ていません。もう一度デプロイしてください。')
  console.error('  それでも直らないときは、site/ を作り直してから出してください。\n')
  process.exitCode = 1
}

await main()
