import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { DerivedDimensions, ModelPart, TriangleMesh } from '../cad'
import { DimensionPreview } from './DimensionPreview'

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
type Props = {
  meshes: Partial<Record<ModelPart, TriangleMesh>>
  dimensions?: DerivedDimensions | null
  mode: ViewMode
  cameraState: { current: ViewerCameraState | null }
  printPlateSize?: { width: number; depth: number }
}

const PARTS: readonly { id: ModelPart; label: string; color: number; offset: [number, number, number] }[] = [
  { id: 'base', label: 'ベース', color: 0x64748b, offset: [-8, -7, -4] },
  { id: 'tray', label: 'トレー', color: 0x0f766e, offset: [8, 7, 5] },
  { id: 'slider', label: 'スライダー', color: 0xd97706, offset: [0, -11, 1] },
  { id: 'lid', label: 'ふた', color: 0x3b82f6, offset: [0, 0, 19] },
]

export function ModelViewer({ meshes, dimensions = null, mode, cameraState, printPlateSize }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const [separation, setSeparation] = useState(100)
  const [visibleParts, setVisibleParts] = useState<Partial<Record<ModelPart, boolean>>>({})
  const [webglUnavailable, setWebglUnavailable] = useState(false)
  const modeRef = useRef(mode)
  const separationRef = useRef(separation)
  const visiblePartsRef = useRef(visibleParts)
  const show3d = mode !== '2d' || Boolean(printPlateSize)
  modeRef.current = mode
  separationRef.current = separation
  visiblePartsRef.current = visibleParts

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
    const displayMeshes: { id: ModelPart; object: THREE.Mesh; offset: THREE.Vector3 }[] = []
    const bounds = new THREE.Box3()
    let plate: THREE.Mesh | undefined
    if (printPlateSize) {
      const geometry = new THREE.BoxGeometry(printPlateSize.width, printPlateSize.depth, 0.8)
      const material = new THREE.MeshStandardMaterial({ color: 0xe5e9ef, roughness: 0.95, metalness: 0.02 })
      plate = new THREE.Mesh(geometry, material)
      plate.position.set(printPlateSize.width / 2, printPlateSize.depth / 2, -1)
      group.add(plate)
      bounds.expandByPoint(new THREE.Vector3(0, 0, -1.4))
      bounds.expandByPoint(new THREE.Vector3(printPlateSize.width, printPlateSize.depth, 0))
    }
    PARTS.forEach((part) => {
      const mesh = meshes[part.id]
      if (!mesh) return
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3))
      geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3))
      geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1))
      geometry.computeBoundingBox()
      bounds.union(geometry.boundingBox!)
      const object = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: part.color, roughness: 0.62, metalness: 0.05 }))
      group.add(object)
      displayMeshes.push({ id: part.id, object, offset: new THREE.Vector3(...part.offset) })
    })
    const center = bounds.getCenter(new THREE.Vector3())
    group.position.copy(center).multiplyScalar(-1)
    scene.add(group)
    const size = bounds.getSize(new THREE.Vector3()).length() || 80
    if (!printPlateSize && !cameraState.current) cameraState.current = loadCamera()
    const prior = cameraState.current
    if (prior && prior.sceneSize > 0) {
      const scale = size / prior.sceneSize
      camera.position.fromArray(prior.position).multiplyScalar(scale)
      controls.target.fromArray(prior.target).multiplyScalar(scale)
      camera.zoom = prior.zoom
      camera.updateProjectionMatrix()
    } else {
      if (printPlateSize) camera.position.set(size * 0.42, -size * 0.52, size * 0.9)
      else camera.position.set(size * 0.7, -size * 0.85, size * 0.65)
      controls.target.set(0, 0, 0)
    }
    controls.update()
    const saveCamera = () => {
      cameraState.current = {
        position: camera.position.toArray() as [number, number, number],
        target: controls.target.toArray() as [number, number, number],
        zoom: camera.zoom,
        sceneSize: size,
      }
      if (!printPlateSize) storeCamera(cameraState.current)
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
      const hit = raycaster.intersectObjects(displayMeshes.filter(({ object }) => object.visible).map(({ object }) => object), false)[0]
      if (!hit) return
      const part = displayMeshes.find(({ object }) => object === hit.object)
      if (part) togglePart(part.id)
    }
    if (!printPlateSize) {
      renderer.domElement.addEventListener('pointerdown', onPointerDown)
      renderer.domElement.addEventListener('click', onClick)
    }
    let frame = 0
    const render = () => {
      const factor = !printPlateSize && modeRef.current === 'exploded' ? separationRef.current / 100 : 0
      displayMeshes.forEach(({ id, object, offset }) => {
        object.position.copy(offset).multiplyScalar(factor * 0.9)
        object.visible = Boolean(printPlateSize) || visiblePartsRef.current[id] !== false
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
      if (!printPlateSize) {
        renderer.domElement.removeEventListener('pointerdown', onPointerDown)
        renderer.domElement.removeEventListener('click', onClick)
      }
      controls.dispose()
      displayMeshes.forEach(({ object }) => { object.geometry.dispose(); (object.material as THREE.Material).dispose() })
      if (plate) { plate.geometry.dispose(); (plate.material as THREE.Material).dispose() }
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [meshes, printPlateSize?.width, printPlateSize?.depth, show3d, cameraState])

  return <div className="model-viewer">
    {!printPlateSize && mode !== '2d' && <label className="separation-control">
      <span>分離距離</span>
      <input type="range" min="0" max="180" step="5" value={separation} disabled={mode !== 'exploded'} onChange={(event) => setSeparation(Number(event.target.value))} />
      <output>{separation}%</output>
    </label>}
    {mode === '2d' && !printPlateSize ? <DimensionPreview dimensions={dimensions} /> : <>
      {webglUnavailable ? <div className="viewer-fallback">このブラウザでは3Dプレビューを表示できません。ダウンロードしたSTLまたはSTEPをご利用ください。</div> : <div className="viewer-stage"><div className="viewer-canvas" ref={host} aria-label={printPlateSize ? '印刷プレート上の配置を回転・移動・ズームできる3Dプレビュー' : 'クリックでパーツを表示・非表示にできる3Dプレビュー'} /></div>}
      {!printPlateSize && <div className="part-controls" role="group" aria-label="3Dパーツの表示切替">{PARTS.filter(({ id }) => Boolean(meshes[id])).map(({ id, label }) => <button key={id} type="button" className={`${id}${visibleParts[id] === false ? ' hidden' : ''}`} aria-pressed={visibleParts[id] !== false} onClick={() => togglePart(id)}>{label}</button>)}</div>}
      <div className="part-legend" aria-label="パーツの色">{PARTS.filter(({ id }) => Boolean(meshes[id])).map(({ id, label }) => <span key={id} className={id}>{label}</span>)}</div>
      <p className="viewer-help">{printPlateSize ? `${printPlateSize.width} × ${printPlateSize.depth} mmプレート。` : 'パーツ名またはモデルをクリックして表示・非表示を切り替えます。'} ドラッグで回転、右ドラッグまたは2本指で移動、ホイールまたはピンチで拡大・縮小</p>
    </>}
  </div>
}
