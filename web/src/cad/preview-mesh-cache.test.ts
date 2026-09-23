import { expect, it } from 'vitest'
import { deriveDimensions } from './derive'
import { DEFAULT_SETTINGS } from './settings'
import { PreviewMeshCache } from './preview-mesh-cache'
import type { ModelPart, TriangleMesh } from './types'

const parts = ['base', 'slider', 'tray', 'funnel', 'lid'] as const
const meshes = Object.fromEntries(parts.map((part, i) => [part, {
  positions: new Float32Array([i]), normals: new Float32Array([i]), indices: new Uint32Array([0]),
}])) as Record<ModelPart, TriangleMesh>

it.each([
  [{ detentSpringLength: 12 }, ['base', 'tray', 'funnel', 'lid']],
  [{ trayStyle: 'cutout' as const }, ['base', 'slider', 'funnel', 'lid']],
  [{ funnelOutlet: 5 }, ['base', 'slider', 'tray', 'lid']],
  [{ lidStyle: 'cutout' as const }, ['base', 'slider', 'tray', 'funnel']],
] as const)('retains exactly the unchanged meshes before building %j', (change, retained) => {
  const cache = new PreviewMeshCache()
  cache.remember(DEFAULT_SETTINGS, deriveDimensions(), meshes)
  const settings = { ...DEFAULT_SETTINGS, ...change }
  const ready = cache.match(settings, deriveDimensions(settings))
  expect(Object.keys(ready).sort()).toEqual([...retained].sort())
  for (const part of retained) expect(ready[part]).toBe(meshes[part])

})

it('tracks partial jobs per part without relabeling old geometry as current', () => {
  const cache = new PreviewMeshCache()
  expect(cache.match(DEFAULT_SETTINGS, deriveDimensions())).toEqual({})
  cache.remember(DEFAULT_SETTINGS, deriveDimensions(), meshes)
  const settings = { ...DEFAULT_SETTINGS, rows: 2 }
  const dimensions = deriveDimensions(settings)
  cache.remember(settings, dimensions, { base: meshes.base })
  expect(cache.match(settings, dimensions)).toEqual({ base: meshes.base })
  const old = cache.match(DEFAULT_SETTINGS, deriveDimensions())
  expect(old.base).toBeUndefined()
  for (const part of ['slider', 'tray', 'funnel', 'lid'] as const) expect(old[part]).toBe(meshes[part])
})
