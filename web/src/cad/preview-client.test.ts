import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelPart, TriangleMesh } from './types'

type Reply = {
  type: 'complete'
  id: number
  model: { dimensions: object }
  partMeshes: Partial<Record<ModelPart, TriangleMesh>>
  partKeys: Record<ModelPart, string>
}

class PreviewWorker {
  static instances: PreviewWorker[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  postMessage = vi.fn()
  terminate = vi.fn()

  constructor() { PreviewWorker.instances.push(this) }

  reply(message: Reply) { this.onmessage?.({ data: message } as MessageEvent) }
}

const parts = ['base', 'tray', 'slider', 'lid', 'funnel'] as const
const keys = (slider = 'slider') => ({ base: 'base', tray: 'tray', slider, lid: 'lid', funnel: 'funnel' })
const mesh = (value: number): TriangleMesh => ({
  positions: new Float32Array([value]),
  normals: new Float32Array([value]),
  indices: new Uint32Array([value]),
})

describe('preview worker client', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    PreviewWorker.instances = []
    vi.stubGlobal('Worker', PreviewWorker)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('reuses one worker and keeps unchanged mesh references from the accepted model', async () => {
    const { generatePreviewModel } = await import('./preview-client')
    const first = generatePreviewModel()
    const worker = PreviewWorker.instances[0]
    const firstRequest = worker.postMessage.mock.calls[0][0]
    expect(firstRequest.knownPartKeys).toBeUndefined()

    const initialMeshes = Object.fromEntries(parts.map((part, index) => [part, mesh(index)])) as Record<ModelPart, TriangleMesh>
    worker.reply({ type: 'complete', id: firstRequest.id, model: { dimensions: {} }, partMeshes: initialMeshes, partKeys: keys() })
    const initial = await first

    const second = generatePreviewModel({ detentSpringLength: 12 })
    const secondRequest = worker.postMessage.mock.calls[1][0]
    expect(PreviewWorker.instances).toHaveLength(1)
    expect(secondRequest.knownPartKeys).toEqual(keys())
    const replacement = mesh(9)
    worker.reply({ type: 'complete', id: secondRequest.id, model: { dimensions: {} }, partMeshes: { slider: replacement }, partKeys: keys('slider-2') })
    const updated = await second

    expect(updated.partMeshes.slider).toBe(replacement)
    for (const part of ['base', 'tray', 'lid'] as const) expect(updated.partMeshes[part]).toBe(initial.partMeshes[part])
  })

  it('does not advance the accepted mesh keys after an aborted request replies', async () => {
    const { generatePreviewModel } = await import('./preview-client')
    const initial = generatePreviewModel()
    const worker = PreviewWorker.instances[0]
    const initialRequest = worker.postMessage.mock.calls[0][0]
    const initialMeshes = Object.fromEntries(parts.map((part, index) => [part, mesh(index)])) as Record<ModelPart, TriangleMesh>
    worker.reply({ type: 'complete', id: initialRequest.id, model: { dimensions: {} }, partMeshes: initialMeshes, partKeys: keys() })
    await initial

    const controller = new AbortController()
    const stale = generatePreviewModel({ detentSpringLength: 12 }, { signal: controller.signal })
    const staleRequest = worker.postMessage.mock.calls[1][0]
    controller.abort()
    await expect(stale).rejects.toMatchObject({ name: 'AbortError' })
    worker.reply({ type: 'complete', id: staleRequest.id, model: { dimensions: {} }, partMeshes: { slider: mesh(9) }, partKeys: keys('slider-2') })

    void generatePreviewModel({ rows: 2 })
    const nextRequest = worker.postMessage.mock.calls[2][0]
    expect(nextRequest.knownPartKeys).toEqual(keys())
  })
})
