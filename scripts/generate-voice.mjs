/**
 * 犬のペットボイスを Google Cloud TTS（Gemini-TTS）で事前生成する。
 *
 * みまもり時計と同じ作り方：
 *   voice = Leda / model = gemini-2.5-flash-tts / speakingRate = 0.85 / 24kHz mono
 *   犬・猫・鳥の違いは「話し方を指示する prompt」だけ（pitch も rate も変えない）
 *
 * セリフは src/pet/phrases.ts から集め、固定文（{...} を含まないもの）だけを対象にする。
 * 歩数など動的な文言はここでは作らず、実行時に合成音声へフォールバックさせる。
 *
 * 出力:
 *   assets/voice/dog/<hash>.mp3          … 1 セリフ 1 ファイル
 *   assets/voice/dog/manifest.json       … 正規化テキスト -> ファイル名
 *
 * 認証: gcloud ADC。課金先プロジェクトは環境変数 GOOGLE_TTS_PROJECT で指定。
 *
 *   実行例:
 *     GOOGLE_TTS_PROJECT=mimamori-clock-stg \
 *     node --experimental-strip-types scripts/generate-voice.mjs
 *
 *   ドライラン（合成せず対象セリフだけ表示）:
 *     node --experimental-strip-types scripts/generate-voice.mjs --dry-run
 */
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, 'assets/voice/dog')

const DRY_RUN = process.argv.includes('--dry-run')
const PROJECT = process.env.GOOGLE_TTS_PROJECT || ''
// 動的な数字の生成上限（歩数）。これを超える値は実行時に合成音声へフォールバック。
const MAX_STEPS = Number(process.env.VOICE_MAX_STEPS || 400)
// 同時リクエスト数（速度と API レート制限のバランス）
const CONCURRENCY = Number(process.env.VOICE_CONCURRENCY || 5)

// ---- 犬の音声設定（みまもり時計の buildPrompt / audioConfig を踏襲）----
const VOICE_NAME = 'Leda'
const MODEL_NAME = 'gemini-2.5-flash-tts'
const SPEAKING_RATE = 0.85
const SAMPLE_RATE = 24000

const DOG_PROMPT =
  'Read the given text in Japanese exactly as written, verbatim. ' +
  'Do NOT add, remove, reorder, paraphrase, or insert any words or sounds. ' +
  'Do NOT add greetings, interjections, fillers, or self-introductions. ' +
  'Do NOT change the content. Only control speaking style. ' +
  'Speaking style: friendly dog mascot, energetic but soft, encouraging, warm.'

const TTS_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize'

/**
 * phrases.ts 以外でペットが喋る固定文。
 * - 立ち位置の案内: src/motionAnalysis/features.ts の postureAdvice と同じ文言
 * - キャリブレーション完了時: src/ui/CalibrationScreen.tsx の onSay 文言
 * features.ts は拡張子なし import のため Node から直接読めないので、ここに写している。
 * （文言を変えたら両方直すこと。ズレても実行時は合成音声にフォールバックするだけ）
 */
const EXTRA_LINES = [
  'カメラの前に立ってみましょう',
  '足もとが見えていません。もう少し下がってみましょう',
  '上半身が見えていません。カメラの正面に立ってみましょう',
  'カメラに近すぎます。もう少し下がってください',
  '少しカメラに近づいてください',
  '体が画面からはみ出しています。立ち位置を合わせましょう',
  'もう一度立ち位置を合わせましょう',
  'ばっちりです。はじめましょう',
  // 完走まとめの固定比較文（PetController.finish と同じ文面）
  '前回よりひざがよく上がっています',
  '前回より少し足が低めでした',
]

/**
 * 生成対象のセリフを集める。
 * 返り値は { text, preload } の配列。preload=true は常用の短文（起動時に先読みする）、
 * false は完走まとめの数字違いなど大量になるもの（必要時に遅延読み込み）。
 */
async function collectLines() {
  const phrases = await import('../src/pet/phrases.ts')
  const { fillTemplate } = phrases
  const items = []
  const seen = new Set()
  const add = (text, preload) => {
    const t = String(text).trim()
    if (!t || t.includes('{') || seen.has(t)) return
    seen.add(t)
    items.push({ text: t, preload })
  }

  // 1) 固定セリフ（応援・分析・安全・キャリブレーション）
  for (const bank of [
    phrases.CHEER_PHRASES,
    phrases.ANALYSIS_PHRASES,
    phrases.SAFETY_PHRASES,
    phrases.CALIBRATION_PHRASES,
  ]) {
    for (const arr of Object.values(bank)) for (const line of arr) add(line, true)
  }

  // 2) phrases.ts 以外の固定文（案内など）
  for (const line of EXTRA_LINES) add(line, true)

  // 3) 歩数の節目（25 刻み）… テンプレートは phrases.ts から取る
  for (let s = 25; s <= MAX_STEPS; s += 25) {
    for (const tpl of phrases.CHEER_PHRASES.milestoneSteps) add(fillTemplate(tpl, { steps: s }), true)
  }

  // 4) 残り時間（60 / 30 / 10 秒）
  for (const sec of [60, 30, 10]) {
    for (const tpl of phrases.CHEER_PHRASES.remainingTime) add(fillTemplate(tpl, { seconds: sec }), true)
  }

  // 5) 完走まとめの数字入り文（PetController.finish と同じ文面）。数が多いので遅延読み込み。
  for (let n = 0; n <= MAX_STEPS; n++) add(`${n}歩、歩きました`, false)
  for (let n = 1; n <= MAX_STEPS; n++) add(`前回より${n}歩多く歩けました`, false)

  return items
}

const fileNameFor = (text) => createHash('sha1').update(text).digest('hex').slice(0, 12) + '.mp3'

let cachedToken = null
async function accessToken() {
  if (cachedToken) return cachedToken
  const { stdout } = await execFileP('gcloud', ['auth', 'application-default', 'print-access-token'])
  cachedToken = stdout.trim()
  return cachedToken
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Gemini-TTS を叩いて base64 PCM(16bit LE, 24kHz, mono) を得る。429/5xx はリトライ。 */
async function synthesize(text, attempt = 0) {
  const token = await accessToken()
  const res = await fetch(TTS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'x-goog-user-project': PROJECT,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: { prompt: DOG_PROMPT, text },
      voice: { languageCode: 'ja-JP', name: VOICE_NAME, model_name: MODEL_NAME },
      audioConfig: {
        audioEncoding: 'LINEAR16',
        sampleRateHertz: SAMPLE_RATE,
        speakingRate: SPEAKING_RATE,
      },
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    // レート制限・一時エラーは指数バックオフで最大 5 回まで
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      cachedToken = null // トークン失効の可能性に備え取り直す
      await sleep(800 * 2 ** attempt)
      return synthesize(text, attempt + 1)
    }
    throw new Error(`TTS ${res.status}: ${body.slice(0, 200)}`)
  }
  const json = await res.json()
  if (!json.audioContent) throw new Error('audioContent が空です')
  return Buffer.from(json.audioContent, 'base64')
}

/** 生 PCM を ffmpeg で mp3 に変換して書き出す */
async function pcmToMp3File(pcm, destPath) {
  await new Promise((resolvePromise, reject) => {
    const ff = execFile(
      'ffmpeg',
      [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', '1', '-i', 'pipe:0',
        '-codec:a', 'libmp3lame', '-q:a', '4',
        destPath,
      ],
      (err) => (err ? reject(err) : resolvePromise(undefined)),
    )
    ff.stdin.end(pcm)
  })
}

/** items を CONCURRENCY 並列で処理する簡易ワーカープール */
async function runPool(items, worker) {
  let index = 0
  const runNext = async () => {
    while (index < items.length) {
      const i = index++
      await worker(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, runNext))
}

/** --limit N で先頭 N 件だけ処理（疎通確認用） */
function limitArg() {
  const i = process.argv.indexOf('--limit')
  return i >= 0 ? Number(process.argv[i + 1]) : 0
}

async function main() {
  let items = await collectLines()
  const limit = limitArg()
  if (limit > 0) items = items.slice(0, limit)
  const preloadCount = items.filter((it) => it.preload).length
  console.log(
    `対象セリフ: ${items.length} 件（常用/先読み ${preloadCount} 件 ＋ 完走まとめ数字 ${
      items.length - preloadCount
    } 件、上限 ${MAX_STEPS} 歩）`,
  )

  if (DRY_RUN) {
    for (const it of items.slice(0, 60)) console.log(`  ${it.preload ? '★' : '・'}${it.text}`)
    if (items.length > 60) console.log(`  … 他 ${items.length - 60} 件`)
    console.log('\n--dry-run のため合成はしていません。')
    return
  }
  if (!PROJECT) {
    console.error('環境変数 GOOGLE_TTS_PROJECT（課金先プロジェクトID）を指定してください。')
    process.exit(1)
  }

  await mkdir(outDir, { recursive: true })
  const manifest = {}
  const preload = []
  let ok = 0
  let done = 0

  await runPool(items, async (item) => {
    const file = fileNameFor(item.text)
    try {
      const pcm = await synthesize(item.text)
      await pcmToMp3File(pcm, resolve(outDir, file))
      manifest[item.text] = file
      if (item.preload) preload.push(file)
      ok++
    } catch (err) {
      console.error(`✗ ${item.text} — ${err.message}`)
    }
    done++
    if (done % 25 === 0 || done === items.length) {
      console.log(`  進捗 ${done}/${items.length}（成功 ${ok}）`)
    }
  })

  await writeFile(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  await writeFile(resolve(outDir, 'preload.json'), JSON.stringify(preload) + '\n')
  console.log(
    `\n完了：${ok}/${items.length} 件を ${outDir.replace(root + '/', '')} に生成しました。` +
      `（先読み対象 ${preload.length} 件）`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
