import { partKeys } from './part-keys'
import type { DerivedDimensions, ModelPart, Settings, TriangleMesh } from './types'

type Meshes = Partial<Record<ModelPart, TriangleMesh>>

/** Retain visible geometry independently of the native worker's lifetime. */
export class PreviewMeshCache {
  private parts: Partial<Record<ModelPart, { key: string; mesh: TriangleMesh }>> = {}

  remember(settings: Settings, dimensions: DerivedDimensions, meshes: Meshes): void {
    const keys = partKeys(settings, dimensions)
    for (const part of Object.keys(meshes) as ModelPart[]) {
      const mesh = meshes[part]
      if (mesh) this.parts[part] = { key: keys[part], mesh }
    }
  }

  match(settings: Settings, dimensions: DerivedDimensions): Meshes {
    const keys = partKeys(settings, dimensions)
    const meshes: Meshes = {}
    for (const part of Object.keys(keys) as ModelPart[]) {
      const cached = this.parts[part]
      if (cached?.key === keys[part]) meshes[part] = cached.mesh
    }
    return meshes
  }
}
