import { generateModel } from './generate'
import type { GeneratedModel, GenerationProgress, Settings } from './types'

type WorkerReply =
  | { type: 'progress'; progress: GenerationProgress }
  | { type: 'complete'; model: GeneratedModel }
  | { type: 'error'; message: string }

function reply(message: WorkerReply) {
  self.postMessage(message)
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
