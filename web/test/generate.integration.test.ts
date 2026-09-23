import { describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { generateModel } from "../src/cad/generate";

// Vite turns ?url into a browser URL. Use the installed WASM path for this
// Node/Vitest integration probe; production code keeps the Vite asset URL.
vi.mock("replicad-opencascadejs/wasm?url", () => ({
  default: resolve(dirname(fileURLToPath(import.meta.url)), "../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
}));

describe("browser CAD integration", () => {
  it.each(["magnets", "pegs"] as const)("builds the cutout lid and funnel using %s", async (attachment) => {
    const model = await generateModel({ rows: 1, columns: 1, lidStyle: "cutout", trayStyle: "cutout", lidAlignment: attachment, funnelAlignment: attachment, funnelOutlet: 24 });
    expect(model.diagnostics.lid.bounds.max[0]).toBeCloseTo(model.dimensions.rim + 0.5);
    expect(model.diagnostics.base.bounds.min[2]).toBeCloseTo(0);
    expect(model.verification.completed).toContain("Flat base underside and recessed screw heads clear funnel magnets or pegs");
    expect(model.verification.completed).toContain("Base mounts have a single common chamber and continuous 45-degree roofs without shelves");
    expect(model.verification.completed).toContain("Rounded funnel corners, outer edges, and outlet verified");
    expect(model.diagnostics.funnel.bounds.min[2]).toBeCloseTo(-19);
    expect(model.diagnostics.funnel.bounds.max[2]).toBeCloseTo(attachment === "pegs" ? Math.max(0.8, model.dimensions.funnelPegHeight) : 0.8);
    expect(model.diagnostics.funnel.bounds.min[0]).toBeCloseTo(0);
    expect(model.diagnostics.funnel.bounds.max[0]).toBeCloseTo(model.dimensions.length);
    expect(model.verification.completed).toContain("Funnel mouth, continuous outlet, and attachment clearances verified");
    expect(model.files["funnel.stl"].size).toBeGreaterThan(84);
  }, 120_000);

  it.each([
    { funnelAlignment: "magnets", magnetThickness: 1 },
    { funnelAlignment: "magnets", magnetThickness: 3 },
    { funnelAlignment: "pegs", magnetThickness: 1 },
    { funnelAlignment: "pegs", magnetThickness: 3 },
  ] as const)("keeps the base flat and screw access clear with minimum-diameter mounts: %j", async (attachment) => {
    const model = await generateModel({ rows: 1, columns: 1, slideClearance: 0.15, magnetDiameter: 5, magnetDiameterClearance: 0, funnelOutlet: 5, ...attachment });
    expect(model.diagnostics.base.bounds.min[2]).toBeCloseTo(0);
    expect(model.verification.completed).toContain("Flat base underside and recessed screw heads clear funnel magnets or pegs");
    expect(model.verification.completed).toContain("Base mounts have a single common chamber and continuous 45-degree roofs without shelves");
    expect(model.verification.completed).toContain("Rounded funnel corners, outer edges, and outlet verified");
    expect(model.verification.completed).toContain("Funnel mouth, continuous outlet, and attachment clearances verified");
    expect(model.verification.completed).toContain("5 valid single solids");
  }, 120_000);

  it.each([
    { magnetDiameter: 3, magnetThickness: 1, magnetDepthClearance: 0, funnelOutlet: 5 },
    { magnetDiameter: 8, magnetThickness: 3, magnetDepthClearance: 0.3, funnelOutlet: 24 },
  ])("keeps small and large funnel mounts clear: %j", async (dimensions) => {
    const model = await generateModel({ rows: 1, columns: 1, joint: "glue", lidStyle: "cutout", lidAlignment: "pegs", funnelAlignment: "pegs", ...dimensions });
    expect(model.verification.completed).toContain("No rigid assembly interference outside the split-peg compression regions");
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
    expect(model.verification.completed).toContain("Square tray holes, entry flares, solid deck, and unchanged square base outlets verified");
    expect(model.verification.completed).toContain("Small side registration lands and sockets verified at both mating planes");
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

});
