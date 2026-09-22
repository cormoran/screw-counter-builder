import type { DerivedDimensions } from '../cad'

export function DimensionPreview({ dimensions }: { dimensions: DerivedDimensions | null }) {
  if (!dimensions) return <div className="preview-empty">設定が成立すると寸法プレビューを表示します。</div>
  const width = dimensions.length
  const height = dimensions.width
  const scale = Math.min(280 / width, 175 / height)
  const w = width * scale
  const h = height * scale
  return <div className="preview-wrap">
    <svg className="dimension-preview" viewBox="0 0 320 230" role="img" aria-label={`本体外形 ${format(dimensions.length)} × ${format(dimensions.width)} mm の上面プレビュー`}>
      <rect x={(320 - w) / 2} y={(195 - h) / 2} width={w} height={h} rx="11" className="body" />
      {dimensions.screwXs.map((x) => dimensions.screwYs.map((y) => <circle key={`${x}-${y}`} cx={(320 - w) / 2 + x * scale} cy={(195 - h) / 2 + y * scale} r={Math.max(2, dimensions.drop * scale / 2)} className="hole" />))}
      <line x1={(320 - w) / 2} x2={(320 + w) / 2} y1="211" y2="211" className="measure" />
      <text x="160" y="226" textAnchor="middle">{format(dimensions.length)} mm</text>
      <line x1="306" x2="306" y1={(195 - h) / 2} y2={(195 + h) / 2} className="measure" />
      <text x="313" y="102" transform="rotate(90 313 102)">{format(dimensions.width)} mm</text>
    </svg>
    <p className="preview-note">穴の配置と本体外形を示す上面図です。</p>
  </div>
}

function format(value: number) { return new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 }).format(value) }
