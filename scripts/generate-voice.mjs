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
]

/** phrases.ts + EXTRA_LINES から固定セリフ（{...} を含まない）を集めて重複を除く */
async function collectLines() {
  const phrases = await import('../src/pet/phrases.ts')
  const banks = [
    phrases.CHEER_PHRASES,
    phrases.ANALYSIS_PHRASES,
    phrases.SAFETY_PHRASES,
    phrases.CALIBRATION_PHRASES,
  ]
  const set = new Set()
  for (const bank of banks) {
    for (const arr of Object.values(bank)) {
      for (const line of arr) {
        const text = String(line).trim()
        if (!text || text.includes('{')) continue // 動的文言は対象外
        set.add(text)
      }
    }
  }
  for (const line of EXTRA_LINES) {
    const text = line.trim()
    if (text && !text.includes('{')) set.add(text)
  }
  return [...set]
}

const fileNameFor = (text) => createHash('sha1').update(text).digest('hex').slice(0, 12) + '.mp3'

let cachedToken = null
async function accessToken() {
  if (cachedToken) return cachedToken
  const { stdout } = await execFileP('gcloud', ['auth', 'application-default', 'print-access-token'])
  cachedToken = stdout.trim()
  return cachedToken
}

/** Gemini-TTS を叩いて base64 PCM(16bit LE, 24kHz, mono) を得る */
async function synthesize(text) {
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
    throw new Error(`TTS ${res.status}: ${body.slice(0, 300)}`)
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

async function main() {
  const lines = await collectLines()
  console.log(`対象セリフ: ${lines.length} 件`)

  if (DRY_RUN) {
    for (const t of lines) console.log(`  ・${t}  ->  ${fileNameFor(t)}`)
    console.log('\n--dry-run のため合成はしていません。')
    return
  }
  if (!PROJECT) {
    console.error('環境変数 GOOGLE_TTS_PROJECT（課金先プロジェクトID）を指定してください。')
    process.exit(1)
  }

  await mkdir(outDir, { recursive: true })
  const manifest = {}
  let ok = 0

  for (const text of lines) {
    const file = fileNameFor(text)
    try {
      const pcm = await synthesize(text)
      await pcmToMp3File(pcm, resolve(outDir, file))
      manifest[text] = file
      ok++
      console.log(`✓ (${ok}/${lines.length}) ${text}`)
    } catch (err) {
      console.error(`✗ ${text} — ${err.message}`)
    }
  }

  await writeFile(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log(`\n完了：${ok}/${lines.length} 件を ${outDir.replace(root + '/', '')} に生成しました。`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
