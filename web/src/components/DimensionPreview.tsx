import type { DerivedDimensions } from '../cad'
import { formatNumber, text, type Language } from '../i18n'

type Props = {
  dimensions: DerivedDimensions | null
  language: Language
  compact?: boolean
}

export function DimensionPreview({ dimensions, language, compact = false }: Props) {
  if (!dimensions) return <div className="preview-empty">{text(language, 'dimensionsUnavailable')}</div>
  const width = dimensions.length
  const height = dimensions.width
  const scale = Math.min(280 / width, 175 / height)
  const w = width * scale
  const h = height * scale
  return <div className={`preview-wrap${compact ? ' compact' : ''}`}>
    <svg className="dimension-preview" viewBox="0 0 320 230" role="img" aria-label={text(language, 'topPreview', { length: format(language, dimensions.length), width: format(language, dimensions.width) })}>
      <rect x={(320 - w) / 2} y={(195 - h) / 2} width={w} height={h} rx="11" className="body" />
      {dimensions.screwXs.map((x) => dimensions.screwYs.map((y) => <rect key={`${x}-${y}`} x={(320 - w) / 2 + (x - dimensions.drop / 2) * scale} y={(195 - h) / 2 + (y - dimensions.drop / 2) * scale} width={dimensions.drop * scale} height={dimensions.drop * scale} className="hole" />))}
      <line x1={(320 - w) / 2} x2={(320 + w) / 2} y1="211" y2="211" className="measure" />
      <text x="160" y="226" textAnchor="middle">{format(language, dimensions.length)} mm</text>
      <line x1="306" x2="306" y1={(195 - h) / 2} y2={(195 + h) / 2} className="measure" />
      <text x="313" y="102" transform="rotate(90 313 102)">{format(language, dimensions.width)} mm</text>
    </svg>
    {!compact && <p className="preview-note">{text(language, 'topPreviewNote')}</p>}
  </div>
}

function format(language: Language, value: number) { return formatNumber(language, value) }
