import { assertValidSettings } from './settings'
import type { GenerateOptions, GenerationProgress, ModelPart, PreviewModel, SettingsInput, TriangleMesh } from './types'

type PartKeys = Record<ModelPart, string>

type WorkerReply =
  | { type: 'progress'; id: number; progress: GenerationProgress }
  | { type: 'complete'; id: number; model: Omit<PreviewModel, 'partMeshes'>; partMeshes: Partial<Record<ModelPart, TriangleMesh>>; partKeys: PartKeys }
  | { type: 'error'; id: number; message: string }

type PendingRequest = {
  abort: () => void
  resolve: (model: PreviewModel) => void
  reject: (reason: unknown) => void
  onProgress?: (progress: GenerationProgress) => void
  signal?: AbortSignal
  knownModel?: PreviewModel
}

let previewWorker: Worker | undefined
let nextRequestId = 0
let latestRequestId = 0
const pendingRequests = new Map<number, PendingRequest>()
let acceptedPreview: { model: PreviewModel; partKeys: PartKeys } | undefined
let idleTermination: ReturnType<typeof setTimeout> | undefined
const IDLE_WORKER_TIMEOUT_MS = 2 * 60_000

function abortError() {
  return new DOMException('CAD preview was cancelled', 'AbortError')
}

function removePendingRequest(id: number) {
  const pending = pendingRequests.get(id)
  if (!pending) return
  pending.signal?.removeEventListener('abort', pending.abort)
  pendingRequests.delete(id)
  scheduleIdleTermination()
}

function scheduleIdleTermination() {
  if (pendingRequests.size > 0 || !previewWorker || idleTermination) return
  const worker = previewWorker
  idleTermination = setTimeout(() => {
    idleTermination = undefined
    if (pendingRequests.size === 0 && previewWorker === worker) {
      worker.terminate()
      previewWorker = undefined
    }
  }, IDLE_WORKER_TIMEOUT_MS)
}

function failWorker(worker: Worker, message: string) {
  if (previewWorker !== worker) return
  previewWorker = undefined
  worker.terminate()
  for (const [id, pending] of pendingRequests) {
    removePendingRequest(id)
    pending.reject(new Error(message))
  }
}

function mergePreviewModel(pending: PendingRequest, reply: Extract<WorkerReply, { type: 'complete' }>): PreviewModel {
  const partMeshes = {} as Record<ModelPart, TriangleMesh>
  for (const part of Object.keys(reply.partKeys) as ModelPart[]) {
    const mesh = reply.partMeshes[part] ?? pending.knownModel?.partMeshes[part]
    if (!mesh) throw new Error(`CAD preview worker omitted ${part} without a cached mesh`)
    partMeshes[part] = mesh
  }
  return { ...reply.model, partMeshes }
}

function getPreviewWorker() {
  if (idleTermination) {
    clearTimeout(idleTermination)
    idleTermination = undefined
  }
  if (previewWorker) return previewWorker

  const worker = new Worker(new URL('./preview-worker-entry.ts', import.meta.url), { type: 'module' })
  // OpenCascade retains native allocations across jobs. Keep a short cache
  // window, then release the whole WASM heap once all queued work has settled.
  let completedJobs = 0
  const retireIfIdle = () => {
    if (completedJobs < 4 || pendingRequests.size > 0 || previewWorker !== worker) return
    if (idleTermination) clearTimeout(idleTermination)
    idleTermination = undefined
    worker.terminate()
    previewWorker = undefined
  }
  worker.onmessage = (event: MessageEvent<WorkerReply>) => {
    const reply = event.data
    if (reply.type !== 'progress') completedJobs = reply.type === 'error' ? Infinity : completedJobs + 1
    const pending = pendingRequests.get(reply.id)
    // An aborted or superseded caller can leave work in the persistent worker.
    // Do not let that work update a later request.
    if (!pending) { retireIfIdle(); return }

    if (reply.type === 'progress') {
      pending.onProgress?.(reply.progress)
    } else if (reply.type === 'complete') {
      removePendingRequest(reply.id)
      try {
        const model = mergePreviewModel(pending, reply)
        // Only the newest live request may become the base for subsequent
        // deltas. Older replies can still settle their own callers.
        if (reply.id === latestRequestId) acceptedPreview = { model, partKeys: reply.partKeys }
        pending.resolve(model)
      } catch (error) {
        pending.reject(error)
      }
    } else {
      removePendingRequest(reply.id)
      pending.reject(new Error(reply.message))
    }
    retireIfIdle()
  }
  worker.onerror = (event) => failWorker(worker, event.message || 'CAD preview worker failed')
  previewWorker = worker
  return worker
}

/** Generate viewport-only geometry in a worker; callers can abort stale edits. */
export function generatePreviewModel(input: SettingsInput = {}, options: GenerateOptions = {}): Promise<PreviewModel> {
  const settings = assertValidSettings(input)
  if (options.signal?.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const id = ++nextRequestId
    latestRequestId = id
    const abort = () => {
      if (!pendingRequests.has(id)) return
      removePendingRequest(id)
      reject(abortError())
    }
    pendingRequests.set(id, {
      abort,
      onProgress: options.onProgress,
      reject,
      resolve,
      signal: options.signal,
      knownModel: acceptedPreview?.model,
    })
    options.signal?.addEventListener('abort', abort, { once: true })
    try {
      getPreviewWorker().postMessage({ type: 'generate', id, settings, knownPartKeys: acceptedPreview?.partKeys })
    } catch (error) {
      const worker = previewWorker
      const message = error instanceof Error ? error.message : String(error)
      if (worker) failWorker(worker, message)
      else {
        removePendingRequest(id)
        reject(new Error(message))
      }
    }
  })
}
