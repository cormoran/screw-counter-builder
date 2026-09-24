import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from './cad'
import { reportDownload } from './analytics'

afterEach(() => vi.unstubAllGlobals())

describe('download analytics', () => {
  it('reports numeric model parameters with a model download', () => {
    const gtag = vi.fn()
    vi.stubGlobal('window', { gtag })

    reportDownload('model', { ...DEFAULT_SETTINGS, rows: 3, columns: 7, screwLength: 12, funnelHeight: null, funnelOutlet: 11 }, 'zip')

    expect(gtag).toHaveBeenCalledWith('event', 'model_download', expect.objectContaining({
      download_format: 'zip', screw_size: 'M2', model_rows: 3, model_columns: 7,
      model_capacity: 21, screw_length_mm: 12, funnel_height_mm: 0, funnel_outlet_mm: 11,
    }))
  })

  it('does nothing when analytics is unavailable', () => {
    vi.stubGlobal('window', {})
    expect(() => reportDownload('print_3mf', DEFAULT_SETTINGS, '3mf')).not.toThrow()
  })
})
