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

async function copyDir(srcDir, outDir, wanted, label) {
  await mkdir(outDir, { recursive: true })
  const files = (await readdir(srcDir)).filter(wanted)
  if (files.length === 0) throw new Error(`コピー元が見つかりません: ${srcDir}`)
  for (const f of files) {
    await copyFile(resolve(srcDir, f), resolve(outDir, f))
    console.log(`  ${f}`)
  }
  console.log(`${files.length} 件を ${label} にコピーしました。`)
}

// TF.js WASM バックエンド（.wasm 本体と、スレッド版が読み込むワーカー JS）
await copyDir(
  resolve(root, 'node_modules/@tensorflow/tfjs-backend-wasm/dist'),
  resolve(root, 'public/tfjs-wasm'),
  (f) => f.endsWith('.wasm') || f.endsWith('.worker.js'),
  'public/tfjs-wasm/',
)

// MediaPipe Tasks Vision のランタイム（wasm ローダ JS と wasm 本体）
// モデル（.task）は容量が大きいので別途 curl で取得し public/models/pose-landmarker/ に置く。
await copyDir(
  resolve(root, 'node_modules/@mediapipe/tasks-vision/wasm'),
  resolve(root, 'public/mediapipe/wasm'),
  (f) => f.endsWith('.wasm') || f.endsWith('.js'),
  'public/mediapipe/wasm/',
)
