import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { ModelPart, TriangleMesh } from '../cad'

type ViewMode = 'assembled' | 'exploded'
type Props = { meshes: Record<ModelPart, TriangleMesh>; printPlateSize?: number }

const PARTS: readonly { id: ModelPart; label: string; color: number; offset: [number, number, number] }[] = [
  { id: 'base', label: 'ベース', color: 0x64748b, offset: [-8, -7, -4] },
  { id: 'tray', label: 'トレー', color: 0x0f766e, offset: [8, 7, 5] },
  { id: 'slider', label: 'スライダー', color: 0xd97706, offset: [0, -11, 1] },
  { id: 'lid', label: 'ふた', color: 0x3b82f6, offset: [0, 0, 19] },
]

export function ModelViewer({ meshes, printPlateSize }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<ViewMode>('assembled')
  const [separation, setSeparation] = useState(100)
  const [webglUnavailable, setWebglUnavailable] = useState(false)
  const modeRef = useRef(mode)
  const separationRef = useRef(separation)
  modeRef.current = mode
  separationRef.current = separation

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
    const displayMeshes: { object: THREE.Mesh; offset: THREE.Vector3 }[] = []
    const bounds = new THREE.Box3()
    let plate: THREE.Mesh | undefined
    if (printPlateSize) {
      const geometry = new THREE.BoxGeometry(printPlateSize, printPlateSize, 0.8)
      const material = new THREE.MeshStandardMaterial({ color: 0xe5e9ef, roughness: 0.95, metalness: 0.02 })
      plate = new THREE.Mesh(geometry, material)
      plate.position.set(printPlateSize / 2, printPlateSize / 2, -1)
      group.add(plate)
      bounds.expandByPoint(new THREE.Vector3(0, 0, -1.4))
      bounds.expandByPoint(new THREE.Vector3(printPlateSize, printPlateSize, 0))
    }
    PARTS.forEach((part) => {
      const mesh = meshes[part.id]
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3))
      geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3))
      geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1))
      geometry.computeBoundingBox()
      bounds.union(geometry.boundingBox!)
      const object = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: part.color, roughness: 0.62, metalness: 0.05 }))
      group.add(object)
      displayMeshes.push({ object, offset: new THREE.Vector3(...part.offset) })
    })
    const center = bounds.getCenter(new THREE.Vector3())
    group.position.copy(center).multiplyScalar(-1)
    scene.add(group)
    const size = bounds.getSize(new THREE.Vector3()).length() || 80
    if (printPlateSize) camera.position.set(size * 0.42, -size * 0.52, size * 0.9)
    else camera.position.set(size * 0.7, -size * 0.85, size * 0.65)
    controls.target.set(0, 0, 0)
    controls.update()

    const resize = () => {
      const { width, height } = container.getBoundingClientRect()
      renderer.setSize(width, height, false)
      camera.aspect = width / Math.max(height, 1)
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    resize()
    let frame = 0
    const render = () => {
      const factor = !printPlateSize && modeRef.current === 'exploded' ? separationRef.current / 100 : 0
      displayMeshes.forEach(({ object, offset }) => object.position.copy(offset).multiplyScalar(factor * 0.9))
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
      cancelAnimationFrame(frame)
      observer.disconnect()
      controls.dispose()
      displayMeshes.forEach(({ object }) => { object.geometry.dispose(); (object.material as THREE.Material).dispose() })
      if (plate) { plate.geometry.dispose(); (plate.material as THREE.Material).dispose() }
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [meshes, printPlateSize])

  return <div className="model-viewer">
    {!printPlateSize && <div className="viewer-toolbar" role="group" aria-label="3Dプレビュー表示">
      <button className={mode === 'assembled' ? 'selected' : ''} type="button" onClick={() => setMode('assembled')} aria-pressed={mode === 'assembled'}>完成</button>
      <button className={mode === 'exploded' ? 'selected' : ''} type="button" onClick={() => setMode('exploded')} aria-pressed={mode === 'exploded'}>パーツ分離</button>
    </div>}
    {!printPlateSize && <label className="separation-control">
      <span>分離距離</span>
      <input type="range" min="0" max="180" step="5" value={separation} disabled={mode !== 'exploded'} onChange={(event) => setSeparation(Number(event.target.value))} />
      <output>{separation}%</output>
    </label>}
    {webglUnavailable ? <div className="viewer-fallback">このブラウザでは3Dプレビューを表示できません。ダウンロードしたSTLまたはSTEPをご利用ください。</div> : <div className="viewer-canvas" ref={host} aria-label={printPlateSize ? '印刷プレート上の配置を回転・移動・ズームできる3Dプレビュー' : 'マウスまたはタッチ操作で回転とズームができる3Dプレビュー'} />}
    <div className="part-legend" aria-label="パーツの色"><span className="base">ベース</span><span className="tray">トレー</span><span className="slider">スライダー</span><span className="lid">ふた</span></div>
    <p className="viewer-help">{printPlateSize ? `${printPlateSize} × ${printPlateSize} mmプレート。` : ''}ドラッグで回転、右ドラッグまたは2本指で移動、ホイールまたはピンチで拡大・縮小</p>
  </div>
}
