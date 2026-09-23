import { expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { generateModel } from "../src/cad/generate";

vi.mock("replicad-opencascadejs/wasm?url", () => ({
  default: resolve(dirname(fileURLToPath(import.meta.url)), "../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
}));

it.each(["magnets", "pegs"] as const)("retains one support-free base recess with maximum-diameter %s", async (funnelAlignment) => {
  const model = await generateModel({ rows: 1, columns: 1, magnetDiameter: 8, magnetDiameterClearance: 0.6, slideClearance: 0.15, funnelAlignment });
  expect(model.verification.completed).toContain("5 valid single solids");
  expect(model.verification.completed).toContain("Base mounts have a single common chamber and continuous 45-degree roofs without shelves");
  expect(model.verification.completed).toContain("Flat base underside and recessed screw heads clear funnel magnets or pegs");
  if (funnelAlignment === "pegs") {
    expect(model.verification.completed).toContain("Split funnel pegs retain bounded 0.08 mm radial press-fit interference");
  }
  expect(model.dimensions.joinZ - model.dimensions.baseMountTaperTop).toBeCloseTo(0.5);
  expect(model.files["base.stl"].size).toBeGreaterThan(84);
}, 120_000);
