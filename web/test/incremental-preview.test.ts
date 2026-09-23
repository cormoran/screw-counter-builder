import { describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { PartPreview } from "../src/cad/types";
import { generatePreviewModel } from "../src/cad/generate";

vi.mock("replicad-opencascadejs/wasm?url", () => ({
  default: resolve(dirname(fileURLToPath(import.meta.url)), "../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
}));

describe("incremental preview geometry", () => {
  it("invalidates the funnel when height or the slope start changes", async () => {
    const settings = { rows: 1, columns: 1, trayStyle: "cutout" as const, funnelHeight: 40 };
    const short = await generatePreviewModel({ ...settings, screwLength: 5 });
    const long = await generatePreviewModel({ ...settings, screwLength: 20 });
    const tall = await generatePreviewModel({ ...settings, screwLength: 20, funnelHeight: 50 });
    expect(short.partMeshes.funnel).not.toBe(long.partMeshes.funnel);
    expect(long.partMeshes.funnel).not.toBe(tall.partMeshes.funnel);
    for (const part of ["base", "tray", "slider", "lid"] as const) {
      expect(short.partMeshes[part]).toBe(long.partMeshes[part]);
      expect(long.partMeshes[part]).toBe(tall.partMeshes[part]);
    }
  }, 120_000);

  it("invalidates tray and funnel when automatic length selection crosses 5 mm", async () => {
    const streamed: PartPreview[] = [];
    const events: string[] = [];
    const holes = await generatePreviewModel({ rows: 1, columns: 1, screwLength: 5 }, {
      onPart: (part) => { streamed.push(part); events.push(part.part); },
      onProgress: (progress) => { if (progress.message?.startsWith("Built ")) events.push(progress.message); },
    });
    expect(events).toEqual(["base", "Built base", "slider", "Built slider", "tray", "Built tray", "funnel", "Built funnel", "lid", "Built lid"]);
    for (const part of streamed) {
      expect(part.mesh).toBe(holes.partMeshes[part.part]);
      expect(part.mesh.indices.length).toBeGreaterThan(0);
      expect(part.dimensions).toBe(holes.dimensions);
    }
    const cutout = await generatePreviewModel({ rows: 1, columns: 1, screwLength: 5.1 });
    expect(holes.partMeshes.tray).not.toBe(cutout.partMeshes.tray);
    for (const part of ["base", "slider", "lid"] as const) expect(holes.partMeshes[part]).toBe(cutout.partMeshes[part]);
    expect(holes.partMeshes.funnel).not.toBe(cutout.partMeshes.funnel);
    const stillCutout = await generatePreviewModel({ rows: 1, columns: 1, screwLength: 8 });
    expect(stillCutout.partMeshes.tray).toBe(cutout.partMeshes.tray);
  }, 120_000);

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
    // Removing the head chamber lowers the base and the whole moving stack.
    expect(joint.dimensions.floor).toBeLessThan(magnet.dimensions.floor);
    for (const part of ["base", "tray", "slider", "lid"] as const) {
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
