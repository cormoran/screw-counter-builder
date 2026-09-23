import { expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { generateModel } from "../src/cad/generate";

vi.mock("replicad-opencascadejs/wasm?url", () => ({
  default: resolve(dirname(fileURLToPath(import.meta.url)), "../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
}));

it.each(["magnets", "pegs"] as const)("supports every %s corner land continuously from the bottom", async (funnelAlignment) => {
  for (const settings of [{}, { rows: 1, columns: 1, magnetDiameter: 8, magnetDiameterClearance: 0.6, funnelHeight: 160 }]) {
    // Export validation also checks the outlet, screw flow and attachment fit.
    const model = await generateModel({ ...settings, funnelAlignment });
    const d = model.dimensions;
    const mesh = model.partMeshes.funnel;
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(mesh.positions, 3));
    geometry.setIndex(new BufferAttribute(mesh.indices, 1));
    const material = new MeshBasicMaterial({ side: DoubleSide });
    const solid = new Mesh(geometry, material);
    for (const p of d.funnelMounts) {
      const span = Math.min(p.y, d.width - p.y) + d.magnetPocketDiameter / 2 + 1.2;
      // Sample inside the R2 corner, outside the bore: a former
      // suspended land would have extra cavity crossings above the bottom.
      const x = p.x < d.length / 2 ? span - 0.8 : d.length - span + 0.8;
      const y = p.y < d.width / 2 ? span - 0.9 : d.width - span + 0.9;
      const ray = new Raycaster(new Vector3(x, y, -d.funnelDepth - 1), new Vector3(0, 0, 1));
      const hits = ray.intersectObject(solid);
      expect(hits).toHaveLength(2);
      expect(hits[0].point.z).toBeCloseTo(-d.funnelDepth);
      expect(hits[1].point.z).toBeCloseTo(0);
      // The old sharp corner must no longer reach the mounting surface.
      const cornerX = p.x < d.length / 2 ? span - 0.3 : d.length - span + 0.3;
      const cornerY = p.y < d.width / 2 ? span - 0.4 : d.width - span + 0.4;
      ray.set(new Vector3(cornerX, cornerY, 1), new Vector3(0, 0, -1));
      const cornerHits = ray.intersectObject(solid);
      expect(cornerHits.length).toBeGreaterThan(0);
      expect(cornerHits[0].point.z).toBeLessThan(-0.1);
    }
    geometry.dispose();
    material.dispose();
  }
}, 120_000);
