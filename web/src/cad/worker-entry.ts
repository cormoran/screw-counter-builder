import { generateModel } from './generate'
import type { GeneratedModel, GenerationProgress, Settings } from './types'

type WorkerReply =
  | { type: 'progress'; progress: GenerationProgress }
  | { type: 'complete'; model: GeneratedModel }
  | { type: 'error'; message: string }

function reply(message: WorkerReply) {
  if (message.type !== 'complete') {
    self.postMessage(message)
    return
  }
  const transfer = Object.values(message.model.partMeshes).flatMap((mesh) => [
    mesh.positions.buffer as ArrayBuffer, mesh.normals.buffer as ArrayBuffer, mesh.indices.buffer as ArrayBuffer,
  ])
  self.postMessage(message, { transfer })
}

self.onmessage = async (event: MessageEvent<Settings>) => {
  try {
    const model = await generateModel(event.data, {
      onProgress: (progress) => reply({ type: 'progress', progress }),
    })
    reply({ type: 'complete', model })
  } catch (error) {
    reply({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
