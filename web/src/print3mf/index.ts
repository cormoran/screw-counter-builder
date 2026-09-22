import JSZip from 'jszip'
import type { GeneratedModel, ModelPart, TriangleMesh } from '../cad/types'

/** The four parts are placed flat on a 256 mm square Bambu plate. */
export const BAMBU_PLATE_SIZE_MM = 256
export const PRINT_PARTS: readonly ModelPart[] = ['base', 'tray', 'slider', 'lid']

export type PrintPartPlacement = {
  part: ModelPart
  /** Lower-left plate position in millimetres. */
  x: number
  y: number
  width: number
  depth: number
}

export type Print3mfArtifact = {
  /** A standards-compliant Core 3MF that Bambu Studio imports with this layout. */
  file: Blob
  placements: readonly PrintPartPlacement[]
  /** Flat, plate-coordinate meshes for a dedicated print-layout preview. */
  previewMeshes: Record<ModelPart, TriangleMesh>
  plateSize: number
}

type Bounds = { min: [number, number, number]; max: [number, number, number] }

const PART_NAMES: Record<ModelPart, string> = {
  base: 'Base', tray: 'Tray', slider: 'Slider', lid: 'Lid',
}

/**
 * Creates a generic Core 3MF package. Bambu Studio accepts Core 3MF model
 * files and retains each build item's transform when opening the file.
 *
 * A sliced `.gcode.3mf` cannot be made safely without a selected printer,
 * nozzle, filament, and process preset, so this is intentionally a project to
 * open and slice in Bambu Studio rather than printer-ready G-code.
 */
export async function createBambu3mf(model: GeneratedModel, plateSize = BAMBU_PLATE_SIZE_MM): Promise<Print3mfArtifact> {
  if (!Number.isFinite(plateSize) || plateSize <= 0) throw new Error('Plate size must be a positive number')
  // Use the same 0.04 mm / 0.15 rad mesh exported for printing, rather than
  // the coarser 0.08 mm / 0.2 rad display mesh stored in partMeshes.
  const prepared = await Promise.all(PRINT_PARTS.map(async (part) => ({
    part,
    mesh: await binaryStlMesh(model.files[`${part}.stl`]),
  })))
  const placements = arrange(prepared.map(({ part, mesh }) => ({ part, bounds: meshBounds(mesh) })), plateSize)
  const byPart = new Map(prepared.map((item) => [item.part, item.mesh]))
  const previewMeshes = Object.fromEntries(placements.map((placement) => [
    placement.part,
    translateMesh(byPart.get(placement.part)!, placement.x, placement.y, 0),
  ])) as Record<ModelPart, TriangleMesh>
  const xml = modelXml(prepared, placements)
  const zip = new JSZip()
  zip.file('[Content_Types].xml', contentTypesXml)
  zip.file('_rels/.rels', relationshipsXml)
  zip.file('3D/3dmodel.model', xml)
  return {
    file: await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }),
    placements,
    previewMeshes,
    plateSize,
  }
}

function arrange(parts: Array<{ part: ModelPart; bounds: Bounds }>, plateSize: number): PrintPartPlacement[] {
  const gap = 8
  const margin = 7
  const firstColumn = Math.max(parts[0].bounds.max[0] - parts[0].bounds.min[0], parts[2].bounds.max[0] - parts[2].bounds.min[0])
  const firstRow = Math.max(parts[0].bounds.max[1] - parts[0].bounds.min[1], parts[1].bounds.max[1] - parts[1].bounds.min[1])
  const positions: Array<[number, number]> = [[margin, margin], [margin + firstColumn + gap, margin], [margin, margin + firstRow + gap], [margin + firstColumn + gap, margin + firstRow + gap]]
  const placements = parts.map(({ part, bounds }, index) => ({
    part, x: positions[index][0], y: positions[index][1],
    width: bounds.max[0] - bounds.min[0], depth: bounds.max[1] - bounds.min[1],
  }))
  const usedWidth = Math.max(...placements.map(({ x, width }) => x + width)) + margin
  const usedDepth = Math.max(...placements.map(({ y, depth }) => y + depth)) + margin
  if (usedWidth > plateSize || usedDepth > plateSize) {
    throw new Error(`The ${usedWidth.toFixed(1)} × ${usedDepth.toFixed(1)} mm print layout does not fit a ${plateSize} × ${plateSize} mm plate.`)
  }
  return placements
}

async function binaryStlMesh(file: Blob): Promise<TriangleMesh> {
  const bytes = new DataView(await file.arrayBuffer())
  if (bytes.byteLength < 84) throw new Error('Print STL is too short')
  const triangles = bytes.getUint32(80, true)
  if (84 + triangles * 50 !== bytes.byteLength) throw new Error('Print STL is not a valid binary STL')
  const positions = new Float32Array(triangles * 9)
  const normals = new Float32Array(triangles * 9)
  const indices = new Uint32Array(triangles * 3)
  for (let triangle = 0; triangle < triangles; triangle += 1) {
    const source = 84 + triangle * 50
    const target = triangle * 9
    const nx = bytes.getFloat32(source, true)
    const ny = bytes.getFloat32(source + 4, true)
    const nz = bytes.getFloat32(source + 8, true)
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const offset = source + 12 + vertex * 12
      positions[target + vertex * 3] = bytes.getFloat32(offset, true)
      positions[target + vertex * 3 + 1] = bytes.getFloat32(offset + 4, true)
      positions[target + vertex * 3 + 2] = bytes.getFloat32(offset + 8, true)
      normals[target + vertex * 3] = nx
      normals[target + vertex * 3 + 1] = ny
      normals[target + vertex * 3 + 2] = nz
      indices[triangle * 3 + vertex] = triangle * 3 + vertex
    }
  }
  return { positions, normals, indices }
}

function translateMesh(mesh: TriangleMesh, x: number, y: number, z: number): TriangleMesh {
  const positions = new Float32Array(mesh.positions)
  for (let index = 0; index < positions.length; index += 3) {
    positions[index] += x; positions[index + 1] += y; positions[index + 2] += z
  }
  return { positions, normals: new Float32Array(mesh.normals), indices: new Uint32Array(mesh.indices) }
}

function meshBounds(mesh: TriangleMesh): Bounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let index = 0; index < mesh.positions.length; index += 3) for (let axis = 0; axis < 3; axis += 1) {
    min[axis] = Math.min(min[axis], mesh.positions[index + axis])
    max[axis] = Math.max(max[axis], mesh.positions[index + axis])
  }
  return { min, max }
}

function modelXml(prepared: Array<{ part: ModelPart; mesh: TriangleMesh }>, placements: readonly PrintPartPlacement[]): string {
  const resources = prepared.map(({ part, mesh }, index) => {
    const vertices = Array.from({ length: mesh.positions.length / 3 }, (_, vertex) => {
      const offset = vertex * 3
      return `<vertex x="${number(mesh.positions[offset])}" y="${number(mesh.positions[offset + 1])}" z="${number(mesh.positions[offset + 2])}"/>`
    }).join('')
    const triangles = Array.from({ length: mesh.indices.length / 3 }, (_, triangle) => {
      const offset = triangle * 3
      return `<triangle v1="${mesh.indices[offset]}" v2="${mesh.indices[offset + 1]}" v3="${mesh.indices[offset + 2]}"/>`
    }).join('')
    return `<object id="${index + 1}" type="model" name="${PART_NAMES[part]}"><mesh><vertices>${vertices}</vertices><triangles>${triangles}</triangles></mesh></object>`
  }).join('')
  const build = placements.map(({ x, y }, index) => `<item objectid="${index + 1}" transform="1 0 0 0 1 0 0 0 1 ${number(x)} ${number(y)} 0"/>`).join('')
  return `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Title">Screw Counter print plate</metadata><metadata name="Application">Screw Counter Builder</metadata><resources>${resources}</resources><build>${build}</build></model>`
}

function number(value: number): string {
  // 3MF requires a locale-invariant finite decimal lexical form.
  if (!Number.isFinite(value)) throw new Error('Mesh contains a non-finite coordinate')
  return String(Math.round(value * 100000) / 100000)
}

const contentTypesXml = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`
const relationshipsXml = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`
