import initOpenCascade from "replicad-opencascadejs";
import openCascadeWasm from "replicad-opencascadejs/wasm?url";
import { exportSTEP, makeBox, makeCylinder, measureShapeVolumeProperties, setOC, Sketcher, sketchCircle, sketchRoundedRectangle, topMost } from "replicad";
import type { Shape3D } from "replicad";
import type { DerivedDimensions, GenerateOptions, GeneratedFileName, PartDiagnostic, Settings, TriangleMesh, VerificationResult } from "./types";
import { TRAY_ENTRY_RADIAL_FLARE } from "./settings";

export type BuildConfiguration = {
  /** Skip STL/STEP serialization for the low-latency editor preview. */
  includeExports?: boolean;
  /** Skip expensive boolean intersection checks while a setting is being edited. */
  validate?: boolean;
  /** A coarser tessellation is sufficient for an interactive viewport. */
  meshTolerance?: number;
};

let kernel: Promise<void> | undefined;
const ready = () => (kernel ??= initOpenCascade({ locateFile: () => openCascadeWasm }).then(setOC));
const box = (x: number, y: number, z: number, dx: number, dy: number, dz: number): Shape3D => makeBox([x, y, z], [x + dx, y + dy, z + dz]);
const cylinder = (x: number, y: number, z: number, r: number, h: number): Shape3D => makeCylinder(r, h, [x, y, z]);
const rounded = (x: number, y: number, z: number, dx: number, dy: number, dz: number, radius: number): Shape3D =>
  sketchRoundedRectangle(dx, dy, radius, { plane: "XY", origin: [x + dx / 2, y + dy / 2, z] }).extrude(dz);
const handleWithSquareRoot = (x: number, y: number, z: number, length: number, width: number, thickness: number): Shape3D =>
  box(x, y, z, length - 3, width, thickness)
    .fuse(rounded(x + length - 6, y, z, 6, width, thickness, 2.8));
const intersectionVolume = (left: Shape3D, right: Shape3D) => measureShapeVolumeProperties(left.intersect(right)).volume;
const cone = (x: number, y: number, z: number, lowerRadius: number, upperRadius: number, height: number): Shape3D =>
  sketchCircle(lowerRadius, { plane: "XY", origin: [x, y, z] }).loftWith(sketchCircle(upperRadius, { plane: "XY", origin: [x, y, z + height] }), {});
const gussetXZ = (points: Array<[number, number]>, y: number, width: number): Shape3D => {
  // XZ's positive normal points toward -Y. Start at the near edge and extrude
  // negatively so the prism occupies the requested positive-Y width.
  const sketch = new Sketcher("XZ", [0, y, 0]).movePointerTo(points[0]);
  for (const point of points.slice(1)) sketch.lineTo(point);
  return sketch.close().extrude(-width);
};
const prismYZ = (points: Array<[number, number]>, x: number, length: number): Shape3D => {
  const sketch = new Sketcher("YZ", [x, 0, 0]).movePointerTo(points[0]);
  for (const point of points.slice(1)) sketch.lineTo(point);
  return sketch.close().extrude(length);
};
const prismXY = (points: Array<[number, number]>, z: number, height: number): Shape3D => {
  const sketch = new Sketcher("XY", [0, 0, z]).movePointerTo(points[0]);
  for (const point of points.slice(1)) sketch.lineTo(point);
  return sketch.close().extrude(height);
};

type CachedCadPart = { key: string; shape: Shape3D; mesh: TriangleMesh; meshTolerance: number; diagnostic: PartDiagnostic; stl?: Blob };
const partCache: Partial<Record<"base" | "tray" | "slider" | "lid", CachedCadPart>> = {};

// Keep each key limited to the dimensions read while constructing that part.
// A new geometry dependency must be added here when a part is edited.
export function partKeys(settings: Settings, d: DerivedDimensions) {
  return {
    base: JSON.stringify([d.length, d.width, d.joinZ, d.wall, d.floor, d.pitch, settings.columns, d.joints,
      d.detent ? [d.detent.tipY, d.detent.notchX, d.detent.notchRadius] : null, settings.joint]),
    tray: JSON.stringify([d.length, d.width, d.joinZ, d.deckThickness, d.deckTop, d.top, d.sliderInsetY, d.screwXs, d.screwYs, d.drop, d.joints, d.magnets, d.magnetPocketDiameter, d.magnetPocketDepth, settings.joint]),
    slider: JSON.stringify([d.width, d.sliderInsetY, d.sliderZ, d.length, d.sliderThickness, d.pitch, settings.columns, d.releaseX, d.window, d.slot, d.screwXs, d.screwYs, d.detent]),
    lid: JSON.stringify([d.top, d.length, d.width, d.rim, d.deckTop, d.magnets, d.magnetPocketDiameter, d.magnetPocketDepth, settings.lidAlignment]),
  };
}

const printOrientation = (shape: Shape3D): Shape3D => {
  const [min] = shape.boundingBox.bounds;
  return shape.translate(-min[0], -min[1], -min[2]);
};

/** Browser-specific OpenCascade B-Rep builder. */
export async function buildWithReplicad(settings: Settings, d: DerivedDimensions, options: GenerateOptions, configuration: BuildConfiguration = {}): Promise<{ files: Partial<Record<GeneratedFileName, Blob>>; warnings: string[]; verification: VerificationResult; diagnostics: Record<"base" | "tray" | "slider" | "lid", PartDiagnostic>; partMeshes: Record<"base" | "tray" | "slider" | "lid", TriangleMesh> }> {
  await ready();
  const aborted = () => { if (options.signal?.aborted) throw new DOMException("CAD generation was cancelled", "AbortError"); };
  aborted();
  const keys = partKeys(settings, d);
  const reusable = <P extends keyof typeof keys>(part: P) => partCache[part]?.key === keys[part] ? partCache[part] : undefined;
  // The low-Y rail is opposite the high-Y click spring. A short closed end in
  // its open-top groove catches the slider lug after the final release station.
  // The lug sits on a laterally flexible tongue, allowing it to snap past that
  // end wall while the slider is inserted from the +X handle end.
  const sliderStop = {
    grooveStartX: 7.7,
    grooveEndX: d.length - 1.1,
    grooveY: d.wall - 1,
    grooveWidth: 1.4,
    lugX: d.length - settings.columns * d.pitch - 3,
    lugLength: 1.6,
    lugDepth: 0.75,
    tongueLength: 10,
    tongueWidth: 0.75,
    flexClearance: 0.25,
  };
  let base = reusable("base")?.shape;
  if (!base) {
    base = rounded(0, 0, 0, d.length, d.width, d.joinZ, 4)
      .cut(box(7.7, d.wall, d.floor, d.length, d.width - 2 * d.wall, d.joinZ + 1))
      .cut(box(7.7, d.wall + 3, -0.1, d.length, d.width - 2 * (d.wall + 3), d.joinZ + 1));
    for (const p of d.joints) {
      // Keep 0.6 mm of material around the R1.2 through-hole at the narrow end.
      // The land narrows by 1.2 mm over its 1.2 mm height, so its exterior is a
      // 45-degree face that prints without support and matches the tray socket.
      base = base.fuse(cone(p.x, p.y, d.joinZ, 3, 1.8, 1.2));
      if (settings.joint === "screws") {
        // Preserve the flat 2.3 mm-deep seat for an M2 head. Above it, a 1.1 mm
        // radial reduction over 1.1 mm of height makes a 45-degree printable roof.
        base = base.cut(cylinder(p.x, p.y, -0.1, 1.2, d.joinZ + 1.5))
          .cut(cylinder(p.x, p.y, -0.1, 2.3, 2.4))
          .cut(cone(p.x, p.y, 2.3, 2.3, 1.2, 1.1));
      }
    }
    if (d.detent) {
      // The notch stops above the floor and never perforates the underside.
      for (const x of d.detent.notchX) base = base.cut(cylinder(x, d.detent.tipY, d.floor, d.detent.notchRadius, d.joinZ - d.floor + 0.1));
    }
    // Leave the groove open at the top so it prints without an internal roof.
    // Its 1.1 mm closed +X end is the pullout stop.
    base = base.cut(box(
      sliderStop.grooveStartX, sliderStop.grooveY, d.sliderZ - 0.1,
      sliderStop.grooveEndX - sliderStop.grooveStartX, sliderStop.grooveWidth,
      d.joinZ - d.sliderZ + 0.2,
    ));
  }
  options.onProgress?.({ phase: "building", completed: 1, total: 4, message: "Built base" });
  let tray = reusable("tray")?.shape;
  const frameWall = 2.4;
  // This ring shares the slider grip's XY opening. With the slider fully
  // inserted, a hook can pass through both openings while their separate Z
  // levels keep the moving slider clear of the tray.
  const storageHandleX = d.length;
  const storageHandleLength = 19;
  const storageHandleOpeningX = storageHandleX + 6;
  const storageHandleOpeningLength = 6;
  const storageHandleY = d.sliderInsetY - 3;
  const storageHandleOpeningY = d.sliderInsetY + 4;
  const storageHandleWidth = d.width - 2 * d.sliderInsetY + 6;
  const storageHandleOpeningWidth = d.width - 2 * d.sliderInsetY - 8;
  const handleExtraThickness = 0.8;
  const drainY = d.width / 2 - 6;
  const drainWidth = 12;
  const drainChamferHeight = d.top - d.deckTop;
  // The narrowest one-row tray brings the magnet pocket close to the outlet.
  // Keep at least 0.5 mm of front wall around that pocket while allowing a
  // much wider, full-height taper on ordinary multi-row trays.
  const frontPocketRadius = d.magnetPocketDiameter / 2 + 0.5;
  const frontPocketDx = d.magnets[0].x - (frameWall + 0.2);
  const frontPocketReachY = Math.sqrt(Math.max(0, frontPocketRadius ** 2 - frontPocketDx ** 2));
  const drainFlare = Math.min(6, drainY - d.magnets[0].y - frontPocketReachY);
  const drainLipClearance = 0.2;
  const handleRibRootX = storageHandleX - 0.4;
  const handleRibRun = 3.2;
  const handleRibBaseZ = d.deckTop + handleExtraThickness;
  const handleRibY = storageHandleY + 1;
  const handleRibWidth = storageHandleWidth - 2;
  if (!tray) {
    tray = rounded(0, 0, d.joinZ, d.length, d.width, d.deckThickness, 4);
    let rim = rounded(0, 0, d.deckTop, d.length, d.width, d.top - d.deckTop, 4)
      .cut(rounded(frameWall, frameWall, d.deckTop - 0.1, d.length - 2 * frameWall, d.width - 2 * frameWall, d.top - d.deckTop + 0.2, 1.6));
    // One reinforced corner carries each magnet above its assembly screw.
    for (const p of d.magnets) rim = rim.fuse(cylinder(p.x, p.y, d.deckTop, d.magnetPocketDiameter / 2 + 1.3, d.top - d.deckTop));
    tray = tray.fuse(rim);
    tray = tray
      .fuse(handleWithSquareRoot(storageHandleX, storageHandleY, d.joinZ, storageHandleLength, storageHandleWidth, d.deckThickness + handleExtraThickness))
      .cut(rounded(storageHandleOpeningX, storageHandleOpeningY, d.joinZ - 0.1, storageHandleOpeningLength, storageHandleOpeningWidth, d.deckThickness + handleExtraThickness + 0.2, 2))
      // Open only the upper rim: the continuous deck remains the runway that
      // guides a screw to the front discharge opening.
      .cut(box(-0.1, drainY, d.deckTop - 0.1, frameWall + 0.2, drainWidth, d.top - d.deckTop + 0.2));
    // Bevel both lid-facing sides over the full rim height. The lower outlet
    // stays narrow, and the continuous deck still guides screws out.
    tray = tray
      .cut(prismYZ([
        [drainY, d.deckTop],
        [drainY, d.top + 0.1],
        [drainY - drainFlare - 0.1, d.top + 0.1],
      ], -0.1, frameWall + 0.2))
      .cut(prismYZ([
        [drainY + drainWidth, d.deckTop],
        [drainY + drainWidth + drainFlare + 0.1, d.top + 0.1],
        [drainY + drainWidth, d.top + 0.1],
      ], -0.1, frameWall + 0.2));
    // A single rib supports the full handle root and stops before the hook hole.
    tray = tray.fuse(gussetXZ([
      [handleRibRootX, handleRibBaseZ],
      [handleRibRootX, handleRibBaseZ + handleRibRun],
      [handleRibRootX + handleRibRun, handleRibBaseZ],
    ], handleRibY, handleRibWidth));
    for (const x of d.screwXs) for (const y of d.screwYs) {
      tray = tray.cut(cylinder(x, y, d.joinZ - 0.1, d.drop / 2, d.deckThickness + 0.2));
      tray = tray.cut(cone(x, y, d.deckTop - 0.3, d.drop / 2, d.drop / 2 + TRAY_ENTRY_RADIAL_FLARE, 0.3));
    }
    for (const p of d.joints) {
      // Start 0.2 mm wider than the tapered base land at the mating plane. The
      // 45-degree socket reaches the R0.85 pilot continuously, leaving no flat
      // inner ceiling that would need bridging or support below the tray deck.
      tray = tray.cut(cone(p.x, p.y, d.joinZ - 0.05, 3.25, 0.85, 2.4));
      if (settings.joint === "screws") tray = tray.cut(cylinder(p.x, p.y, d.joinZ + 1.4, 0.85, 2));
    }
    for (const p of d.magnets) tray = tray.cut(cylinder(p.x, p.y, d.top - d.magnetPocketDepth, d.magnetPocketDiameter / 2, d.magnetPocketDepth + 0.1));
  }
  options.onProgress?.({ phase: "building", completed: 2, total: 4, message: "Built tray" });
  const sw = d.width - 2 * d.sliderInsetY;
  let slider = reusable("slider")?.shape;
  if (!slider) {
    slider = rounded(8, d.sliderInsetY, d.sliderZ, d.length - 8, sw, d.sliderThickness, 1.5).fuse(handleWithSquareRoot(d.length, storageHandleY, d.sliderZ, storageHandleLength, storageHandleWidth, d.sliderThickness));
    slider = slider.cut(rounded(storageHandleOpeningX, storageHandleOpeningY, d.sliderZ - 0.1, storageHandleOpeningLength, storageHandleOpeningWidth, d.sliderThickness + 0.2, 2));
    // A U-slot leaves a low-side cantilever tongue. Its lug enters the base
    // groove during normal travel and flexes inward to pass the closed end on
    // intentional insertion or removal.
    const tongueEndX = sliderStop.lugX + sliderStop.lugLength + 0.1;
    slider = slider
      .cut(box(
        sliderStop.lugX - sliderStop.tongueLength, d.sliderInsetY + sliderStop.tongueWidth,
        d.sliderZ - 0.1, tongueEndX - (sliderStop.lugX - sliderStop.tongueLength), 0.8,
        d.sliderThickness + 0.2,
      ))
      .cut(box(
        tongueEndX, d.sliderInsetY - 0.1, d.sliderZ - 0.1, 0.45,
        sliderStop.tongueWidth + 1, d.sliderThickness + 0.2,
      ))
      // The -X face is a 45-degree cam that gradually flexes the tongue inward
      // during insertion. The +X face remains vertical for a positive pullout
      // catch against the base groove's closed end.
      .fuse(prismXY([
        [sliderStop.lugX, d.sliderInsetY + 0.15],
        [sliderStop.lugX + sliderStop.lugDepth, d.sliderInsetY - sliderStop.lugDepth],
        [sliderStop.lugX + sliderStop.lugLength, d.sliderInsetY - sliderStop.lugDepth],
        [sliderStop.lugX + sliderStop.lugLength, d.sliderInsetY + 0.15],
      ], d.sliderZ, d.sliderThickness));
    const last = d.screwXs.at(-1)!;
    for (const y of d.screwYs) slider = slider.cut(rounded(d.releaseX - 1, y - d.slot / 2, d.sliderZ - 0.1, last + 3 - (d.releaseX - 1), d.slot, d.sliderThickness + 0.2, d.slot / 2 - 0.02)).cut(rounded(d.releaseX - d.window / 2, y - d.window / 2, d.sliderZ - 0.1, d.window, d.window, d.sliderThickness + 0.2, 0.65));
    if (d.detent) {
      const edge = d.width - d.sliderInsetY;
      slider = slider.cut(rounded(10, edge - d.detent.springWidth - d.detent.reliefGap, d.sliderZ - 0.1, d.detent.springLength + 2, d.detent.reliefGap, d.sliderThickness + 0.2, 0.45)).cut(box(10, edge - d.detent.springWidth - d.detent.reliefGap + 0.4, d.sliderZ - 0.1, 0.8, d.detent.springWidth + d.detent.reliefGap + 2, d.sliderThickness + 0.2)).fuse(cylinder(d.detent.tipX, d.detent.tipY, d.sliderZ, d.detent.noseRadius, d.sliderThickness));
    }
  }
  options.onProgress?.({ phase: "building", completed: 3, total: 4, message: "Built slider" });
  const gussetRun = 4.2;
  const gussetPlugX = frameWall - 0.3;
  // The tray keeps the existing corner receptacles in both modes. Pegs use
  // 0.3 mm diametral clearance and stop 0.3 mm above each receptacle floor.
  const lidPegDiameterClearance = 0.3;
  const lidPegDepthClearance = 0.3;
  const lidPegRadius = (d.magnetPocketDiameter - lidPegDiameterClearance) / 2;
  const lidPegHeight = d.magnetPocketDepth - lidPegDepthClearance;
  let lid = reusable("lid")?.shape;
  if (!lid) {
    lid = rounded(0, 0, d.top, d.length, d.width, 3.4, 4).fuse(rounded(d.length - 1, d.width / 2 - 7, d.top, 6, 14, 3.4, 2.5));
    const lidPocketInset = d.rim + 2;
    lid = lid.cut(rounded(lidPocketInset, lidPocketInset, d.top - 0.1, d.length - 2 * lidPocketInset, d.width - 2 * lidPocketInset, 2.1, 2));
    const lip = rounded(d.rim + 0.35, d.rim + 0.35, d.top - 1.2, d.length - 2 * d.rim - 0.7, d.width - 2 * d.rim - 0.7, 1.3, 3.35)
      .cut(rounded(d.rim + 1.75, d.rim + 1.75, d.top - 1.3, d.length - 2 * d.rim - 3.5, d.width - 2 * d.rim - 3.5, 1.5, 2));
    lid = lid.fuse(lip).fillet(0.6, (finder, shape) => finder.when(topMost(shape)).parallelTo("XY"));
    // The plug keys into the tray's front rim cutout with 0.2 mm lateral
    // clearance. It reaches the deck so a closed lid cannot let screws escape.
    lid = lid.fuse(rounded(0.1, drainY + 0.1, d.deckTop, frameWall - 0.2, drainWidth - 0.2, d.top - d.deckTop + 0.1, 0.5));
    // Matching full-height tapered lips follow the opening with clearance.
    // They overlap the plug slightly for a continuous printable body.
    lid = lid
      .fuse(prismYZ([
        [drainY + 0.3, d.deckTop + 0.3],
        [drainY + 0.3, d.top + 0.1],
        [drainY - drainFlare + drainLipClearance, d.top + 0.1],
      ], 0.1, frameWall - 0.2))
      .fuse(prismYZ([
        [drainY + drainWidth - 0.3, d.deckTop + 0.3],
        [drainY + drainWidth + drainFlare - drainLipClearance, d.top + 0.1],
        [drainY + drainWidth - 0.3, d.top + 0.1],
      ], 0.1, frameWall - 0.2));
    // Brace the long discharge plug from the underside of the lid, inside the
    // tray opening. The 45-degree face meets the plug without extending the lid
    // past its front edge or reaching the first screw station.
    lid = lid.fuse(gussetXZ([
      [gussetPlugX, d.top],
      [gussetPlugX + gussetRun, d.top],
      [gussetPlugX, d.top - gussetRun],
    ], drainY + 0.1, drainWidth - 0.2));
    for (const p of d.magnets) {
      lid = settings.lidAlignment === "pegs"
        // Overlap the lid by 0.1 mm so the peg fuses into one printable solid.
        ? lid.fuse(cylinder(p.x, p.y, d.top - lidPegHeight, lidPegRadius, lidPegHeight + 0.1))
        : lid.cut(cylinder(p.x, p.y, d.top - 0.1, d.magnetPocketDiameter / 2, d.magnetPocketDepth + 0.1));
    }
  }
  options.onProgress?.({ phase: "building", completed: 4, total: 4, message: "Built lid" });
  aborted();
  const parts = { base, tray, slider, lid };
  const completed: string[] = [];
  if (configuration.validate !== false) {
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
  const fullReleaseTravel = settings.columns * d.pitch;
  // Exclude the click tip here: the stop check must prove the opposite-side
  // lug catches, rather than merely observing detent contact between stations.
  const sliderWithoutClickTip = d.detent
    ? slider.cut(cylinder(d.detent.tipX, d.detent.tipY, d.sliderZ, d.detent.noseRadius, d.sliderThickness))
    : slider;
  const sliderAtFullRelease = sliderWithoutClickTip.clone().translate(fullReleaseTravel, 0, 0);
  const sliderPastPulloutStop = sliderWithoutClickTip.clone().translate(fullReleaseTravel + d.pitch / 4, 0, 0);
  if (intersectionVolume(base, sliderAtFullRelease) >= 1e-5 ||
      intersectionVolume(base, sliderPastPulloutStop) < 0.01) {
    throw new Error("Slider pullout stop must clear full release travel and catch beyond it");
  }
  const tongueSlotProbe = box(
    sliderStop.lugX - sliderStop.tongueLength + 0.3, d.sliderInsetY + sliderStop.tongueWidth + 0.1,
    d.sliderZ - 0.05, sliderStop.tongueLength + sliderStop.lugLength - 0.5, 0.5,
    d.sliderThickness + 0.1,
  );
  const lugLeadClearanceProbe = box(
    sliderStop.lugX + 0.05, d.sliderInsetY - sliderStop.lugDepth + 0.05, d.sliderZ + 0.2,
    0.05, 0.1, d.sliderThickness - 0.4,
  );
  const lugCatchProbe = box(
    sliderStop.lugX + sliderStop.lugDepth - 0.1, d.sliderInsetY - sliderStop.lugDepth + 0.05,
    d.sliderZ + 0.2, 0.05, 0.1, d.sliderThickness - 0.4,
  );
  const flexDistance = sliderStop.lugDepth - settings.slideClearance + sliderStop.flexClearance;
  const flexedLugAtInsertion = box(
    sliderStop.lugX, d.sliderInsetY - sliderStop.lugDepth, d.sliderZ,
    sliderStop.lugLength, sliderStop.lugDepth + 0.15, d.sliderThickness,
  ).translate(fullReleaseTravel + d.pitch / 4, flexDistance, 0);
  if (intersectionVolume(slider, tongueSlotProbe) >= 1e-5 ||
      intersectionVolume(slider, lugLeadClearanceProbe) >= 1e-5 ||
      intersectionVolume(slider, lugCatchProbe) < 0.001 ||
      intersectionVolume(base, flexedLugAtInsertion) >= 1e-5) {
    throw new Error("Slider pullout tongue must retain its lead-in and flex past the base stop for insertion");
  }
  completed.push("Low-side pullout groove, 45-degree flexible slider tongue, and full release travel verified");
  if (settings.lidAlignment === "pegs") {
    for (const peg of d.magnets) {
      const fittedPeg = cylinder(peg.x, peg.y, d.top - lidPegHeight, lidPegRadius, lidPegHeight);
      const pegVolume = Math.PI * lidPegRadius ** 2 * lidPegHeight;
      const radialClearanceProbe = cylinder(peg.x + lidPegRadius + lidPegDiameterClearance / 4, peg.y, d.top - lidPegHeight + 0.1, lidPegDiameterClearance / 8, Math.max(0.1, lidPegHeight - 0.2));
      const floorClearanceProbe = cylinder(peg.x, peg.y, d.top - d.magnetPocketDepth + 0.05, lidPegRadius / 2, lidPegDepthClearance - 0.1);
      if (intersectionVolume(lid, fittedPeg) < pegVolume * 0.98 ||
          intersectionVolume(tray, fittedPeg) >= 1e-5 ||
          intersectionVolume(tray, radialClearanceProbe) >= 1e-5 || intersectionVolume(lid, radialClearanceProbe) >= 1e-5 ||
          intersectionVolume(tray, floorClearanceProbe) >= 1e-5 || intersectionVolume(lid, floorClearanceProbe) >= 1e-5) {
        throw new Error("Lid alignment peg does not retain its material or receptacle clearance");
      }
    }
    completed.push("Lid alignment pegs retain 0.3 mm radial and axial receptacle clearance");
  } else {
    for (const magnet of d.magnets) {
      const fittedMagnet = cylinder(magnet.x, magnet.y, d.top - d.magnetPocketDepth, settings.magnetDiameter / 2, settings.magnetThickness);
      if (intersectionVolume(tray, fittedMagnet) >= 1e-5 || intersectionVolume(lid, fittedMagnet.clone().translate(0, 0, d.magnetPocketDepth)) >= 1e-5) throw new Error("Magnet pocket does not clear its nominal magnet");
    }
    completed.push("Magnet pockets clear their nominal magnets");
  }
  if (d.joints.some((joint, index) => joint.x !== d.magnets[index].x || joint.y !== d.magnets[index].y)) throw new Error("Corner fasteners are not aligned with the magnets");
  if (settings.joint === "screws") {
    const screwTip = 2.3 + 5;
    if (d.top - d.magnetPocketDepth - screwTip < 0.5) throw new Error("Corner screw reaches the magnet pocket");
    const p = d.joints[0];
    if (intersectionVolume(tray, cylinder(p.x, p.y, d.joinZ + 1.5, 0.3, 1.7)) >= 1e-5 ||
        intersectionVolume(tray, cylinder(p.x, p.y, d.joinZ + 3.6, 0.3, 0.25)) < 0.05) {
      throw new Error("Corner screw pilot must be blind below the magnet pocket");
    }
  }
  completed.push(settings.lidAlignment === "pegs"
    ? "Coaxial corner fasteners and lid alignment receptacles remain vertically separated"
    : "Coaxial corner fasteners and magnet pockets remain vertically separated");
  const frameSpan = cylinder(d.length / 2, frameWall + 0.6, d.deckTop + 0.6, 0.15, 0.5);
  const cornerPad = cylinder(d.magnets[0].x + 2.5, d.magnets[0].y, d.deckTop + 0.15, 0.25, 0.4);
  if (intersectionVolume(tray, frameSpan) >= 1e-5 || intersectionVolume(tray, cornerPad) < 0.05) {
    throw new Error("Thin frame or corner reinforcement is missing");
  }
  const lidCenterX = d.length / 2; const lidCenterY = d.width / 2;
  if (intersectionVolume(lid, cylinder(lidCenterX, lidCenterY, d.top + 0.2, 0.25, 0.8)) >= 1e-5 ||
      intersectionVolume(lid, cylinder(lidCenterX, lidCenterY, d.top + 2.25, 0.25, 0.7)) < 0.1) {
    throw new Error("Lid center pocket or roof is missing");
  }
  completed.push("Thin frame, reinforced corners, and lid skin verified");
  const printedLid = printOrientation(lid.clone().rotate(180, [0, 0, 0], [1, 0, 0]));
  const [printedLidMin] = printedLid.boundingBox.bounds;
  if (Math.abs(printedLidMin[2]) > 1e-5) throw new Error("Lid print orientation is not seated on the build plane");
  if (settings.lidAlignment === "pegs") {
    for (const peg of d.magnets) {
      const printedPegTip = cylinder(peg.x, d.width - peg.y, 3.4 + lidPegHeight - 0.08, lidPegRadius / 2, 0.05);
      if (intersectionVolume(printedLid, printedPegTip) < 0.001) throw new Error("Lid alignment peg is not upright in print orientation");
    }
  }
  completed.push("Lid print orientation verified");
  const handleCenterX = storageHandleOpeningX + storageHandleOpeningLength / 2;
  const handleCenterY = d.width / 2;
  if (tray.boundingBox.bounds[1][0] < storageHandleX + storageHandleLength - 0.1 ||
      intersectionVolume(tray, cylinder(handleCenterX, handleCenterY, d.joinZ - 0.1, 0.3, d.deckThickness + 0.2)) >= 1e-5 ||
      intersectionVolume(slider, cylinder(handleCenterX, handleCenterY, d.sliderZ - 0.1, 0.3, d.sliderThickness + 0.2)) >= 1e-5) {
    throw new Error("Tray and slider storage handles must retain overlapping hook openings");
  }
  const gripX = storageHandleX + 5.5;
  if (intersectionVolume(tray, cylinder(gripX, handleCenterY, d.deckTop + 0.3, 0.25, 0.3)) < 0.02 ||
      intersectionVolume(slider, cylinder(gripX, handleCenterY, d.sliderZ + 0.8, 0.25, 0.3)) < 0.02) {
    throw new Error("Tray and slider hook handles must retain their reinforced thickness");
  }
  completed.push("Tray and slider storage handles retain reinforced thickness");
  const rootCornerX = storageHandleX + 0.5;
  const rootCornerY = storageHandleY + 0.3;
  const tipCornerX = storageHandleX + storageHandleLength - 0.5;
  for (const [part, z] of [[tray, d.joinZ], [slider, d.sliderZ]] as const) {
    if (intersectionVolume(part, cylinder(rootCornerX, rootCornerY, z + 0.5, 0.1, 0.1)) < 0.002 ||
        intersectionVolume(part, cylinder(tipCornerX, rootCornerY, z + 0.5, 0.1, 0.1)) >= 1e-5) {
      throw new Error("Storage handles must have square roots and rounded outer tips");
    }
  }
  completed.push("Tray and slider handle roots are square while outer tips stay rounded");
  const handleRibProbeX = handleRibRootX + handleRibRun / 2;
  for (const probeY of [handleRibY + 1.5, handleCenterY, handleRibY + handleRibWidth - 1.5]) {
    if (intersectionVolume(tray, cylinder(handleRibProbeX, probeY, handleRibBaseZ + 0.8, 0.12, 0.12)) < 0.003 ||
        intersectionVolume(tray, cylinder(handleRibProbeX, probeY, handleRibBaseZ + 2.4, 0.12, 0.12)) >= 1e-5) {
      throw new Error("Tray storage handle must retain its full-width 45-degree root rib");
    }
  }
  completed.push("Tray storage handle retains its full-width 45-degree root rib");
  const drainProbe = cylinder(frameWall / 2, d.width / 2, d.deckTop + 0.2, 0.3, 0.5);
  if (intersectionVolume(tray, drainProbe) >= 1e-5 || intersectionVolume(lid, drainProbe) < 0.05) {
    throw new Error("Tray discharge cutout or closed-lid retention plug is missing");
  }
  for (const side of [-1, 1]) {
    const edgeY = side < 0 ? drainY : drainY + drainWidth;
    const probeZ = d.top - Math.min(0.75, drainChamferHeight * 0.15);
    const openingAtProbe = drainFlare * (probeZ - d.deckTop) / (drainChamferHeight + 0.1);
    const lipY = edgeY + side * openingAtProbe * 0.7;
    const clearanceY = edgeY + side * (openingAtProbe - 0.08);
    const lipProbe = cylinder(frameWall / 2, lipY, probeZ, 0.08, 0.08);
    const clearanceProbe = cylinder(frameWall / 2, clearanceY, probeZ, 0.025, 0.08);
    const lowerRimProbe = cylinder(frameWall / 2, edgeY + side * 1.4, d.deckTop + 0.2, 0.08, 0.08);
    if (intersectionVolume(tray, lipProbe) >= 1e-5 || intersectionVolume(lid, lipProbe) < 0.001 ||
        intersectionVolume(tray, clearanceProbe) >= 1e-5 || intersectionVolume(lid, clearanceProbe) >= 1e-5 ||
        intersectionVolume(tray, lowerRimProbe) < 0.001 || intersectionVolume(lid, lowerRimProbe) >= 1e-5) {
      throw new Error("Discharge cutout must retain full-height chamfers and matching clearance-fit lid lips");
    }
  }
  completed.push("Discharge cutout full-height chamfers and matching lid lips verified");
  const gussetY = d.width / 2;
  const gussetMiddleX = gussetPlugX + gussetRun / 2;
  const gussetMaterial = cylinder(gussetMiddleX, gussetY, d.top - 1.75, 0.12, 0.12);
  const belowGusset = cylinder(gussetMiddleX, gussetY, d.top - 2.7, 0.12, 0.12);
  const gussetMaterialVolume = intersectionVolume(lid, gussetMaterial);
  const belowGussetVolume = intersectionVolume(lid, belowGusset);
  const lidFrontX = lid.boundingBox.bounds[0][0];
  if (gussetMaterialVolume < 0.003 || belowGussetVolume >= 1e-5 || lidFrontX < -1e-5) {
    throw new Error("Lid discharge plug must retain its 45-degree internal gusset without a front protrusion");
  }
  completed.push("Overlapping storage handles, closed-lid discharge plug, and 45-degree internal gusset verified");
  if (settings.joint === "screws") {
    const p = d.joints[0];
    if (intersectionVolume(base, cylinder(p.x + 1.8, p.y, 2.45, 0.08, 0.15)) >= 1e-5 ||
        intersectionVolume(base, cylinder(p.x + 1.8, p.y, 3.15, 0.08, 0.15)) < 0.001) {
      throw new Error("Assembly screw counterbore lacks its 45-degree transition");
    }
    completed.push("Assembly screw counterbore retains its head seat and 45-degree roof");
  }
  const joint = d.joints[0];
  // Both printed mating surfaces taper one millimetre per millimetre. Samples
  // on either side of the former vertical walls catch an accidental regression
  // to a cylindrical peg or a flat-bottomed tray socket.
  const lowerBaseLand = intersectionVolume(base, cylinder(joint.x + 2.7, joint.y, d.joinZ + 0.15, 0.05, 0.15));
  const upperBaseLand = intersectionVolume(base, cylinder(joint.x + 2.0, joint.y, d.joinZ + 1.05, 0.05, 0.15));
  const baseTipWall = intersectionVolume(base, cylinder(joint.x + 1.5, joint.y, d.joinZ + 1.05, 0.05, 0.15));
  const lowerTraySocket = intersectionVolume(tray, cylinder(joint.x + 2.7, joint.y, d.joinZ + 0.15, 0.05, 0.15));
  const upperTraySocket = intersectionVolume(tray, cylinder(joint.x + 2.4, joint.y, d.joinZ + 1.05, 0.05, 0.15));
  if (lowerBaseLand < 1e-4 || upperBaseLand >= 1e-5 || baseTipWall < 0.001 || lowerTraySocket >= 1e-5 || upperTraySocket < 0.001) {
    throw new Error("Registration joint must retain matching 45-degree tapers");
  }
  completed.push("Tapered registration lands and sockets retain 45-degree printable faces");
  if (d.detent) {
    const tip = cylinder(d.detent.tipX, d.detent.tipY, d.sliderZ, d.detent.noseRadius, d.sliderThickness);
    const rigidSlider = slider.cut(tip);
    for (const x of d.detent.notchX) {
      if (intersectionVolume(base, cylinder(x, d.detent.tipY, 0, 0.4, d.floor / 2)) < 0.3) throw new Error("Detent notch perforates the base floor");
    }
    for (const fraction of [0.25, 0.5, 0.75]) {
      if (intersectionVolume(base, rigidSlider.clone().translate(d.pitch * fraction, 0, 0)) >= 1e-5) throw new Error("Detent slider body contacts rail between stations");
      if (intersectionVolume(base, tip.clone().translate(d.pitch * fraction, -0.8, 0)) >= 1e-5) throw new Error("Detent tip cannot deflect 0.8 mm");
    }
    if (intersectionVolume(base, tip.clone().translate(d.pitch / 2, 0, 0)) < 0.1) throw new Error("Detent engagement is too shallow");
    if (d.detent.reliefGap <= d.detent.maxLateralDeflection + 0.2) throw new Error("Detent relief gap is too narrow");
    completed.push("Detent pockets retain the base floor; inter-station clearance verified");
  }
  } else {
    completed.push("Interactive preview geometry generated; export validation deferred");
  }
  const diagnostics = Object.fromEntries(Object.entries(parts).map(([name, part]) => {
    const prior = reusable(name as keyof typeof keys);
    if (prior) return [name, prior.diagnostic];
    const [min, max] = part.boundingBox.bounds;
    return [name, { volume: measureShapeVolumeProperties(part).volume, bounds: { min, max } }];
  })) as Record<"base" | "tray" | "slider" | "lid", PartDiagnostic>;
  const meshTolerance = configuration.meshTolerance ?? 0.08;
  const partMeshes = Object.fromEntries(Object.entries(parts).map(([name, part]) => {
    const prior = reusable(name as keyof typeof keys);
    if (prior?.meshTolerance === meshTolerance) return [name, prior.mesh];
    const mesh = part.mesh({ tolerance: meshTolerance, angularTolerance: 0.2 });
    return [name, {
      positions: Float32Array.from(mesh.vertices),
      normals: Float32Array.from(mesh.normals),
      indices: Uint32Array.from(mesh.triangles),
    }];
  })) as Record<"base" | "tray" | "slider" | "lid", TriangleMesh>;
  for (const name of Object.keys(parts) as Array<keyof typeof parts>) {
    const prior = partCache[name];
    partCache[name] = { key: keys[name], shape: parts[name], mesh: partMeshes[name], meshTolerance, diagnostic: diagnostics[name], stl: prior?.key === keys[name] ? prior.stl : undefined };
  }
  const partStl = (name: keyof typeof parts, shape: Shape3D): Blob => {
    const cached = partCache[name]!;
    return cached.stl ??= printOrientation(shape.clone()).blobSTL({ binary: true, tolerance: 0.04, angularTolerance: 0.15 });
  };
  const files: Partial<Record<GeneratedFileName, Blob>> = configuration.includeExports === false ? {} : {
    "base.stl": partStl("base", base), "tray.stl": partStl("tray", tray),
    "slider.stl": partStl("slider", slider), "lid.stl": partCache.lid!.stl ??= printOrientation(lid.clone().rotate(180, [0, 0, 0], [1, 0, 0])).blobSTL({ binary: true, tolerance: 0.04, angularTolerance: 0.15 }),
    "assembly.step": exportSTEP([{ shape: base, name: "base" }, { shape: tray, name: "tray" }, { shape: slider, name: "slider" }, { shape: lid, name: "lid" }]),
  };
  return { files, warnings: [], verification: { completed, pending: ["Full per-station release and retention checks", "Physical print fit and detent force of the browser revision"] }, diagnostics, partMeshes };
}
