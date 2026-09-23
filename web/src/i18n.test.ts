import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectLanguage, loadLanguage, localizeValidation, saveLanguage, text } from './i18n'

afterEach(() => vi.unstubAllGlobals())

describe('language preference', () => {
  it('uses Japanese only when the browser prefers Japanese', () => {
    expect(detectLanguage(['en-US', 'ja-JP'])).toBe('ja')
    expect(detectLanguage(['en-GB', 'fr'])).toBe('en')
  })

  it('restores an explicit language choice ahead of browser detection', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } })
    vi.stubGlobal('navigator', { languages: ['ja-JP'] })
    saveLanguage('en')
    expect(loadLanguage()).toBe('en')
  })

  it('localizes the preview reset control', () => {
    expect(text('ja', 'resetPreviewDisplay')).toBe('表示をリセット')
    expect(text('en', 'resetPreviewDisplay')).toBe('Reset view')
  })

  it('describes the relocated square outlet in both languages', () => {
    expect(text('ja', 'fieldTrayHoleClearance')).toContain('ベース角穴')
    expect(text('en', 'fieldTrayHoleClearance')).toContain('base-hole')
    expect(localizeValidation('ja', 'baseHoleClearance must be 0.1..1.2 mm')).toContain('ベース穴')
    expect(localizeValidation('en', 'baseHoleClearance must be 0.1..1.2 mm')).toContain('Base-hole')
  })
})
