import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import JSZip from 'jszip'
import { DEFAULT_PREVIEW_CONFIRM_BYTES, DEFAULT_SETTINGS, deriveDimensions, generateModel, generatePreviewModel, getDefaultPreviewInfo, loadDefaultPreview, validateSettings, type GeneratedModel, type ModelPart, type PreviewModel, type Settings, type TriangleMesh } from './cad'
import { createBambu3mf, type Print3mfArtifact } from './print3mf'
import { DimensionPreview } from './components/DimensionPreview'
import { SettingsForm } from './components/SettingsForm'
import { SETTINGS_FIELDS } from './settings-schema'
import { currentConnectionNeedsConfirmation } from './network'

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
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [advanced, setAdvanced] = useState(false)
  const [state, setState] = useState<State>('ready')
  const [status, setStatus] = useState('設定を確認してから「モデルを生成」を選んでください。')
  const [model, setModel] = useState<GeneratedModel | null>(null)
  const [preview, setPreview] = useState<PreviewModel | null>(null)
  const [previewState, setPreviewState] = useState<PreviewState>('idle')
  const [previewStatus, setPreviewStatus] = useState('事前生成プレビューを読み込んでいます…')
  const [realtimePreview, setRealtimePreview] = useState(true)
  const [printArtifact, setPrintArtifact] = useState<Print3mfArtifact | null>(null)
  const [showPrintPreview, setShowPrintPreview] = useState(false)
  const [printState, setPrintState] = useState<PrintState>('ready')
  const [printStatus, setPrintStatus] = useState('')
  const [pendingTransfer, setPendingTransfer] = useState<PendingTransfer | null>(null)
  const generation = useRef<AbortController | null>(null)
  const previewGeneration = useRef<AbortController | null>(null)
  const printRequest = useRef(0)
  const [previewRetry, setPreviewRetry] = useState(0)
  const wasmApproved = useRef(false)
  const previewApproved = useRef(false)
  const hasEditedSettings = useRef(false)
  const validation = useMemo(() => validateSettings(settings).map(localizeValidation), [settings])
  const dimensions = useMemo(() => validation.length === 0 ? deriveDimensions(settings) : null, [settings, validation])

  function update(key: keyof Settings, value: Settings[keyof Settings]) {
    hasEditedSettings.current = true
    generation.current?.abort()
    previewGeneration.current?.abort()
    printRequest.current += 1
    setSettings((current) => ({ ...current, [key]: value }))
    setModel(null)
    if (!realtimePreview) {
      setPreview(null)
      setPreviewStatus('リアルタイムプレビューはオフです。')
    } else {
      setPreviewState('generating')
      setPreviewStatus('設定の変更をプレビューに反映しています…')
    }
    setPrintArtifact(null)
    setShowPrintPreview(false)
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
  }, [previewRetry, realtimePreview, settings, validation.length])

  async function loadInitialPreview() {
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
      const artifact = await createBambu3mf(source)
      if (printRequest.current !== request) return
      setPrintArtifact(artifact)
      setShowPrintPreview(true)
      setPrintState('ready')
      setPrintStatus('Bambu Studioで開ける3MFプレビューを生成しました。')
    } catch (error) {
      if (printRequest.current !== request) return
      setPrintState('error')
      const message = error instanceof Error ? error.message : ''
      setPrintStatus(message.includes('print layout does not fit') ? '4部品の配置が256 × 256 mmのプレートに収まりません。取り出し回数や本数を減らしてください。' : message || '3MFファイルを生成できませんでした。')
    }
  }

  const isPrintPreview = showPrintPreview && printArtifact !== null
  const displayMeshes: Record<ModelPart, TriangleMesh> | null = isPrintPreview ? printArtifact.previewMeshes : preview?.partMeshes ?? model?.partMeshes ?? null
  const displayDimensions = isPrintPreview ? null : dimensions

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
        <SettingsForm fields={SETTINGS_FIELDS.filter((field) => field.group === 'basic')} settings={settings} onChange={update} />
        <button className="details-button" type="button" aria-expanded={advanced} onClick={() => setAdvanced((value) => !value)}>
          {advanced ? '詳細設定を隠す' : '詳細設定'} <span aria-hidden="true">⌄</span>
        </button>
        {advanced && <div className="advanced"><div className="section-heading"><h2>詳細設定</h2><span>実測値・クリアランス</span></div>
          <SettingsForm fields={SETTINGS_FIELDS.filter((field) => field.group === 'detail')} settings={settings} onChange={update} />
        </div>}
      </section>
      <aside className="side-column">
        <section className="panel preview-panel" aria-labelledby="preview-title">
          <div className="section-heading"><h2 id="preview-title">プレビュー</h2><span>{isPrintPreview ? '印刷プレート' : displayMeshes ? '3D' : '寸法・上面'}</span></div>
          <div className="preview-controls">
            <label className="preview-toggle"><input type="checkbox" checked={realtimePreview} onChange={(event) => { setRealtimePreview(event.target.checked); if (!event.target.checked) { previewGeneration.current?.abort(); setPreviewState('idle'); setPreviewStatus('リアルタイムプレビューはオフです。') } }} />リアルタイムプレビュー</label>
            {printArtifact && <button className="preview-mode-button" type="button" onClick={() => setShowPrintPreview((value) => !value)}>{isPrintPreview ? '組立プレビューに戻る' : '印刷プレビューを表示'}</button>}
            {(!realtimePreview || previewState !== 'idle') && <p className={`preview-status ${previewState}`} role="status" aria-live="polite">{previewState === 'generating' && <span className="spinner" aria-hidden="true" />}{previewStatus}</p>}
          </div>
          {displayMeshes ? <Suspense fallback={<div className="preview-empty">3Dプレビューを準備しています…</div>}><ModelViewer meshes={displayMeshes} {...(isPrintPreview ? { printPlateSize: printArtifact.plateSize } : {})} /></Suspense> : <DimensionPreview dimensions={dimensions} />}
          {displayDimensions && <dl className="dimensions">
            <div><dt>外形</dt><dd>{fmt(displayDimensions.length)} × {fmt(displayDimensions.width)} × {fmt(displayDimensions.top)} mm</dd></div>
            <div><dt>ピッチ</dt><dd>{fmt(displayDimensions.pitch)} mm</dd></div>
            <div><dt>収容本数</dt><dd>{settings.rows * settings.columns} 本</dd></div>
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
            <p>4部品を256 mmプレートに印刷向きで配置します。Bambu Studioで機種・材料・印刷条件を選んでスライスしてください。</p>
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
  const visibleWarnings = model.warnings.filter((warning) => warning !== 'Browser CAD output has not been compared against the Python B-Rep baseline or physically print-tested.')
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
  if (message === 'Browser CAD output has not been compared against the Python B-Rep baseline or physically print-tested.') {
    return 'Python版のB-Repとの詳細比較と、印刷・実機での確認は未実施です。'
  }
  return message
}

function fmt(value: number) { return new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 }).format(value) }
function formatBytes(value: number) { return new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 }).format(value / 1024 / 1024) + ' MB' }
function localizeValidation(message: string) {
  const translations: Record<string, string> = {
    'rows and columns must be positive integers within 12 × 24': '1回に出す本数は1〜12本、取り出し回数は1〜24回の整数にしてください。',
    'screw must be M1.5, M2 or M3': '対象のねじはM1.5、M2、M3から選んでください。',
    'joint must be screws or glue': '接合方法を選び直してください。',
    'Supported magnet diameter is 3..8 mm': '磁石の直径は3〜8 mmにしてください。',
    'Supported magnet thickness is 1..3 mm': '磁石の厚みは1〜3 mmにしてください。',
    'slideClearance must be 0.15..0.6 mm': 'スライドのクリアランスは0.15〜0.6 mmにしてください。',
    'screwSpaceHeight must be 3.5..30 mm': 'ねじ収納スペースの高さは3.5〜30 mmにしてください。',
    'Magnet clearance is outside the supported range': '磁石穴のクリアランスが対応範囲を外れています。',
    'detentSpringWidth must be 1.0..1.5 mm': 'ばね幅は1.0〜1.5 mmにしてください。',
    'Need shaft + 0.3 <= slot <= head - 0.6; measure the actual screw': '軸径 + 0.3 mm ≤ スロット幅 ≤ 頭径 − 0.6 mm となるよう、実物のねじを測ってください。',
    'All numeric settings must be finite numbers': '数値欄には有限の値を入力してください。',
    'Pitch needs >= window + 1.8 mm for separated batches': 'ピッチをねじ頭の窓幅より1.8 mm以上大きくしてください。',
  }
  return translations[message] ?? message
}
