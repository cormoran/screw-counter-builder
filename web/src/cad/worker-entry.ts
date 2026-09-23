import { generateModel } from './generate'
import type { PartPreview, GeneratedModel, GenerationProgress, ModelPart, Settings, TriangleMesh } from './types'

type WorkerReply =
  | { type: 'part'; id: number; preview: PartPreview }
  | { type: 'progress'; id: number; progress: GenerationProgress }
  | { type: 'complete'; id: number; model: GeneratedModel }
  | { type: 'error'; id: number; message: string }

type WorkerRequest = { type: 'generate'; id: number; settings: Settings }

function cloneMeshesForTransfer(model: GeneratedModel): GeneratedModel {
  const partMeshes = {} as Record<ModelPart, TriangleMesh>
  for (const [part, mesh] of Object.entries(model.partMeshes) as Array<[ModelPart, TriangleMesh]>) {
    partMeshes[part] = {
      positions: new Float32Array(mesh.positions),
      normals: new Float32Array(mesh.normals),
      indices: new Uint32Array(mesh.indices),
    }
  }
  return { ...model, partMeshes }
}

function reply(message: WorkerReply) {
  if (message.type === 'part') {
    // Transfer copies: the CAD cache keeps ownership of its original buffers.
    const source = message.preview.mesh
    const mesh = source ? { positions: new Float32Array(source.positions), normals: new Float32Array(source.normals), indices: new Uint32Array(source.indices) } : undefined
    self.postMessage({ ...message, preview: { ...message.preview, mesh } }, { transfer: mesh ? [mesh.positions.buffer, mesh.normals.buffer, mesh.indices.buffer] : [] })
    return
  }
  if (message.type !== 'complete') {
    self.postMessage(message)
    return
  }
  const model = cloneMeshesForTransfer(message.model)
  const transfer = Object.values(model.partMeshes).flatMap((mesh) => [
    mesh.positions.buffer as ArrayBuffer, mesh.normals.buffer as ArrayBuffer, mesh.indices.buffer as ArrayBuffer,
  ])
  self.postMessage({ ...message, model }, { transfer })
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, settings } = event.data
  try {
    const model = await generateModel(settings, {
      onPart: (preview) => reply({ type: 'part', id, preview }),
      onProgress: (progress) => reply({ type: 'progress', id, progress }),
    })
    reply({ type: 'complete', id, model })
  } catch (error) {
    reply({ type: 'error', id, message: error instanceof Error ? error.message : String(error) })
  }
}
