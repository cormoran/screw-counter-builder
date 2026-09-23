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

describe("browser CAD integration", () => {
  it.each(["magnets", "pegs"] as const)("builds the cutout lid and funnel using %s", async (attachment) => {
    const model = await generateModel({ rows: 1, columns: 1, lidStyle: "cutout", lidAlignment: attachment, funnelAlignment: attachment, funnelOutlet: 24 });
    expect(model.diagnostics.lid.bounds.max[0]).toBeCloseTo(model.dimensions.rim + 0.5);
    expect(model.diagnostics.funnel.bounds.min[2]).toBeCloseTo(-14);
    expect(model.diagnostics.funnel.bounds.max[2]).toBeCloseTo(0);
    expect(model.diagnostics.funnel.bounds.min[0]).toBeCloseTo(0);
    expect(model.diagnostics.funnel.bounds.max[0]).toBeCloseTo(model.dimensions.length);
    expect(model.verification.completed).toContain("Funnel mouth, continuous outlet, and attachment clearances verified");
    expect(model.files["funnel.stl"].size).toBeGreaterThan(84);
  }, 120_000);

  it.each(["magnets", "pegs"] as const)("allows screw insertion with minimum-size embedded %s", async (funnelAlignment) => {
    const model = await generateModel({ rows: 1, columns: 1, magnetDiameter: 5, magnetDiameterClearance: 0, funnelAlignment });
    expect(model.verification.completed).toContain("Funnel mouth, continuous outlet, and attachment clearances verified");
    expect(model.verification.completed).toContain("5 valid single solids");
  }, 120_000);

  it.each([
    { magnetDiameter: 3, magnetThickness: 1, magnetDepthClearance: 0, funnelOutlet: 10 },
    { magnetDiameter: 8, magnetThickness: 3, magnetDepthClearance: 0.3, funnelOutlet: 24 },
  ])("keeps small and large funnel mounts clear: %j", async (dimensions) => {
    const model = await generateModel({ rows: 1, columns: 1, joint: "glue", lidStyle: "cutout", lidAlignment: "pegs", funnelAlignment: "pegs", ...dimensions });
    expect(model.verification.completed).toContain("No pairwise assembly interference at the closed position");
  }, 120_000);

  it("changes the printed slider when the detent spring is shortened", async () => {
    const short = await generateModel({ rows: 1, columns: 1, detentSpringLength: 6 });
    const long = await generateModel({ rows: 1, columns: 1, detentSpringLength: 18 });
    expect(short.diagnostics.slider.volume).toBeGreaterThan(long.diagnostics.slider.volume);
    expect(short.dimensions.detent?.springLength).toBe(6);
    expect(long.dimensions.detent?.springLength).toBe(18);
    for (const part of ["base", "tray", "lid"] as const) {
      expect(short.files[`${part}.stl`]).toBe(long.files[`${part}.stl`]);
    }
    expect(short.files["slider.stl"]).not.toBe(long.files["slider.stl"]);
  }, 120_000);

  it("builds printed lid alignment pegs without changing the other parts", async () => {
    const settings = { rows: 1, columns: 1 } as const;
    const magnets = await generateModel({ ...settings, lidAlignment: "magnets" });
    const pegs = await generateModel({ ...settings, lidAlignment: "pegs" });
    expect(pegs.verification.completed).toContain("Lid alignment pegs retain 0.3 mm radial and axial receptacle clearance");
    expect(pegs.diagnostics.lid.volume).toBeGreaterThan(magnets.diagnostics.lid.volume);
    expect(pegs.files["lid.stl"]).not.toBe(magnets.files["lid.stl"]);
    for (const part of ["base", "tray", "slider"] as const) {
      expect(pegs.files[`${part}.stl`]).toBe(magnets.files[`${part}.stl`]);
    }
  }, 120_000);

  it("generates M2 4x2 exports and diagnostics", async () => {
    const model = await generateModel({ rows: 4, columns: 2, screw: "M2", joint: "screws" });
    expect(model.files["base.stl"].size).toBeGreaterThan(0);
    expect(model.files["assembly.step"].size).toBeGreaterThan(0);
    expect(model.verification.completed).toContain("5 valid single solids");
    expect(model.verification.completed).toContain("Detent pockets retain the base floor; inter-station clearance verified");
    expect(model.verification.completed).toContain("Low-side pullout groove, rigid nose-length slider rib, and full release travel verified");
    expect(model.verification.completed).toContain("Thin frame, reinforced corners, and selected lid coverage verified");
    expect(model.verification.completed).toContain("Overlapping storage handles, closed-lid discharge plug, and 45-degree internal gusset verified");
    expect(model.diagnostics.lid.bounds.min[0]).toBeGreaterThan(-1e-5);
    expect(model.verification.completed).toContain("Tray and slider storage handles retain reinforced thickness");
    expect(model.verification.completed).toContain("Tray handle root square; slider convex root rounded and concave body junction square");
    expect(model.verification.completed).toContain("Tray storage handle retains its full-width 45-degree root rib");
    expect(model.verification.completed).toContain("Discharge cutout full-height chamfers and matching lid lips verified");
    expect(model.verification.completed).toContain("Coaxial corner fasteners and magnet pockets remain vertically separated");
    expect(model.dimensions.joints).toEqual(model.dimensions.magnets);
    expect(model.verification.completed).toContain("Assembly screw counterbore retains its head seat and 45-degree roof");
    expect(model.verification.completed).toContain("Full base floor, square outlets, and rounded tray opening with slider guides and solid outer panels verified");
    expect(model.verification.completed).toContain("Tapered registration lands and sockets retain 45-degree printable faces");
    expect(model.dimensions.screwSpaceHeight).toBe(15);
    expect(model.dimensions.deckThickness).toBe(0.75);
    expect(model.dimensions.drop).toBe(3.5);
    expect(model.dimensions.drop - model.dimensions.head).toBeCloseTo(0.3);
    expect(model.dimensions.window - model.dimensions.head).toBeCloseTo(1);
    expect(model.dimensions.sliderZ - model.dimensions.floor).toBeCloseTo(0.2);
    expect(model.diagnostics.tray.bounds.min[2]).toBeCloseTo(model.dimensions.joinZ);
    expect(model.diagnostics.slider.bounds.min[2]).toBeCloseTo(model.dimensions.sliderZ);
    expect(model.diagnostics.tray.bounds.max[0]).toBeGreaterThan(model.dimensions.length + 18);
    expect(model.diagnostics.slider.bounds.max[0]).toBeGreaterThan(model.dimensions.length + 18);
    expect(model.dimensions.detent?.nominalDeflection).toBeCloseTo(0.7);
    for (const part of ["base", "tray", "slider", "lid", "funnel"] as const) {
      expect(model.diagnostics[part].volume).toBeGreaterThan(0);
      expect(model.diagnostics[part].bounds.max[0]).toBeGreaterThan(model.diagnostics[part].bounds.min[0]);
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
    { rows: 1, columns: 1, screw: "M3" as const, joint: "glue" as const, lidAlignment: "pegs" as const, screwSpaceHeight: 3.5 },
    { rows: 1, columns: 1, screw: "M2" as const, joint: "glue" as const, detent: false, slideClearance: 0.6 },
    { rows: 1, columns: 1, screw: "M2" as const, joint: "screws" as const, detentDiameter: 3.2, detentSpringLength: 6 },
  ])("generates the $screw $rows x $columns $joint validation case", async (settings) => {
    const model = await generateModel(settings);
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
