import { expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from './cad/settings'
import { createSettingsFile, parseSettingsFile } from './settings-transfer'

it('imports old files with defaults for the added parts and round-trips new choices', async () => {
  const old = { ...DEFAULT_SETTINGS } as Record<string, unknown>
  for (const key of ['lidStyle', 'funnelAlignment', 'funnelOutlet', 'funnelHeight', 'screwLength', 'trayStyle']) delete old[key]
  expect(parseSettingsFile(JSON.stringify({ format: 'screw-counter-settings', version: 1, settings: old }))).toEqual(DEFAULT_SETTINGS)
  const settings = { ...DEFAULT_SETTINGS, lidStyle: 'cutout', funnelAlignment: 'pegs', funnelOutlet: 24 } as const
  expect(parseSettingsFile(await createSettingsFile(settings).text())).toEqual(settings)
  expect(() => parseSettingsFile(JSON.stringify({ format: 'screw-counter-settings', version: 1, settings: { ...settings, funnelOutlet: 0 } }))).toThrow('Invalid settings file')
})

it.each(['auto', 'holes', 'cutout'] as const)('round-trips screw length and %s tray style', async (trayStyle) => {
  const settings = { ...DEFAULT_SETTINGS, screwLength: 5.1, trayStyle }
  expect(parseSettingsFile(await createSettingsFile(settings).text())).toEqual(settings)
})
it.each([{ screwLength: '5' }, { screwLength: null }, { screwLength: 0 }, { trayStyle: 'unknown' }])('rejects invalid tray settings %j', (invalid) => {
  expect(() => parseSettingsFile(JSON.stringify({ format: 'screw-counter-settings', version: 1, settings: { ...DEFAULT_SETTINGS, ...invalid } }))).toThrow('Invalid settings file')
})

it('round-trips screw attachment and a manual funnel height', async () => {
  const settings = { ...DEFAULT_SETTINGS, funnelAlignment: 'screws', screwLength: 20, funnelHeight: 40 } as const
  expect(parseSettingsFile(await createSettingsFile(settings).text())).toEqual(settings)
})
