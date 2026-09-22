import type { ModelPart, TriangleMesh } from './types'

type Manifest = { files: Record<ModelPart, string> }
type Reply =
  | { type: 'complete'; meshes: Record<ModelPart, TriangleMesh> }
  | { type: 'error'; message: string }

function parsePreviewMesh(data: ArrayBuffer): TriangleMesh {
  if (data.byteLength < 12) throw new Error('Default preview mesh is truncated')
  const view = new DataView(data)
  const positionLength = view.getUint32(0, true)
  const normalLength = view.getUint32(4, true)
  const indexLength = view.getUint32(8, true)
  const expectedBytes = 12 + (positionLength + normalLength) * Float32Array.BYTES_PER_ELEMENT + indexLength * Uint32Array.BYTES_PER_ELEMENT
  if (expectedBytes !== data.byteLength || positionLength % 3 || normalLength !== positionLength || indexLength % 3) throw new Error('Default preview mesh is invalid')
  const positions = new Float32Array(data.slice(12, 12 + positionLength * 4))
  const normals = new Float32Array(data.slice(12 + positionLength * 4, 12 + (positionLength + normalLength) * 4))
  const indices = new Uint32Array(data.slice(12 + (positionLength + normalLength) * 4))
  return { positions, normals, indices }
}

self.onmessage = async (event: MessageEvent<{ manifestUrl: string }>) => {
  try {
    const manifest = await fetch(event.data.manifestUrl).then(async (response) => {
      if (!response.ok) throw new Error(`Default preview download failed (${response.status})`)
      return response.json() as Promise<Manifest>
    })
    const entries = await Promise.all((Object.entries(manifest.files) as [ModelPart, string][]).map(async ([part, url]) => {
      const response = await fetch(new URL(url, event.data.manifestUrl))
      if (!response.ok) throw new Error(`Default ${part} preview download failed (${response.status})`)
      return [part, parsePreviewMesh(await response.arrayBuffer())] as const
    }))
    const meshes = Object.fromEntries(entries) as Record<ModelPart, TriangleMesh>
    const transfer = Object.values(meshes).flatMap((mesh) => [mesh.positions.buffer, mesh.normals.buffer, mesh.indices.buffer])
    self.postMessage({ type: 'complete', meshes } satisfies Reply, { transfer })
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) } satisfies Reply)
  }
}
