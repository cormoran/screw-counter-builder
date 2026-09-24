import type { Settings } from './cad'

type Gtag = (command: 'event', eventName: string, parameters: Record<string, string | number>) => void

declare global {
  interface Window {
    gtag?: Gtag
  }
}

/**
 * Reports only non-identifying design choices with a completed download.
 * Register the numeric fields as event-scoped custom metrics in GA4.
 */
export function reportDownload(kind: 'model' | 'print_3mf', settings: Settings, format: string) {
  window.gtag?.('event', `${kind}_download`, {
    download_format: format,
    screw_size: settings.screw,
    model_rows: settings.rows,
    model_columns: settings.columns,
    model_capacity: settings.rows * settings.columns,
    screw_length_mm: settings.screwLength,
    funnel_height_mm: settings.funnelHeight ?? 0,
    funnel_outlet_mm: settings.funnelOutlet,
  })
}
