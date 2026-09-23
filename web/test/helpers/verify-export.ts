import { expect } from "vitest";
import type { PartPreview, SettingsInput } from "../../src/cad/types";
import { generateModel } from "../../src/cad/generate";
import { createBambu3mf } from "../../src/print3mf";
import JSZip from "jszip";

export async function verifyExport(settings: SettingsInput & { rows: number; columns: number }) {
    const streamed: PartPreview[] = [];
    const model = await generateModel(settings, { onPart: (part) => streamed.push(part) });
    expect(streamed.map(({ part }) => part)).toEqual(["base", "slider", "tray", "funnel", "lid"]);
    for (const part of streamed) expect(part.mesh).toBe(model.partMeshes[part.part]);
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
}
