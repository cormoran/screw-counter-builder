import { expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { generateModel } from "../src/cad/generate";

vi.mock("replicad-opencascadejs/wasm?url", () => ({
  default: resolve(dirname(fileURLToPath(import.meta.url)), "../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
}));

it.each([
  { rows: 1, columns: 1, screwLength: 1, funnelHeight: 9 },
  { rows: 4, columns: 2, screwLength: 20, funnelHeight: 40 },
  { rows: 1, columns: 1, screwLength: 100, funnelHeight: 160, slideClearance: 0.6 },
])("exports screw-mounted funnel with free drop clearance: %j", async (settings) => {
  const model = await generateModel({ ...settings, funnelAlignment: "screws" });
  expect(model.dimensions.funnelSlopeZ).toBe(-(settings.screwLength + 3));
  expect(model.diagnostics.funnel.bounds.min[2]).toBeCloseTo(-settings.funnelHeight);
  expect(model.verification.completed).toContain("No pairwise assembly interference at the closed position");
  expect(model.verification.completed).toContain("Funnel underside screw access and 45-degree counterbore roofs verified");
  expect(model.verification.completed).toContain("Small side registration lands and sockets verified at both mating planes");
  expect(model.diagnostics.funnel.bounds.min[0]).toBeCloseTo(-16);
  expect(model.verification.completed).toContain("Side funnel outlet and closed floor verified");
  expect(model.verification.completed).toContain("Open upper half and pouring floor of the funnel spout verified");
  expect(model.verification.completed).toContain("Continuous descending funnel floor to the side spout verified");
  // Read the exported mesh independently: the center floor must descend all
  // the way to the lip, without a roof or a flat collection pocket.
  const mesh = model.partMeshes.funnel;
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(mesh.positions, 3));
  geometry.setIndex(new BufferAttribute(mesh.indices, 1));
  const material = new MeshBasicMaterial({ side: DoubleSide });
  const solid = new Mesh(geometry, material);
  const d = model.dimensions;
  let previousFloor = -Infinity;
  for (const x of [-14, -8, -1, d.funnelOutletX, d.length - 5]) {
    const ray = new Raycaster(new Vector3(x, d.width / 2, 1), new Vector3(0, 0, -1));
    const hits = ray.intersectObject(solid);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits[0].point.z).toBeGreaterThan(previousFloor + 0.01);
    expect(hits[0].point.z).toBeLessThan(d.funnelSlopeZ);
    previousFloor = hits[0].point.z;
  }
  geometry.dispose();
  material.dispose();
  expect(model.files["funnel.stl"].size).toBeGreaterThan(84);
  expect(model.files["assembly.step"].size).toBeGreaterThan(0);
}, 120_000);
