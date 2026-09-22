# Screw Counter Builder

ネジを決まった本数ずつ梱包するための、3Dプリント製計数トレーのCadQueryモデルです。
現在は **Revision 4**。標準はM2・4本×10列で、1列ごとに軽いクリックが掛かる構造です。

![構造](ScrewCounter_M2_preview.png)

## セットアップ

Python 3.10以上を使用します。生成確認済みのCadQuery 2.7.0を固定しています。

```sh
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python design_screw_counter.py --rows 4 --columns 10 --screw M2 --out generated
```

## Web版（ブラウザ内生成）

`web/` にブラウザだけで動く生成画面を用意しています。[公開サイト](https://cormoran.github.io/screw-counter-builder/)では、左側の3Dプレビューを見ながら右側で設定を変更できます。既定モデルは事前生成されたメッシュを読み込み、設定変更後は少し待ってプレビューを再生成します。自動更新は切り替えられます。完成状態とパーツ分離状態をマウス・タッチで回転、移動、ズームできます。

4部品の印刷用STL、組立STEP、寸法・検証JSONを個別またはZIPでダウンロードできます。Bambu Studio用3MFではプレートサイズを350×320、330×320、256×256（既定）、180×180 mmから選択できます。配置は各プレートの中央に寄せ、1枚に収まらない場合は複数プレートに分けます。1部品も収まらない場合はエラーを表示します。3MFはスライス前の形状と配置であり、Bambu Studioで機種・材料・印刷条件を選んでスライスしてください。形状生成は端末内のWeb Workerで実行され、モデルはサーバーへ送信されません。省データ設定またはモバイル回線などが検出された場合は、大きなデータの初回取得前に確認します。

Web版の既定形状はPython版の印刷試用で見つかった課題に合わせて更新しています。クリック位置の係合とスライダーの隙間を詰め、ネジ頭を受ける穴を狭めてトレー床を薄くし、収納高さを15 mmにしました。外周は磁石・接合部の補強を残して細くし、蓋中央も肉抜きしています。Python版と同梱の生成済みモデルは従来形状のままです。

```sh
cd web
npm ci
npm run dev
```

表示されるローカルURLを開いてください。検証には `npm test`、配布用ビルドには `npm run build` を使用します。既定モデルの形状を変更したら `npm run generate:default-preview` で事前生成アセットを更新してください。プリセットのねじ頭径は設計上の想定です。実物のねじを測り、試験版で摺動・保持・落下を確認してください。

`rows`は1回に排出する本数、`columns`は列数です。M1.5／M2／M3に対応しています。

```sh
# 小型の試験版
python design_screw_counter.py --columns 2 --out test
# クリックを弱める
python design_screw_counter.py --columns 2 --detent-spring-width 1.0 --out light_test
```

## ファイル

- [詳細な設定・印刷・組立説明](README_ja.md)
- [Web版の実現可能性と実装方針](docs/web-feasibility.md)
- `design_screw_counter.py`：パラメータ設定、CAD生成、幾何学的な検証
- `generated/`：標準M2・4×10の組立STEPと印刷用STL
- `test/`：4×2の印刷試験版（ソフトウェアのテストスイートではありません）
- `validation_matrix.json`：異なる設定で実施したCAD検証記録

![クリック機構](ScrewCounter_detent_detail.png)

Web版の改訂形状はCAD上の保持・通過・干渉を確認しています。改訂形状の印刷・動作・クリック力・耐久性は未検証なので、まず試験版で確認してください。
