import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { ModelPart, TriangleMesh } from '../cad'

type ViewMode = 'assembled' | 'exploded'
type Props = { meshes: Record<ModelPart, TriangleMesh> }

const PARTS: readonly { id: ModelPart; label: string; color: number; offset: [number, number, number] }[] = [
  { id: 'base', label: 'ベース', color: 0x64748b, offset: [-8, -7, -4] },
  { id: 'tray', label: 'トレー', color: 0x0f766e, offset: [8, 7, 5] },
  { id: 'slider', label: 'スライダー', color: 0xd97706, offset: [0, -11, 1] },
  { id: 'lid', label: 'ふた', color: 0x3b82f6, offset: [0, 0, 19] },
]

export function ModelViewer({ meshes }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<ViewMode>('assembled')
  const [webglUnavailable, setWebglUnavailable] = useState(false)
  const modeRef = useRef(mode)
  modeRef.current = mode

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
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.enablePan = false
    controls.minDistance = 15
    controls.maxDistance = 800
    scene.add(new THREE.HemisphereLight(0xffffff, 0x94a3b8, 2.2))
    const key = new THREE.DirectionalLight(0xffffff, 2.5)
    key.position.set(80, -100, 150)
    scene.add(key)

    const group = new THREE.Group()
    const displayMeshes: { object: THREE.Mesh; offset: THREE.Vector3 }[] = []
    const bounds = new THREE.Box3()
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
    camera.position.set(size * 0.7, -size * 0.85, size * 0.65)
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
      const factor = modeRef.current === 'exploded' ? 1 : 0
      displayMeshes.forEach(({ object, offset }) => object.position.copy(offset).multiplyScalar(factor * 0.9))
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
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [meshes])

  return <div className="model-viewer">
    <div className="viewer-toolbar" role="group" aria-label="3Dプレビュー表示">
      <button className={mode === 'assembled' ? 'selected' : ''} type="button" onClick={() => setMode('assembled')} aria-pressed={mode === 'assembled'}>完成</button>
      <button className={mode === 'exploded' ? 'selected' : ''} type="button" onClick={() => setMode('exploded')} aria-pressed={mode === 'exploded'}>パーツ分離</button>
    </div>
    {webglUnavailable ? <div className="viewer-fallback">このブラウザでは3Dプレビューを表示できません。ダウンロードしたSTLまたはSTEPをご利用ください。</div> : <div className="viewer-canvas" ref={host} aria-label="マウスまたはタッチ操作で回転とズームができる3Dプレビュー" />}
    <div className="part-legend" aria-label="パーツの色"><span className="base">ベース</span><span className="tray">トレー</span><span className="slider">スライダー</span><span className="lid">ふた</span></div>
    <p className="viewer-help">ドラッグで回転、ホイールまたはピンチで拡大・縮小</p>
  </div>
}
