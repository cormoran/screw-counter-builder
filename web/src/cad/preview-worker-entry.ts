import { generatePreviewModel } from './generate'
import { partKeys } from './replicad'
import type { GenerationProgress, ModelPart, PreviewModel, Settings, TriangleMesh } from './types'

type PartKeys = Record<ModelPart, string>

type WorkerReply =
  | { type: 'progress'; id: number; progress: GenerationProgress }
  | { type: 'complete'; id: number; model: Omit<PreviewModel, 'partMeshes'>; partMeshes: Partial<Record<ModelPart, TriangleMesh>>; partKeys: PartKeys }
  | { type: 'error'; id: number; message: string }

type WorkerRequest = { type: 'generate'; id: number; settings: Settings; knownPartKeys?: PartKeys }

function cloneMeshesForTransfer(partMeshes: Partial<Record<ModelPart, TriangleMesh>>) {
  const clones: Partial<Record<ModelPart, TriangleMesh>> = {}
  for (const [part, mesh] of Object.entries(partMeshes) as Array<[ModelPart, TriangleMesh]>) {
    clones[part] = {
      positions: new Float32Array(mesh.positions),
      normals: new Float32Array(mesh.normals),
      indices: new Uint32Array(mesh.indices),
    }
  }
  return clones
}

function reply(message: WorkerReply) {
  if (message.type !== 'complete') return self.postMessage(message)
  // Cached meshes stay owned by the worker. Transfer copied buffers so a
  // response cannot detach the cache used by the next parameter update.
  const partMeshes = cloneMeshesForTransfer(message.partMeshes)
  const transfer = Object.values(partMeshes).flatMap((mesh) => [
    mesh.positions.buffer as ArrayBuffer, mesh.normals.buffer as ArrayBuffer, mesh.indices.buffer as ArrayBuffer,
  ])
  self.postMessage({ ...message, partMeshes }, { transfer })
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, settings, knownPartKeys } = event.data
  try {
    const model = await generatePreviewModel(settings, {
      onProgress: (progress) => reply({ type: 'progress', id, progress }),
    })
    const keys = partKeys(settings, model.dimensions)
    const partMeshes = Object.fromEntries(Object.entries(model.partMeshes).filter(([part]) => knownPartKeys?.[part as ModelPart] !== keys[part as ModelPart])) as Partial<Record<ModelPart, TriangleMesh>>
    reply({ type: 'complete', id, model: { dimensions: model.dimensions }, partMeshes, partKeys: keys })
  } catch (error) {
    reply({ type: 'error', id, message: error instanceof Error ? error.message : String(error) })
  }
}
