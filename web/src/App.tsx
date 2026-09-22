import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import JSZip from 'jszip'
import { DEFAULT_PREVIEW_CONFIRM_BYTES, DEFAULT_SETTINGS, deriveDimensions, generateModel, generatePreviewModel, getDefaultPreviewInfo, loadDefaultPreview, validateSettings, type GeneratedModel, type ModelPart, type PreviewModel, type Settings, type TriangleMesh } from './cad'
import { createBambu3mf, type Print3mfArtifact } from './print3mf'
import { DimensionPreview } from './components/DimensionPreview'
import type { ViewMode, ViewerCameraState } from './components/ModelViewer'
import { SettingsForm } from './components/SettingsForm'
import { differsFromDefaults, loadRealtimePreview, loadSettings, loadViewMode, saveRealtimePreview, saveSettings, saveViewMode } from './settings-session'
import { PRINT_PLATE_OPTIONS, SETTINGS_CATEGORIES, SETTINGS_FIELDS, type PrintPlateOption } from './settings-schema'
import { currentConnectionNeedsConfirmation } from './network'
import './styles/preview.css'

type State = 'ready' | 'generating' | 'complete' | 'error'
type PreviewState = 'idle' | 'generating' | 'error'
type PrintState = 'ready' | 'generating' | 'error'
type PendingTransfer = { label: string; detail: string; action: () => void }
const ModelViewer = lazy(() => import('./components/ModelViewer').then((module) => ({ default: module.ModelViewer })))

const PART_FILES = [
  ['assembly.step', '組立 STEP'],
  ['base.stl', 'ベース STL'],
  ['tray.stl', 'トレー STL'],
  ['slider.stl', 'スライダー STL'],
  ['lid.stl', 'ふた STL'],
  ['dimensions.json', '寸法・検証 JSON'],
] as const

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [advanced, setAdvanced] = useState(false)
  const [selectedPlateId, setSelectedPlateId] = useState<PrintPlateOption['id']>('standard')
  const [state, setState] = useState<State>('ready')
  const [status, setStatus] = useState('設定を確認してから「モデルを生成」を選んでください。')
  const [model, setModel] = useState<GeneratedModel | null>(null)
  const [preview, setPreview] = useState<PreviewModel | null>(null)
  const [previewState, setPreviewState] = useState<PreviewState>('idle')
  const [previewStatus, setPreviewStatus] = useState('事前生成プレビューを読み込んでいます…')
  const [realtimePreview, setRealtimePreview] = useState(loadRealtimePreview)
  const [printArtifact, setPrintArtifact] = useState<Print3mfArtifact | null>(null)
  const [showPrintPreview, setShowPrintPreview] = useState(false)
  const [previewMode, setPreviewMode] = useState<ViewMode>(loadViewMode)
  const [previewPlateIndex, setPreviewPlateIndex] = useState(0)
  const [printState, setPrintState] = useState<PrintState>('ready')
  const [printStatus, setPrintStatus] = useState('')
  const [pendingTransfer, setPendingTransfer] = useState<PendingTransfer | null>(null)
  const generation = useRef<AbortController | null>(null)
  const previewGeneration = useRef<AbortController | null>(null)
  const printRequest = useRef(0)
  const [previewRetry, setPreviewRetry] = useState(0)
  const wasmApproved = useRef(false)
  const previewApproved = useRef(false)
  const hasEditedSettings = useRef(differsFromDefaults(settings))
  const assemblyCamera = useRef<ViewerCameraState | null>(null)
  const printCamera = useRef<ViewerCameraState | null>(null)
  const validation = useMemo(() => validateSettings(settings).map(localizeValidation), [settings])
  const dimensions = useMemo(() => validation.length === 0 ? deriveDimensions(settings) : null, [settings, validation])
  const selectedPlate = useMemo(() => PRINT_PLATE_OPTIONS.find((plate) => plate.id === selectedPlateId)!, [selectedPlateId])

  useEffect(() => { saveViewMode(previewMode) }, [previewMode])
  useEffect(() => { saveRealtimePreview(realtimePreview) }, [realtimePreview])

  function update(key: keyof Settings, value: Settings[keyof Settings]) {
    hasEditedSettings.current = true
    const next = key === 'screw'
      ? { ...settings, screw: value as Settings['screw'], headDiameter: null, shaftDiameter: null, slotWidth: null, pitch: null }
      : { ...settings, [key]: value }
    saveSettings(next)
    generation.current?.abort()
    previewGeneration.current?.abort()
    printRequest.current += 1
    setSettings(next)
    setModel(null)
    if (!realtimePreview || previewMode === '2d') {
      setPreview(null)
      setPreviewState('idle')
      setPreviewStatus(!realtimePreview ? 'リアルタイムプレビューはオフです。' : '2Dプレビューを更新しました。3Dは表示時に生成します。')
    } else {
      setPreviewState('generating')
      setPreviewStatus('設定の変更をプレビューに反映しています…')
    }
    setPrintArtifact(null)
    setShowPrintPreview(false)
    setPreviewPlateIndex(0)
    setPrintState('ready')
    setState('ready')
  }

  useEffect(() => {
    void loadInitialPreview()
  }, [])

  useEffect(() => {
    if (!hasEditedSettings.current) return
    if (validation.length > 0) {
      setPreviewState('idle')
      setPreviewStatus('入力を修正するとプレビューを更新できます。')
      return
    }
    if (!realtimePreview) {
      setPreviewState('idle')
      setPreviewStatus('リアルタイムプレビューはオフです。')
      return
    }
    if (previewMode === '2d') {
      setPreviewState('idle')
      setPreviewStatus('2Dプレビューを更新しました。3Dは表示時に生成します。')
      return
    }
    const controller = new AbortController()
    previewGeneration.current?.abort()
    previewGeneration.current = controller
    setPreviewState('generating')
    setPreviewStatus('設定の変更をプレビューに反映しています…')
    const timeout = window.setTimeout(() => {
      if (currentConnectionNeedsConfirmation() && !wasmApproved.current) {
        setPreviewState('idle')
        setPreviewStatus('リアルタイムプレビューの生成を待機しています。')
        setPendingTransfer({ label: 'CADエンジンの取得', detail: '初回のみCADエンジン約23 MB（圧縮時約7.3 MB）を取得します。', action: () => { wasmApproved.current = true; setPreviewRetry((value) => value + 1) } })
        return
      }
      void generatePreviewModel(settings, {
        signal: controller.signal,
        onProgress: (progress) => setPreviewStatus(localizeProgress(progress.message) ?? 'プレビューを生成しています…'),
      }).then((generated) => {
        if (previewGeneration.current !== controller) return
        setPreview(generated)
        setPreviewState('idle')
        setPreviewStatus('プレビューを更新しました。')
      }).catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        if (previewGeneration.current !== controller) return
        setPreviewState('error')
        setPreviewStatus(error instanceof Error ? error.message : 'プレビューを生成できませんでした。')
      })
    }, 700)
    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [previewRetry, previewMode, realtimePreview, settings, validation.length])

  async function loadInitialPreview() {
    if (hasEditedSettings.current) return
    try {
      const info = await getDefaultPreviewInfo()
      if (currentConnectionNeedsConfirmation() && info.rawBytes > DEFAULT_PREVIEW_CONFIRM_BYTES && !previewApproved.current) {
        setPreviewStatus('事前生成プレビューの取得を待機しています。')
        setPendingTransfer({ label: '事前生成プレビューの取得', detail: `初回のみ事前生成した3Dプレビュー約${formatBytes(info.gzipBytes)}（展開後約${formatBytes(info.rawBytes)}）を取得します。`, action: () => { previewApproved.current = true; void loadInitialPreview() } })
        return
      }
      const partMeshes = await loadDefaultPreview()
      if (hasEditedSettings.current) return
      setPreview({ dimensions: deriveDimensions(DEFAULT_SETTINGS), partMeshes })
      setPreviewState('idle')
      setPreviewStatus('事前生成プレビューを表示しています。')
    } catch (error) {
      setPreviewState('error')
      setPreviewStatus(error instanceof Error ? error.message : '事前生成プレビューを読み込めませんでした。')
    }
  }

  function requestGeneration() {
    if (currentConnectionNeedsConfirmation() && !wasmApproved.current) {
      setPendingTransfer({ label: 'CADエンジンの取得', detail: '初回のみCADエンジン約23 MB（圧縮時約7.3 MB）を取得します。', action: () => { wasmApproved.current = true; void build() } })
      return
    }
    void build()
  }

  async function build(): Promise<GeneratedModel | null> {
    if (validation.length) return null
    previewGeneration.current?.abort()
    setPreviewState('idle')
    const controller = new AbortController()
    generation.current = controller
    setState('generating')
    setStatus('CADエンジンを準備しています…')
    try {
      const generated = await generateModel(settings, {
        signal: controller.signal,
        onProgress: (progress) => setStatus(localizeProgress(progress.message) ?? phaseLabel(progress.phase)),
      })
      if (generation.current !== controller) return null
      setModel(generated)
      setPreview({ dimensions: generated.dimensions, partMeshes: generated.partMeshes })
      setState('complete')
      setStatus('モデルを生成しました。')
      return generated
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setState('ready')
        setStatus('生成を中止しました。設定を変更して再生成できます。')
      } else {
        setState('error')
        setStatus(error instanceof Error ? error.message : 'モデルを生成できませんでした。')
      }
      return null
    } finally {
      generation.current = null
    }
  }

  function requestPrint3mf() {
    if (!model && currentConnectionNeedsConfirmation() && !wasmApproved.current) {
      setPendingTransfer({ label: 'CADエンジンの取得', detail: '初回のみCADエンジン約23 MB（圧縮時約7.3 MB）を取得します。', action: () => { wasmApproved.current = true; void buildPrint3mf() } })
      return
    }
    void buildPrint3mf()
  }

  function selectPrintPlate(plateId: PrintPlateOption['id']) {
    setSelectedPlateId(plateId)
    printRequest.current += 1
    setPrintArtifact(null)
    setShowPrintPreview(false)
    setPreviewPlateIndex(0)
    setPrintState('ready')
    setPrintStatus('')
  }

  async function buildPrint3mf() {
    if (validation.length) return
    const request = ++printRequest.current
    setPrintState('generating')
    setPrintStatus(model ? '3MFファイルを生成しています…' : '印刷用モデルを生成しています…')
    try {
      const source = model ?? await build()
      if (printRequest.current !== request) return
      if (!source) {
        setPrintState('ready')
        return
      }
      const artifact = await createBambu3mf(source, { width: selectedPlate.width, depth: selectedPlate.depth })
      if (printRequest.current !== request) return
      setPrintArtifact(artifact)
      setShowPrintPreview(true)
      setPreviewPlateIndex(0)
      setPrintState('ready')
      setPrintStatus(`Bambu Studio用3MFを${artifact.plates.length}プレートで生成しました。`)
    } catch (error) {
      if (printRequest.current !== request) return
      setPrintState('error')
      const message = error instanceof Error ? error.message : ''
      setPrintStatus(message.includes('print layout does not fit') ? `部品のいずれかが${selectedPlate.label}のプレートに収まりません。取り出し回数や本数を減らすか、大きいプレートを選んでください。` : message || '3MFファイルを生成できませんでした。')
    }
  }

  const isPrintPreview = showPrintPreview && printArtifact !== null
  const printPreviewPlate = isPrintPreview ? printArtifact.plates[previewPlateIndex] : null
  const displayMeshes: Partial<Record<ModelPart, TriangleMesh>> | null = printPreviewPlate ? printPreviewPlate.previewMeshes : preview?.partMeshes ?? model?.partMeshes ?? null
  const displayDimensions = isPrintPreview ? null : preview?.dimensions ?? model?.dimensions ?? dimensions
  const shownDimensions = !isPrintPreview && previewMode === '2d' ? dimensions : displayDimensions

  return <main className="app-shell">
    <header className="tool-header">
      <div><a className="tool-title" href={import.meta.env.BASE_URL}>ねじカウンター生成器</a><p>印刷用STLと組立用STEPをこのブラウザ内で生成します。</p></div>
      <nav className="header-links" aria-label="関連リンク">
        <a href="https://github.com/cormoran/screw-counter-builder" target="_blank" rel="noreferrer">GitHub</a>
        <a href="https://github.com/cormoran" target="_blank" rel="noreferrer">GitHub @cormoran</a>
        <span>created by <a href="https://x.com/cormoran707" target="_blank" rel="noreferrer">@cormoran707</a></span>
      </nav>
    </header>
    <div className="tool-layout">
      <section className="panel form-panel" aria-labelledby="settings-title">
        <div className="section-heading"><h2 id="settings-title">設定</h2><span>基本</span></div>
        {displayMeshes && !isPrintPreview && previewMode !== '2d' && <div className="settings-mini-preview"><DimensionPreview dimensions={displayDimensions} compact /></div>}
        <SettingsForm fields={SETTINGS_FIELDS.filter((field) => field.category === 'basic')} settings={settings} onChange={update} />
        <button className="details-button" type="button" aria-expanded={advanced} onClick={() => setAdvanced((value) => !value)}>
          {advanced ? '詳細設定を隠す' : '詳細設定'} <span aria-hidden="true">⌄</span>
        </button>
        {advanced && <div className="advanced"><div className="settings-categories">
          {SETTINGS_CATEGORIES.filter((category) => category.id !== 'basic').map((category) => <section className="settings-category" key={category.id} aria-labelledby={`settings-category-${category.id}`}>
            <div className="category-heading"><h3 id={`settings-category-${category.id}`}>{category.label}</h3><p>{category.description}</p></div>
            <SettingsForm fields={SETTINGS_FIELDS.filter((field) => field.category === category.id)} settings={settings} onChange={update} />
          </section>)}
        </div></div>}
      </section>
      <aside className="side-column">
        <section className="panel preview-panel" aria-labelledby="preview-title">
          <div className="section-heading"><h2 id="preview-title">プレビュー</h2><span>{isPrintPreview ? '印刷プレート' : previewMode === '2d' || !displayMeshes ? '2D' : '3D'}</span></div>
          <div className="preview-controls">
            <label className="preview-toggle"><input type="checkbox" checked={realtimePreview} onChange={(event) => { setRealtimePreview(event.target.checked); if (!event.target.checked) { previewGeneration.current?.abort(); setPreviewState('idle'); setPreviewStatus('リアルタイムプレビューはオフです。') } }} />リアルタイムプレビュー</label>
            {printArtifact && <button className="preview-mode-button" type="button" onClick={() => setShowPrintPreview((value) => !value)}>{isPrintPreview ? '組立プレビューに戻る' : '印刷プレビューを表示'}</button>}
            {(!realtimePreview || previewState !== 'idle') && <p className={`preview-status ${previewState}`} role="status" aria-live="polite">{previewState === 'generating' && <span className="spinner" aria-hidden="true" />}{previewStatus}</p>}
          </div>
          {!isPrintPreview && <div className="viewer-toolbar" role="group" aria-label="プレビュー表示モード">
            <button className={previewMode === 'assembled' ? 'selected' : ''} type="button" onClick={() => setPreviewMode('assembled')} aria-pressed={previewMode === 'assembled'}>完成</button>
            <button className={previewMode === 'exploded' ? 'selected' : ''} type="button" onClick={() => setPreviewMode('exploded')} aria-pressed={previewMode === 'exploded'}>パーツ分離</button>
            <button className={previewMode === '2d' ? 'selected' : ''} type="button" onClick={() => setPreviewMode('2d')} aria-pressed={previewMode === '2d'}>2D</button>
          </div>}
          {isPrintPreview && printArtifact.plates.length > 1 && <div className="plate-tabs" role="group" aria-label="印刷プレートを選択">{printArtifact.plates.map((plate, index) => <button key={index} type="button" aria-pressed={previewPlateIndex === index} className={previewPlateIndex === index ? 'selected' : ''} onClick={() => setPreviewPlateIndex(index)}>プレート {index + 1} <span>{plate.placements.length}部品</span></button>)}</div>}
          {displayMeshes ? <Suspense fallback={<div className="preview-empty">3Dプレビューを準備しています…</div>}><ModelViewer meshes={displayMeshes} dimensions={isPrintPreview ? null : previewMode === '2d' ? dimensions : displayDimensions} mode={printPreviewPlate ? 'assembled' : previewMode} cameraState={printPreviewPlate ? printCamera : assemblyCamera} {...(printPreviewPlate ? { printPlateSize: { width: printPreviewPlate.width, depth: printPreviewPlate.depth } } : {})} /></Suspense> : <DimensionPreview dimensions={dimensions} />}
          {shownDimensions && <dl className="dimensions">
            <div><dt>外形</dt><dd>{fmt(shownDimensions.length)} × {fmt(shownDimensions.width)} × {fmt(shownDimensions.top)} mm</dd></div>
            <div><dt>ピッチ</dt><dd>{fmt(shownDimensions.pitch)} mm</dd></div>
            <div><dt>収容本数</dt><dd>{shownDimensions.screwXs.length * shownDimensions.screwYs.length} 本</dd></div>
          </dl>}
        </section>
        <section className="panel generate-panel" aria-labelledby="generate-title">
          <div className="section-heading"><h2 id="generate-title">出力</h2></div>
          {validation.length > 0 && <div className="validation" role="alert"><strong>設定を修正してください</strong><ul>{validation.map((message) => <li key={message}>{message}</li>)}</ul></div>}
          <p className={`status ${state}`} role="status" aria-live="polite">{state === 'generating' && <span className="spinner" aria-hidden="true" />}{status}</p>
          <button className="generate-button" type="button" disabled={state === 'generating' || validation.length > 0} onClick={requestGeneration}>
            {state === 'generating' ? 'モデルを生成中…' : 'モデルを生成'}
          </button>
          {state === 'generating' && <button className="details-button" type="button" onClick={() => generation.current?.abort()}>生成を中止</button>}
          {model && <DownloadArea model={model} settings={settings} />}
          <div className="print-3mf">
            <h3>Bambu Studio 用3MF</h3>
            <p>4部品を選択したプレートへ印刷向きで配置します。Bambu Studioで機種・材料・印刷条件を選んでスライスしてください。組立時はスライダーをベースへ上から載せ、その後トレーを固定します。</p>
            <label className="plate-select" htmlFor="print-plate-size"><span>プレートサイズ</span><select id="print-plate-size" value={selectedPlateId} disabled={printState === 'generating'} onChange={(event) => selectPrintPlate(event.target.value as PrintPlateOption['id'])}>{PRINT_PLATE_OPTIONS.map((plate) => <option key={plate.id} value={plate.id}>{plate.label}（{plate.printers}）</option>)}</select></label>
            <button className="zip-button" type="button" disabled={state === 'generating' || printState === 'generating' || validation.length > 0} onClick={requestPrint3mf}>{printState === 'generating' ? '3MFを生成中…' : '3MFを生成してプレビュー'}</button>
            {printStatus && <p className={`print-status ${printState}`} role="status" aria-live="polite">{printState === 'generating' && <span className="spinner" aria-hidden="true" />}{printStatus}</p>}
            {printArtifact && <button className="download-3mf" type="button" onClick={() => download(printArtifact.file, `ScrewCounter_${settings.screw.replace('.', 'p')}_${settings.rows}x${settings.columns}_Bambu.3mf`)}>3MFをダウンロード <span>↓</span></button>}
          </div>
        </section>
      </aside>
    </div>
    <footer><p>プリセットのねじ寸法は規格保証値ではありません。実物を測定し、印刷条件と実機での動作を確認してください。</p></footer>
    {pendingTransfer && <DataConfirmation pending={pendingTransfer} onCancel={() => setPendingTransfer(null)} onContinue={() => { const action = pendingTransfer.action; setPendingTransfer(null); action() }} />}
  </main>
}

function DownloadArea({ model, settings }: { model: GeneratedModel; settings: Settings }) {
  const prefix = `ScrewCounter_${settings.screw.replace('.', 'p')}_${settings.rows}x${settings.columns}`
  const visibleWarnings = model.warnings
  async function downloadAll() {
    const zip = new JSZip()
    Object.entries(model.files).forEach(([name, file]) => zip.file(`${prefix}_${name}`, file))
    download(await zip.generateAsync({ type: 'blob' }), `${prefix}.zip`)
  }
  return <div className="downloads" aria-label="生成ファイルのダウンロード">
    <button type="button" className="zip-button" onClick={() => void downloadAll()}>ZIPで一括ダウンロード</button>
    <div className="file-list">{PART_FILES.map(([file, label]) => model.files[file] && <button type="button" key={file} onClick={() => download(model.files[file], `${prefix}_${file}`)}>{label}<span>↓</span></button>)}</div>
    {visibleWarnings.length > 0 && <div className="warnings"><strong>確認事項</strong><ul>{visibleWarnings.map((warning) => <li key={warning}>{localizeWarning(warning)}</li>)}</ul></div>}
  </div>
}

function DataConfirmation({ pending, onCancel, onContinue }: { pending: PendingTransfer; onCancel: () => void; onContinue: () => void }) {
  return <div className="data-dialog-backdrop" role="presentation"><section className="data-dialog" role="alertdialog" aria-modal="true" aria-labelledby="data-dialog-title" aria-describedby="data-dialog-detail">
    <h2 id="data-dialog-title">通信量の確認</h2><p id="data-dialog-detail">{pending.detail}</p><p>現在の回線では通信量を抑える設定またはモバイル回線が検出されました。{pending.label}を続けますか？</p>
    <div><button type="button" className="dialog-cancel" autoFocus onClick={onCancel}>キャンセル</button><button type="button" className="dialog-confirm" onClick={onContinue}>続ける</button></div>
  </section></div>
}

function download(file: Blob, name: string) {
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function phaseLabel(phase: string) {
  return ({ initializing: 'CADエンジンを準備しています…', building: '形状を作成しています…', validating: '形状を検証しています…', exporting: 'ファイルを書き出しています…' } as Record<string, string>)[phase] ?? 'モデルを生成しています…'
}

function localizeProgress(message?: string) {
  if (!message) return undefined
  const translations: Record<string, string> = {
    'Loading the CAD engine…': 'CADエンジンを準備しています…',
    'Building parts…': '部品を作成しています…',
    'Built base': 'ベースを作成しました。',
    'Built tray': 'トレーを作成しました。',
    'Built slider': 'スライダーを作成しました。',
    'Built lid': 'ふたを作成しました。',
    'Preparing export metadata…': '出力データを準備しています…',
    'Exports are ready.': '出力データを準備しました。',
  }
  return translations[message] ?? message
}

function localizeWarning(message: string) {
  return message
}

function fmt(value: number) { return new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 }).format(value) }
function formatBytes(value: number) { return new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 }).format(value / 1024 / 1024) + ' MB' }
function localizeValidation(message: string) {
  const translations: Record<string, string> = {
    'rows and columns must be positive integers within 12 × 24': '1回に出す本数は1〜12本、取り出し回数は1〜24回の整数にしてください。',
    'screw must be M1.5, M2 or M3': '対象のねじはM1.5、M2、M3から選んでください。',
    'joint must be screws or glue': '接合方法を選び直してください。',
    'lidAlignment must be magnets or pegs': 'ふたの位置合わせ方法を選び直してください。',
    'Supported magnet diameter is 3..8 mm': '磁石の直径は3〜8 mmにしてください。',
    'Supported magnet thickness is 1..3 mm': '磁石の厚みは1〜3 mmにしてください。',
    'slideClearance must be 0.15..0.6 mm': 'スライドのクリアランスは0.15〜0.6 mmにしてください。',
    'trayHoleClearance must be 0.1..1.2 mm': 'トレー穴の径クリアランスは0.1〜1.2 mmにしてください。',
    'screwSpaceHeight must be 3.5..30 mm': 'ねじ収納スペースの高さは3.5〜30 mmにしてください。',
    'Magnet clearance is outside the supported range': '磁石穴のクリアランスが対応範囲を外れています。',
    'detentSpringWidth must be 1.0..1.5 mm': 'ばね幅は1.0〜1.5 mmにしてください。',
    'detentSpringLength must be 6..18 mm': 'ばね長さは6〜18 mmにしてください。',
    'detentDiameter must be 2.0..3.2 mm': 'クリックの凹凸径は2.0〜3.2 mmにしてください。',
    'Need shaft + 0.3 <= slot <= head - 0.6; measure the actual screw': '軸径 + 0.3 mm ≤ スロット幅 ≤ 頭径 − 0.6 mm となるよう、実物のねじを測ってください。',
    'All numeric settings must be finite numbers': '数値欄には有限の値を入力してください。',
    'Pitch needs >= window + 1.8 mm for separated batches': 'ピッチをねじ頭の窓幅より1.8 mm以上大きくしてください。',
    'Need at least 0.5 mm between the corner screw and magnet pocket; increase screw space height or use a thinner magnet': '四隅のねじと磁石穴の間隔を0.5 mm以上にしてください。ねじ収納スペースの高さを増やすか、薄い磁石を選んでください。',
  }
  return translations[message] ?? message
}
