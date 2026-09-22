import type { ModelPart, TriangleMesh } from './types'

export const DEFAULT_PREVIEW_CONFIRM_BYTES = 1_000_000

export type DefaultPreviewInfo = {
  version: number
  settings: { rows: number; columns: number; screw: string; screwSpaceHeight: number }
  files: Record<ModelPart, string>
  rawBytes: number
  gzipBytes: number
}

type Reply =
  | { type: 'complete'; meshes: Record<ModelPart, TriangleMesh> }
  | { type: 'error'; message: string }

let infoPromise: Promise<DefaultPreviewInfo> | undefined
let meshPromise: Promise<Record<ModelPart, TriangleMesh>> | undefined

function manifestUrl() {
  return new URL('default-preview/manifest.json', new URL(import.meta.env.BASE_URL, window.location.origin)).toString()
}

/** Read the small manifest before deciding whether a connection confirmation is needed. */
export function getDefaultPreviewInfo(): Promise<DefaultPreviewInfo> {
  return (infoPromise ??= fetch(manifestUrl()).then(async (response) => {
    if (!response.ok) throw new Error(`Default preview manifest download failed (${response.status})`)
    return response.json() as Promise<DefaultPreviewInfo>
  }))
}

/** Download and parse the pre-generated assembly meshes off the UI thread. */
export function loadDefaultPreview(): Promise<Record<ModelPart, TriangleMesh>> {
  return (meshPromise ??= new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./default-preview-worker-entry.ts', import.meta.url), { type: 'module' })
    const finish = () => worker.terminate()
    worker.onmessage = (event: MessageEvent<Reply>) => {
      finish()
      event.data.type === 'complete' ? resolve(event.data.meshes) : reject(new Error(event.data.message))
    }
    worker.onerror = (event) => { finish(); reject(new Error(event.message || 'Default preview worker failed')) }
    worker.postMessage({ manifestUrl: manifestUrl() })
  }))
}
