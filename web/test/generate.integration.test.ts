import { describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { generateModel } from "../src/cad/generate";
import { createBambu3mf } from "../src/print3mf";

// Vite turns ?url into a browser URL. Use the installed WASM path for this
// Node/Vitest integration probe; production code keeps the Vite asset URL.
vi.mock("replicad-opencascadejs/wasm?url", () => ({
  default: resolve(dirname(fileURLToPath(import.meta.url)), "../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
}));

describe("browser CAD integration", () => {
  it("generates M2 4x2 exports and diagnostics", async () => {
    const model = await generateModel({ rows: 4, columns: 2, screw: "M2", joint: "screws" });
    expect(model.files["base.stl"].size).toBeGreaterThan(0);
    expect(model.files["assembly.step"].size).toBeGreaterThan(0);
    expect(model.verification.completed).toContain("4 valid single solids");
    const referenceVolumes = {
      base: 4571.984940,
      tray: 16960.356573,
      slider: 3157.977700,
      lid: 8358.802246,
    } as const;
    for (const part of ["base", "tray", "slider", "lid"] as const) {
      expect(model.diagnostics[part].volume).toBeGreaterThan(0);
      expect(model.diagnostics[part].bounds.max[0]).toBeGreaterThan(model.diagnostics[part].bounds.min[0]);
      // The checked-in Python STL is meshed, so allow 0.2% rather than byte equality.
      expect(Math.abs(model.diagnostics[part].volume / referenceVolumes[part] - 1)).toBeLessThan(0.002);
      const bytes = new Uint8Array(await model.files[`${part}.stl`].arrayBuffer());
      expect(bytes.byteLength).toBeGreaterThan(84);
      expect(new DataView(bytes.buffer).getUint32(80, true) * 50 + 84).toBe(bytes.byteLength);
    }
    expect(await model.files["assembly.step"].text()).toContain("ISO-10303-21");
    console.log(JSON.stringify({
      files: Object.fromEntries(Object.entries(model.files).map(([name, blob]) => [name, blob.size])),
      diagnostics: model.diagnostics,
    }));
  }, 120_000);

  it.each([
    { rows: 4, columns: 10, screw: "M2" as const, joint: "screws" as const },
    { rows: 3, columns: 3, screw: "M1.5" as const, joint: "glue" as const },
    { rows: 6, columns: 3, screw: "M3" as const, joint: "screws" as const },
    { rows: 1, columns: 1, screw: "M2" as const, joint: "screws" as const },
    { rows: 4, columns: 2, screw: "M2" as const, joint: "screws" as const, screwSpaceHeight: 10 },
  ])("generates the $screw $rows x $columns $joint validation case", async (settings) => {
    const model = await generateModel(settings);
    expect(model.verification.completed).toContain("Release, retention, and shaft clearance checked at representative stations");
    expect(model.verification.completed).toContain("Magnet pockets and registration-boss clearance verified");
    expect(model.files["assembly.step"].size).toBeGreaterThan(0);
    expect(model.dimensions.screwXs).toHaveLength(settings.columns);
    expect(model.dimensions.screwYs).toHaveLength(settings.rows);
    if (settings.columns === 10) {
      const print = await createBambu3mf(model);
      expect(print.placements).toHaveLength(4);
      expect(print.file.size).toBeGreaterThan(100_000);
      const mini = await createBambu3mf(model, { width: 180, depth: 180 });
      expect(mini.plates.length).toBeGreaterThan(1);
      expect(mini.plates.flatMap((plate) => plate.placements)).toHaveLength(4);
      for (const plate of mini.plates) {
        const minX = Math.min(...plate.placements.map((placement) => placement.x));
        const maxX = Math.max(...plate.placements.map((placement) => placement.x + placement.width));
        const minY = Math.min(...plate.placements.map((placement) => placement.y));
        const maxY = Math.max(...plate.placements.map((placement) => placement.y + placement.depth));
        expect((minX + maxX) / 2).toBeCloseTo(90, 3);
        expect((minY + maxY) / 2).toBeCloseTo(90, 3);
        expect(minX).toBeGreaterThanOrEqual(0);
        expect(maxX).toBeLessThanOrEqual(180);
        expect(minY).toBeGreaterThanOrEqual(0);
        expect(maxY).toBeLessThanOrEqual(180);
      }
    }
    if ('screwSpaceHeight' in settings) expect(model.dimensions.top - model.dimensions.deckTop - 1.2).toBeCloseTo(settings.screwSpaceHeight);
  }, 120_000);
});
