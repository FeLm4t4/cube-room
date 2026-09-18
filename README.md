# CUBE ROOM

React・TypeScript・Three.jsで作った、ブラウザで遊べる3Dルービックキューブです。

Cloudflare WorkersのStatic Assetsで公開できます。

## 遊び方

| 操作 | 動作 |
| --- | --- |
| キューブを左ドラッグ | ドラッグした方向へ、その列を90度回転 |
| 右ドラッグ | キューブを見渡す |
| マウスホイール | 拡大・縮小 |
| 余白をドラッグ | 視点を変更 |
| Q / W / E | 上・手前・右の面を時計回りに90度回転 |
| A / S / D | 下・奥・左の面を時計回りに90度回転 |
| Z / X / C | 左右・上下・前後の間にある中央の層を90度回転 |
| Shift + 回転キー | 逆向きに回転 |
| Ctrl / Command + Z | 一手戻す |
| Space | シャッフル |
| 全画面ボタン | キューブと操作パネルを全画面表示。解除ボタンか Esc で戻る |

面や中央の層は、左ドラッグか QWE / ASD / ZXC のキーで回せます。Z は左から、X は下から、C は手前から見て時計回りです。「キーを逆回転」をオンにすると、キー操作の回転方向が逆になります。キーの対応や詳しい操作は、画面の「操作ガイド」で確認できます。全画面表示は対応ブラウザで利用できます。

スマートフォンでは「回す／見る」を切り替えて操作します。二本指でも視点を動かせ、ピンチで拡大・縮小できます。

短いドラッグは取り消されます。回し始めるとタイマーが動き、六面がそろうと止まります。シャッフルは毎回20〜40手からランダムに選び、選んだ手数をボタンに表示します。ページを再読み込みすると初期状態に戻ります。

「解法例」を押すと、現在の状態から完成までの手順がプレビュー下部に重なって表示されます。下からスライドして現れ、プレビューの大きさは変わりません。手順のボタンを押すと、その位置までアニメーションで進みます。前の位置に戻ったり、一手ずつ確認したり、最後まで再生して途中で止めたりできます。解法例の再生も操作履歴と手数に含まれます。

手動で面を回すと、その操作を反映した有効な解法をすぐに表示します。操作が約300ms止まると、Web Workerで回転の合成とmin2phaseによる二段階探索を行い、短い解が見つかるたびに残りの手順を更新します。再生中は手順を固定し、停止後の更新でも、たどった手順と現在位置はそのまま残ります。**最短手数を保証するものではありません。**

解法例の「探索時間の上限」で、1秒・5秒・10秒から選べます。既定は1秒で、選択はブラウザに保存します。この時間には探索データの初回読み込みも含みます。上限に達する前でも、探索が終われば停止します。回転やドラッグが始まったとき、または画面が非表示になったときは探索を中断し、その時点の有効な手順を保持します。次に操作が止まると、最新の状態から探索し直します。

プレビュー右上の「FPS」で、フレームレートと描画方式の表示を切り替えます。WebGL 2を使い、高性能GPUを優先する設定です。利用するGPUはブラウザが決定します。ソフトウェア描画を検出した場合は、その旨を表示します。FPS表示を切ると、画面が変化したときだけ描画します。

## ローカルで起動

Node.js 24以降を推奨します。

```sh
npm ci
npm run dev
```

表示されたローカルURLをブラウザで開いてください。3D表示にはWebGL 2対応ブラウザが必要です。

```sh
npm test        # 回転・完成判定のテスト
npm run build  # TypeScript検査と公開用ビルド
npm run preview
```

## Cloudflare Workersで公開

Cloudflareの **Workers & Pages** で、GitHubの`FeLm4t4/cube-room`を接続します。GitHubリポジトリはPrivateのまま利用できます。

| 設定 | 値 |
| --- | --- |
| Worker名 | `cube-room` |
| 本番ブランチ | `main` |
| ビルドコマンド | `npm test && npm run build` |
| デプロイコマンド | `npm run deploy` |
| ルートディレクトリ | `/` |
| ビルド環境変数 | `NODE_VERSION=24` |

接続後は、`main`へのpushをCloudflareが検知し、テストとビルドの成功後に公開します。公開URLはCloudflareの管理画面で確認できます。GitHub Actionsでも、pushとプルリクエスト時にテストとビルドを実行します。

`wrangler.jsonc`で`dist/`全体を配信します。サーバー用のWorkerコードは不要で、解法の探索はブラウザのWeb Workerで実行します。

手元から公開する場合は、初回に`npx wrangler login`でCloudflareへログインし、次の順に実行します。

```sh
npm test
npm run build
npm run deploy
```

## 実装

- `src/cube/model.ts`: 整数座標を使った26個の小片、面の回転、完成判定。
- `src/components/CubeStage.tsx`: Three.jsの描画、面の選択、ドラッグ追従、視点操作。
- `src/cube/solution.ts`: 回転の合成と、同じ変化を起こす手順への短縮。
- `src/cube/solver.ts`: 現在状態からの二段階探索、時間制限、候補の完成確認。
- `src/cube/solution.worker.ts`: 区間短縮と二段階探索の実行、改善候補の通知。
- `src/cube/searchClient.ts`: 探索の中断、期限の管理、古い計算結果の除外。
- `src/cube/useSolution.ts`: 操作ごとの解法更新と、操作停止後の探索開始。
- `scripts/generate-solver-tables.mjs`: min2phaseの探索表とアダプターをビルド時に生成。
- `src/components/SolutionTrail.tsx`: 位置を選んでたどれる解法例。
- `src/App.tsx`: シャッフル、履歴、タイマー、解法再生、キーボード操作。

キューブの状態とアニメーションを分け、回転が終わるたびに整数座標から描画を組み直すことで、繰り返し回しても位置や色がずれないようにしています。

探索は端末内で完結します。探索表を静的ファイルとして配信するため、スマートフォンで重い表の生成を繰り返す必要はありません。min2phase.jsはMITライセンスで利用し、著作権表示と生成元の情報を`src/vendor/`に含めています。公開ファイルにも`public/third-party-licenses/min2phase.txt`のライセンス文を同梱します。探索表は`npm run generate:solver`でも再生成できます。

実装時の参照: [Three.js公式ドキュメント](https://threejs.org/docs/)、[Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)、[WorkersのGit連携](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/)。
