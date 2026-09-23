import { expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
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
  expect(model.files["funnel.stl"].size).toBeGreaterThan(84);
  expect(model.files["assembly.step"].size).toBeGreaterThan(0);
}, 120_000);
