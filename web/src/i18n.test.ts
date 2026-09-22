import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectLanguage, loadLanguage, saveLanguage } from './i18n'

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
})
