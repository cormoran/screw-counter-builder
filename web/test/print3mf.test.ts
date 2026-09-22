import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { createBambu3mf } from '../src/print3mf'
import type { GeneratedModel, ModelPart, TriangleMesh } from '../src/cad/types'

const triangle = (offset: number): TriangleMesh => ({
  positions: new Float32Array([offset, 0, 0, offset + 10, 0, 0, offset, 10, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2]),
})

function binaryStl(mesh: TriangleMesh): Blob {
  const bytes = new ArrayBuffer(84 + 50)
  const view = new DataView(bytes)
  view.setUint32(80, 1, true)
  view.setFloat32(84, 0, true); view.setFloat32(88, 0, true); view.setFloat32(92, 1, true)
  for (let vertex = 0; vertex < 3; vertex += 1) for (let axis = 0; axis < 3; axis += 1) view.setFloat32(96 + vertex * 12 + axis * 4, mesh.positions[vertex * 3 + axis], true)
  return new Blob([bytes], { type: 'model/stl' })
}

const meshes = Object.fromEntries(['base', 'tray', 'slider', 'lid'].map((part, index) => [part, triangle(index * 20)])) as Record<ModelPart, TriangleMesh>
const model = {
  partMeshes: meshes,
  files: Object.fromEntries(['base', 'tray', 'slider', 'lid'].map((part) => [`${part}.stl`, binaryStl(meshes[part as ModelPart])])),
} as GeneratedModel

describe('Bambu 3MF export', () => {
  it('creates a Core 3MF package with four flat, non-overlapping build items', async () => {
    const artifact = await createBambu3mf(model, 64)
    expect(artifact.placements).toHaveLength(4)
    expect(artifact.placements.every((placement) => placement.x >= 0 && placement.y >= 0)).toBe(true)
    expect(artifact.previewMeshes.lid.positions[2]).toBe(0)
    const archive = await JSZip.loadAsync(artifact.file)
    expect(await archive.file('[Content_Types].xml')!.async('text')).toContain('3dmanufacturing-3dmodel+xml')
    const xml = await archive.file('3D/3dmodel.model')!.async('text')
    expect(xml).toContain('unit="millimeter"')
    expect(xml.match(/<object /g)).toHaveLength(4)
    expect(xml.match(/<item /g)).toHaveLength(4)
    expect(xml).toContain('transform="1 0 0 0 1 0 0 0 1 7 7 0"')
  })

  it('reports when the configured Bambu plate cannot hold the generated layout', async () => {
    await expect(createBambu3mf(model, 20)).rejects.toThrow('does not fit')
  })
})
