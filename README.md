# CUBE ROOM

React・TypeScript・Three.jsで作った、ブラウザで遊べる3Dルービックキューブです。

公開URL: https://FeLm4t4.github.io/cube-room/

## 遊び方

| 操作 | 動作 |
| --- | --- |
| キューブを左ドラッグ | ドラッグした方向へ、その列を90度回転 |
| 右ドラッグ | キューブを見渡す |
| マウスホイール | 拡大・縮小 |
| 余白をドラッグ | 視点を変更 |
| U / D / F / B / L / R | 指定した面を時計回りに回転 |
| Shift + 面のキー | 反時計回りに回転 |
| Ctrl / Command + Z | 一手戻す |
| Space | シャッフル |

スマートフォンでは「回す／見る」を切り替えて操作します。二本指でも視点を動かせ、ピンチで拡大・縮小できます。

短いドラッグは取り消されます。回し始めるとタイマーが動き、六面がそろうと止まります。シャッフルは20手です。ページを再読み込みすると初期状態に戻ります。

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

## GitHub Pages

リポジトリの **Settings → Pages → Source** を **GitHub Actions** に設定します。`main`へのpushで、テスト・ビルドの成功後に`.github/workflows/deploy.yml`が`dist/`を公開します。

Viteの`base`は`./`です。GitHub Pagesのリポジトリ配下でも、画像やJavaScriptを相対パスで読み込めます。

## 実装

- `src/cube/model.ts`: 整数座標を使った26個の小片、面の回転、完成判定。
- `src/components/CubeStage.tsx`: Three.jsの描画、面の選択、ドラッグ追従、視点操作。
- `src/App.tsx`: シャッフル、履歴、タイマー、キーボード操作。

キューブの状態とアニメーションを分け、回転が終わるたびに整数座標から描画を組み直すことで、繰り返し回しても位置や色がずれないようにしています。

実装時の参照: [Three.js公式ドキュメント](https://threejs.org/docs/)、[ViteのGitHub Pages公開手順](https://vite.dev/guide/static-deploy.html#github-pages)、[GitHub Pagesのカスタムワークフロー](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。
