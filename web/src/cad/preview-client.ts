import { assertValidSettings } from './settings'
import type { GenerateOptions, GenerationProgress, PreviewModel, SettingsInput } from './types'

type WorkerReply =
  | { type: 'progress'; progress: GenerationProgress }
  | { type: 'complete'; model: PreviewModel }
  | { type: 'error'; message: string }

/** Generate viewport-only geometry in a worker; callers can abort stale edits. */
export function generatePreviewModel(input: SettingsInput = {}, options: GenerateOptions = {}): Promise<PreviewModel> {
  const settings = assertValidSettings(input)
  if (options.signal?.aborted) return Promise.reject(new DOMException('CAD preview was cancelled', 'AbortError'))
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./preview-worker-entry.ts', import.meta.url), { type: 'module' })
    const finish = () => { options.signal?.removeEventListener('abort', abort); worker.terminate() }
    const abort = () => { finish(); reject(new DOMException('CAD preview was cancelled', 'AbortError')) }
    options.signal?.addEventListener('abort', abort, { once: true })
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      const reply = event.data
      if (reply.type === 'progress') options.onProgress?.(reply.progress)
      else if (reply.type === 'complete') { finish(); resolve(reply.model) }
      else { finish(); reject(new Error(reply.message)) }
    }
    worker.onerror = (event) => { finish(); reject(new Error(event.message || 'CAD preview worker failed')) }
    worker.postMessage(settings)
  })
}
