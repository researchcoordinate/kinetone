# multi flower

介護施設向け運動アプリの **アトラクト画面**。

展示会ブースで、通路に向けた広角 Web カメラの映像を大画面テレビに映し、通行人の骨格を
重ねて足を止めさせる。立ち止まってその場で動くと、足元に花が育って咲く。

将来は施設の共用部での集団レクリエーション機能に育てる。

---

## 現在の状態

**段階1（性能ゲート）まで完了。** カメラ映像 → 多人数姿勢推定 → 骨格描画 → fps 表示。
演出・トラッキング・ペットはまだ入っていない。

実装の順序（仕様どおり）:

1. ✅ 性能ゲート
2. ⬜ 動き量の算出（横移動と「その場での動き」の分離）＋デバッグ表示
3. ⬜ トラッキング
4. ⬜ 演出（種・花・個人ゲージ・満開）
5. ⬜ ペット（口パク・セリフ分岐・吹き出し）
6. ⬜ 累計表示

---

## 動かす

```sh
npm install
npm run dev          # http://localhost:5173/
```

本番ビルドと確認:

```sh
npm run build        # dist/ を作り、Service Worker も生成する
npm run preview      # http://localhost:4173/
```

Firebase Hosting へのデプロイ:

```sh
npm run deploy       # 内部で npm run build が走る
```

### URL クエリでの一時的な上書き

計測やデモのたびにコードを触らずに済ませるためのもの。恒久的な設定は `src/config.ts`。

| クエリ | 意味 | 例 |
| --- | --- | --- |
| `src` | 映像ソース | `?src=video`（開発用動画） / `?src=camera` |
| `dim` | 推論入力の最長辺（32 の倍数に丸める） | `?dim=192` |
| `backend` | TF.js バックエンド | `?backend=webgl` / `wasm` / `webgpu` |
| `mirror` | 鏡像表示 | `?mirror=0` |
| `crop` | 中央クロップ（x,y,w,h の正規化値） | `?crop=0.2,0,0.6,1` |

### キー操作

| キー | 動作 |
| --- | --- |
| `D` | デバッグオーバーレイの表示切替 |
| `C` | 計測ログをクリップボードにコピー |
| `R` | 計測のリセット |

---

## 性能ゲートの結果

計測機: Intel Core i9-9880H / Intel UHD 630（内蔵GPU）/ macOS 15.7 / Chrome 150
モデル: MoveNet MultiPose Lightning（TensorFlow.js graph model）

### 推論1回あたりの所要時間

| 入力解像度 | WebGPU | WebGL | WASM |
| --- | --- | --- | --- |
| 192px | 10.2 ms | 57.7 ms | 39.9 ms |
| 256px | 10.1 ms | 61.9 ms | 77.0 ms |
| 320px | 10.1 ms | 70.6 ms | 112.4 ms |
| 448px | 16.7 ms | — | — |
| 512px | 16.7 ms | — | — |

**WebGPU が WebGL の約6倍速い。** 同じ内蔵GPUでこの差が出るのは、このモデルが
グラフ内に NMS を含み、WebGL では推論の途中で GPU→CPU の同期読み戻しが
何度も発生するため。WebGL の所要時間が解像度にほとんど比例しない（128px でも 51.8ms）
のがその証拠で、解像度を下げても速くならない。

WebGPU では 320〜640px で所要時間がほぼ変わらないので、**遠くの人を拾えるよう
入力を大きめ（既定 448px）に取っている。**

### 連続稼働（11分）

テスト動画（24fps）を入力に、既定設定（WebGPU / 448px）で連続稼働:

| 経過 | 描画fps | 推論fps | 推論時間 |
| --- | --- | --- | --- |
| 0.5分 | 61 | 24 | 24.3 ms |
| 2分 | 60 | 23 | 22.8 ms |
| 4分 | 60 | 24 | 20.1 ms |
| 5分 | 60 | 22 | 27.3 ms |
| 6分 | 60 | 17 | 46.8 ms |
| 6.5分 | 59 | 24 | 24.5 ms |
| 9分 | 60 | 23 | 23.5 ms |
| 11分 | 60 | 24 | 23.7 ms |

推論fps が 24 で頭打ちなのは入力動画が 24fps だからで、性能の上限ではない。
6分あたりに一度 47ms まで落ちて自力で戻る谷があった（他プロセスの負荷か電力制御と思われる）。
**11分を通して継続的な性能低下は出ていない。**

### 人数と fps の関係

MoveNet MultiPose は常に6人分の出力枠を持つ全畳み込みモデルなので、
**推論コストは写っている人数ではなく入力解像度だけで決まる。**
実測でも 0人 61.5ms に対し 1人 64.0ms（WebGL / 256px）とほぼ同じだった。

「1人・3人・6人でそれぞれ測る」という要件に対しては、**どれもほぼ同じ値になる**
というのが答えになる。ただし実カメラ・実人数での最終確認は別途必要。

### 描画と推論の分離

推論はカメラが新しいフレームを出したときだけ走らせ（`requestVideoFrameCallback`）、
描画はディスプレイのリフレッシュで回している。このため **推論が 24fps でも映像は 60fps で
なめらかに出る。** `video.currentTime` は毎フレーム連続的に進むので新フレーム判定には
使えない（使うと同じ絵を何度も推論して GPU と発熱を無駄にする）。

---

## オフライン動作

会場のネットワークは信頼できないので、**CDN や外部ストレージは一切参照しない。**
モデル・TF.js・WASM バイナリ・画像はすべてリポジトリに含め、自ドメインから配信する。

- モデル: `public/models/movenet-multipose-lightning/`（9.7MB）
- WASM: `public/tfjs-wasm/`（`npm run setup:wasm` で node_modules からコピー）
- Service Worker: `npm run build` 時に `scripts/build-service-worker.mjs` が
  `dist/` の全ファイルを先読みキャッシュする `sw.js` を生成する

### オフライン起動テストの手順

```sh
npm run build
npm run preview                  # 一度開いて Service Worker を入れる
# ここでサーバを止める（Ctrl-C）か、Wi-Fi を切る
# ブラウザを再読み込み → 起動すれば合格
```

DevTools の Application → Service Workers で登録状態を、
Network で全リクエストが `(ServiceWorker)` から来ていることを確認できる。

**確認済み**: 配信サーバを完全に停止した状態で再読み込みし、モデル読み込みまで
含めて起動することを確認した（2026-07-24）。

> 注意: Service Worker のキャッシュ照合は `ignoreVary: true` が必須。
> `index.html` の `<script>` / `<link>` には `crossorigin` が付くため
> これらのリクエストにだけ `Origin` ヘッダが付き、配信側が `Vary: Origin` を返すと
> キャッシュにあるのに一致せず、JS の代わりに `index.html` が返って起動しなくなる。

---

## 構成

```
src/
  config.ts              チューニング値の集約（ここだけ見れば調整できる状態を保つ）
  main.ts                起動と描画ループ
  offline.ts             Service Worker の登録
  poseEngine/
    types.ts             姿勢推定の抽象化（PoseProvider / DetectedPerson）
    MoveNetProvider.ts   MoveNet MultiPose Lightning の実装
    backend.ts           TF.js バックエンドの初期化とフォールバック
  render/
    Stage.ts             表示キャンバスと座標変換（ソース/クロップ/表示）
    skeleton.ts          骨格の描画
  perf/PerfMonitor.ts    fps と推論時間の計測、連続稼働ログ
  ui/Hud.ts              fps 表示とデバッグオーバーレイ
  video/source.ts        カメラ / 開発用テスト動画
scripts/
  copy-wasm-assets.mjs   WASM バイナリを public/ へコピー
  build-service-worker.mjs  dist/ から sw.js を生成
public/
  models/                MoveNet のモデルファイル
  tfjs-wasm/             TF.js WASM バックエンドのバイナリ
  assets/pet/            ペット画像（cat.png / cat_open_mouth.png）
  dev/                   開発用テスト動画
```

### 姿勢推定の差し替え

将来 RTMO などに差し替えるため、`src/poseEngine/types.ts` の `PoseProvider` で分離してある。

- 入力: 1フレーム（video / canvas / ImageBitmap）
- 出力: 人物の配列（キーポイント群・信頼度・バウンディングボックス）

描画・トラッキング・演出はこの型にだけ依存させること。差し替えるときは
`src/poseEngine/index.ts` の `createPoseProvider()` だけを直す。

座標は常に **ソース映像のピクセル座標**（クロップ前）で受け渡す。
推論解像度・クロップ・鏡像はすべて Provider と Stage の内側に閉じている。

---

## 制約（守ること）

- **個人ごとのスコアやランキングは表示しない。** ゲージは個人単位だが、点数や順位として見せない
- **集計値のみを保持し、個人を識別できるデータおよび画像は保存しない**
- 映像・骨格データを外部に送信しない。すべてメモリ上で完結
- 音声は補助扱い。音がなくても成立する画面にする

---

## TODO

- [ ] **顔ぼかし。展示会前に必ず実装する。** 今回は対象外だが、通行人を撮影する以上
      本番投入の必須条件
- [ ] 段階2の検証用に、実カメラで撮った「人が横切る／立ち止まる／その場で動く」クリップが要る。
      `public/dev/walking_street.mp4` は一人称視点の路地映像で人がほとんど写らないため、
      動き量の検証には使えない
- [ ] セリフを変えたときの音声再生成手順（段階5でペットを実装したときに書く）
- [ ] 全員の成長量の合算（将来のレクリエーションモード）
- [ ] 集団の同期率
