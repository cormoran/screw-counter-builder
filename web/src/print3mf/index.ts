import JSZip from 'jszip'
import type { GeneratedModel, ModelPart, TriangleMesh } from '../cad/types'

export type BambuPlateSize = { width: number; depth: number }
export const DEFAULT_BAMBU_PLATE: BambuPlateSize = { width: 256, depth: 256 }
/** @deprecated Use DEFAULT_BAMBU_PLATE, which supports rectangular plates. */
export const BAMBU_PLATE_SIZE_MM = DEFAULT_BAMBU_PLATE.width
export const PRINT_PARTS: readonly ModelPart[] = ['base', 'tray', 'slider', 'lid']

export type PrintPartPlacement = { part: ModelPart; plate: number; x: number; y: number; width: number; depth: number }
export type Print3mfPlate = { placements: readonly PrintPartPlacement[]; previewMeshes: Partial<Record<ModelPart, TriangleMesh>>; width: number; depth: number }
export type Print3mfArtifact = {
  file: Blob; plates: readonly Print3mfPlate[]; placements: readonly PrintPartPlacement[]
  /** @deprecated First plate preview. Use plates[n].previewMeshes. */ previewMeshes: Partial<Record<ModelPart, TriangleMesh>>
  /** @deprecated First plate width. Use plates[n].width. */ plateSize: number
}

type Bounds = { min: [number, number, number]; max: [number, number, number] }
type PreparedPart = { part: ModelPart; mesh: TriangleMesh; bounds: Bounds }
type LocalPlacement = Omit<PrintPartPlacement, 'plate'>
const PART_NAMES: Record<ModelPart, string> = { base: 'Base', tray: 'Tray', slider: 'Slider', lid: 'Lid' }
const PART_GAP_MM = 8
// BambuStudio's PartPlate.cpp: LOGICAL_PART_PLATE_GAP = 1 / 5.
const PLATE_GAP_RATIO = 0.2

/**
 * Generates a Bambu Studio project 3MF. Multiple packed groups become actual
 * Bambu plates through model_settings.config and Bambu's virtual-bed grid.
 */
export async function createBambu3mf(model: GeneratedModel, requestedPlate: BambuPlateSize | number = DEFAULT_BAMBU_PLATE): Promise<Print3mfArtifact> {
  const plate = normalisePlate(requestedPlate)
  const parts = await Promise.all(PRINT_PARTS.map(async (part) => {
    const mesh = await binaryStlMesh(model.files[`${part}.stl`])
    return { part, mesh, bounds: meshBounds(mesh) }
  }))
  assertPartsFitIndividually(parts, plate)
  const grouped = packParts(parts, plate)
  const plates: Print3mfPlate[] = grouped.map((group, index) => {
    const placements = group.map((placement) => ({ ...placement, plate: index + 1 }))
    const previewMeshes = Object.fromEntries(group.map((placement) => {
      const source = parts.find(({ part }) => part === placement.part)!
      return [placement.part, translateMesh(source.mesh, placement.x - source.bounds.min[0], placement.y - source.bounds.min[1], -source.bounds.min[2])]
    })) as Partial<Record<ModelPart, TriangleMesh>>
    return { placements, previewMeshes, width: plate.width, depth: plate.depth }
  })
  const placements = plates.flatMap((item) => item.placements)
  const zip = new JSZip()
  zip.file('[Content_Types].xml', contentTypesXml)
  zip.file('_rels/.rels', relationshipsXml)
  zip.file('3D/3dmodel.model', modelXml(parts, placements, plate, plates.length))
  zip.file('Metadata/model_settings.config', modelSettingsXml(placements))
  // filament_colour is required by BambuStudio while it builds plate data.
  zip.file('Metadata/project_settings.config', JSON.stringify({
    name: 'project_settings', from: 'project', printable_area: ['0x0', `${plate.width}x0`, `${plate.width}x${plate.depth}`, `0x${plate.depth}`],
    printer_settings_id: printerPresetFor(plate),
    filament_colour: ['#00AE42'], filament_settings_id: [''], filament_type: ['PLA'], filament_diameter: ['1.75'],
  }))
  return { file: await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }), plates, placements, previewMeshes: plates[0].previewMeshes, plateSize: plate.width }
}

function normalisePlate(value: BambuPlateSize | number): BambuPlateSize {
  const plate = typeof value === 'number' ? { width: value, depth: value } : value
  if (!Number.isFinite(plate.width) || !Number.isFinite(plate.depth) || plate.width <= 0 || plate.depth <= 0) throw new Error('Plate width and depth must be positive numbers')
  return { width: plate.width, depth: plate.depth }
}

function printerPresetFor(plate: BambuPlateSize): string {
  if (plate.width === 350 && plate.depth === 320) return 'Bambu Lab H2D 0.4 nozzle'
  if (plate.width === 330 && plate.depth === 320) return 'Bambu Lab A2L 0.4 nozzle'
  if (plate.width === 180 && plate.depth === 180) return 'Bambu Lab A1 mini 0.4 nozzle'
  return 'Bambu Lab A1 0.4 nozzle'
}

function assertPartsFitIndividually(parts: readonly PreparedPart[], plate: BambuPlateSize): void {
  for (const { part, bounds } of parts) {
    const width = bounds.max[0] - bounds.min[0]; const depth = bounds.max[1] - bounds.min[1]
    if (width > plate.width || depth > plate.depth) throw new Error(`${PART_NAMES[part]} (${width.toFixed(1)} × ${depth.toFixed(1)} mm) does not fit on a ${plate.width} × ${plate.depth} mm plate.`)
  }
}

function packParts(parts: readonly PreparedPart[], plate: BambuPlateSize): LocalPlacement[][] {
  let best: LocalPlacement[][] | undefined
  for (const order of permutations([...parts])) {
    const candidate = shelfPack(order, plate)
    if (!best || candidate.length < best.length || (candidate.length === best.length && footprint(candidate) < footprint(best))) best = candidate
  }
  return best!.map((placements) => centerPlacements(placements, plate))
}

function shelfPack(parts: readonly PreparedPart[], plate: BambuPlateSize): LocalPlacement[][] {
  const result: LocalPlacement[][] = []; let current: LocalPlacement[] = []; let x = 0; let y = 0; let rowDepth = 0
  for (const { part, bounds } of parts) {
    const width = bounds.max[0] - bounds.min[0]; const depth = bounds.max[1] - bounds.min[1]
    if (x > 0 && x + width > plate.width) { x = 0; y += rowDepth + PART_GAP_MM; rowDepth = 0 }
    if (y > 0 && y + depth > plate.depth) { result.push(current); current = []; x = 0; y = 0; rowDepth = 0 }
    current.push({ part, x, y, width, depth }); x += width + PART_GAP_MM; rowDepth = Math.max(rowDepth, depth)
  }
  if (current.length) result.push(current)
  return result
}

/** Shift each plate's occupied bounding box to the build plate center. */
function centerPlacements(placements: LocalPlacement[], plate: BambuPlateSize): LocalPlacement[] {
  const minX = Math.min(...placements.map(({ x }) => x)); const minY = Math.min(...placements.map(({ y }) => y))
  const maxX = Math.max(...placements.map(({ x, width }) => x + width)); const maxY = Math.max(...placements.map(({ y, depth }) => y + depth))
  const dx = (plate.width - (maxX - minX)) / 2 - minX; const dy = (plate.depth - (maxY - minY)) / 2 - minY
  return placements.map((placement) => ({ ...placement, x: placement.x + dx, y: placement.y + dy }))
}

function footprint(plates: readonly LocalPlacement[][]): number {
  return plates.reduce((sum, placements) => sum + Math.max(...placements.map(({ x, width }) => x + width)) * Math.max(...placements.map(({ y, depth }) => y + depth)), 0)
}
function permutations<T>(items: T[]): T[][] { return items.length < 2 ? [items] : items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest])) }

async function binaryStlMesh(file: Blob): Promise<TriangleMesh> {
  const bytes = new DataView(await file.arrayBuffer())
  if (bytes.byteLength < 84) throw new Error('Print STL is too short')
  const triangles = bytes.getUint32(80, true)
  if (84 + triangles * 50 !== bytes.byteLength) throw new Error('Print STL is not a valid binary STL')
  const positions = new Float32Array(triangles * 9); const normals = new Float32Array(triangles * 9); const indices = new Uint32Array(triangles * 3)
  for (let triangle = 0; triangle < triangles; triangle += 1) {
    const source = 84 + triangle * 50; const target = triangle * 9
    const nx = bytes.getFloat32(source, true); const ny = bytes.getFloat32(source + 4, true); const nz = bytes.getFloat32(source + 8, true)
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const offset = source + 12 + vertex * 12
      positions[target + vertex * 3] = bytes.getFloat32(offset, true); positions[target + vertex * 3 + 1] = bytes.getFloat32(offset + 4, true); positions[target + vertex * 3 + 2] = bytes.getFloat32(offset + 8, true)
      normals[target + vertex * 3] = nx; normals[target + vertex * 3 + 1] = ny; normals[target + vertex * 3 + 2] = nz; indices[triangle * 3 + vertex] = triangle * 3 + vertex
    }
  }
  return { positions, normals, indices }
}

function translateMesh(mesh: TriangleMesh, x: number, y: number, z: number): TriangleMesh {
  const positions = new Float32Array(mesh.positions)
  for (let index = 0; index < positions.length; index += 3) { positions[index] += x; positions[index + 1] += y; positions[index + 2] += z }
  return { positions, normals: new Float32Array(mesh.normals), indices: new Uint32Array(mesh.indices) }
}
function meshBounds(mesh: TriangleMesh): Bounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]; const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let index = 0; index < mesh.positions.length; index += 3) for (let axis = 0; axis < 3; axis += 1) { min[axis] = Math.min(min[axis], mesh.positions[index + axis]); max[axis] = Math.max(max[axis], mesh.positions[index + axis]) }
  return { min, max }
}

function modelXml(parts: readonly PreparedPart[], placements: readonly PrintPartPlacement[], plate: BambuPlateSize, plateCount: number): string {
  const resources = parts.map(({ part, mesh }, index) => `<object id="${index + 1}" type="model" name="${PART_NAMES[part]}"><mesh><vertices>${Array.from({ length: mesh.positions.length / 3 }, (_, vertex) => { const offset = vertex * 3; return `<vertex x="${number(mesh.positions[offset])}" y="${number(mesh.positions[offset + 1])}" z="${number(mesh.positions[offset + 2])}"/>` }).join('')}</vertices><triangles>${Array.from({ length: mesh.indices.length / 3 }, (_, triangle) => { const offset = triangle * 3; return `<triangle v1="${mesh.indices[offset]}" v2="${mesh.indices[offset + 1]}" v3="${mesh.indices[offset + 2]}"/>` }).join('')}</triangles></mesh></object>`).join('')
  const cols = Math.ceil(Math.sqrt(plateCount))
  const build = placements.map((placement) => {
    const source = parts.find(({ part }) => part === placement.part)!
    const gridX = ((placement.plate - 1) % cols) * plate.width * (1 + PLATE_GAP_RATIO)
    const gridY = -Math.floor((placement.plate - 1) / cols) * plate.depth * (1 + PLATE_GAP_RATIO)
    return `<item objectid="${PRINT_PARTS.indexOf(placement.part) + 1}" transform="1 0 0 0 1 0 0 0 1 ${number(placement.x - source.bounds.min[0] + gridX)} ${number(placement.y - source.bounds.min[1] + gridY)} ${number(-source.bounds.min[2])}"/>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Title">Screw Counter print plates</metadata><metadata name="Application">BambuStudio-02.08.02.60</metadata><metadata name="BambuStudio:3mfVersion">1</metadata><resources>${resources}</resources><build>${build}</build></model>`
}

function modelSettingsXml(placements: readonly PrintPartPlacement[]): string {
  const objects = PRINT_PARTS.map((part, index) => `<object id="${index + 1}"><metadata key="name" value="${PART_NAMES[part]}"/><metadata key="extruder" value="1"/></object>`).join('')
  const plates = Array.from({ length: Math.max(...placements.map(({ plate }) => plate)) }, (_, index) => {
    const number = index + 1
    const instances = placements.filter(({ plate }) => plate === number).map((placement) => { const id = PRINT_PARTS.indexOf(placement.part) + 1; return `<model_instance><metadata key="object_id" value="${id}"/><metadata key="instance_id" value="0"/><metadata key="identify_id" value="${id}"/></model_instance>` }).join('')
    return `<plate><metadata key="plater_id" value="${number}"/><metadata key="plater_name" value="Plate ${number}"/><metadata key="locked" value="false"/>${instances}</plate>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8"?><config>${objects}${plates}</config>`
}

function number(value: number): string { if (!Number.isFinite(value)) throw new Error('Mesh contains a non-finite coordinate'); return String(Math.round(value * 100000) / 100000) }
const contentTypesXml = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`
const relationshipsXml = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`
