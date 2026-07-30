/**
 * 旧プロジェクト（1 ゲーム 1 プロジェクト時代）の Hosting サイトを、
 * 統合サイト（https://kinetone.web.app）への案内ページに差し替える。
 *
 * 旧 URL をブックマークしている端末が古いビルドを使い続けてしまうのを防ぐのが目的。
 * 消してしまうと何も出なくなるので、案内ページを置いて最新版へ送る。
 *
 * 気をつけている点が 2 つある。
 *  1. **リダイレクトではなく rewrite + HTML** にしている。Hosting の redirects は
 *     すべてのパスに効いてしまい、/sw.js まで他オリジンへ飛ばしてしまう。それだと
 *     Service Worker の更新（下記 2.）ができない。rewrite なら実ファイルが優先される。
 *  2. 旧アプリのうち PWA だったものは **Service Worker がキャッシュから古い画面を出す**ので、
 *     案内ページに辿り着けない。自分を unregister する sw.js を同じ場所に置いて、
 *     次回アクセス時に登録を消させる。
 *
 * 使い方: node scripts/legacy-redirect.mjs [--dry-run]
 */
import { execFileSync } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const HOME = 'https://kinetone.web.app'

/** 旧サイト → 統合サイトのどこへ送るか。 */
const SITES = [
  { project: 'kinetone-multi-flower', site: 'kinetone-multi-flower', to: '/flower/', name: 'みんなの花畑' },
  { project: 'kinetone-hanabi', site: 'kinetone-hanabi', to: '/hanabi/', name: '夏だ！みんなで花火' },
  { project: 'kinetone-stepping', site: 'kinetone-stepping', to: '/stepping/', name: 'おさんぽ足踏み' },
  { project: 'kinetone-stepping', site: 'kinetone-steptest', to: '/steptest/', name: '2分間足踏みテスト' },
  { project: 'kinetone-chairstand', site: 'kinetone-chairstand', to: '/chair-stand/', name: '5回椅子立ち上がりテスト' },
  { project: 'aiube-taisou-demo', site: 'aiube-taisou-demo', to: '/aiube-avatar/', name: 'あいうべ体操（キャラクター）' },
  { project: 'aiube-taisou-demo', site: 'aiube-mesh-demo', to: '/aiube/', name: 'あいうべ体操（自分の顔）' },
]

/** 案内ページ。文字が読めない方でも押せるよう、大きなボタンを 1 つだけ置く。 */
const page = ({ name, url }) => `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name}｜引っ越しました</title>
<meta http-equiv="refresh" content="0; url=${url}">
<link rel="canonical" href="${url}">
<style>
  html,body{margin:0;height:100%;}
  body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1.5em;
       padding:8vw;text-align:center;background:#f7f8fb;color:#182234;
       font-family:"Hiragino Maru Gothic ProN","Hiragino Kaku Gothic ProN","Yu Gothic",YuGothic,Meiryo,sans-serif;}
  h1{margin:0;font-size:clamp(20px,3.6vw,32px);font-weight:800;line-height:1.5;}
  p{margin:0;font-size:clamp(14px,2vw,18px);color:#5a6a80;line-height:1.8;}
  a{display:inline-flex;align-items:center;justify-content:center;min-height:72px;
    padding:0 2em;border-radius:999px;background:#0e8f79;color:#fff;font-weight:800;
    font-size:clamp(17px,2.6vw,22px);text-decoration:none;}
</style>
</head>
<body>
  <h1>「${name}」は<br>新しい場所へ移動しました</h1>
  <p>自動で移動します。移動しない場合は下のボタンを押してください。</p>
  <a href="${url}">新しい場所をひらく</a>
  <p>${url}</p>
</body>
</html>
`

/**
 * 自分自身を消す Service Worker。
 * 旧 PWA のキャッシュを消し、登録を外して、開いている画面を読み直させる。
 */
const KILL_SW = `self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) await caches.delete(key)
      await self.registration.unregister()
      for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url)
    })(),
  )
})
`

const config = (site) => ({
  hosting: {
    site,
    public: 'public',
    ignore: ['firebase.json'],
    // redirects ではなく rewrite にする（実ファイルの /sw.js を優先させるため）
    rewrites: [{ source: '**', destination: '/index.html' }],
    headers: [{ source: '**', headers: [{ key: 'Cache-Control', value: 'no-cache' }] }],
  },
})

const dryRun = process.argv.includes('--dry-run')
const root = resolve(tmpdir(), 'kinetone-legacy-redirect')
await rm(root, { recursive: true, force: true })

for (const entry of SITES) {
  const dir = resolve(root, entry.site)
  const url = `${HOME}${entry.to}`
  await mkdir(resolve(dir, 'public'), { recursive: true })
  await writeFile(resolve(dir, 'public/index.html'), page({ name: entry.name, url }))
  await writeFile(resolve(dir, 'public/sw.js'), KILL_SW)
  await writeFile(resolve(dir, 'firebase.json'), `${JSON.stringify(config(entry.site), null, 2)}\n`)

  console.log(`\n▶ ${entry.site}.web.app → ${url}`)
  if (dryRun) {
    console.log('  (--dry-run: デプロイはしません)')
    continue
  }
  execFileSync(
    'npx',
    [
      'firebase-tools',
      'deploy',
      '--only',
      'hosting',
      '--project',
      entry.project,
      '--config',
      resolve(dir, 'firebase.json'),
    ],
    { stdio: 'inherit' },
  )
}

console.log('\n✓ 旧サイトを案内ページに差し替えました（旧リリースは Hosting の履歴から戻せます）')
