import { generatePreviewModel } from './generate'
import type { GenerationProgress, PreviewModel, Settings } from './types'

type WorkerReply =
  | { type: 'progress'; progress: GenerationProgress }
  | { type: 'complete'; model: PreviewModel }
  | { type: 'error'; message: string }

function reply(message: WorkerReply) {
  if (message.type !== 'complete') return self.postMessage(message)
  const transfer = Object.values(message.model.partMeshes).flatMap((mesh) => [
    mesh.positions.buffer as ArrayBuffer, mesh.normals.buffer as ArrayBuffer, mesh.indices.buffer as ArrayBuffer,
  ])
  self.postMessage(message, { transfer })
}

self.onmessage = async (event: MessageEvent<Settings>) => {
  try {
    reply({ type: 'complete', model: await generatePreviewModel(event.data, {
      onProgress: (progress) => reply({ type: 'progress', progress }),
    }) })
  } catch (error) {
    reply({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
