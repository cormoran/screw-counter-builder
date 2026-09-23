/** Generate the checked-in default preview from browser CAD assembly meshes. */
import { expect, it, vi } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

vi.mock('replicad-opencascadejs/wasm?url', () => ({
  default: resolve(dirname(fileURLToPath(import.meta.url)), '../node_modules/replicad-opencascadejs/dist/replicad_single.wasm'),
}))

it('writes assembly-coordinate default preview meshes', async () => {
  const { generatePreviewModel } = await import('../src/cad/generate')
  const { DEFAULT_SETTINGS } = await import('../src/cad/settings')
  const model = await generatePreviewModel()
  const output = resolve(dirname(fileURLToPath(import.meta.url)), '../public/default-preview')
  await mkdir(output, { recursive: true })
  let rawBytes = 0
  let gzipBytes = 0
  const files = {} as Record<string, string>
  for (const [part, mesh] of Object.entries(model.partMeshes)) {
    const header = new Uint32Array([mesh.positions.length, mesh.normals.length, mesh.indices.length])
    const data = new Uint8Array(header.byteLength + mesh.positions.byteLength + mesh.normals.byteLength + mesh.indices.byteLength)
    data.set(new Uint8Array(header.buffer), 0)
    data.set(new Uint8Array(mesh.positions.buffer), header.byteLength)
    data.set(new Uint8Array(mesh.normals.buffer), header.byteLength + mesh.positions.byteLength)
    data.set(new Uint8Array(mesh.indices.buffer), header.byteLength + mesh.positions.byteLength + mesh.normals.byteLength)
    const name = `${part}.mesh`
    await writeFile(resolve(output, name), data)
    files[part] = name
    rawBytes += data.byteLength
    gzipBytes += gzipSync(data).byteLength
  }
  await writeFile(resolve(output, 'manifest.json'), `${JSON.stringify({
    version: 2,
    settings: DEFAULT_SETTINGS,
    files,
    rawBytes,
    gzipBytes,
  }, null, 2)}\n`)
  expect(Object.keys(files)).toEqual(['base', 'tray', 'slider', 'lid', 'funnel'])
}, 120_000)
