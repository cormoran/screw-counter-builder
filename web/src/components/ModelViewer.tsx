import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { DerivedDimensions, ModelPart, TriangleMesh } from '../cad'
import { DimensionPreview } from './DimensionPreview'
import { text, type Language } from '../i18n'

export type ViewMode = 'assembled' | 'exploded' | '2d'
export type ViewerCameraState = {
  position: [number, number, number]
  target: [number, number, number]
  zoom: number
  sceneSize: number
}
const CAMERA_KEY = 'screw-counter-assembly-camera-v1'

function loadCamera(): ViewerCameraState | null {
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(CAMERA_KEY) ?? 'null')
    if (!value || typeof value !== 'object') return null
    const candidate = value as ViewerCameraState
    const numbers = [...candidate.position, ...candidate.target, candidate.zoom, candidate.sceneSize]
    return candidate.position.length === 3 && candidate.target.length === 3 && numbers.every(Number.isFinite) && candidate.zoom > 0 && candidate.sceneSize > 0 ? candidate : null
  } catch { return null }
}

function storeCamera(camera: ViewerCameraState): void {
  try { window.sessionStorage.setItem(CAMERA_KEY, JSON.stringify(camera)) } catch { /* Storage is optional. */ }
}

function clearStoredCamera(): void {
  try { window.sessionStorage.removeItem(CAMERA_KEY) } catch { /* Storage is optional. */ }
}
type Props = {
  meshes: Partial<Record<ModelPart, TriangleMesh>>
  language: Language
  dimensions?: DerivedDimensions | null
  mode: ViewMode
  cameraState: { current: ViewerCameraState | null }
  printPlateSize?: { width: number; depth: number }
  resetKey: number
}
type DisplayMesh = {
  id: ModelPart
  object: THREE.Mesh
  offset: THREE.Vector3
  source: TriangleMesh
}
type ViewerRuntime = {
  update: (meshes: Props['meshes'], printPlateSize?: Props['printPlateSize']) => void
  reset: () => void
}

const PARTS: readonly { id: ModelPart; label: 'base' | 'tray' | 'slider' | 'lid'; color: number; offset: [number, number, number] }[] = [
  { id: 'base', label: 'base', color: 0x64748b, offset: [-8, -7, -4] },
  { id: 'tray', label: 'tray', color: 0x0f766e, offset: [8, 7, 5] },
  { id: 'slider', label: 'slider', color: 0xd97706, offset: [0, -11, 1] },
  { id: 'lid', label: 'lid', color: 0x3b82f6, offset: [0, 0, 19] },
]

export function ModelViewer({ language, meshes, dimensions = null, mode, cameraState, printPlateSize, resetKey }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const [separation, setSeparation] = useState(100)
  const [visibleParts, setVisibleParts] = useState<Partial<Record<ModelPart, boolean>>>({})
  const [webglUnavailable, setWebglUnavailable] = useState(false)
  const modeRef = useRef(mode)
  const separationRef = useRef(separation)
  const visiblePartsRef = useRef(visibleParts)
  const printPlateSizeRef = useRef(printPlateSize)
  const runtime = useRef<ViewerRuntime | null>(null)
  const show3d = mode !== '2d' || Boolean(printPlateSize)
  modeRef.current = mode
  separationRef.current = separation
  visiblePartsRef.current = visibleParts
  printPlateSizeRef.current = printPlateSize

  const togglePart = (part: ModelPart) => {
    setVisibleParts((current) => ({ ...current, [part]: current[part] === false }))
  }

  useEffect(() => {
    const container = host.current
    if (!container) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      setWebglUnavailable(true)
      return
    }
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 10000)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0x000000, 0)
    container.append(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = false
    controls.enablePan = true
    controls.screenSpacePanning = true
    controls.minDistance = 15
    controls.maxDistance = 800
    scene.add(new THREE.HemisphereLight(0xffffff, 0x94a3b8, 2.2))
    const key = new THREE.DirectionalLight(0xffffff, 2.5)
    key.position.set(80, -100, 150)
    scene.add(key)

    const group = new THREE.Group()
    const displayMeshes = new Map<ModelPart, DisplayMesh>()
    let plate: THREE.Mesh | undefined
    let plateSize: Props['printPlateSize']
    let sceneSize = 80
    let positioned = false
    const setDefaultCamera = () => {
      if (printPlateSizeRef.current) camera.position.set(sceneSize * 0.42, -sceneSize * 0.52, sceneSize * 0.9)
      else camera.position.set(sceneSize * 0.7, -sceneSize * 0.85, sceneSize * 0.65)
      controls.target.set(0, 0, 0)
      camera.zoom = 1
      camera.updateProjectionMatrix()
    }
    const createGeometry = (mesh: TriangleMesh) => {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3))
      geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3))
      geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1))
      geometry.computeBoundingBox()
      return geometry
    }
    const update = (nextMeshes: Props['meshes'], nextPlateSize?: Props['printPlateSize']) => {
      const bounds = new THREE.Box3()
      if (nextPlateSize) {
        if (!plate) {
          plate = new THREE.Mesh(new THREE.BoxGeometry(nextPlateSize.width, nextPlateSize.depth, 0.8), new THREE.MeshStandardMaterial({ color: 0xe5e9ef, roughness: 0.95, metalness: 0.02 }))
          group.add(plate)
        } else if (!plateSize || plateSize.width !== nextPlateSize.width || plateSize.depth !== nextPlateSize.depth) {
          plate.geometry.dispose()
          plate.geometry = new THREE.BoxGeometry(nextPlateSize.width, nextPlateSize.depth, 0.8)
        }
        plate.position.set(nextPlateSize.width / 2, nextPlateSize.depth / 2, -1)
        bounds.expandByPoint(new THREE.Vector3(0, 0, -1.4))
        bounds.expandByPoint(new THREE.Vector3(nextPlateSize.width, nextPlateSize.depth, 0))
      } else if (plate) {
        group.remove(plate)
        plate.geometry.dispose()
        ;(plate.material as THREE.Material).dispose()
        plate = undefined
      }
      plateSize = nextPlateSize

      PARTS.forEach((part) => {
        const mesh = nextMeshes[part.id]
        const existing = displayMeshes.get(part.id)
        if (!mesh) {
          if (existing) {
            group.remove(existing.object)
            existing.object.geometry.dispose()
            ;(existing.object.material as THREE.Material).dispose()
            displayMeshes.delete(part.id)
          }
          return
        }
        if (existing) {
          if (existing.source !== mesh) {
            const geometry = createGeometry(mesh)
            existing.object.geometry.dispose()
            existing.object.geometry = geometry
            existing.source = mesh
          }
          return
        }
        const object = new THREE.Mesh(createGeometry(mesh), new THREE.MeshStandardMaterial({ color: part.color, roughness: 0.62, metalness: 0.05 }))
        group.add(object)
        displayMeshes.set(part.id, { id: part.id, object, offset: new THREE.Vector3(...part.offset), source: mesh })
      })
      displayMeshes.forEach(({ object }) => {
        if (!object.geometry.boundingBox) object.geometry.computeBoundingBox()
        bounds.union(object.geometry.boundingBox!)
      })
      const center = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3())
      group.position.copy(center).multiplyScalar(-1)
      const size = bounds.isEmpty() ? 80 : bounds.getSize(new THREE.Vector3()).length() || 80
      if (!positioned) {
        if (!nextPlateSize && !cameraState.current) cameraState.current = loadCamera()
        const prior = cameraState.current
        if (prior && prior.sceneSize > 0) {
          const scale = size / prior.sceneSize
          camera.position.fromArray(prior.position).multiplyScalar(scale)
          controls.target.fromArray(prior.target).multiplyScalar(scale)
          camera.zoom = prior.zoom
          camera.updateProjectionMatrix()
        } else {
          setDefaultCamera()
        }
        positioned = true
      } else if (sceneSize > 0) {
        const scale = size / sceneSize
        camera.position.multiplyScalar(scale)
        controls.target.multiplyScalar(scale)
        camera.updateProjectionMatrix()
      }
      sceneSize = size
      controls.update()
    }
    scene.add(group)
    const saveCamera = () => {
      cameraState.current = {
        position: camera.position.toArray() as [number, number, number],
        target: controls.target.toArray() as [number, number, number],
        zoom: camera.zoom,
        sceneSize,
      }
      if (!printPlateSizeRef.current) storeCamera(cameraState.current)
    }
    controls.addEventListener('end', saveCamera)

    const resize = () => {
      const { width, height } = container.getBoundingClientRect()
      renderer.setSize(width, height, false)
      camera.aspect = width / Math.max(height, 1)
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    resize()
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    let pointerDown: { x: number; y: number } | undefined
    const onPointerDown = (event: PointerEvent) => { pointerDown = { x: event.clientX, y: event.clientY } }
    const onClick = (event: MouseEvent) => {
      if (!pointerDown || Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 5) return
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(pointer, camera)
      if (printPlateSizeRef.current) return
      const hit = raycaster.intersectObjects([...displayMeshes.values()].filter(({ object }) => object.visible).map(({ object }) => object), false)[0]
      if (!hit) return
      const part = [...displayMeshes.values()].find(({ object }) => object === hit.object)
      if (part) togglePart(part.id)
    }
    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('click', onClick)
    const reset = () => {
      cameraState.current = null
      if (!printPlateSizeRef.current) clearStoredCamera()
      setDefaultCamera()
      controls.update()
    }
    runtime.current = { update, reset }
    let frame = 0
    const render = () => {
      const factor = !printPlateSizeRef.current && modeRef.current === 'exploded' ? separationRef.current / 100 : 0
      displayMeshes.forEach(({ id, object, offset }) => {
        object.position.copy(offset).multiplyScalar(factor * 0.9)
        object.visible = Boolean(printPlateSizeRef.current) || visiblePartsRef.current[id] !== false
      })
      const zoom = 1 / (1 + factor * 0.4)
      if (camera.zoom !== zoom) {
        camera.zoom = zoom
        camera.updateProjectionMatrix()
      }
      controls.update()
      renderer.render(scene, camera)
      frame = requestAnimationFrame(render)
    }
    render()
    return () => {
      saveCamera()
      cancelAnimationFrame(frame)
      observer.disconnect()
      if (runtime.current?.update === update) runtime.current = null
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('click', onClick)
      controls.dispose()
      displayMeshes.forEach(({ object }) => { object.geometry.dispose(); (object.material as THREE.Material).dispose() })
      if (plate) { plate.geometry.dispose(); (plate.material as THREE.Material).dispose() }
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [show3d, cameraState])

  useEffect(() => {
    runtime.current?.update(meshes, printPlateSize)
  }, [meshes, printPlateSize?.width, printPlateSize?.depth, show3d])

  useEffect(() => {
    if (resetKey === 0) return
    setSeparation(100)
    setVisibleParts({})
    runtime.current?.reset()
  }, [resetKey])

  return <div className="model-viewer">
    {!printPlateSize && mode !== '2d' && <label className="separation-control">
      <span>{text(language, 'separation')}</span>
      <input type="range" min="0" max="180" step="5" value={separation} disabled={mode !== 'exploded'} onChange={(event) => setSeparation(Number(event.target.value))} />
      <output>{separation}%</output>
    </label>}
    {mode === '2d' && !printPlateSize ? <DimensionPreview dimensions={dimensions} language={language} /> : <>
      {webglUnavailable ? <div className="viewer-fallback">{text(language, 'noWebgl')}</div> : <div className="viewer-stage"><div className="viewer-canvas" ref={host} aria-label={text(language, printPlateSize ? 'printPlatePreview' : 'modelPreview')} /></div>}
      {!printPlateSize && <div className="part-controls" role="group" aria-label={text(language, 'partVisibility')}>{PARTS.filter(({ id }) => Boolean(meshes[id])).map(({ id, label }) => <button key={id} type="button" className={`${id}${visibleParts[id] === false ? ' hidden' : ''}`} aria-pressed={visibleParts[id] !== false} onClick={() => togglePart(id)}>{text(language, label)}</button>)}</div>}
      <div className="part-legend" aria-label={text(language, 'partColors')}>{PARTS.filter(({ id }) => Boolean(meshes[id])).map(({ id, label }) => <span key={id} className={id}>{text(language, label)}</span>)}</div>
      <p className="viewer-help">{printPlateSize ? text(language, 'printPlateHelp', printPlateSize) : text(language, 'modelHelp')} {text(language, 'viewerControls')}</p>
    </>}
  </div>
}
