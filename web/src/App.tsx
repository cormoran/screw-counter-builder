import { useMemo, useRef, useState } from 'react'
import JSZip from 'jszip'
import { DEFAULT_SETTINGS, deriveDimensions, generateModel, validateSettings, type GeneratedModel, type Settings } from './cad'
import { DimensionPreview } from './components/DimensionPreview'
import { SettingsForm } from './components/SettingsForm'
import { SETTINGS_FIELDS } from './settings-schema'

type State = 'ready' | 'generating' | 'complete' | 'error'

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
  const generation = useRef<AbortController | null>(null)
  const validation = useMemo(() => validateSettings(settings).map(localizeValidation), [settings])
  const dimensions = useMemo(() => validation.length === 0 ? deriveDimensions(settings) : null, [settings, validation])

  function update(key: keyof Settings, value: Settings[keyof Settings]) {
    setSettings((current) => ({ ...current, [key]: value }))
    setModel(null)
    setState('ready')
  }

  async function build() {
    if (validation.length) return
    const controller = new AbortController()
    generation.current = controller
    setState('generating')
    setModel(null)
    setStatus('CADエンジンを準備しています…')
    try {
      const generated = await generateModel(settings, {
        signal: controller.signal,
        onProgress: (progress) => setStatus(progress.message ?? phaseLabel(progress.phase)),
      })
      setModel(generated)
      setState('complete')
      setStatus(generated.verification.pending.length === 0 ? 'CAD検証を完了してモデルを生成しました。' : 'モデルを生成しました。未実施の検証項目があります。')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setState('ready')
        setStatus('生成を中止しました。設定を変更して再生成できます。')
      } else {
        setState('error')
        setStatus(error instanceof Error ? error.message : 'モデルを生成できませんでした。')
      }
    } finally {
      generation.current = null
    }
  }

  return <main className="app-shell">
    <header className="tool-header">
      <div><a className="tool-title" href={import.meta.env.BASE_URL}>ねじカウンター生成器</a><p>印刷用STLと組立用STEPをこのブラウザ内で生成します。</p></div>
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
          <div className="section-heading"><h2 id="preview-title">寸法プレビュー</h2><span>上面</span></div>
          <DimensionPreview dimensions={dimensions} />
          {dimensions && <dl className="dimensions">
            <div><dt>外形</dt><dd>{fmt(dimensions.length)} × {fmt(dimensions.width)} × {fmt(dimensions.top)} mm</dd></div>
            <div><dt>ピッチ</dt><dd>{fmt(dimensions.pitch)} mm</dd></div>
            <div><dt>収容本数</dt><dd>{settings.rows * settings.columns} 本</dd></div>
          </dl>}
        </section>
        <section className="panel generate-panel" aria-labelledby="generate-title">
          <div className="section-heading"><h2 id="generate-title">出力</h2></div>
          {validation.length > 0 && <div className="validation" role="alert"><strong>設定を修正してください</strong><ul>{validation.map((message) => <li key={message}>{message}</li>)}</ul></div>}
          <p className={`status ${state}`} role="status" aria-live="polite">{state === 'generating' && <span className="spinner" aria-hidden="true" />}{status}</p>
          <button className="generate-button" type="button" disabled={state === 'generating' || validation.length > 0} onClick={build}>
            {state === 'generating' ? 'モデルを生成中…' : 'モデルを生成'}
          </button>
          {state === 'generating' && <button className="details-button" type="button" onClick={() => generation.current?.abort()}>生成を中止</button>}
          {model && <DownloadArea model={model} settings={settings} />}
        </section>
      </aside>
    </div>
    <footer><p>プリセットのねじ寸法は規格保証値ではありません。実物を測定し、印刷条件と実機での動作を確認してください。</p></footer>
  </main>
}

function DownloadArea({ model, settings }: { model: GeneratedModel; settings: Settings }) {
  const prefix = `ScrewCounter_${settings.screw.replace('.', 'p')}_${settings.rows}x${settings.columns}`
  async function downloadAll() {
    const zip = new JSZip()
    Object.entries(model.files).forEach(([name, file]) => zip.file(`${prefix}_${name}`, file))
    download(await zip.generateAsync({ type: 'blob' }), `${prefix}.zip`)
  }
  return <div className="downloads" aria-label="生成ファイルのダウンロード">
    <button type="button" className="zip-button" onClick={() => void downloadAll()}>ZIPで一括ダウンロード</button>
    <div className="file-list">{PART_FILES.map(([file, label]) => model.files[file] && <button type="button" key={file} onClick={() => download(model.files[file], `${prefix}_${file}`)}>{label}<span>↓</span></button>)}</div>
    {model.warnings.length > 0 && <div className="warnings"><strong>確認事項</strong><ul>{model.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
  </div>
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

function fmt(value: number) { return new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 }).format(value) }

function localizeValidation(message: string) {
  const translations: Record<string, string> = {
    'rows and columns must be positive integers': '1回に出す本数と取り出し回数には1以上の整数を入力してください。',
    'joint must be screws or glue': '接合方法を選び直してください。',
    'Supported magnet diameter is 3..8 mm': '磁石の直径は3〜8 mmにしてください。',
    'Supported magnet thickness is 1..3 mm': '磁石の厚みは1〜3 mmにしてください。',
    'slideClearance must be 0.15..0.6 mm': 'スライドのクリアランスは0.15〜0.6 mmにしてください。',
    'Magnet clearance is outside the supported range': '磁石穴のクリアランスが対応範囲を外れています。',
    'detentSpringWidth must be 1.0..1.5 mm': 'ばね幅は1.0〜1.5 mmにしてください。',
    'Need shaft + 0.3 <= slot <= head - 0.6; measure the actual screw': '軸径 + 0.3 mm ≤ スロット幅 ≤ 頭径 − 0.6 mm となるよう、実物のねじを測ってください。',
  }
  return translations[message] ?? message
}
