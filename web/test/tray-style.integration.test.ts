import { describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { generateModel } from "../src/cad/generate";

// Vite turns ?url into a browser URL. Use the installed WASM path for this
// Node/Vitest integration probe; production code keeps the Vite asset URL.
vi.mock("replicad-opencascadejs/wasm?url", () => ({
  default: resolve(dirname(fileURLToPath(import.meta.url)), "../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
}));

// Keep this repeated style-switch scenario in its own WASM instance.
// Each instance has a finite native heap independent of JavaScript GC.
describe("tray style CAD integration", () => {
  it("switches the tray and funnel at 5 mm and exports both explicit styles", async () => {
    const settings = { rows: 2, columns: 2 } as const;
    const holes = await generateModel({ ...settings, screwLength: 5 });
    const cutout = await generateModel({ ...settings, screwLength: 5.1 });
    expect(holes.dimensions.trayStyle).toBe("holes");
    expect(cutout.dimensions.trayStyle).toBe("cutout");
    expect(holes.diagnostics.tray.volume).toBeGreaterThan(cutout.diagnostics.tray.volume);
    expect(holes.files["tray.stl"]).not.toBe(cutout.files["tray.stl"]);
    for (const part of ["base", "slider", "lid"] as const) expect(holes.files[`${part}.stl`]).toBe(cutout.files[`${part}.stl`]);
    expect(holes.files["funnel.stl"]).not.toBe(cutout.files["funnel.stl"]);
    const manualCutout = await generateModel({ ...settings, screwLength: 3, trayStyle: "cutout" });
    expect(manualCutout.files["tray.stl"]).toBe(cutout.files["tray.stl"]);
    const manualHoles = await generateModel({ ...settings, screwLength: 8, trayStyle: "holes" });
    expect(manualHoles.diagnostics.tray.volume).toBeCloseTo(holes.diagnostics.tray.volume);
    const metadata = JSON.parse(await manualHoles.files["dimensions.json"].text());
    expect(metadata.settings).toMatchObject({ screwLength: 8, trayStyle: "holes" });
    expect(metadata.derived.trayStyle).toBe("holes");
  }, 120_000);

});
