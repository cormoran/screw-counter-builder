import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelPart, TriangleMesh } from './types'

class DefaultPreviewWorker {
  static instances: DefaultPreviewWorker[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  postMessage = vi.fn()
  terminate = vi.fn()

  constructor() { DefaultPreviewWorker.instances.push(this) }

  reply(meshes: Record<ModelPart, TriangleMesh>) { this.onmessage?.({ data: { type: 'complete', meshes } } as MessageEvent) }
  fail(message: string) { this.onerror?.({ message } as ErrorEvent) }
}

beforeEach(() => {
  vi.resetModules()
  DefaultPreviewWorker.instances = []
  vi.stubGlobal('window', { location: { origin: 'https://example.test' } })
  vi.stubGlobal('Worker', DefaultPreviewWorker)
})

afterEach(() => vi.unstubAllGlobals())

describe('default preview loading', () => {
  it('retries the manifest after a transient failure', async () => {
    const info = { version: 2, settings: { rows: 4, columns: 10, screw: 'M2', screwSpaceHeight: 15 }, files: {}, rawBytes: 1, gzipBytes: 1 }
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, json: async () => info })
    vi.stubGlobal('fetch', fetch)
    const { getDefaultPreviewInfo } = await import('./default-preview')

    await expect(getDefaultPreviewInfo()).rejects.toThrow('503')
    await expect(getDefaultPreviewInfo()).resolves.toEqual(info)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('retries the mesh worker after it fails to start', async () => {
    const { loadDefaultPreview } = await import('./default-preview')
    const first = loadDefaultPreview()
    DefaultPreviewWorker.instances[0].fail('network interrupted')
    await expect(first).rejects.toThrow('network interrupted')

    const second = loadDefaultPreview()
    const meshes = {} as Record<ModelPart, TriangleMesh>
    DefaultPreviewWorker.instances[1].reply(meshes)
    await expect(second).resolves.toBe(meshes)
    expect(DefaultPreviewWorker.instances).toHaveLength(2)
  })
})
