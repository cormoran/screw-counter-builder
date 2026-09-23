import { expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from './cad/settings'
import { createSettingsFile, parseSettingsFile } from './settings-transfer'

it('imports old files with defaults for the added parts and round-trips new choices', async () => {
  const old = { ...DEFAULT_SETTINGS } as Record<string, unknown>
  for (const key of ['lidStyle', 'funnelAlignment', 'funnelOutlet']) delete old[key]
  expect(parseSettingsFile(JSON.stringify({ format: 'screw-counter-settings', version: 1, settings: old }))).toEqual(DEFAULT_SETTINGS)
  const settings = { ...DEFAULT_SETTINGS, lidStyle: 'cutout', funnelAlignment: 'pegs', funnelOutlet: 24 } as const
  expect(parseSettingsFile(await createSettingsFile(settings).text())).toEqual(settings)
  expect(() => parseSettingsFile(JSON.stringify({ format: 'screw-counter-settings', version: 1, settings: { ...settings, funnelOutlet: 0 } }))).toThrow('Invalid settings file')
})
