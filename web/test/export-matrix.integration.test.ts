import { describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { generateModel } from "../src/cad/generate";
import { createBambu3mf } from "../src/print3mf";
import JSZip from "jszip";

// Vite turns ?url into a browser URL. Use the installed WASM path for this
// Node/Vitest integration probe; production code keeps the Vite asset URL.
vi.mock("replicad-opencascadejs/wasm?url", () => ({
  default: resolve(dirname(fileURLToPath(import.meta.url)), "../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
}));

// Bound each suite to its own finite OpenCascade heap, like recycled UI workers.
describe("CAD export matrix", () => {
  it.each([
    { rows: 4, columns: 10, screw: "M2" as const, joint: "screws" as const },
    { rows: 3, columns: 3, screw: "M1.5" as const, joint: "glue" as const },
    { rows: 6, columns: 3, screw: "M3" as const, joint: "screws" as const },
    { rows: 1, columns: 1, screw: "M2" as const, joint: "screws" as const },
    { rows: 4, columns: 2, screw: "M2" as const, joint: "screws" as const, screwSpaceHeight: 10 },
    { rows: 1, columns: 1, screw: "M3" as const, joint: "glue" as const, lidAlignment: "pegs" as const, screwSpaceHeight: 3.5 },
    { rows: 1, columns: 1, screw: "M2" as const, joint: "glue" as const, detent: false, slideClearance: 0.6 },
    { rows: 1, columns: 1, screw: "M2" as const, joint: "screws" as const, detentDiameter: 3.2, detentSpringLength: 6 },
  ])("generates the $screw $rows x $columns $joint validation case", async (settings) => {
    const model = await generateModel(settings);
    expect(model.diagnostics.base.bounds.min[2]).toBeCloseTo(0);
    expect(model.verification.completed).toContain("Release, retention, and shaft clearance checked at representative stations");
    expect(model.verification.completed).toContain("Low-side pullout groove, rigid nose-length slider rib, and full release travel verified");
    expect(model.verification.completed).toContain("lidAlignment" in settings && settings.lidAlignment === "pegs"
      ? "Coaxial corner fasteners and lid alignment receptacles remain vertically separated"
      : "Coaxial corner fasteners and magnet pockets remain vertically separated");
    expect(model.verification.completed).toContain("Thin frame, reinforced corners, and selected lid coverage verified");
    expect(model.verification.completed).toContain("Overlapping storage handles, closed-lid discharge plug, and 45-degree internal gusset verified");
    expect(model.files["assembly.step"].size).toBeGreaterThan(0);
    expect(model.dimensions.screwXs).toHaveLength(settings.columns);
    expect(model.dimensions.screwYs).toHaveLength(settings.rows);
    const print = await createBambu3mf(model);
    expect(print.placements).toHaveLength(5);
    expect(print.file.size).toBeGreaterThan(0);
    const archive = await JSZip.loadAsync(print.file);
    const xml = await archive.file("3D/3dmodel.model")!.async("text");
    for (const partId of [1, 2, 3, 4, 5]) {
      const part = xml.match(new RegExp(`<object id="${partId}"[\\s\\S]*?<\\/object>`))![0];
      const faces = [...part.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"\/>/g)].map((match) => match.slice(1).map(Number));
      const edgeCounts = new Map<string, number>();
      for (const [a, b, c] of faces) for (const [start, end] of [[a, b], [b, c], [c, a]]) {
        const key = `${Math.min(start, end)},${Math.max(start, end)}`;
        edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
      }
      expect(part.match(/<vertex /g)!.length).toBeLessThan(faces.length * 3);
      expect([...edgeCounts.values()].every((count) => count === 2)).toBe(true);
    }
    if (settings.columns === 10) {
      expect(print.file.size).toBeGreaterThan(100_000);
      const mini = await createBambu3mf(model, { width: 180, depth: 180 });
      expect(mini.plates.length).toBeGreaterThan(1);
      expect(mini.plates.flatMap((plate) => plate.placements)).toHaveLength(5);
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
