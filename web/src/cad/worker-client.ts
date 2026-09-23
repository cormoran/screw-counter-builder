import { assertValidSettings } from './settings'
import type { GenerateOptions, GeneratedModel, GenerationProgress, SettingsInput } from './types'

type WorkerReply =
  | { type: 'progress'; id: number; progress: GenerationProgress }
  | { type: 'complete'; id: number; model: GeneratedModel }
  | { type: 'error'; id: number; message: string }

type PendingRequest = {
  request: { type: 'generate'; id: number; settings: ReturnType<typeof assertValidSettings> }
  worker?: Worker
  retries: number
  abort: () => void
  resolve: (model: GeneratedModel) => void
  reject: (reason: unknown) => void
  onProgress?: (progress: GenerationProgress) => void
  signal?: AbortSignal
}

let modelWorker: Worker | undefined
let nextRequestId = 0
const pendingRequests = new Map<number, PendingRequest>()
let idleTermination: ReturnType<typeof setTimeout> | undefined
const IDLE_WORKER_TIMEOUT_MS = 2 * 60_000

function abortError() {
  return new DOMException('CAD generation was cancelled', 'AbortError')
}

function removePendingRequest(id: number) {
  const pending = pendingRequests.get(id)
  if (!pending) return
  pending.signal?.removeEventListener('abort', pending.abort)
  pendingRequests.delete(id)
  scheduleIdleTermination()
}

function scheduleIdleTermination() {
  if (pendingRequests.size > 0 || !modelWorker || idleTermination) return
  const worker = modelWorker
  idleTermination = setTimeout(() => {
    idleTermination = undefined
    if (pendingRequests.size === 0 && modelWorker === worker) {
      worker.terminate()
      modelWorker = undefined
    }
  }, IDLE_WORKER_TIMEOUT_MS)
}

function failWorker(worker: Worker, message: string) {
  if (modelWorker !== worker) return
  modelWorker = undefined
  if (idleTermination) clearTimeout(idleTermination)
  idleTermination = undefined
  worker.terminate()
  // Every request assigned to this kernel must restart, including queued jobs.
  // Each caller gets at most one retry; completed/aborted callers are absent.
  for (const [id, pending] of [...pendingRequests]) {
    if (pending.worker !== worker) continue
    if (pending.retries >= 1) {
      removePendingRequest(id)
      pending.reject(new Error(message))
    } else {
      pending.retries++
      sendRequest(id)
    }
  }
}

function sendRequest(id: number) {
  const pending = pendingRequests.get(id)
  if (!pending) return
  try {
    pending.worker = getModelWorker()
    pending.worker.postMessage(pending.request)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (pending.worker && modelWorker === pending.worker) failWorker(pending.worker, message)
    else {
      removePendingRequest(id)
      pending.reject(new Error(message))
    }
  }
}

function getModelWorker() {
  if (idleTermination) {
    clearTimeout(idleTermination)
    idleTermination = undefined
  }
  if (modelWorker) return modelWorker

  const worker = new Worker(new URL('./worker-entry.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<WorkerReply>) => {
    if (modelWorker !== worker) return
    const reply = event.data
    if (reply.type === 'error') { failWorker(worker, reply.message); return }
    const pending = pendingRequests.get(reply.id)
    if (!pending || pending.worker !== worker) return

    if (reply.type === 'progress') {
      pending.onProgress?.(reply.progress)
    } else if (reply.type === 'complete') {
      removePendingRequest(reply.id)
      pending.resolve(reply.model)
    }
  }
  worker.onerror = (event) => failWorker(worker, event.message || 'CAD worker failed')
  modelWorker = worker
  return worker
}

/** Keep OpenCascade's synchronous geometry operations off the UI thread. */
export function generateModel(input: SettingsInput = {}, options: GenerateOptions = {}): Promise<GeneratedModel> {
  const settings = assertValidSettings(input)
  if (options.signal?.aborted) return Promise.reject(abortError())

  return new Promise((resolve, reject) => {
    const id = ++nextRequestId
    const abort = () => {
      if (!pendingRequests.has(id)) return
      removePendingRequest(id)
      reject(abortError())
    }
    pendingRequests.set(id, { request: { type: 'generate', id, settings }, retries: 0, abort, onProgress: options.onProgress, reject, resolve, signal: options.signal })
    options.signal?.addEventListener('abort', abort, { once: true })
    sendRequest(id)
  })
}
