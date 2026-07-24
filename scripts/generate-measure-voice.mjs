/**
 * 測定アプリの案内音声を Google Cloud TTS（Gemini-TTS）で生成する。
 * 落ち着いた案内声（Despina）。ペットではなく事務的で丁寧なトーン。
 *
 *   GOOGLE_TTS_PROJECT=mimamori-clock-stg node --experimental-strip-types scripts/generate-measure-voice.mjs
 *
 * 出力: assets/voice/measure/<name>.mp3
 * 認証: gcloud ADC。
 */
import { execFile } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, 'assets/voice/measure')
const PROJECT = process.env.GOOGLE_TTS_PROJECT || ''

const VOICE_NAME = 'Despina'
const MODEL_NAME = 'gemini-2.5-flash-tts'
const SAMPLE_RATE = 24000
const RATE = 0.92

const STYLE =
  'a calm, clear, polite Japanese guidance voice; reassuring and natural; not childish, not excited.'
const PROMPT =
  'Read the given text in Japanese exactly as written, verbatim. ' +
  'Do NOT add, remove, reorder, paraphrase, or insert any words or sounds. ' +
  'Do NOT add greetings or fillers. Only control speaking style. ' +
  `Speaking style: ${STYLE}`

const TTS_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize'

// name -> text
const LINES = {
  instruction:
    '赤い線よりも上に膝が上がるように、その場で足踏みをしてください。1分間の足踏みの回数を数えます。',
  otsukaresama: 'お疲れさまでした。',
  // キャリブレーション案内
  calib_stand: 'カメラの前に立って、全身が映るようにしてください。',
  calib_hold: '基準値を決めていますので、その場で動かないでください。',
}

let token = null
async function accessToken() {
  if (token) return token
  const { stdout } = await execFileP('gcloud', ['auth', 'application-default', 'print-access-token'])
  token = stdout.trim()
  return token
}

async function synthesize(text) {
  const t = await accessToken()
  const res = await fetch(TTS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${t}`,
      'x-goog-user-project': PROJECT,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: { prompt: PROMPT, text },
      voice: { languageCode: 'ja-JP', name: VOICE_NAME, model_name: MODEL_NAME },
      audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: SAMPLE_RATE, speakingRate: RATE },
    }),
  })
  if (!res.ok) throw new Error(`TTS ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = await res.json()
  if (!json.audioContent) throw new Error('audioContent が空')
  return Buffer.from(json.audioContent, 'base64')
}

async function toMp3(pcm, dest) {
  await new Promise((res, rej) => {
    const ff = execFile(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-y', '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', '1', '-i', 'pipe:0', '-codec:a', 'libmp3lame', '-q:a', '4', dest],
      (err) => (err ? rej(err) : res(undefined)),
    )
    ff.stdin.end(pcm)
  })
}

if (!PROJECT) {
  console.error('環境変数 GOOGLE_TTS_PROJECT を指定してください。')
  process.exit(1)
}
await mkdir(outDir, { recursive: true })
for (const [name, text] of Object.entries(LINES)) {
  const pcm = await synthesize(text)
  await toMp3(pcm, resolve(outDir, `${name}.mp3`))
  console.log(`✓ ${name}.mp3  ${text}`)
}
console.log('完了')
