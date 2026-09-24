import { PreviewMeshCache } from './cad/preview-mesh-cache'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import JSZip from 'jszip'
import { DEFAULT_PREVIEW_CONFIRM_BYTES, DEFAULT_SETTINGS, deriveDimensions, generateModel, generatePreviewModel, getDefaultPreviewInfo, loadDefaultPreview, validateSettings, type GeneratedModel, type ModelPart, type ProgressivePreview, type Settings, type TriangleMesh } from './cad'
import { createBambu3mf, type Print3mfArtifact } from './print3mf'
import { DimensionPreview } from './components/DimensionPreview'
import type { ViewMode, ViewerCameraState } from './components/ModelViewer'
import { SettingsForm } from './components/SettingsForm'
import { differsFromDefaults, loadRealtimePreview, loadSettings, loadViewMode, saveRealtimePreview, saveSettings, saveViewMode } from './settings-session'
import { PRINT_PLATE_OPTIONS, getSettingsCategories, getSettingsFields, type PrintPlateOption } from './settings-schema'
import { currentConnectionNeedsConfirmation, currentConnectionNeedsLargeDownloadConfirmation } from './network'
import { createSettingsFile, parseSettingsFile } from './settings-transfer'
import { LANGUAGE_OPTIONS, formatNumber, loadLanguage, localizeProgress, localizeValidation, saveLanguage, text, type Language } from './i18n'
import './styles/preview.css'

type State = 'ready' | 'generating' | 'complete' | 'error'
type PreviewState = 'idle' | 'generating' | 'error'
type PrintState = 'ready' | 'generating' | 'error'
type PendingTransfer = { label: string; detail: string; action: () => void }
const ModelViewer = lazy(() => import('./components/ModelViewer').then((module) => ({ default: module.ModelViewer })))
const buildCommitDate = new Date(__BUILD_COMMIT_DATE__)

const PART_FILES = [['assembly.step', 'assemblyFile'], ['base.stl', 'baseFile'], ['tray.stl', 'trayFile'], ['slider.stl', 'sliderFile'], ['lid.stl', 'lidFile'], ['funnel.stl', 'funnelFile'], ['dimensions.json', 'dimensionsFile']] as const

export default function App() {
  const [language, setLanguage] = useState<Language>(loadLanguage)
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [advanced, setAdvanced] = useState(false)
  const [selectedPlateId, setSelectedPlateId] = useState<PrintPlateOption['id']>('standard')
  const [state, setState] = useState<State>('ready')
  const [status, setStatus] = useState(() => text(language, 'initialStatus'))
  const [model, setModel] = useState<GeneratedModel | null>(null)
  const [preview, setPreview] = useState<ProgressivePreview | null>(null)
  const [previewState, setPreviewState] = useState<PreviewState>('idle')
  const [previewStatus, setPreviewStatus] = useState(() => text(language, 'loadingDefaultPreview'))
  const [realtimePreview, setRealtimePreview] = useState(loadRealtimePreview)
  const [printArtifact, setPrintArtifact] = useState<Print3mfArtifact | null>(null)
  const [showPrintPreview, setShowPrintPreview] = useState(false)
  const [previewMode, setPreviewMode] = useState<ViewMode>(loadViewMode)
  const [previewPlateIndex, setPreviewPlateIndex] = useState(0)
  const [printState, setPrintState] = useState<PrintState>('ready')
  const [printStatus, setPrintStatus] = useState('')
  const [pendingTransfer, setPendingTransfer] = useState<PendingTransfer | null>(null)
  const generation = useRef<AbortController | null>(null)
  const settingsFileInput = useRef<HTMLInputElement>(null)
  const previewCache = useRef(new PreviewMeshCache())
  const previewGeneration = useRef<AbortController | null>(null)
  const printRequest = useRef(0)
  const [previewRetry, setPreviewRetry] = useState(0)
  const [previewViewReset, setPreviewViewReset] = useState(0)
  const wasmApproved = useRef(false)
  const previewApproved = useRef(false)
  const hasEditedSettings = useRef(differsFromDefaults(settings))
  const assemblyCamera = useRef<ViewerCameraState | null>(null)
  const printCamera = useRef<ViewerCameraState | null>(null)
  const validation = useMemo(() => validateSettings(settings).map((message) => localizeValidation(language, message)), [language, settings])
  const dimensions = useMemo(() => validation.length === 0 ? deriveDimensions(settings) : null, [settings, validation])
  const selectedPlate = useMemo(() => PRINT_PLATE_OPTIONS.find((plate) => plate.id === selectedPlateId)!, [selectedPlateId])
  const settingsFields = useMemo(() => getSettingsFields(language), [language])
  const settingsCategories = useMemo(() => getSettingsCategories(language), [language])

  useEffect(() => { saveViewMode(previewMode) }, [previewMode])
  useEffect(() => { saveRealtimePreview(realtimePreview) }, [realtimePreview])
  useEffect(() => {
    document.documentElement.lang = language
    document.title = text(language, 'appTitle')
    if (state === 'ready') setStatus(text(language, 'initialStatus'))
    if (previewState === 'idle' && !hasEditedSettings.current) setPreviewStatus(text(language, 'loadingDefaultPreview'))
  }, [language])

  function changeLanguage(next: Language) {
    saveLanguage(next)
    setLanguage(next)
  }

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
      setPreviewStatus(!realtimePreview ? text(language, 'realtimeOff') : text(language, 'twoDimensionalUpdated'))
    } else {
      setPreviewState('generating')
      setPreviewStatus(text(language, 'applyingPreview'))
    }
    setPrintArtifact(null)
    setShowPrintPreview(false)
    setPreviewPlateIndex(0)
    setPrintState('ready')
    setState('ready')
  }

  function resetSettings() {
    const defaults = { ...DEFAULT_SETTINGS }
    hasEditedSettings.current = false
    saveSettings(defaults)
    generation.current?.abort()
    previewGeneration.current?.abort()
    printRequest.current += 1
    setSettings(defaults)
    setModel(null)
    setPreview(null)
    setPreviewState('idle')
    setPreviewStatus(text(language, 'loadingDefaultPreview'))
    setPrintArtifact(null)
    setShowPrintPreview(false)
    setPreviewPlateIndex(0)
    setPrintState('ready')
    setPrintStatus('')
    setState('ready')
    setStatus(text(language, 'settingsReset'))
    setPendingTransfer(null)
    void loadInitialPreview()
  }

  async function importSettingsFile(file: File | undefined) {
    if (!file) return
    try {
      const imported = parseSettingsFile(await file.text())
      saveSettings(imported)
      hasEditedSettings.current = differsFromDefaults(imported)
      generation.current?.abort()
      previewGeneration.current?.abort()
      printRequest.current += 1
      setSettings(imported)
      setModel(null)
      setPreview(null)
      setPreviewState('idle')
      setPreviewStatus(text(language, 'loadingDefaultPreview'))
      setPrintArtifact(null)
      setShowPrintPreview(false)
      setPreviewPlateIndex(0)
      setPrintState('ready')
      setPrintStatus('')
      setState('ready')
      setStatus(text(language, 'settingsImported'))
      if (realtimePreview && previewMode !== '2d') setPreviewState('generating')
    } catch {
      setStatus(text(language, 'settingsImportFailed'))
    } finally {
      if (settingsFileInput.current) settingsFileInput.current.value = ''
    }
  }

  function resetPreviewDisplay() {
    assemblyCamera.current = null
    printCamera.current = null
    setPreviewViewReset((value) => value + 1)
  }

  useEffect(() => {
    void loadInitialPreview()
  }, [])

  useEffect(() => {
    if (!hasEditedSettings.current) return
    if (validation.length > 0) {
      setPreviewState('idle')
      setPreviewStatus(text(language, 'fixInputToPreview'))
      return
    }
    if (!realtimePreview) {
      setPreviewState('idle')
      setPreviewStatus(text(language, 'realtimeOff'))
      return
    }
    if (previewMode === '2d') {
      setPreviewState('idle')
      setPreviewStatus(text(language, 'twoDimensionalUpdated'))
      return
    }
    const controller = new AbortController()
    previewGeneration.current?.abort()
    previewGeneration.current = controller
    setPreviewState('generating')
    setPreviewStatus(text(language, 'applyingPreview'))
    const timeout = window.setTimeout(() => {
      if (currentConnectionNeedsConfirmation() && !wasmApproved.current) {
        setPreviewState('idle')
        setPreviewStatus(text(language, 'waitingRealtime'))
        setPendingTransfer({ label: text(language, 'downloadCadEngine'), detail: text(language, 'cadEngineDetail'), action: () => { wasmApproved.current = true; setPreviewRetry((value) => value + 1) } })
        return
      }
      const nextDimensions = deriveDimensions(settings)
      const readyMeshes = previewCache.current.match(settings, nextDimensions)
      setPreview({ dimensions: nextDimensions, partMeshes: { ...readyMeshes } })
      void generatePreviewModel(settings, {
        onPart: ({ part, mesh, dimensions }) => {
          if (controller.signal.aborted || previewGeneration.current !== controller) return
          previewCache.current.remember(settings, dimensions, { [part]: mesh })
          readyMeshes[part] = mesh
          setPreview({ dimensions, partMeshes: { ...readyMeshes } })
        },
        signal: controller.signal,
        onProgress: (progress) => setPreviewStatus(localizeProgress(language, progress.message) ?? text(language, 'generatingPreview')),
      }).then((generated) => {
        if (previewGeneration.current !== controller) return
        previewCache.current.remember(settings, generated.dimensions, generated.partMeshes)
        setPreview(generated)
        setPreviewState('idle')
        setPreviewStatus(text(language, 'previewUpdated'))
      }).catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        if (previewGeneration.current !== controller) return
        setPreviewState('error')
        setPreviewStatus(error instanceof Error ? error.message : text(language, 'cannotGeneratePreview'))
      })
    }, 700)
    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [language, previewRetry, previewMode, realtimePreview, settings, validation.length])

  async function loadInitialPreview() {
    if (hasEditedSettings.current) return
    try {
      const info = await getDefaultPreviewInfo()
      if (currentConnectionNeedsConfirmation() && info.rawBytes > DEFAULT_PREVIEW_CONFIRM_BYTES && !previewApproved.current) {
        setPreviewStatus(text(language, 'waitingDefaultPreview'))
        setPendingTransfer({ label: text(language, 'downloadDefaultPreview'), detail: text(language, 'defaultPreviewDetail', { compressed: formatBytes(language, info.gzipBytes), raw: formatBytes(language, info.rawBytes) }), action: () => { previewApproved.current = true; void loadInitialPreview() } })
        return
      }
      const partMeshes = await loadDefaultPreview()
      if (hasEditedSettings.current) return
      const defaultDimensions = deriveDimensions(DEFAULT_SETTINGS)
      previewCache.current.remember(DEFAULT_SETTINGS, defaultDimensions, partMeshes)
      setPreview({ dimensions: defaultDimensions, partMeshes })
      setPreviewState('idle')
      setPreviewStatus(text(language, 'showingDefaultPreview'))
    } catch (error) {
      setPreviewState('error')
      setPreviewStatus(error instanceof Error ? error.message : text(language, 'cannotLoadDefaultPreview'))
    }
  }

  function requestGeneration() {
    if (currentConnectionNeedsConfirmation() && !wasmApproved.current) {
      setPendingTransfer({ label: text(language, 'downloadCadEngine'), detail: text(language, 'cadEngineDetail'), action: () => { wasmApproved.current = true; void build() } })
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
    setStatus(text(language, 'preparingCad'))
    try {
      const nextDimensions = deriveDimensions(settings)
      const readyMeshes = previewCache.current.match(settings, nextDimensions)
      setPreview({ dimensions: nextDimensions, partMeshes: { ...readyMeshes } })
      const generated = await generateModel(settings, {
        onPart: ({ part, mesh, dimensions }) => {
          if (controller.signal.aborted || generation.current !== controller) return
          previewCache.current.remember(settings, dimensions, { [part]: mesh })
          readyMeshes[part] = mesh
          setPreview({ dimensions, partMeshes: { ...readyMeshes } })
        },
        signal: controller.signal,
        onProgress: (progress) => setStatus(localizeProgress(language, progress.message) ?? phaseLabel(language, progress.phase)),
      })
      if (generation.current !== controller) return null
      setModel(generated)
      previewCache.current.remember(settings, generated.dimensions, generated.partMeshes)
      setPreview({ dimensions: generated.dimensions, partMeshes: generated.partMeshes })
      setState('complete')
      setStatus(text(language, 'modelGenerated'))
      return generated
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setState('ready')
        setStatus(text(language, 'generationCancelled'))
      } else {
        setState('error')
        setStatus(error instanceof Error ? error.message : text(language, 'cannotGenerateModel'))
      }
      return null
    } finally {
      generation.current = null
    }
  }

  function requestPrint3mf() {
    if (!model && currentConnectionNeedsConfirmation() && !wasmApproved.current) {
      setPendingTransfer({ label: text(language, 'downloadCadEngine'), detail: text(language, 'cadEngineDetail'), action: () => { wasmApproved.current = true; void buildPrint3mf() } })
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
    setPrintStatus(model ? text(language, 'generating3mfFile') : text(language, 'generatingModelForPrint'))
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
      setPrintStatus(text(language, 'generated3mf', { count: artifact.plates.length }))
    } catch (error) {
      if (printRequest.current !== request) return
      setPrintState('error')
      const message = error instanceof Error ? error.message : ''
      setPrintStatus(message.includes('print layout does not fit') ? text(language, 'plateDoesNotFit', { plate: selectedPlate.label }) : message || text(language, 'cannotGenerate3mf'))
    }
  }

  const isPrintPreview = showPrintPreview && printArtifact !== null
  const printPreviewPlate = isPrintPreview ? printArtifact.plates[previewPlateIndex] : null
  const displayMeshes: Partial<Record<ModelPart, TriangleMesh>> | null = printPreviewPlate ? printPreviewPlate.previewMeshes : preview?.partMeshes ?? model?.partMeshes ?? null
  const displayDimensions = isPrintPreview ? null : preview?.dimensions ?? model?.dimensions ?? dimensions
  const shownDimensions = !isPrintPreview && previewMode === '2d' ? dimensions : displayDimensions

  return <main className="app-shell">
    <header className="tool-header">
      <div><a className="tool-title" href={import.meta.env.BASE_URL}>{text(language, 'appTitle')}</a><p>{text(language, 'appDescription')}</p></div>
      <nav className="header-links" aria-label={text(language, 'relatedLinks')}>
        <a href="https://github.com/cormoran/screw-counter-builder" target="_blank" rel="noreferrer">GitHub</a>
        <a href="https://github.com/cormoran" target="_blank" rel="noreferrer">GitHub @cormoran</a>
        <span>created by <a href="https://x.com/cormoran707" target="_blank" rel="noreferrer">@cormoran707</a></span>
        <label className="language-select"><span>{text(language, 'language')}</span><select value={language} onChange={(event) => changeLanguage(event.target.value as Language)}>{LANGUAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      </nav>
    </header>
    <div className="tool-layout">
      <section className="panel form-panel" aria-labelledby="settings-title">
        <div className="section-heading settings-heading"><div><h2 id="settings-title">{text(language, 'settings')}</h2><span>{text(language, 'basic')}</span></div><div className="settings-actions"><button className="reset-button" type="button" onClick={() => settingsFileInput.current?.click()}>{text(language, 'importSettings')}</button><input ref={settingsFileInput} type="file" accept=".json,application/json" hidden onChange={(event) => void importSettingsFile(event.currentTarget.files?.[0])} /><button className="reset-button" type="button" disabled={!differsFromDefaults(settings)} onClick={resetSettings}>{text(language, 'resetSettings')}</button></div></div>
        {displayMeshes && !isPrintPreview && previewMode !== '2d' && <div className="settings-mini-preview"><DimensionPreview dimensions={displayDimensions} language={language} /></div>}
        <SettingsForm fields={settingsFields.filter((field) => field.category === 'basic')} settings={settings} onChange={update} />
        <button className="details-button" type="button" aria-expanded={advanced} onClick={() => setAdvanced((value) => !value)}>
          {advanced ? text(language, 'hideAdvanced') : text(language, 'showAdvanced')} <span aria-hidden="true">⌄</span>
        </button>
        {advanced && <div className="advanced"><div className="settings-categories">
          {settingsCategories.filter((category) => category.id !== 'basic').map((category) => <section className="settings-category" key={category.id} aria-labelledby={`settings-category-${category.id}`}>
            <div className="category-heading"><h3 id={`settings-category-${category.id}`}>{category.label}</h3><p>{category.description}</p></div>
            <SettingsForm fields={settingsFields.filter((field) => field.category === category.id)} settings={settings} onChange={update} />
          </section>)}
        </div></div>}
      </section>
      <aside className="side-column">
        <section className="panel preview-panel" aria-labelledby="preview-title">
          <div className="section-heading"><h2 id="preview-title">{text(language, 'preview')}</h2><span>{isPrintPreview ? text(language, 'printPlate') : previewMode === '2d' || !displayMeshes ? '2D' : '3D'}</span></div>
          <div className="preview-controls">
            <label className="preview-toggle"><input type="checkbox" checked={realtimePreview} onChange={(event) => { setRealtimePreview(event.target.checked); if (!event.target.checked) { previewGeneration.current?.abort(); setPreviewState('idle'); setPreviewStatus(text(language, 'realtimeOff')) } }} />{text(language, 'realtimePreview')}</label>
            {printArtifact && <button className="preview-mode-button" type="button" onClick={() => setShowPrintPreview((value) => !value)}>{isPrintPreview ? text(language, 'returnAssembly') : text(language, 'showPrintPreview')}</button>}
            {(!realtimePreview || previewState !== 'idle') && <p className={`preview-status ${previewState}`} role="status" aria-live="polite">{previewState === 'generating' && <span className="spinner" aria-hidden="true" />}{previewStatus}</p>}
          </div>
          {!isPrintPreview && <div className="viewer-toolbar" role="group" aria-label={text(language, 'previewDisplayMode')}>
            <button className={previewMode === 'assembled' ? 'selected' : ''} type="button" onClick={() => setPreviewMode('assembled')} aria-pressed={previewMode === 'assembled'}>{text(language, 'assembled')}</button>
            <button className={previewMode === 'exploded' ? 'selected' : ''} type="button" onClick={() => setPreviewMode('exploded')} aria-pressed={previewMode === 'exploded'}>{text(language, 'exploded')}</button>
            <button className={previewMode === '2d' ? 'selected' : ''} type="button" onClick={() => setPreviewMode('2d')} aria-pressed={previewMode === '2d'}>2D</button>
            <button className="viewer-reset-button" type="button" onClick={resetPreviewDisplay}>{text(language, 'resetPreviewDisplay')}</button>
          </div>}
          {isPrintPreview && printArtifact.plates.length > 1 && <div className="plate-tabs" role="group" aria-label={text(language, 'selectPrintPlate')}>{printArtifact.plates.map((plate, index) => <button key={index} type="button" aria-pressed={previewPlateIndex === index} className={previewPlateIndex === index ? 'selected' : ''} onClick={() => setPreviewPlateIndex(index)}>{text(language, 'plate')} {index + 1} <span>{plate.placements.length} {text(language, 'parts')}</span></button>)}</div>}
          {displayMeshes ? <Suspense fallback={<div className="preview-empty">{text(language, 'loading3d')}</div>}><ModelViewer language={language} meshes={displayMeshes} dimensions={isPrintPreview ? null : previewMode === '2d' ? dimensions : displayDimensions} mode={printPreviewPlate ? 'assembled' : previewMode} cameraState={printPreviewPlate ? printCamera : assemblyCamera} resetKey={previewViewReset} {...(printPreviewPlate ? { printPlateSize: { width: printPreviewPlate.width, depth: printPreviewPlate.depth } } : {})} /></Suspense> : <DimensionPreview dimensions={dimensions} language={language} />}
          {shownDimensions && <dl className="dimensions">
            <div><dt>{text(language, 'overallSize')}</dt><dd>{fmt(language, shownDimensions.length + 19)} × {fmt(language, shownDimensions.width)} × {fmt(language, shownDimensions.top + 3.4 + shownDimensions.funnelDepth)} mm</dd></div>
            <div><dt>{text(language, 'fieldTrayStyle')}</dt><dd>{text(language, shownDimensions.trayStyle === 'holes' ? 'trayHoles' : 'trayCutout')}</dd></div>
            <div><dt>{text(language, 'funnelDepth')}</dt><dd>{fmt(language, shownDimensions.funnelDepth)} mm</dd></div>
            <div><dt>{text(language, 'pitch')}</dt><dd>{fmt(language, shownDimensions.pitch)} mm</dd></div>
            <div><dt>{text(language, 'capacity')}</dt><dd>{shownDimensions.screwXs.length * shownDimensions.screwYs.length} {text(language, 'pieces')}</dd></div>
          </dl>}
        </section>
        <section className="panel generate-panel" aria-labelledby="generate-title">
          <div className="section-heading"><h2 id="generate-title">{text(language, 'output')}</h2></div>
          {validation.length > 0 && <div className="validation" role="alert"><strong>{text(language, 'fixSettings')}</strong><ul>{validation.map((message) => <li key={message}>{message}</li>)}</ul></div>}
          <p className={`status ${state}`} role="status" aria-live="polite">{state === 'generating' && <span className="spinner" aria-hidden="true" />}{status}</p>
          <button className="generate-button" type="button" disabled={state === 'generating' || validation.length > 0} onClick={requestGeneration}>
            {state === 'generating' ? text(language, 'generating') : text(language, 'generate')}
          </button>
          {state === 'generating' && <button className="details-button" type="button" onClick={() => generation.current?.abort()}>{text(language, 'cancelGeneration')}</button>}
          {model && <DownloadArea language={language} model={model} settings={settings} onConfirmTransfer={setPendingTransfer} />}
          <div className="print-3mf">
            <h3>{text(language, 'print3mf')}</h3>
            <p>{text(language, 'print3mfDescription')}</p>
            <label className="plate-select" htmlFor="print-plate-size"><span>{text(language, 'plateSize')}</span><select id="print-plate-size" value={selectedPlateId} disabled={printState === 'generating'} onChange={(event) => selectPrintPlate(event.target.value as PrintPlateOption['id'])}>{PRINT_PLATE_OPTIONS.map((plate) => <option key={plate.id} value={plate.id}>{plate.label} ({plate.printers})</option>)}</select></label>
            <button className="zip-button" type="button" disabled={state === 'generating' || printState === 'generating' || validation.length > 0} onClick={requestPrint3mf}>{printState === 'generating' ? text(language, 'generating3mf') : text(language, 'generate3mf')}</button>
            {printStatus && <p className={`print-status ${printState}`} role="status" aria-live="polite">{printState === 'generating' && <span className="spinner" aria-hidden="true" />}{printStatus}</p>}
            {printArtifact && <button className="download-3mf" type="button" onClick={() => requestDownload(language, printArtifact.file, `ScrewCounter_${settings.screw.replace('.', 'p')}_${settings.rows}x${settings.columns}_Bambu.3mf`, setPendingTransfer)}>{text(language, 'download3mf')} <span>↓</span></button>}
          </div>
        </section>
      </aside>
    </div>
    <footer>
      <p>{text(language, 'footer')}</p>
      <p className="build-info"><span>{text(language, 'version')}: <code>{__BUILD_COMMIT_HASH__}</code></span> <span>{text(language, 'commitDate')}: {formatBuildCommitDate(language, buildCommitDate)}</span></p>
    </footer>
    {pendingTransfer && <DataConfirmation language={language} pending={pendingTransfer} onCancel={() => setPendingTransfer(null)} onContinue={() => { const action = pendingTransfer.action; setPendingTransfer(null); action() }} />}
  </main>
}

function DownloadArea({ language, model, settings, onConfirmTransfer }: { language: Language; model: GeneratedModel; settings: Settings; onConfirmTransfer: (transfer: PendingTransfer) => void }) {
  const prefix = `ScrewCounter_${settings.screw.replace('.', 'p')}_${settings.rows}x${settings.columns}`
  const visibleWarnings = model.warnings
  async function downloadAll() {
    const estimatedBytes = Object.values(model.files).reduce((total, file) => total + file.size, 0) + createSettingsFile(settings).size
    if (currentConnectionNeedsLargeDownloadConfirmation(estimatedBytes)) {
      onConfirmTransfer({ label: text(language, 'downloadZip'), detail: text(language, 'largeDownloadDetail', { size: formatBytes(language, estimatedBytes) }), action: () => { void createZip() } })
      return
    }
    await createZip()
  }
  async function createZip() {
    const zip = new JSZip()
    Object.entries(model.files).forEach(([name, file]) => zip.file(`${prefix}_${name}`, file))
    zip.file(`${prefix}_settings.json`, createSettingsFile(settings))
    download(await zip.generateAsync({ type: 'blob' }), `${prefix}.zip`)
  }
  return <div className="downloads" aria-label={text(language, 'downloadFiles')}>
    <button type="button" className="zip-button" onClick={() => void downloadAll()}>{text(language, 'downloadZip')}</button>
    <button type="button" className="settings-download" onClick={() => requestDownload(language, createSettingsFile(settings), `${prefix}_settings.json`, onConfirmTransfer)}>{text(language, 'downloadSettings')}</button>
    <div className="file-list">{PART_FILES.map(([file, label]) => model.files[file] && <button type="button" key={file} onClick={() => requestDownload(language, model.files[file], `${prefix}_${file}`, onConfirmTransfer)}>{text(language, label)}<span>↓</span></button>)}</div>
    {visibleWarnings.length > 0 && <div className="warnings"><strong>{text(language, 'notes')}</strong><ul>{visibleWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
  </div>
}

function requestDownload(language: Language, file: Blob, name: string, onConfirmTransfer: (transfer: PendingTransfer) => void) {
  if (currentConnectionNeedsLargeDownloadConfirmation(file.size)) {
    onConfirmTransfer({ label: name, detail: text(language, 'largeDownloadDetail', { size: formatBytes(language, file.size) }), action: () => download(file, name) })
    return
  }
  download(file, name)
}

function DataConfirmation({ language, pending, onCancel, onContinue }: { language: Language; pending: PendingTransfer; onCancel: () => void; onContinue: () => void }) {
  return <div className="data-dialog-backdrop" role="presentation"><section className="data-dialog" role="alertdialog" aria-modal="true" aria-labelledby="data-dialog-title" aria-describedby="data-dialog-detail">
    <h2 id="data-dialog-title">{text(language, 'dataUsage')}</h2><p id="data-dialog-detail">{pending.detail}</p><p>{text(language, 'dataUsageQuestion', { label: pending.label })}</p>
    <div><button type="button" className="dialog-cancel" autoFocus onClick={onCancel}>{text(language, 'cancel')}</button><button type="button" className="dialog-confirm" onClick={onContinue}>{text(language, 'continue')}</button></div>
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

function phaseLabel(language: Language, phase: string) {
  const keys = { initializing: 'preparingCad', building: 'generating', validating: 'generating', exporting: 'generating' } as const
  return text(language, keys[phase as keyof typeof keys] ?? 'generating')
}

function fmt(language: Language, value: number) { return formatNumber(language, value) }
function formatBytes(language: Language, value: number) { return `${formatNumber(language, value / 1024 / 1024)} MB` }
function formatBuildCommitDate(language: Language, value: Date) {
  if (Number.isNaN(value.getTime())) return text(language, 'unknown')
  return new Intl.DateTimeFormat(language === 'ja' ? 'ja-JP' : 'en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short',
  }).format(value)
}
