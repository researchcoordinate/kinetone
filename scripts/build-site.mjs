/**
 * 統合サイト（https://kinetone.web.app）用の配信ディレクトリ site/ を作る。
 *
 * 各アプリは別々の Vite プロジェクト／静的サイトだが、利用者の名簿を共有するには
 * 同じ origin に載っている必要がある（localStorage はサイトごとに分かれるため）。
 * そこで、それぞれをサブパス向けにビルドして site/ の下に並べる。
 *
 *   site/                 ホーム（アプリ選択）
 *   site/flower/          みんなの花畑
 *   site/stepping/        おさんぽ足踏み（measure.html が 2 分間足踏みテスト）
 *   site/chair-stand/     5 回椅子立ち上がりテスト
 *   site/hanabi/          みんなで花火
 *   site/aiube/           あいうべ体操（フェイスメッシュ版）
 *   site/aiube-avatar/    あいうべ体操（アバター版）
 *
 * Vite プロジェクトには KINETONE_BASE でサブパスを渡す（vite.config.ts が読む）。
 * 静的サイトは相対パスで書かれているので、そのままコピーするだけで動く。
 */
import { execFileSync } from 'node:child_process'
import { cp, mkdir, rm, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const site = resolve(root, 'site')

/** Vite プロジェクト（ビルドしてから dist を置く） */
const VITE_APPS = [
  { dir: 'multi-flower', out: 'flower', path: '/flower/', post: ['scripts/build-service-worker.mjs'] },
  { dir: 'stepping', path: '/stepping/', setup: 'setup:mediapipe', needs: 'public/mediapipe' },
  {
    dir: 'chair-stand-test',
    out: 'chair-stand',
    path: '/chair-stand/',
    setup: 'setup:mediapipe',
    needs: 'public/mediapipe',
  },
]

/** ビルド不要の静的サイト（そのままコピー） */
const STATIC_APPS = [
  { dir: 'hanabi', out: 'hanabi' },
  { dir: 'aiube-exercise/public', out: 'aiube' },
  { dir: 'aiube-exercise-avatar/public', out: 'aiube-avatar' },
]

/** hanabi は開発用ファイルが同じ階層にあるので、配信するものだけ選ぶ */
const HANABI_FILES = ['hanabi_game.html', 'assets']

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

await rm(site, { recursive: true, force: true })
await mkdir(site, { recursive: true })

for (const app of VITE_APPS) {
  const cwd = resolve(root, app.dir)
  console.log(`\n▶ ${app.dir} を ${app.path} 向けにビルド`)
  // 追跡していないモデル・WASM は、無ければ取得スクリプトで用意する
  if (app.setup && !(await exists(resolve(cwd, app.needs)))) {
    run('npm', ['run', app.setup], cwd)
  }
  run('npx', ['tsc', '-b'], cwd)
  run('npx', ['vite', 'build'], cwd, { KINETONE_BASE: app.path })
  // ビルド後の生成物（Service Worker など）はアプリ側のスクリプトに任せる
  for (const script of app.post ?? []) {
    run('node', [script], cwd, { KINETONE_BASE: app.path })
  }
  await cp(resolve(cwd, 'dist'), resolve(site, app.out ?? app.dir), { recursive: true })
}

for (const app of STATIC_APPS) {
  const from = resolve(root, app.dir)
  const to = resolve(site, app.out)
  console.log(`\n▶ ${app.dir} をコピー`)
  if (app.out === 'hanabi') {
    await mkdir(to, { recursive: true })
    for (const f of HANABI_FILES) {
      await cp(resolve(from, f), resolve(to, f), { recursive: true })
    }
  } else {
    await cp(from, to, { recursive: true })
  }
}

console.log('\n▶ ホーム画面をコピー')
await cp(resolve(root, 'home'), site, { recursive: true })

console.log('\n✓ site/ を作成しました（npx firebase-tools deploy --only hosting で配信）')
