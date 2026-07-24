/**
 * TF.js WASM バックエンドのバイナリを public/tfjs-wasm/ にコピーする。
 *
 * 会場のネットワークは信頼できないため、CDN（jsdelivr 等）は一切参照せず
 * 自ドメインから配信する。コピー結果はリポジトリにコミットして、
 * npm install なしでも配信できる状態にしておく。
 *
 *   npm run setup:wasm
 *
 * tfjs-backend-wasm を更新したら再実行すること。
 */
import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = resolve(root, 'node_modules/@tensorflow/tfjs-backend-wasm/dist')
const outDir = resolve(root, 'public/tfjs-wasm')

// .wasm 本体と、スレッド版が読み込むワーカー JS
const wanted = (f) => f.endsWith('.wasm') || f.endsWith('.worker.js')

await mkdir(outDir, { recursive: true })
const files = (await readdir(srcDir)).filter(wanted)
if (files.length === 0) throw new Error(`コピー元が見つかりません: ${srcDir}`)
for (const f of files) {
  await copyFile(resolve(srcDir, f), resolve(outDir, f))
  console.log(`  ${f}`)
}
console.log(`${files.length} 件を public/tfjs-wasm/ にコピーしました。`)
