/**
 * MediaPipe のランタイム（WASM）とポーズ推定モデルを public/mediapipe/ に配置する。
 *
 * 展示会（CareTEX など）の会場では回線が不安定なことが多いため、
 * CDN 依存を避けてローカル配信できるようにしておく。
 * WASM は node_modules からコピー、モデルは Google の配布 URL から一度だけ取得する。
 *
 *   npm run setup:mediapipe
 *
 * 取得に失敗しても致命的ではない（アプリは CDN へ自動フォールバックする）。
 */
import { cp, mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const wasmSrc = resolve(root, 'node_modules/@mediapipe/tasks-vision/wasm')
const wasmDest = resolve(root, 'public/mediapipe/wasm')

const MODELS = [
  {
    name: 'pose_landmarker_lite.task',
    url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  },
  {
    name: 'pose_landmarker_full.task',
    url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
  },
]

const exists = async (p) => {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

async function copyWasm() {
  if (!(await exists(wasmSrc))) {
    console.warn('! node_modules に WASM が見つかりません。先に npm install を実行してください。')
    return
  }
  await mkdir(wasmDest, { recursive: true })
  await cp(wasmSrc, wasmDest, { recursive: true })
  console.log(`✓ WASM をコピーしました -> ${wasmDest.replace(root + '/', '')}`)
}

async function fetchModel({ name, url }) {
  const dest = resolve(root, 'public/mediapipe', name)
  if (await exists(dest)) {
    console.log(`- ${name} は取得済みのためスキップ`)
    return
  }
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    await writeFile(dest, Buffer.from(await res.arrayBuffer()))
    console.log(`✓ ${name} を取得しました`)
  } catch (err) {
    console.warn(`! ${name} の取得に失敗しました (${err.message})。実行時は CDN にフォールバックします。`)
  }
}

await mkdir(resolve(root, 'public/mediapipe'), { recursive: true })
await copyWasm()
for (const model of MODELS) await fetchModel(model)
