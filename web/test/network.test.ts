import { describe, expect, it } from 'vitest'
import { shouldConfirmCadDownload } from '../src/network'

describe('large CAD engine download confirmation', () => {
  it('confirms on data saving, cellular, and 2G connections', () => {
    expect(shouldConfirmCadDownload({ saveData: true, type: 'wifi' })).toBe(true)
    expect(shouldConfirmCadDownload({ type: 'cellular', effectiveType: '4g' })).toBe(true)
    expect(shouldConfirmCadDownload({ effectiveType: '2g' })).toBe(true)
    expect(shouldConfirmCadDownload({ effectiveType: 'slow-2g' })).toBe(true)
  })

  it('does not guess when the connection API is missing or reports Wi-Fi', () => {
    expect(shouldConfirmCadDownload()).toBe(false)
    expect(shouldConfirmCadDownload({ type: 'wifi', effectiveType: '4g' })).toBe(false)
  })
})
