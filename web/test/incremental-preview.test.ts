import { describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { generatePreviewModel } from "../src/cad/generate";

vi.mock("replicad-opencascadejs/wasm?url", () => ({
  default: resolve(dirname(fileURLToPath(import.meta.url)), "../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
}));

describe("incremental preview geometry", () => {
  it("reuses unrelated B-Rep meshes as individual parameters change", async () => {
    const initial = await generatePreviewModel({ rows: 2, columns: 2 });
    const spring = await generatePreviewModel({ rows: 2, columns: 2, detentSpringLength: 12 });
    expect(spring.partMeshes.slider).not.toBe(initial.partMeshes.slider);
    for (const part of ["base", "tray", "lid"] as const) {
      expect(spring.partMeshes[part]).toBe(initial.partMeshes[part]);
    }

    const magnet = await generatePreviewModel({ rows: 2, columns: 2, detentSpringLength: 12, magnetThickness: 2.5 });
    for (const part of ["slider"] as const) {
      expect(magnet.partMeshes[part]).toBe(spring.partMeshes[part]);
    }
    for (const part of ["base", "tray", "lid", "funnel"] as const) {
      expect(magnet.partMeshes[part]).not.toBe(spring.partMeshes[part]);
    }

    const joint = await generatePreviewModel({ rows: 2, columns: 2, detentSpringLength: 12, magnetThickness: 2.5, joint: "glue" });
    for (const part of ["slider", "lid"] as const) {
      expect(joint.partMeshes[part]).toBe(magnet.partMeshes[part]);
    }
    for (const part of ["base", "tray"] as const) {
      expect(joint.partMeshes[part]).not.toBe(magnet.partMeshes[part]);
    }

    const taller = await generatePreviewModel({ rows: 2, columns: 2, detentSpringLength: 12, magnetThickness: 2.5, joint: "glue", screwSpaceHeight: 18 });
    for (const part of ["base", "slider"] as const) {
      expect(taller.partMeshes[part]).toBe(joint.partMeshes[part]);
    }
    for (const part of ["tray", "lid"] as const) {
      expect(taller.partMeshes[part]).not.toBe(joint.partMeshes[part]);
    }

    const measuredShaft = await generatePreviewModel({ rows: 2, columns: 2, detentSpringLength: 12, magnetThickness: 2.5, joint: "glue", screwSpaceHeight: 18, shaftDiameter: 1.8 });
    for (const part of ["base", "tray", "slider", "lid"] as const) {
      expect(measuredShaft.partMeshes[part]).toBe(taller.partMeshes[part]);
    }
  }, 120_000);
});
