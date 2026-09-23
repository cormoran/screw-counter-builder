import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from './cad/settings'
import { loadRealtimePreview, loadSettings, loadViewMode, saveRealtimePreview, saveSettings, saveViewMode } from './settings-session'

function tabStorage() {
  const values = new Map<string, string>()
  vi.stubGlobal('window', { sessionStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  } })
  return values
}

afterEach(() => vi.unstubAllGlobals())

describe('settings across a page reload', () => {
  it('restores a valid edit and keeps the last valid value when a field is temporarily empty', () => {
    tabStorage()
    const edited = { ...DEFAULT_SETTINGS, rows: 5 }
    saveSettings(edited)
    saveSettings({ ...edited, rows: null as unknown as number })
    expect(loadSettings().rows).toBe(5)
  })

  it('restores the explicit tray style and screw length across reloads', () => {
    tabStorage()
    saveSettings({ ...DEFAULT_SETTINGS, screwLength: 8, trayStyle: 'holes' })
    expect(loadSettings()).toMatchObject({ screwLength: 8, trayStyle: 'holes' })
  })

  it('falls back to defaults for corrupt stored data', () => {
    const values = tabStorage()
    values.set('screw-counter-settings-v1', '{broken')
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('restores the selected view and live-preview preference', () => {
    tabStorage()
    saveViewMode('exploded')
    saveRealtimePreview(false)
    expect(loadViewMode()).toBe('exploded')
    expect(loadRealtimePreview()).toBe(false)
  })
})
