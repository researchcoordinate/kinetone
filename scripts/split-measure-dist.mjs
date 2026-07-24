/**
 * ビルド後の後処理：測定アプリ用の配信ディレクトリ dist-measure/ を作る。
 *
 * Vite マルチページは dist/ に index.html（おさんぽ）と measure.html（測定）を出力する。
 * だが Firebase Hosting は「/」に対して index.html を優先して返すため、
 * dist をそのまま2サイトで共有すると、測定サイトでも index.html（おさんぽ）が表示されてしまう。
 *
 * そこで測定サイト専用に dist-measure/ を作り、measure.html を index.html として置く。
 * これで測定サイトの「/」が測定アプリになる。アセットは共有（同一内容）。
 */
import { cp, rename, rm, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const distMeasure = resolve(root, 'dist-measure')

const exists = async (p) => {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

if (!(await exists(resolve(dist, 'measure.html')))) {
  console.error('! dist/measure.html が見つかりません。先に vite build を実行してください。')
  process.exit(1)
}

await rm(distMeasure, { recursive: true, force: true })
await cp(dist, distMeasure, { recursive: true })
// 測定アプリを「/」で出すため、measure.html を index.html に（おさんぽの index.html を置き換え）
await rename(resolve(distMeasure, 'measure.html'), resolve(distMeasure, 'index.html'))
// おさんぽ配信(dist)には測定の HTML は不要なので削除しておく
await rm(resolve(dist, 'measure.html'), { force: true })

console.log('✓ dist-measure/ を作成（index.html = 測定アプリ）')
