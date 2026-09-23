import { DEFAULT_SETTINGS, validateSettings } from './cad/settings'
import type { Settings } from './cad/types'

const FORMAT = 'screw-counter-settings'
const VERSION = 1

export function createSettingsFile(settings: Settings): Blob {
  return new Blob([JSON.stringify({ format: FORMAT, version: VERSION, settings }, null, 2)], { type: 'application/json' })
}

export function parseSettingsFile(contents: string): Settings {
  const value: unknown = JSON.parse(contents)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid settings file')
  const document = value as Record<string, unknown>
  if (document.format !== FORMAT || document.version !== VERSION || !document.settings || typeof document.settings !== 'object' || Array.isArray(document.settings)) throw new Error('Invalid settings file')
  const raw: Record<string, unknown> = { screwLength: DEFAULT_SETTINGS.screwLength, trayStyle: DEFAULT_SETTINGS.trayStyle, lidStyle: DEFAULT_SETTINGS.lidStyle, funnelAlignment: DEFAULT_SETTINGS.funnelAlignment, funnelOutlet: DEFAULT_SETTINGS.funnelOutlet, ...document.settings as Record<string, unknown> }
  const keys = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]
  if (keys.some((key) => !(key in raw)) || Object.keys(raw).some((key) => !keys.includes(key as keyof Settings))) throw new Error('Invalid settings file')
  if (typeof raw.detent !== 'boolean' || typeof raw.rows !== 'number' || typeof raw.columns !== 'number') throw new Error('Invalid settings file')
  for (const key of ['screwLength', 'detentSpringWidth', 'detentSpringLength', 'detentDiameter', 'magnetDiameter', 'magnetThickness', 'magnetDiameterClearance', 'magnetDepthClearance', 'slideClearance', 'trayHoleClearance', 'screwSpaceHeight'] as const) {
    if (typeof raw[key] !== 'number') throw new Error('Invalid settings file')
  }
  for (const key of ['headDiameter', 'shaftDiameter', 'slotWidth', 'pitch'] as const) {
    if (raw[key] !== null && typeof raw[key] !== 'number') throw new Error('Invalid settings file')
  }
  if (!['M1.5', 'M2', 'M3'].includes(String(raw.screw)) || !['screws', 'glue'].includes(String(raw.joint)) || !['magnets', 'pegs'].includes(String(raw.lidAlignment))) throw new Error('Invalid settings file')
  const settings = raw as unknown as Settings
  if (validateSettings(settings).length) throw new Error('Invalid settings file')
  return settings
}
