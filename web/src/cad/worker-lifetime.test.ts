import { afterEach, beforeEach, expect, it, vi } from 'vitest'

class CadWorker {
  static instances: CadWorker[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  postMessage = vi.fn()
  terminate = vi.fn()
  constructor() { CadWorker.instances.push(this) }
  complete(index: number) {
    const { id } = this.postMessage.mock.calls[index][0]
    const partKeys = { base: 'base', tray: 'tray', slider: 'slider', lid: 'lid', funnel: 'funnel' }
    const mesh = { positions: new Float32Array(), normals: new Float32Array(), indices: new Uint32Array() }
    const partMeshes = Object.fromEntries(Object.keys(partKeys).map((key) => [key, mesh]))
    this.onmessage?.({ data: { type: 'complete', id, model: { dimensions: {} }, partKeys, partMeshes } } as MessageEvent)
  }
}

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  CadWorker.instances = []
  vi.stubGlobal('Worker', CadWorker)
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

it.each(['export', 'preview'] as const)('recycles the %s native heap without interrupting queued work', async (mode) => {
  const generate = mode === 'export'
    ? (await import('./worker-client')).generateModel
    : (await import('./preview-client')).generatePreviewModel
  for (let index = 0; index < 3; index++) {
    const pending = generate()
    const worker = CadWorker.instances[0]
    worker.complete(index)
    await pending
    expect(worker.terminate).not.toHaveBeenCalled()
  }
  const fourth = generate()
  const fifth = generate()
  const worker = CadWorker.instances[0]
  expect(CadWorker.instances).toHaveLength(1)
  worker.complete(3)
  await fourth
  expect(worker.terminate).not.toHaveBeenCalled()
  worker.complete(4)
  await fifth
  expect(worker.terminate).toHaveBeenCalledTimes(1)
  const fresh = generate()
  expect(CadWorker.instances).toHaveLength(2)
  CadWorker.instances[1].complete(0)
  await fresh
  expect(CadWorker.instances[1].terminate).not.toHaveBeenCalled()
  vi.advanceTimersByTime(2 * 60_000)
  expect(CadWorker.instances[1].terminate).toHaveBeenCalledTimes(1)
})
