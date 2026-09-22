# Web版フィージビリティ調査（2026-09-22）

## 結論と確認レベル

**静的サイト + ブラウザ内WASM CADで4部品の生成を実装し、ChromeとNodeで出力を確認した。** Replicadを採用し、寸法・体積を同梱Python出力と比較した。全停止位置の検査、CADアプリでの再読込、印刷・実機試験は残る。公開環境はGitHub Pagesへの配信後に確認する。

初期調査では既存コードの構造、同梱済み出力、候補ライブラリの公開APIを確認した。その後の実装と測定結果は末尾に追記した。この環境でPython版を再生成していないため、比較基準はリポジトリに同梱された出力である。

## 既存実装から分かる要件

|項目|現状|Web版での扱い|
|---|---|---|
|入力|`Settings` に行数、列数、M1.5/M2/M3、接合方法、磁石、摺動隙間、頭径・軸径・溝幅・ピッチ、クリック設定がある|初版UIは行数・列数・対象ネジ・接合方法を基本入力にし、実測頭径・軸径・溝幅・ピッチ、磁石、隙間、クリックを詳細設定に置く。Python CLIにない軸径なども `Settings` の対応範囲として扱う|
|形状|`design_screw_counter.py` の `dimension()` と `build()` が4部品を作る。カット、結合、フィレット、面取り、円錐、目盛り文字を使用|単純なSTLメッシュの組立では形状とSTEPを同等にしにくい。B-RepのCADカーネルをブラウザで動かす|
|出力|組立位置のSTEP、印刷姿勢のbase/tray/slider/lid各STL、設定・寸法・検証結果JSON|同じ5 CADファイルとJSONをZIPで一括ダウンロード。各ファイルの個別取得も可能にする。STLとSTEPの座標系を明示する|
|検証|単一ソリッド・形状有効性・部品間干渉・各停止位置の落下/保持/軸通過・磁石/クリック隙間を検査|単なるブラウザプレビューだけを「検証済み」としない。Python版の比較テストと同等の幾何チェックを移植する。未実装のチェックはJSONに成功として書かない|

標準のM2・4行×10列は既存JSONで本体 **108.3 × 55 × 14 mm**、ピッチ **8 mm**。同梱の標準出力はSTEP約2.6 MiB、4 STL合計約3.2 MiBで、ダウンロード自体は小さい。これはWASM本体の転送量や生成中のメモリ量を示す数値ではない。行数・列数の上限は現行 `dimension()` にないため、Web UIでは性能測定後に上限を定める必要がある。無限大/NaNを含む数値と巨大な個数もUIと生成関数の両方で拒否する。

プリセット頭径は規格保証値ではない。実物のネジ頭を測った値を入力できるようにし、皿頭や薄頭など未対応形状については生成画面に説明を置く。CAD上の成立と実際の印刷・動作は別の確認事項である。

## 技術候補と判断

|案|利点|課題|判断|
|---|---|---|---|
|Replicad + OpenCascade WASMをTypeScriptから使用|ブラウザ内B-Rep演算、メッシュ化、STL/STEP出力、文字図形の公開APIがある。既存CadQueryと同系統のCADカーネル|CadQueryのコードはそのまま動かない。フィレットのエッジ指定、組立STEP、検証API、計算時間を移植・実測する必要がある|採用候補。brepjsと同条件で比較|
|brepjs + occt-wasm|B-Rep、フィレット、ブーリアン演算、STL/STEP、組立、形状計測を公開APIで扱える。occt-wasmはWorkerと明示的なメモリ管理を備える|こちらも全面移植が必要。文字刻印、同等形状、性能を確認する。occt-wasmは新しいWASM機能を要求するため対応ブラウザに注意|採用候補。Replicadと同条件で比較|
|occt-wasm / OpenCascade.jsを直接使用|必要なOCCT機能を細かく使える。occt-wasmには低レベルの検証・組立APIもある|形状作成の抽象化、エッジ選択、文字処理などを自前で実装する負担が増える。OpenCascade.jsのカスタムビルドは管理対象が増える|上位ライブラリで必要な操作が足りない場合に再評価|
|Python/CadQueryをサーバーで実行|現行形状・検証を再利用できる|サーバー運用、処理キュー、リソース制限が必要。静的サイトだけでは完結しない|WASM移植が品質・性能で成立しない場合の代替|
|メッシュ専用CAD/CSG|STLに絞れば選択肢が広い|現行STEPに相当する編集可能なB-Rep出力と形状比較が難しい|初版の要件には選ばない|

Replicadの公式資料は[ライブラリ利用とWorker内WASM初期化](https://replicad.xyz/docs/use-as-a-library/)、[STL/STEPとプレビュー用メッシュのAPI](https://replicad.xyz/docs/api/classes/Shape/)、[文字図形](https://replicad.xyz/docs/api/functions/drawText/)を記載している。[組立STEPのエクスポータ](https://github.com/sgenoud/replicad/blob/main/packages/replicad/src/export/assemblyExporter.ts)もソース上にある。[brepjsの公式README](https://github.com/andymai/brepjs)はB-Rep演算、STEP出力、組立を説明し、[occt-wasmの公式README](https://github.com/andymai/occt-wasm)はSTL/STEP、XCAF組立、Worker、対応ブラウザを説明している。[OpenCascade.jsの公式資料](https://ocjs.org/docs/app-dev-workflow/custom-builds)にはカスタムWASMビルドの手順がある。これらは**機能の存在**の根拠であり、このリポジトリのモデルでの動作保証ではない。OpenJSCADは[公式資料に列挙される出力形式にSTEPがない](https://github.com/jscad/OpenJSCAD.org/blob/master/jsdoc/tutorials/01_gettingStarted.md)ため、現行出力との同等性を優先する初版には選ばない。`occt-import-js` は[STEP等の読み込み・三角形化が主用途](https://github.com/kovacsv/occt-import-js/blob/main/README.md)なので生成エンジンには採用しない。

## 推奨アーキテクチャ

1. Vite + TypeScriptの静的サイトを追加し、GitHub PagesへActionsから配信する。Pagesは[静的アセットとActionsでのビルド成果物配信に対応](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)。リポジトリ名のサブパス配信を想定してbase URLを設定する。
2. UIでパラメータを入力し、`dimension()` と同じ制約で即時に寸法とエラーを表示する。Python版は比較の基準として維持し、寸法計算のゴールデンケースをTS版と照合する。
3. 専用Web WorkerでOCCT WASMを一度初期化し、4部品を生成する。計算中のUIを止めず、キャンセル時はWorkerを破棄する。プレビューは生成した形状のメッシュを描く。設定変更時は重い演算を明示的な「生成」操作で開始する。
4. 形状検証を通った結果だけをダウンロード可能にする。STEPは組立位置、STLは各部品を印刷姿勢に変換して出力。ZIPには設定、派生寸法、実施済みチェック、生成器のバージョンを入れる。失敗時はエラーを表示し、不完全なZIPは提供しない。
5. 開発時はPython版との比較をCIで行う。配信時にはPythonを必要としない構成にする。ページ本体とWASMのライセンス/配布ファイルを依存確定時に確認する。

## エンジン比較スパイク（2026-09-22）

公開APIと配布条件を再確認し、初版の採用候補をReplicadに絞る判断とした。この時点ではCAD生成を実行しておらず、生成時間・WASM実測値を示すものではない。npm registryは権限付きの実行経路でアクセスできることを後から確認した。

|観点|Replicad|brepjs + occt-wasm|判断|
|---|---|---|---|
|現行形状の移植|CadQueryに近いチェーンAPI、`EdgeFinder`による幾何条件のエッジ選択、フィレット/ブーリアン|OCCTの低レベル操作を型付きAPIで扱えるが、形状手順の全面移植が必要|Replicadの移植リスクが低い|
|文字|`drawText(text, { fontFamily, fontSize })` が公開され、Drawingを押し出し/カットへ渡せる|確認した公開ガイドに文字からB-Repを作る同等ヘルパーはない|目盛り文字があるためReplicad優位|
|出力|`Shape.blobSTL()`、`Shape.blobSTEP()`、メッシュ取得。CLIには`step-assembly`出力|STL/STEP、XCAF assembly、テッセレーションを低レベルAPIで提供|両方成立。ReplicadのAPIが簡潔|
|検証|形状トポロジー、体積、BBox等をラッパー越しに取得。必要なOCCT検査は追加実装|形状型、体積、BBox、点分類、healing等を広く提供|検査の深さはbrepjs優位。採用後に不足分をOCCT APIで補う|
|ブラウザ|WorkerでOpenCascade WASMを初期化する構成。実行時のWASM設定が必要|occt-wasmはWorker対応だが、SIMD・tail calls・例外処理を要求（確認済み最低: Chrome/Edge 114、Safari 17.2、Firefox 121）|対応ブラウザを明記し、非対応時はエラー表示|
|配布|Replicad本体とOpenCascade WASMのライセンス/サイズ確認が必要|occt-wasm READMEはbrotli約4.5MB、Apache-2.0のbrepjsを記載|実装時にlockfileとライセンスを固定|

### 採用判断

目盛り文字を含む4部品モデルを最短で移植できる可能性を優先し、**初版はReplicad + OpenCascade WASMを採用する**。Replicadのmain packageは現在1.1.0で、対応する`replicad-opencascadejs`も1.1.0として公開されているため、実装開始時はこの組み合わせをlockfileに固定してスパイクする。brepjs + occt-wasmは、Replicadで文字刻印またはAssembly STEPが詰まった場合の代替候補として残す。brepjsは検証・XCAF assemblyのAPIが広いため、Replicadで生成したSTEPを受けて検査する補助利用も将来の選択肢になる。

比較根拠: [Replicad library/Worker初期化](https://replicad.pages.dev/docs/use-as-a-library/)、[Replicad ShapeのSTL/STEP/mesh API](https://replicad.xyz/docs/api/classes/Shape/)、[Replicad drawText](https://replicad.xyz/docs/api/functions/drawText/)、[Replicad CLIのstep-assembly](https://github.com/sgenoud/replicad/blob/main/packages/replicad-cli/README.md)、[brepjs README](https://github.com/andymai/brepjs)、[occt-wasm READMEとブラウザ要件](https://github.com/andymai/occt-wasm/blob/main/README.md)。

### インストール済みReplicad 1.1.0のAPI確認

`web/node_modules/replicad/dist/replicad.d.ts` と実装を確認した。4部品の組立STEPは、各Shapeを `{ shape, name, color, alpha }` にして `exportSTEP(parts, { unit: "MM" })` に渡す。内部でXCAFドキュメントを作成し、`write.step.assembly=2` を設定してBlobを返す。`createAssembly()`も公開されるが、通常はBlobを直接返す`exportSTEP()`が扱いやすい。

文字は `sketchText(text, { fontSize, fontFamily }, { plane, origin })` または `drawText(text, { ... }).sketchOnPlane(...)` の結果を `.extrude(depth)` し、部品を `.cut(textSolid)` する。`sketchText` は複数輪郭を返す `Sketches` であり、複数文字輪郭を一度に押し出せる。

検査は高水準の単一 `isValid` は公開されていないため、`shape.solids.length`、`shape.isNull`、`shape.boundingBox`、`measureVolume(shape)`、`measureDistanceBetween(a, b)` と boolean の `intersect()` 結果を組み合わせる。厳密なOCCT `BRepCheck_Analyzer` は `getOC()` 経由の追加実装が必要で、検証JSONでは未実施チェックを成功扱いしない。

プレビューは `shape.mesh({ tolerance, angularTolerance })` の頂点/法線/三角形をThree.jsへ渡す。部品STLは `shape.blobSTL({ binary: true, tolerance, angularTolerance })`、組立STEPは前記 `exportSTEP()` を使う。`Shape.solids` は検証時のソリッド数取得にも利用できる。

## 最初の実装スパイクと合格条件

1. Replicad系とbrepjs + occt-wasm系の公開API、モデル移植の難度、文字形状、組立STEP、検証手段を比較する。Replicad採用後は実モデルをWorker内で生成し、STL/STEP出力、形状計測、WASMサイズ、生成時間を確認する。iOS Safari相当での初期化は別途確認する。
2. M2・4×2を**4部品すべて**移植し、印刷姿勢の各STLと組立STEPをブラウザから出力する。難所は縦エッジ/上面エッジのフィレット指定、トレーの多数の穴、文字のくり抜き、ばねとノッチ、蓋の反転とSTEP組立である。最初に文字を省略した形状で演算を通し、その後文字まで含める。
3. Python版の同設定と外形寸法、部品数、ソリッド有効性、体積、各部品の位置、穴の中心/径を比較する。メッシュのバイト一致は要求しない。受け入れる数値許容差を比較前に決め、差分を記録する。スライダーの各停止位置で保持・落下・干渉を確認する。
4. 標準M2・4×10、M1.5・3×3・接着、M3・6×3・ネジ、M2・1×1も実行し、全ファイルをCAD/スライサーで開く。デスクトップとスマートフォンで生成時間、ピークメモリ、初回WASM取得量を測る。測定後に入力上限と対応ブラウザを決める。

合格ならサイト本実装に進む。組立STEPや重要なフィレット/文字が再現できない、標準設定で実用的な時間・メモリに収まらない、または検証を同等に移せない場合は、差分と測定値を残してサーバー生成案へ切り替える。サーバー案でもフロントエンドの入力・寸法表示・プレビュー設計は流用できる。

## 残る作業

- [ ] ダウンロードしたSTEP/STLを別のCADアプリとスライサーで再読込し、組立位置と印刷姿勢を確認する。
- [ ] 複数ブラウザ・スマートフォンで生成時間、メモリ、ダウンロードを測る。現行の入力上限12行×24列は暫定値。
- [ ] Python版と同じ全停止位置での幾何検査、B-Rep数値比較を必要に応じて追加する。現行ブラウザ版は代表位置を検査し、未実施項目をJSONに記録する。
- [ ] 印刷・実機動作、クリック力、耐久性を試験版で確認する。

## 実装・検証の追記（2026-09-22）

- `web/` にVite/Reactの静的サイト、設定スキーマ、Web Worker内のReplicad生成、4 STL・組立STEP・寸法JSON・ZIP出力を実装した。WASMはビルド時22.98 MB、gzip時7.32 MB。ブラウザの実際の転送量はホストの圧縮設定に依存する。
- 生成した4部品のメッシュをWorkerから転送し、Three.jsで完成状態とパーツ分離状態を表示する。Chromeで切替とマウス回転を操作し、390 px幅でも横スクロールが発生しないことを確認した。Three.jsは生成後に遅延読込する。
- `navigator.connection` が省データ設定、cellular、2g、slow-2gを報告する場合、初回WASM取得前に通信量を示して続行確認を出す。APIがないブラウザでは回線種別を推測しない。STL/ZIPはブラウザ内のBlobを保存するため回線確認の対象外とした。[Network Information API](https://developer.mozilla.org/en-US/docs/Web/API/Network_Information_API)はブラウザによって利用可否が異なる。
- Chromeのローカル配布ビルドでM2・4×2を入力し、幾何検査後に6ファイルのダウンロード操作が表示されることを確認した。無効な頭径入力ではエラーが表示され生成できない。UIからの保存先への書き込みとダウンロードファイルの再読込は、このブラウザ環境では未確認。
- Node/VitestでM2・4×2を実生成し、4 STL・組立STEP・寸法JSONを作成した。ReplicadのB-Rep体積と同梱Python STLのメッシュ体積の差はbase +0.00077%、tray −0.00425%、slider +0.00178%、lid +0.00031%。この差にはPython出力側のSTLメッシュ化誤差と目盛り文字の形状差が含まれる。外形寸法も一致。STEPのCADアプリでの再読込、印刷、物理動作は未確認。
- Node/Vitestでは標準M2・4×10、M1.5・3×3接着、M3・6×3ねじ、M2・1×1ねじも実生成し、幾何チェックとSTEP/STL出力を通過した。Chromeのローカル配布ビルドでも標準M2・4×10を約100秒で生成できた。ブラウザでの性能は端末依存なので、公開後の対応範囲は追加測定が必要。
- 目盛り数字にはフォントファイルに依存しない形状を使用している。Python版と完全に同一の文字輪郭ではない。今後モデルを変更する際は、`settings.ts` の入力制約、`derive.ts` の派生寸法、`replicad.ts` の形状、`settings-schema.ts` のUIメタデータ、比較テストを一緒に更新する。

## 2026-09-22 の追加設計

- プレビューを主画面の左に広く置き、設定を右サイドパネルにした。完成／分離の切替、分離距離、パン、回転、ズームを操作できる。OrbitControls のダンピングは無効。
- `screwSpaceHeight` はトレーのデッキ上面から閉じたふたの内側までの高さ。ふたの突出部1.2 mmを加えて外形上端を計算する。既定5.6 mmで従来の外形上端14 mmを維持し、3.5〜30 mmの入力を許可する。この設定は `Settings`、入力スキーマ、派生寸法、CAD形状へ通す。
- 標準M2・4×10の組立座標メッシュを事前生成し、静的アセットとして配布する。`npm run generate:default-preview` で更新。現在の合計は生データ1.43 MB、gzip換算0.33 MB。回線情報APIで省データ・cellular等を検出した場合、1 MB超の初回取得前に確認する。動的プレビューはWeb Workerで出力・詳細幾何検証を省き、古い設定の生成を中断する。ダウンロード可能なCADファイルには従来の検証を実行する。
- 初期実装ではBambu Studio向けにCore 3MFを生成し、4部品を印刷向きにして256×256 mmプレートへ8 mm以上の間隔で配置した。当時はプレートに収まらない設定をエラーにした。Bambu Studio CLIで4×2の実生成ファイルを再読込し、4部品・manifoldを確認した。機種、ノズル、フィラメント、印刷条件が不明なためスライス済みG-codeは含めず、Bambu Studioで設定してからスライスする。[Bambu Studio CLI](https://github.com/bambulab/BambuStudio/wiki/Command-Line-Usage)、[3MF処理実装](https://github.com/bambulab/BambuStudio/blob/master/src/libslic3r/Format/bbs_3mf.cpp)。

## 2026-09-22 のプレート配置拡張

- 詳細設定は基本設定の次に、収納・操作、ねじの実測値、磁石、クリアランスの順で表示する。入力の追加時は `web/src/settings-schema.ts` の `SETTINGS_CATEGORIES` と `SETTINGS_FIELDS` に対応付ける。
- 印刷プレートは350×320、330×320、256×256（既定）、180×180 mmの4種類を選べる。対応機種の表示と寸法は `PRINT_PLATE_OPTIONS` に集約した。3MF生成APIは `{ width, depth }` を受け取る。
- STLを印刷向きのまま8 mm間隔で詰める。4部品の並び順を試して使うプレート枚数を抑え、各プレートで部品全体のバウンディングボックスを中央に移す。1枚に収まらなければ分割する。部品単体が指定プレートからはみ出す場合にエラーとする。
- 複数プレートはBambu Studioの `Metadata/model_settings.config` の `<plate>` と、3MF内の仮想プレート座標に対応付ける。[Bambu Studioの3MF読み書き実装](https://github.com/bambulab/BambuStudio/blob/master/src/libslic3r/Format/bbs_3mf.cpp)を参照。3MFは形状と配置を保存し、機種や材料のスライス設定はBambu Studio上で選択する。
- Bambu Studio 02.08.02.60 のCLIで180×180 mmの4プレート入り3MFを再読込し、`m_plater_data size 4` と `got plate count 4` を確認した。この確認用3MFのメッシュはテスト用の平面三角形であり、凸包エラーも出るため、スライス可能性の証明ではない。Chromeのローカルサイトでは標準M2・4×10を180×180 mmで生成し、2プレート表示と各プレートの部品切替を確認した。実印刷は未確認。

## デテント用ノッチの底面

- ベース側のクリック位置ノッチは、以前は `z=-0.1` から円筒で切られ、底面を貫通していた。Python版とWeb版の切削開始高さをレール床面 `floor=1.6 mm` に変更した。スライダーの突起はそれより上の `sliderZ` から始まるため、係合側面の形状を保ちながら底板を連続させる。
- 両実装の検証で、各ノッチ直下の底板に材料が残ることをB-Rep交差体積で確認する。Web版の既定プレビューと、Python版の4×2・4×10の配布用形状を再生成する。実印刷でのクリック荷重と耐久性は未確認。

## Python版の印刷フィードバックを受けたWeb専用改訂

Python版と同梱の生成済みモデルは変更しない。Web版は印刷試用で報告された弱いクリック、接合ネジ座ぐりの天井の潰れ、スライダー下のネジの移動、穴内でのネジの反転・重複、収納高さと材料量を改善する。新形状はPython版と意図的に異なるため、旧Python STLとの体積一致を回帰条件にしない。

| 部位 | Web版の変更 | 確認する性質 |
| --- | --- | --- |
| デテント | ノーズ半径1.1 mm、レールへの公称食い込み0.7 mm。切り欠き半径は1.2 mmを維持 | 停止位置で干渉せず、位置間でノーズが接触し、0.8 mmの逃げが可能 |
| ベースの接合ネジ | 平頭用の深さ2.3 mmの座面を残し、その上を半径2.3→1.2 mm、高さ1.1 mmで45度に絞る | ネジ頭の座面と斜面をB-Repで確認 |
| スライダー | 既定の上下・横クリアランスを0.3→0.2 mm | 引き抜き位置の干渉と軸・頭の保持を既存の生成検証で確認 |
| トレー | 頭穴を `head+1.2`→`head+0.6` mm、入口の広がりを片側0.2 mm、床厚を3→1.6 mm | 単一ソリッド、頭の通過、周囲の保持を確認 |
| 収納部 | 既定の自由高さを5.6→15 mm | 入力値から外形上端を導出 |
| トレー外周 | 長辺・短辺の壁を2.4 mmとし、磁石と接合ネジの周囲のみ円形パッドで補強 | 中間部が空洞、磁石・接合部の材料が残ることを確認 |
| 蓋 | 中央下面を深さ2 mm肉抜きし、外側に1.4 mmの皮を残す | 中央の空洞と皮、磁石穴のクリアランスを確認 |

これらの数値はWeb版の初期改訂値であり、新版の実印刷による給送・クリック力・耐久性は未確認。調整の際は `settings.ts` の既定値と検証範囲、`derive.ts` の派生寸法、`replicad.ts` の形状、`settings-schema.ts` の入力メタデータ、既定プレビューと生成テストを合わせて更新する。

## 四隅への接合ネジ移動とプレビュー表示

Web版では4本の接合ネジのXY座標を磁石の中心と一致させる。ネジは底面からM2×5を入れ、ベースの座面は従来の深さ2.3 mmを維持する。トレーの下側に深さ2 mmの止まり穴を設け、上側の磁石ポケットとはZ方向に0.5 mm以上の材料を残す。最小収納高さと厚い磁石の組み合わせでこの厚みを確保できない場合は入力を拒否する。CAD検証では同軸の配置、止まり穴、間の材料、磁石の嵌合を確認する。ネジの実物の頭径・長さと樹脂の保持力は実印刷で確認する。

プレビューは完成・パーツ分離・2Dを切り替える。3D表示中は設定サイドバー右上に寸法上面図も置き、各部品の表示切替を操作できるようにする。表示状態はプレビュー専用で、STL・STEP・3MFの生成対象を変えない。
