import initOpenCascade from "replicad-opencascadejs";
import openCascadeWasm from "replicad-opencascadejs/wasm?url";
import { exportSTEP, makeBox, makeCylinder, measureShapeVolumeProperties, setOC, sketchCircle, sketchRoundedRectangle, topMost } from "replicad";
import type { Shape3D } from "replicad";
import type { DerivedDimensions, GenerateOptions, GeneratedFileName, PartDiagnostic, Settings, TriangleMesh, VerificationResult } from "./types";

let kernel: Promise<void> | undefined;
const ready = () => (kernel ??= initOpenCascade({ locateFile: () => openCascadeWasm }).then(setOC));
const box = (x: number, y: number, z: number, dx: number, dy: number, dz: number): Shape3D => makeBox([x, y, z], [x + dx, y + dy, z + dz]);
const cylinder = (x: number, y: number, z: number, r: number, h: number): Shape3D => makeCylinder(r, h, [x, y, z]);
const rounded = (x: number, y: number, z: number, dx: number, dy: number, dz: number, radius: number): Shape3D =>
  sketchRoundedRectangle(dx, dy, radius, { plane: "XY", origin: [x + dx / 2, y + dy / 2, z] }).extrude(dz);
const intersectionVolume = (left: Shape3D, right: Shape3D) => measureShapeVolumeProperties(left.intersect(right)).volume;
const cone = (x: number, y: number, z: number, lowerRadius: number, upperRadius: number, height: number): Shape3D =>
  sketchCircle(lowerRadius, { plane: "XY", origin: [x, y, z] }).loftWith(sketchCircle(upperRadius, { plane: "XY", origin: [x, y, z + height] }), {});

const DIGIT_SEGMENTS: Record<string, readonly number[]> = {
  "0": [0, 1, 2, 3, 4, 5], "1": [1, 2], "2": [0, 1, 6, 4, 3], "3": [0, 1, 6, 2, 3], "4": [5, 6, 1, 2],
  "5": [0, 5, 6, 2, 3], "6": [0, 5, 6, 4, 2, 3], "7": [0, 1, 2], "8": [0, 1, 2, 3, 4, 5, 6], "9": [0, 1, 2, 3, 5, 6],
};
/** Font-free seven-segment engraving avoids browser font loading and produces stable B-Rep cuts. */
function digitCut(text: string, x: number, y: number, z: number): Shape3D {
  const w = 0.95; const h = 1.75; const t = 0.22; const gap = 0.2;
  const segments = [box(0, h - t, 0, w, t, 0.4), box(w - t, h / 2, 0, t, h / 2 - t, 0.4), box(w - t, 0, 0, t, h / 2 - t, 0.4), box(0, 0, 0, w, t, 0.4), box(0, 0, 0, t, h / 2 - t, 0.4), box(0, h / 2, 0, t, h / 2 - t, 0.4), box(0, h / 2 - t / 2, 0, w, t, 0.4)];
  let result: Shape3D | undefined;
  [...text].forEach((char, index) => {
    for (const segment of DIGIT_SEGMENTS[char] ?? []) {
      const translated = segments[segment].clone().translate(x + index * (w + gap), y, z);
      result = result ? result.fuse(translated) : translated;
    }
  });
  if (!result) throw new Error(`Unsupported scale digit: ${text}`);
  return result;
}
const printOrientation = (shape: Shape3D): Shape3D => {
  const [min] = shape.boundingBox.bounds;
  return shape.translate(-min[0], -min[1], -min[2]);
};

/** OpenCascade B-Rep port of `design_screw_counter.py`'s `build()`. */
export async function buildWithReplicad(settings: Settings, d: DerivedDimensions, options: GenerateOptions): Promise<{ files: Partial<Record<GeneratedFileName, Blob>>; warnings: string[]; verification: VerificationResult; diagnostics: Record<"base" | "tray" | "slider" | "lid", PartDiagnostic>; partMeshes: Record<"base" | "tray" | "slider" | "lid", TriangleMesh> }> {
  await ready();
  const aborted = () => { if (options.signal?.aborted) throw new DOMException("CAD generation was cancelled", "AbortError"); };
  aborted();
  let base = rounded(0, 0, 0, d.length, d.width, d.joinZ, 4)
    .cut(box(7.7, d.wall, d.floor, d.length, d.width - 2 * d.wall, d.joinZ + 1))
    .cut(box(7.7, d.wall + 3, -0.1, d.length, d.width - 2 * (d.wall + 3), d.joinZ + 1));
  for (const p of d.joints) {
    base = base.fuse(cylinder(p.x, p.y, d.joinZ, 2, 1.2).chamfer(0.2, (finder, shape) => finder.when(topMost(shape)).parallelTo("XY")));
    if (settings.joint === "screws") base = base.cut(cylinder(p.x, p.y, -0.1, 1.2, d.joinZ + 1.5)).cut(cylinder(p.x, p.y, -0.1, 2.3, 2.3));
  }
  options.onProgress?.({ phase: "building", completed: 1, total: 4, message: "Built base" });
  let tray = rounded(0, 0, d.joinZ, d.length, d.width, 3, 4);
  const rim = rounded(0, 0, d.deckTop, d.length, d.width, d.top - d.deckTop, 4)
    .cut(rounded(d.rim, d.rim, d.deckTop - 0.1, d.length - 2 * d.rim, d.width - 2 * d.rim, d.top, 3))
    .fillet(0.65, (finder, shape) => finder.when(topMost(shape)).parallelTo("XY"));
  tray = tray.fuse(rim);
  for (const x of d.screwXs) for (const y of d.screwYs) {
    tray = tray.cut(cylinder(x, y, d.joinZ - 0.1, d.drop / 2, 3.3));
    tray = tray.cut(cone(x, y, d.deckTop - 0.6, d.drop / 2, d.drop / 2 + 0.6, 0.6));
  }
  for (const p of d.joints) {
    tray = tray.cut(cylinder(p.x, p.y, d.joinZ - 0.05, 2.2, 1.5));
    if (settings.joint === "screws") tray = tray.cut(cylinder(p.x, p.y, d.joinZ + 1.4, 0.85, 5.6));
  }
  options.onProgress?.({ phase: "building", completed: 2, total: 4, message: "Built tray" });
  const sw = d.width - 2 * d.sliderInsetY;
  let slider = rounded(8, d.sliderInsetY, d.sliderZ, d.length - 8, sw, d.sliderThickness, 1.5).fuse(rounded(d.length, d.sliderInsetY - 3, d.sliderZ, 19, sw + 6, d.sliderThickness, 3));
  slider = slider.cut(rounded(d.length + 5, d.sliderInsetY + 3, d.sliderZ - 0.1, 8, sw - 6, d.sliderThickness + 0.2, 2));
  const last = d.screwXs.at(-1)!;
  for (const y of d.screwYs) slider = slider.cut(rounded(d.releaseX - 1, y - d.slot / 2, d.sliderZ - 0.1, last + 3 - (d.releaseX - 1), d.slot, d.sliderThickness + 0.2, d.slot / 2 - 0.02)).cut(rounded(d.releaseX - d.window / 2, y - d.window / 2, d.sliderZ - 0.1, d.window, d.window, d.sliderThickness + 0.2, 0.65));
  if (d.detent) {
    const edge = d.width - d.sliderInsetY;
    slider = slider.cut(rounded(10, edge - d.detent.springWidth - d.detent.reliefGap, d.sliderZ - 0.1, 17, d.detent.reliefGap, d.sliderThickness + 0.2, 0.45)).cut(box(10, edge - d.detent.springWidth - d.detent.reliefGap + 0.4, d.sliderZ - 0.1, 0.8, d.detent.springWidth + d.detent.reliefGap + 2, d.sliderThickness + 0.2)).fuse(cylinder(12, edge - 0.2, d.sliderZ, 1, d.sliderThickness));
    for (const x of d.detent.notchX) base = base.cut(cylinder(x, edge - 0.2, -0.1, 1.2, d.joinZ + 0.2));
  }
  options.onProgress?.({ phase: "building", completed: 3, total: 4, message: "Built slider" });
  for (let i = 0; i <= settings.columns; i += 1) {
    const x = d.length - d.pitch * i;
    slider = slider.cut(box(x - 0.18, d.sliderInsetY + 0.65, d.sliderZ + d.sliderThickness - 0.3, 0.36, 2.3, 0.4));
    slider = slider.cut(digitCut(String(i), x + 1.8, d.sliderInsetY + 2, d.sliderZ + d.sliderThickness - 0.3));
  }
  let lid = rounded(0, 0, d.top, d.length, d.width, 3.4, 4).fuse(rounded(d.length - 1, d.width / 2 - 7, d.top, 6, 14, 3.4, 2.5));
  const lip = rounded(d.rim + 0.35, d.rim + 0.35, d.top - 1.2, d.length - 2 * d.rim - 0.7, d.width - 2 * d.rim - 0.7, 1.3, 3.35)
    .cut(rounded(d.rim + 1.75, d.rim + 1.75, d.top - 1.3, d.length - 2 * d.rim - 3.5, d.width - 2 * d.rim - 3.5, 1.5, 2));
  lid = lid.fuse(lip).fillet(0.6, (finder, shape) => finder.when(topMost(shape)).parallelTo("XY"));
  for (const p of d.magnets) {
    tray = tray.cut(cylinder(p.x, p.y, d.top - d.magnetPocketDepth, d.magnetPocketDiameter / 2, d.magnetPocketDepth + 0.1));
    lid = lid.cut(cylinder(p.x, p.y, d.top - 0.1, d.magnetPocketDiameter / 2, d.magnetPocketDepth + 0.1));
  }
  options.onProgress?.({ phase: "building", completed: 4, total: 4, message: "Built lid" });
  aborted();
  const parts = { base, tray, slider, lid };
  const completed: string[] = [];
  if (Object.values(parts).every((part) => !part.isNull && part.solids.length === 1)) completed.push("4 valid single solids");
  else throw new Error("CAD build produced a null or multi-solid part");
  const names = Object.keys(parts) as Array<keyof typeof parts>;
  for (let i = 0; i < names.length; i += 1) for (let j = i + 1; j < names.length; j += 1) {
    if (intersectionVolume(parts[names[i]], parts[names[j]]) >= 1e-5) throw new Error(`Assembly interference: ${names[i]} / ${names[j]}`);
  }
  completed.push("No pairwise assembly interference at the closed position");
  // The pitch-repeating geometry lets us sample the two boundaries and the
  // first interior station. This is a fast check, not a full per-station proof.
  const stations = [...new Set([0, 1, settings.columns].filter((station) => station <= settings.columns))];
  for (const station of stations) {
    const moving = slider.clone().translate(station * d.pitch, 0, 0);
    for (const fixed of [base, tray]) if (intersectionVolume(fixed, moving) >= 1e-5) throw new Error(`Slider interference at release station ${station}`);
    if (station > 0) {
      const x = d.screwXs[station - 1];
      for (const y of d.screwYs) {
        const releasedHead = cylinder(x, y, -1, d.head / 2, d.deckTop + 2);
        for (const fixed of [moving, tray, base]) if (intersectionVolume(fixed, releasedHead) >= 1e-5) throw new Error(`Released head interference at station ${station}`);
      }
    }
    // At an interior station the first and last retained columns exercise both
    // slot ends; every other column is a pitch-periodic translation of them.
    const retained = d.screwXs.slice(station);
    const retainedXs = retained.length > 2 ? [retained[0], retained.at(-1)!] : retained;
    for (const x of retainedXs) for (const y of d.screwYs) {
      if (intersectionVolume(moving, cylinder(x, y, d.sliderZ - 0.1, d.shaft / 2, d.sliderThickness + 0.2)) >= 1e-5) throw new Error(`Shaft blocked at station ${station}`);
      if (intersectionVolume(moving, cylinder(x, y, d.sliderZ, d.head / 2, d.sliderThickness)) <= 0.5) throw new Error(`Head not retained at station ${station}`);
    }
  }
  completed.push("Release, retention, and shaft clearance checked at representative stations");
  for (const magnet of d.magnets) {
    const fittedMagnet = cylinder(magnet.x, magnet.y, d.top - d.magnetPocketDepth, settings.magnetDiameter / 2, settings.magnetThickness);
    if (intersectionVolume(tray, fittedMagnet) >= 1e-5 || intersectionVolume(lid, fittedMagnet.clone().translate(0, 0, d.magnetPocketDepth)) >= 1e-5) throw new Error("Magnet pocket does not clear its nominal magnet");
    for (const joint of d.joints) if (Math.hypot(magnet.x - joint.x, magnet.y - joint.y) <= d.magnetPocketDiameter / 2 + 2.8) throw new Error("Magnet pocket is too close to a registration boss");
  }
  completed.push("Magnet pockets and registration-boss clearance verified");
  if (d.detent) {
    const tip = cylinder(d.detent.tipX, d.detent.tipY, d.sliderZ, d.detent.noseRadius, d.sliderThickness);
    const rigidSlider = slider.cut(tip);
    for (const fraction of [0.25, 0.5, 0.75]) {
      if (intersectionVolume(base, rigidSlider.clone().translate(d.pitch * fraction, 0, 0)) >= 1e-5) throw new Error("Detent slider body contacts rail between stations");
      if (intersectionVolume(base, tip.clone().translate(d.pitch * fraction, -0.8, 0)) >= 1e-5) throw new Error("Detent tip cannot deflect 0.8 mm");
    }
    if (d.detent.reliefGap <= d.detent.maxLateralDeflection + 0.2) throw new Error("Detent relief gap is too narrow");
    completed.push("Detent inter-station clearance verified");
  }
  const diagnostics = Object.fromEntries(Object.entries(parts).map(([name, part]) => {
    const [min, max] = part.boundingBox.bounds;
    return [name, { volume: measureShapeVolumeProperties(part).volume, bounds: { min, max } }];
  })) as Record<"base" | "tray" | "slider" | "lid", PartDiagnostic>;
  const partMeshes = Object.fromEntries(Object.entries(parts).map(([name, part]) => {
    const mesh = part.mesh({ tolerance: 0.08, angularTolerance: 0.2 });
    return [name, {
      positions: Float32Array.from(mesh.vertices),
      normals: Float32Array.from(mesh.normals),
      indices: Uint32Array.from(mesh.triangles),
    }];
  })) as Record<"base" | "tray" | "slider" | "lid", TriangleMesh>;
  return { files: {
    "base.stl": printOrientation(base.clone()).blobSTL({ binary: true, tolerance: 0.04, angularTolerance: 0.15 }), "tray.stl": printOrientation(tray.clone()).blobSTL({ binary: true, tolerance: 0.04, angularTolerance: 0.15 }),
    "slider.stl": printOrientation(slider.clone()).blobSTL({ binary: true, tolerance: 0.04, angularTolerance: 0.15 }), "lid.stl": printOrientation(lid.clone().rotate(180, [0, 0, 0], [1, 0, 0])).blobSTL({ binary: true, tolerance: 0.04, angularTolerance: 0.15 }),
    "assembly.step": exportSTEP([{ shape: base, name: "base" }, { shape: tray, name: "tray" }, { shape: slider, name: "slider" }, { shape: lid, name: "lid" }]),
  }, warnings: ["Browser CAD output has not been compared against the Python B-Rep baseline or physically print-tested."], verification: { completed, pending: ["Full per-station release and retention checks", "Full Python B-Rep numeric comparison"] }, diagnostics, partMeshes };
}
