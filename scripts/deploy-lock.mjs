/**
 * デプロイの重なりを防ぐ鍵。
 *
 * ── なぜ要るか ────────────────────────────────────────────────
 *
 * `build-site.mjs` は **site/ を消してから作り直す**。これが `firebase.json` の
 * predeploy に入っているので、2 つのデプロイが重なると次のことが起きる。
 *
 *   A: predeploy（site/ を作る）→ 送信中 ………………………
 *   B:                    predeploy（site/ を消す）→ 作り直し
 *   A: 送信が終わる → **空の site/ が本番として公開される**
 *
 * 実際に起きた。2026-08-07、kinetone.web.app が全ページ 404 になった。
 * 気づけたのは postdeploy の `verify-deploy.mjs` が全件 404 を報せたためで、
 * 無ければそのまま気づかないところだった。
 *
 * ── どう防ぐか ────────────────────────────────────────────────
 *
 * **鍵はビルドの間だけでなく、送信が終わるまで持ち続ける。**
 * ビルドの間だけにすると、A が送信している最中に B のビルドが始まってしまう。
 *
 *   predeploy （build-site.mjs）  … 取る
 *   postdeploy（verify-deploy.mjs）… 返す
 *
 * デプロイの外で `node scripts/build-site.mjs` を直接走らせたときは、postdeploy が
 * 無いので終わりに自分で返す。どちらで動いているかは Firebase CLI が hook に渡す
 * `RESOURCE_DIR` の有無で分かる。
 *
 * 途中で落ちて返し損ねても、`TTL_MS` を過ぎた鍵は古いものとして取り直せる。
 * 手で消したいときは次のとおり。
 *
 *   rm .deploy.lock
 */
import { readFileSync, unlinkSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const lockFile = resolve(root, '.deploy.lock')

/** これを過ぎた鍵は、返し損ねたものとして取り直す。 */
const TTL_MS = 15 * 60 * 1000
/** 空くのを待つ上限。これを過ぎたら諦めて、人に判断してもらう。 */
const WAIT_MS = 5 * 60 * 1000
const POLL_MS = 5000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function readLock() {
  try {
    return JSON.parse(await readFile(lockFile, 'utf8'))
  } catch {
    return null // 無い（＝空いている）か、壊れている
  }
}

/** 鍵の持ち主が生きているか。同じ端末なら、プロセスの有無で分かる。 */
function alive(lock) {
  if (lock.host !== hostname()) return true // 別の端末のことは分からないので、生きている前提
  try {
    process.kill(lock.pid, 0)
    return true
  } catch {
    return false
  }
}

function age(lock) {
  return Date.now() - (lock.startedAt ?? 0)
}

/**
 * 鍵を取る。誰かが持っていれば空くまで待つ。
 *
 * @param {string} label 何のための鍵か（待たされた側に見せる）
 * @returns {Promise<{ keepForDeploy: boolean }>} デプロイの hook として動いているか
 */
export async function acquire(label) {
  // Firebase CLI が hook に渡す。デプロイの中で動いているかの目印にする
  const keepForDeploy = Boolean(process.env.RESOURCE_DIR)
  const until = Date.now() + WAIT_MS
  let told = false

  for (;;) {
    const lock = await readLock()
    if (!lock || !alive(lock) || age(lock) > TTL_MS) {
      if (lock) {
        const why = !alive(lock) ? 'そのプロセスは終わっています' : '時間が経ちすぎています'
        console.log(`  ・前のデプロイの鍵が残っていました（${why}）。取り直します`)
      }
      await writeFile(
        lockFile,
        JSON.stringify({ pid: process.pid, host: hostname(), label, startedAt: Date.now() }, null, 2),
      )
      armExitRelease(keepForDeploy)
      return { keepForDeploy }
    }

    if (!told) {
      told = true
      const min = Math.round(age(lock) / 60000)
      console.log(
        `\n▶ ほかのデプロイが動いています（${lock.host} の ${lock.pid}、${min} 分前から）。` +
          '\n  site/ を作り直すと、あちらが空のまま公開してしまうので待ちます。',
      )
    }
    if (Date.now() > until) {
      console.error(
        '\n待っても空きませんでした。' +
          '\n  もう一方のデプロイが終わってから、もう一度実行してください。' +
          '\n  そちらが落ちて鍵だけ残っているときは、次で消せます:\n' +
          '\n    rm .deploy.lock\n',
      )
      process.exit(1)
    }
    await sleep(POLL_MS)
  }
}

/**
 * 終わるときに鍵を返すよう仕掛ける。
 *
 * **どの終わり方でも返るようにしておく。**途中で落ちたときに鍵が残ると、
 * TTL が切れるまで誰もデプロイできない。
 *
 * 返さないのは「うまくいって、かつデプロイの中で動いている」ときだけ。
 * そのときは送信がこのあと続くので、postdeploy が返すまで持ち続ける。
 */
function armExitRelease(keepForDeploy) {
  process.on('exit', (code) => {
    if (code === 0 && keepForDeploy) return
    try {
      const lock = JSON.parse(readFileSyncSafe(lockFile) ?? 'null')
      if (lock && lock.pid === process.pid && lock.host === hostname()) unlinkSync(lockFile)
    } catch {
      // 返せなくても、TTL を過ぎれば取り直せる
    }
  })
}

function readFileSyncSafe(p) {
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return null
  }
}

/** 鍵を返す。持っていなくても黙って何もしない。 */
export async function release() {
  const lock = await readLock()
  if (!lock) return
  // 自分のものだけ返す（TTL 切れで誰かに取り直されたあとに消さないように）
  if (lock.pid !== process.pid || lock.host !== hostname()) return
  await rm(lockFile, { force: true })
}

/** 誰のものでも返す。postdeploy から使う（predeploy とは別のプロセスになるため）。 */
export async function releaseAny() {
  await rm(lockFile, { force: true })
}
