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
import { existsSync } from 'node:fs'
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// 出力先は環境変数で差し替え可能（聞き比べ用に別フォルダへ出す）
const outDir = process.env.VOICE_OUT_DIR
  ? resolve(process.env.VOICE_OUT_DIR)
  : resolve(root, 'assets/voice/dog')

const DRY_RUN = process.argv.includes('--dry-run')
const PROJECT = process.env.GOOGLE_TTS_PROJECT || ''
// 動的な数字の生成上限（歩数）。これを超える値は実行時に合成音声へフォールバック。
const MAX_STEPS = Number(process.env.VOICE_MAX_STEPS || 400)
// 同時リクエスト数（速度と API レート制限のバランス）。TTS は分あたりのクォータがあるので控えめ。
const CONCURRENCY = Number(process.env.VOICE_CONCURRENCY || 3)

// ---- 犬の音声設定（みまもり時計の buildPrompt / audioConfig を踏襲）----
// voice/model は共通。犬らしさ・落ち着き具合は「話し方の指示（style）」と speakingRate で調整する。
// 採用ボイス（サンプル聞き比べで Despina / rate 0.85 / 落ち着きstyle に決定）
const VOICE_NAME = process.env.VOICE_NAME || 'Despina'
const MODEL_NAME = 'gemini-2.5-flash-tts'
const SPEAKING_RATE = Number(process.env.VOICE_RATE || 0.85)
// 「イチ、ニ」など掛け声はテンポよく（速め）にする。セリフ別の速度上書き用。
// 聞き比べで 1.15 を採用。
const COUNTIN_RATE = Number(process.env.VOICE_COUNTIN_RATE || 1.15)
// 掛け声は TTS の間の取り方がばらつくので、複数回作って一番短い（テンポの良い）ものを採用する。
const BRISK_TRIES = Number(process.env.VOICE_BRISK_TRIES || 4)
const SAMPLE_RATE = 24000

// 話し方の指示。落ち着いたトーンを既定にする（元は "energetic but soft"）。
const DOG_STYLE =
  process.env.VOICE_STYLE ||
  'a calm, gentle dog mascot; warm and reassuring; soft and unhurried; quietly encouraging, not excited.'

const DOG_PROMPT =
  'Read the given text in Japanese exactly as written, verbatim. ' +
  'Do NOT add, remove, reorder, paraphrase, or insert any words or sounds. ' +
  'Do NOT add greetings, interjections, fillers, or self-introductions. ' +
  'Do NOT change the content. Only control speaking style. ' +
  `Speaking style: ${DOG_STYLE}`

const TTS_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize'

/**
 * phrases.ts 以外でペットが喋る固定文。
 * - 立ち位置の案内: src/motionAnalysis/features.ts の postureAdvice と同じ文言
 * - キャリブレーション完了時: src/ui/CalibrationScreen.tsx の onSay 文言
 * features.ts は拡張子なし import のため Node から直接読めないので、ここに写している。
 * （文言を変えたら両方直すこと。ズレても実行時は合成音声にフォールバックするだけ）
 */
// phrases.ts 以外の固定文。name はファイル名（意味が分かる名前）。
const EXTRA_LINES = [
  { text: 'カメラの前に立ってみましょう', name: 'guide-noperson' },
  { text: '足もとが見えていません。もう少し下がってみましょう', name: 'guide-lowerbody' },
  { text: '上半身が見えていません。カメラの正面に立ってみましょう', name: 'guide-upperbody' },
  { text: 'カメラに近すぎます。もう少し下がってください', name: 'guide-tooclose' },
  { text: '少しカメラに近づいてください', name: 'guide-toofar' },
  { text: '体が画面からはみ出しています。立ち位置を合わせましょう', name: 'guide-outofframe' },
  { text: 'もう一度立ち位置を合わせましょう', name: 'guide-retry' },
  { text: 'ばっちりです。はじめましょう', name: 'guide-ready' },
  // 完走まとめの固定比較文（PetController.finish と同じ文面）
  { text: '前回よりひざがよく上がっています', name: 'finish-raise-up' },
  { text: '前回より少し足が低めでした', name: 'finish-raise-down' },
]

// 応援/分析/安全/キャリブレーションの各バンクに、ファイル名の接頭辞を割り当てる
const BANK_PREFIX = [
  ['cheer', 'CHEER_PHRASES'],
  ['analysis', 'ANALYSIS_PHRASES'],
  ['safety', 'SAFETY_PHRASES'],
  ['calib', 'CALIBRATION_PHRASES'],
]

/**
 * 生成対象のセリフを集める。
 * 返り値は { text, preload, name } の配列。
 *   name … 意味が分かるファイル名（拡張子なし）。例: cheer-keepGoing-1 / milestone-25-1 / finish-total-130
 *   preload=true は常用の短文（起動時に先読み）、false は完走まとめの数字違い（遅延読み込み）。
 */
async function collectLines() {
  const phrases = await import('../src/pet/phrases.ts')
  const { fillTemplate } = phrases
  const items = []
  const seen = new Set()
  const usedNames = new Set()
  const add = (text, preload, name) => {
    const t = String(text).trim()
    if (!t || t.includes('{') || seen.has(t)) return
    if (usedNames.has(name)) throw new Error(`ファイル名が重複: ${name}`)
    seen.add(t)
    usedNames.add(name)
    items.push({ text: t, preload, name })
  }

  // 1) 固定セリフ（応援・分析・安全・キャリブレーション）: <バンク>-<キー>-<番号>
  for (const [prefix, bankName] of BANK_PREFIX) {
    for (const [key, arr] of Object.entries(phrases[bankName])) {
      arr.forEach((line, i) => add(line, true, `${prefix}-${key}-${i + 1}`))
    }
  }

  // 2) phrases.ts 以外の固定文（案内など）
  for (const { text, name } of EXTRA_LINES) add(text, true, name)

  // 3) 歩数の節目（25 刻み）: milestone-<歩数>-<番号>
  for (let s = 25; s <= MAX_STEPS; s += 25) {
    phrases.CHEER_PHRASES.milestoneSteps.forEach((tpl, i) =>
      add(fillTemplate(tpl, { steps: s }), true, `milestone-${s}-${i + 1}`),
    )
  }

  // 4) 残り時間（60 / 30 / 10 秒）: remaining-<秒>s-<番号>
  for (const sec of [60, 30, 10]) {
    phrases.CHEER_PHRASES.remainingTime.forEach((tpl, i) =>
      add(fillTemplate(tpl, { seconds: sec }), true, `remaining-${sec}s-${i + 1}`),
    )
  }

  // 5) 完走まとめの数字入り文: finish-total-<歩数> / finish-diff-<差>
  for (let n = 0; n <= MAX_STEPS; n++) add(`${n}歩、歩きました`, false, `finish-total-${n}`)
  for (let n = 1; n <= MAX_STEPS; n++) add(`前回より${n}歩多く歩けました`, false, `finish-diff-${n}`)

  // セリフ別の速度上書き：「イチ、ニ」の掛け声はテンポよく速め、かつ最短採用でばらつきを抑える
  for (const it of items) {
    if (it.name.startsWith('cheer-countIn')) {
      it.rate = COUNTIN_RATE
      it.brisk = true
    }
  }

  return items
}

/**
 * item の音声(PCM)を得る。brisk 指定なら複数回合成して一番短い（＝間が詰まってテンポの良い）ものを選ぶ。
 * PCM は 24kHz/16bit/mono なので、バイト長がそのまま長さに比例する。
 */
async function synthesizeItem(item) {
  const rate = item.rate ?? SPEAKING_RATE
  if (!item.brisk) return synthesize(item.text, rate)
  let best = null
  for (let i = 0; i < BRISK_TRIES; i++) {
    const pcm = await synthesize(item.text, rate)
    if (!best || pcm.length < best.length) best = pcm
  }
  return best
}

/** 旧命名（sha1 ハッシュ）。既存ファイルを新しい名前に移行するために残す。 */
const legacyHashName = (text) => createHash('sha1').update(text).digest('hex').slice(0, 12) + '.mp3'

let cachedToken = null
async function accessToken() {
  if (cachedToken) return cachedToken
  const { stdout } = await execFileP('gcloud', ['auth', 'application-default', 'print-access-token'])
  cachedToken = stdout.trim()
  return cachedToken
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Gemini-TTS を叩いて base64 PCM(16bit LE, 24kHz, mono) を得る。429/5xx はリトライ。 */
async function synthesize(text, rate = SPEAKING_RATE, attempt = 0) {
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
        speakingRate: rate,
      },
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    // レート制限(429=分あたりクォータ)・一時エラーはバックオフでリトライ。
    // クォータは毎分リセットされるので、待ち時間の上限は 60 秒まで伸ばして待ち切る。
    if ((res.status === 429 || res.status >= 500) && attempt < 8) {
      if (res.status !== 429) cachedToken = null // トークン失効に備える（429 はトークンの問題ではない）
      await sleep(Math.min(60000, 1500 * 2 ** attempt))
      return synthesize(text, rate, attempt + 1)
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

/** --only <substr> で名前が一致するセリフだけを「強制的に」作り直す（manifest は触らない） */
function onlyArg() {
  const i = process.argv.indexOf('--only')
  return i >= 0 ? String(process.argv[i + 1]) : ''
}

async function main() {
  let items = await collectLines()
  const limit = limitArg()
  if (limit > 0) items = items.slice(0, limit)

  // --only モード：一部だけ作り直す。既存を上書きし、manifest/掃除はしない（他のクリップを消さない）。
  const only = onlyArg()
  if (only) {
    items = items.filter((it) => it.name.includes(only) || it.text.includes(only))
    console.log(`--only "${only}": ${items.length} 件だけ作り直します（manifest は変更しません）`)
    if (!PROJECT) {
      console.error('環境変数 GOOGLE_TTS_PROJECT を指定してください。')
      process.exit(1)
    }
    await mkdir(outDir, { recursive: true })
    let n = 0
    await runPool(items, async (item) => {
      const dest = resolve(outDir, `${item.name}.mp3`)
      try {
        const pcm = await synthesizeItem(item)
        await pcmToMp3File(pcm, dest)
        n++
        console.log(`✓ ${item.name}.mp3  (rate ${item.rate ?? SPEAKING_RATE})  ${item.text}`)
      } catch (err) {
        console.error(`✗ ${item.name} — ${err.message}`)
      }
    })
    console.log(`\n完了：${n}/${items.length} 件を作り直しました。`)
    return
  }
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

  // 旧命名（sha1 ハッシュ）のファイルが残っていれば、新しい名前へリネームして移行する。
  // これにより再課金せずファイル名だけ付け替えられる。
  let migrated = 0
  for (const item of items) {
    const newDest = resolve(outDir, `${item.name}.mp3`)
    const oldDest = resolve(outDir, legacyHashName(item.text))
    if (!existsSync(newDest) && existsSync(oldDest)) {
      await rename(oldDest, newDest)
      migrated++
    }
  }
  if (migrated > 0) console.log(`旧ハッシュ名から ${migrated} 件をリネーム移行しました。`)

  const manifest = {}
  const preload = []
  let ok = 0
  let done = 0
  let skipped = 0

  await runPool(items, async (item) => {
    const file = `${item.name}.mp3`
    const dest = resolve(outDir, file)
    // 再開：既に生成済みのファイルは API を叩かず再利用する
    if (existsSync(dest)) {
      manifest[item.text] = file
      if (item.preload) preload.push(file)
      ok++
      skipped++
    } else {
      try {
        const pcm = await synthesizeItem(item)
        await pcmToMp3File(pcm, dest)
        manifest[item.text] = file
        if (item.preload) preload.push(file)
        ok++
      } catch (err) {
        console.error(`✗ ${item.text} — ${err.message}`)
      }
    }
    done++
    if (done % 50 === 0 || done === items.length) {
      console.log(`  進捗 ${done}/${items.length}（成功 ${ok} / 既存再利用 ${skipped}）`)
    }
  })

  // マニフェストに載っていない mp3（旧ハッシュ名の残骸など）を掃除する
  const valid = new Set(Object.values(manifest))
  let removed = 0
  for (const f of await readdir(outDir)) {
    if (f.endsWith('.mp3') && !valid.has(f)) {
      await rm(resolve(outDir, f))
      removed++
    }
  }
  if (removed > 0) console.log(`未使用の mp3 を ${removed} 件削除しました。`)

  await writeFile(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  await writeFile(resolve(outDir, 'preload.json'), JSON.stringify(preload) + '\n')
  console.log(
    `\n完了：${ok}/${items.length} 件を ${outDir.replace(root + '/', '')} に用意しました。` +
      `（先読み対象 ${preload.length} 件）`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
