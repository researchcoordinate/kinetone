/**
 * dist/ の中身を全部先読みキャッシュする Service Worker を生成する。
 *
 * 会場のネットワークは信頼できない。一度開いたあとは回線が死んでいても
 * 起動できる状態にするのが目的。npm run build から自動で呼ばれる。
 *
 * キャッシュ名にはファイル一覧のハッシュを入れてあるので、
 * 中身が変われば自動的に新しいキャッシュになり、古いものは消える。
 */
import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')

async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full)))
    else out.push(full)
  }
  return out
}

const files = (await walk(dist))
  .map((f) => '/' + relative(dist, f).split('\\').join('/'))
  .filter((f) => f !== '/sw.js')
  .sort()

// 版が変わったことを検出できるよう、ファイル名とサイズからハッシュを作る
const hash = createHash('sha1')
for (const f of files) {
  hash.update(f)
  hash.update(String((await readFile(resolve(dist, f.slice(1)))).length))
}
const version = hash.digest('hex').slice(0, 12)

const sw = `// 自動生成（scripts/build-service-worker.mjs）。直接編集しないこと。
const CACHE = 'multi-flower-${version}'
const ASSETS = ${JSON.stringify(files, null, 2)}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

// キャッシュ優先。会場では常にオフライン前提で動かす。
// 更新はデプロイのたびにキャッシュ名が変わることで反映される。
//
// ignoreVary は必須。index.html の script/link には crossorigin が付くため
// これらのリクエストだけ Origin ヘッダが付き、配信側が Vary: Origin を返すと
// キャッシュに入っているのに一致しなくなる（結果 index.html が JS として返り起動しない）。
self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return
  event.respondWith(
    caches.match(req, { ignoreSearch: true, ignoreVary: true }).then((hit) => {
      if (hit) return hit
      // 画面遷移だけは index.html を返す。それ以外は握りつぶさず失敗させる
      // （JS を要求されて HTML を返すと、原因の分かりにくい起動失敗になる）
      return fetch(req).catch(() => (req.mode === 'navigate' ? caches.match('/index.html') : Response.error()))
    }),
  )
})
`

await writeFile(resolve(dist, 'sw.js'), sw)
console.log(`sw.js を生成しました（${files.length} ファイル / cache=multi-flower-${version}）`)
