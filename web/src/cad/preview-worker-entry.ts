import { generatePreviewModel } from './generate'
import { partKeys } from './replicad'
import type { PartPreview, GenerationProgress, ModelPart, PreviewModel, Settings, TriangleMesh } from './types'

type PartKeys = Record<ModelPart, string>

type WorkerReply =
  | { type: 'part'; id: number; preview: Omit<PartPreview, 'mesh'> & { mesh?: TriangleMesh } }
  | { type: 'progress'; id: number; progress: GenerationProgress }
  | { type: 'complete'; id: number; model: Omit<PreviewModel, 'partMeshes'>; partMeshes: Partial<Record<ModelPart, TriangleMesh>>; partKeys: PartKeys }
  | { type: 'error'; id: number; message: string }

type WorkerRequest = { type: 'generate'; id: number; settings: Settings; knownPartKeys?: PartKeys }

function reply(message: WorkerReply) {
  if (message.type === 'part') {
    // Transfer copies: the CAD cache keeps ownership of its original buffers.
    const source = message.preview.mesh
    const mesh = source ? { positions: new Float32Array(source.positions), normals: new Float32Array(source.normals), indices: new Uint32Array(source.indices) } : undefined
    self.postMessage({ ...message, preview: { ...message.preview, mesh } }, { transfer: mesh ? [mesh.positions.buffer, mesh.normals.buffer, mesh.indices.buffer] : [] })
    return
  }
  self.postMessage(message)
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, settings, knownPartKeys } = event.data
  try {
    const model = await generatePreviewModel(settings, {
      onPart: (preview) => reply({ type: 'part', id, preview: knownPartKeys?.[preview.part] === partKeys(settings, preview.dimensions)[preview.part] ? { part: preview.part, dimensions: preview.dimensions } : preview }),
      onProgress: (progress) => reply({ type: 'progress', id, progress }),
    })
    const keys = partKeys(settings, model.dimensions)
    // Meshes have already been delivered once, as each part became ready.
    reply({ type: 'complete', id, model: { dimensions: model.dimensions }, partMeshes: {}, partKeys: keys })
  } catch (error) {
    reply({ type: 'error', id, message: error instanceof Error ? error.message : String(error) })
  }
}
