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

const modes = ['export', 'preview'] as const
async function generator(mode: typeof modes[number]) {
  return mode === 'export'
    ? (await import('./worker-client')).generateModel
    : (await import('./preview-client')).generatePreviewModel
}
function fail(worker: CadWorker, kind: 'reply' | 'event', index = 0) {
  const message = 'memory access out of bounds'
  if (kind === 'event') worker.onerror?.({ message } as ErrorEvent)
  else worker.onmessage?.({ data: { type: 'error', id: worker.postMessage.mock.calls[index][0].id, message } } as MessageEvent)
}

it.each(modes)('keeps the %s cache beyond four jobs and releases it only after idle', async (mode) => {
  const generate = await generator(mode)
  for (let index = 0; index < 8; index++) {
    const pending = generate()
    expect(CadWorker.instances).toHaveLength(1)
    const worker = CadWorker.instances[0]
    worker.complete(index)
    await pending
    expect(worker.terminate).not.toHaveBeenCalled()
  }
  vi.advanceTimersByTime(2 * 60_000)
  expect(CadWorker.instances[0].terminate).toHaveBeenCalledTimes(1)
  const next = generate()
  CadWorker.instances[1].complete(0)
  await next
})

it.each(modes.flatMap(mode => (['reply', 'event'] as const).map(kind => ({ mode, kind }))))(
  'retries queued $mode requests once after a worker $kind failure', async ({ mode, kind }) => {
    const generate = await generator(mode)
    const first = generate({ screwLength: 5 })
    const second = generate({ screwLength: 8 })
    const old = CadWorker.instances[0]
    fail(old, kind)
    expect(old.terminate).toHaveBeenCalledTimes(1)
    expect(CadWorker.instances).toHaveLength(2)
    const fresh = CadWorker.instances[1]
    expect(fresh.postMessage.mock.calls.map(([request]) => request)).toEqual(old.postMessage.mock.calls.map(([request]) => request))
    old.complete(0)
    fail(old, kind)
    expect(fresh.terminate).not.toHaveBeenCalled()
    fresh.complete(0)
    fresh.complete(1)
    await Promise.all([first, second])
  },
)

it.each(modes)('stops retrying %s after the replacement also fails', async (mode) => {
  const generate = await generator(mode)
  const pending = generate()
  const rejected = expect(pending).rejects.toThrow('memory access out of bounds')
  fail(CadWorker.instances[0], 'reply')
  fail(CadWorker.instances[1], 'event')
  await rejected
  expect(CadWorker.instances).toHaveLength(2)
  expect(CadWorker.instances[1].terminate).toHaveBeenCalledTimes(1)
  const next = generate()
  CadWorker.instances[2].complete(0)
  await next
})

it.each(modes)('does not replay aborted %s jobs, even if they report the kernel failure', async (mode) => {
  const generate = await generator(mode)
  const controller = new AbortController()
  const aborted = generate({}, { signal: controller.signal })
  const rejected = expect(aborted).rejects.toMatchObject({ name: 'AbortError' })
  const active = generate({ screwLength: 8 })
  controller.abort()
  await rejected
  fail(CadWorker.instances[0], 'reply')
  const fresh = CadWorker.instances[1]
  expect(fresh.postMessage).toHaveBeenCalledTimes(1)
  expect(fresh.postMessage.mock.calls[0][0].settings.screwLength).toBe(8)
  fresh.complete(0)
  await active
})

it.each(modes)('bounds retries when posting to the %s worker throws synchronously', async (mode) => {
  const generate = await generator(mode)
  const warm = generate()
  CadWorker.instances[0].complete(0)
  await warm
  CadWorker.instances[0].postMessage.mockImplementationOnce(() => { throw new Error('post failed') })
  const pending = generate()
  expect(CadWorker.instances[0].terminate).toHaveBeenCalledTimes(1)
  expect(CadWorker.instances[1].postMessage).toHaveBeenCalledTimes(1)
  CadWorker.instances[1].complete(0)
  await pending
})
