import { DEFAULT_SETTINGS, normalizeSettings, validateSettings } from './cad/settings'
import type { Settings } from './cad/types'

const KEY = 'screw-counter-settings-v1'
const VIEW_KEY = 'screw-counter-view-v1'
const REALTIME_KEY = 'screw-counter-realtime-v1'
type ViewMode = 'assembled' | 'exploded' | '2d'

function storage(): Storage | null {
  try { return window.sessionStorage } catch { return null }
}

export function loadSettings(): Settings {
  try {
    const saved = storage()?.getItem(KEY)
    if (!saved) return { ...DEFAULT_SETTINGS }
    const input: unknown = JSON.parse(saved)
    if (!input || typeof input !== 'object' || Array.isArray(input)) return { ...DEFAULT_SETTINGS }
    const settings = normalizeSettings(input as Partial<Settings>)
    return validateSettings(settings).length === 0 ? settings : { ...DEFAULT_SETTINGS }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: Settings): void {
  if (validateSettings(settings).length > 0) return
  try { storage()?.setItem(KEY, JSON.stringify(settings)) } catch { /* Private browsing can disable storage. */ }
}

export function differsFromDefaults(settings: Settings): boolean {
  return (Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]).some((key) => settings[key] !== DEFAULT_SETTINGS[key])
}

export function loadViewMode(): ViewMode {
  try {
    const saved = storage()?.getItem(VIEW_KEY)
    return saved === 'assembled' || saved === 'exploded' || saved === '2d' ? saved : '2d'
  } catch { return '2d' }
}

export function saveViewMode(mode: ViewMode): void {
  try { storage()?.setItem(VIEW_KEY, mode) } catch { /* Storage is optional. */ }
}

export function loadRealtimePreview(): boolean {
  try { return storage()?.getItem(REALTIME_KEY) !== 'off' } catch { return true }
}

export function saveRealtimePreview(enabled: boolean): void {
  try { storage()?.setItem(REALTIME_KEY, enabled ? 'on' : 'off') } catch { /* Storage is optional. */ }
}
