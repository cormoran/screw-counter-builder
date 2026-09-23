import initOpenCascade from "replicad-opencascadejs";
import openCascadeWasm from "replicad-opencascadejs/wasm?url";
import { exportSTEP, makeBox, makeCylinder, measureShapeVolumeProperties, setOC, Sketcher, sketchCircle, sketchRectangle, sketchRoundedRectangle, topMost } from "replicad";
import { partKeys } from "./part-keys";
import { TRAY_ENTRY_FLARE } from "./settings";
import type { Shape3D } from "replicad";
import type { DerivedDimensions, GenerateOptions, GeneratedFileName, PartDiagnostic, ModelPart, Settings, TriangleMesh, VerificationResult } from "./types";

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
const sliderBodyWithSquareHandleEnd = (x: number, y: number, z: number, length: number, width: number, thickness: number): Shape3D =>
  rounded(x, y, z, 3.2, width, thickness, 1.5)
    .fuse(box(x + 1.6, y, z, length - 1.6, width, thickness));
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

type CachedCadPart = { key: string; shape: Shape3D; mesh: TriangleMesh; meshTolerance: number; diagnostic: PartDiagnostic; stl?: Blob };
const partCache: Partial<Record<"base" | "tray" | "slider" | "lid" | "funnel", CachedCadPart>> = {};


const printOrientation = (shape: Shape3D): Shape3D => {
  const [min] = shape.boundingBox.bounds;
  return shape.translate(-min[0], -min[1], -min[2]);
};

/** Browser-specific OpenCascade B-Rep builder. */
export async function buildWithReplicad(settings: Settings, d: DerivedDimensions, options: GenerateOptions, configuration: BuildConfiguration = {}): Promise<{ files: Partial<Record<GeneratedFileName, Blob>>; warnings: string[]; verification: VerificationResult; diagnostics: Record<"base" | "tray" | "slider" | "lid" | "funnel", PartDiagnostic>; partMeshes: Record<"base" | "tray" | "slider" | "lid" | "funnel", TriangleMesh> }> {
  await ready();
  const aborted = () => { if (options.signal?.aborted) throw new DOMException("CAD generation was cancelled", "AbortError"); };
  aborted();
  const keys = partKeys(settings, d);
  const reusable = <P extends keyof typeof keys>(part: P) => partCache[part]?.key === keys[part] ? partCache[part] : undefined;
  const meshTolerance = configuration.meshTolerance ?? 0.08;
  const preparedMeshes: Partial<Record<ModelPart, TriangleMesh>> = {};
  const prepareMesh = (name: ModelPart, shape: Shape3D): TriangleMesh => {
    if (preparedMeshes[name]) return preparedMeshes[name];
    const prior = reusable(name);
    if (prior?.meshTolerance === meshTolerance) return preparedMeshes[name] = prior.mesh;
    const mesh = shape.mesh({ tolerance: meshTolerance, angularTolerance: 0.2 });
    return preparedMeshes[name] = {
      positions: Float32Array.from(mesh.vertices), normals: Float32Array.from(mesh.normals), indices: Uint32Array.from(mesh.triangles),
    };
  };
  const partReady = (part: ModelPart, shape: Shape3D, completed: number) => {
    aborted();
    if (options.onPart) options.onPart({ part, mesh: prepareMesh(part, shape), dimensions: d });
    options.onProgress?.({ phase: "building", completed, total: 5, message: `Built ${part}` });
  };
  // The low-Y rail is opposite the high-Y click spring. Its open-top groove
  // takes a rigid guide rib that runs from near the slider nose to the stop.
  // Place the slider from above before fastening the tray to the base.
  const sliderStop = {
    grooveStartX: 7.7,
    grooveEndX: d.length - 1.1,
    grooveY: d.wall - 1,
    grooveWidth: 1.4,
    ribStartX: 10,
    ribEndX: d.length - settings.columns * d.pitch - 1.4,
    ribY: d.wall - 0.7,
    ribWidth: d.sliderInsetY - (d.wall - 0.7) + 0.2,
  };
  let base = reusable("base")?.shape;
  if (!base) {
    // The full bottom plate keeps screw heads away from broad openings. Each
    // head can leave only through its own straight square outlet after the
    // slider's release window reaches that station.
    base = rounded(0, 0, 0, d.length, d.width, d.joinZ, 4)
      .cut(box(7.7, d.wall, d.floor, d.length, d.width - 2 * d.wall, d.joinZ + 1));
    for (const x of d.screwXs) for (const y of d.screwYs) {
      base = base.cut(box(x - d.drop / 2, y - d.drop / 2, -0.1, d.drop, d.drop, d.floor + 0.2));
    }
    for (const p of d.joints) {
      // Keep 0.6 mm of material around the R1.2 through-hole at the narrow end.
      // The land narrows by 1.2 mm over its 1.2 mm height, so its exterior is a
      // 45-degree face that prints without support and matches the tray socket.
      base = base.fuse(cone(p.x, p.y, d.joinZ, 3, 1.8, 1.2));
      if (settings.joint === "screws") {
        // Recess the M2 head above the underside magnet, retaining its 45-degree roof.
        base = base.cut(cylinder(p.x, p.y, -0.1, 1.2, d.joinZ + 1.5))
          .cut(cylinder(p.x, p.y, -0.1, 2.3, d.baseScrewHeadSeat + 0.1))
          .cut(cone(p.x, p.y, d.baseScrewHeadSeat, 2.3, 1.2, 1.1));
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
  if (!reusable("base")) {
    for (const p of d.funnelMounts) {
      // Cut into the original flat base: never add material below Z=0.
      base = base.cut(cylinder(p.x, p.y, -0.1, d.magnetPocketDiameter / 2, d.funnelBasePocketDepth + 0.1));
      if (settings.funnelAlignment === "pegs") {
        base = base.cut(cylinder(p.x, p.y, d.funnelBasePocketDepth * 0.4, d.magnetPocketDiameter / 2 + 0.3, d.funnelBasePocketDepth * 0.6));
      }
    }
  }
  partReady("base", base, 1);
  let tray = reusable("tray")?.shape;
  const frameWall = 2.4;
  const sliderGuideWidth = 2;
  const trayOpeningCornerRadius = 2;
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
  const sw = d.width - 2 * d.sliderInsetY;
  let slider = reusable("slider")?.shape;
  if (!slider) {
    // Keep the handle's outward-facing root corners rounded. Square the body
    // end instead, so its inward-facing junction corners do not form a fillet.
    slider = sliderBodyWithSquareHandleEnd(8, d.sliderInsetY, d.sliderZ, d.length - 8, sw, d.sliderThickness)
      .fuse(rounded(d.length, storageHandleY, d.sliderZ, storageHandleLength, storageHandleWidth, d.sliderThickness, 3));
    slider = slider.cut(rounded(storageHandleOpeningX, storageHandleOpeningY, d.sliderZ - 0.1, storageHandleOpeningLength, storageHandleOpeningWidth, d.sliderThickness + 0.2, 2));
    // This solid rib cannot flex. It supports the low edge over a longer run
    // and ends 0.3 mm before the base's closed groove end at full release.
    slider = slider.fuse(box(
      sliderStop.ribStartX, sliderStop.ribY, d.sliderZ,
      sliderStop.ribEndX - sliderStop.ribStartX, sliderStop.ribWidth, d.sliderThickness,
    ));
    const last = d.screwXs.at(-1)!;
    for (const y of d.screwYs) slider = slider.cut(rounded(d.releaseX - 1, y - d.slot / 2, d.sliderZ - 0.1, last + 3 - (d.releaseX - 1), d.slot, d.sliderThickness + 0.2, d.slot / 2 - 0.02)).cut(rounded(d.releaseX - d.window / 2, y - d.window / 2, d.sliderZ - 0.1, d.window, d.window, d.sliderThickness + 0.2, 0.65));
    if (d.detent) {
      const edge = d.width - d.sliderInsetY;
      slider = slider.cut(rounded(10, edge - d.detent.springWidth - d.detent.reliefGap, d.sliderZ - 0.1, d.detent.springLength + 2, d.detent.reliefGap, d.sliderThickness + 0.2, 0.45)).cut(box(10, edge - d.detent.springWidth - d.detent.reliefGap + 0.4, d.sliderZ - 0.1, 0.8, d.detent.springWidth + d.detent.reliefGap + 2, d.sliderThickness + 0.2)).fuse(cylinder(d.detent.tipX, d.detent.tipY, d.sliderZ, d.detent.noseRadius, d.sliderThickness));
    }
  }
  partReady("slider", slider, 2);
  if (!tray) {
    tray = rounded(0, 0, d.joinZ, d.length, d.width, d.deckThickness, 4);
    // Open only the screw-head area between two narrow ledges that keep the
    // slider captive from above. The floor outside the slider stays solid.
    const deckOpeningX = d.rim;
    const deckOpeningLength = d.length - 2 * d.rim;
    if (d.trayStyle === "cutout") {
      tray = tray.cut(rounded(
        deckOpeningX, d.sliderInsetY + sliderGuideWidth, d.joinZ - 0.1,
        deckOpeningLength, d.width - 2 * (d.sliderInsetY + sliderGuideWidth), d.deckThickness + 0.2, trayOpeningCornerRadius,
      ));
    } else {
      // Reuse one cutter and release each intermediate deck immediately: a
      // large grid otherwise retains every increasingly complex boolean result.
      const straight = box(-d.drop / 2, -d.drop / 2, d.joinZ - 0.1, d.drop, d.drop, d.deckThickness + 0.2);
      const flare = sketchRectangle(d.drop, d.drop, { plane: "XY", origin: [0, 0, d.deckTop - TRAY_ENTRY_FLARE] })
        .loftWith(sketchRectangle(d.drop + 2 * TRAY_ENTRY_FLARE, d.drop + 2 * TRAY_ENTRY_FLARE,
          { plane: "XY", origin: [0, 0, d.deckTop] }), { ruled: true });
      const cutter = straight.fuse(flare);
      straight.delete();
      flare.delete();
      try {
        for (const x of d.screwXs) for (const y of d.screwYs) {
          const positioned = cutter.clone().translate(x, y, 0);
          const previous: Shape3D = tray!;
          try { tray = previous.cut(positioned); } finally { positioned.delete(); }
          previous.delete();
        }
      } finally { cutter.delete(); }
    }
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
    for (const p of d.joints) {
      // Start 0.2 mm wider than the tapered base land at the mating plane. The
      // 45-degree socket reaches the R0.85 pilot continuously, leaving no flat
      // inner ceiling that would need bridging or support below the tray deck.
      tray = tray.cut(cone(p.x, p.y, d.joinZ - 0.05, 3.25, 0.85, 2.4));
      if (settings.joint === "screws") {
        // Give an M2x5 tip more room than the former 0.1 mm, while keeping a
        // solid roof below the coaxial magnet or peg receptacle.
        const pilotEnd = Math.min(d.joinZ + 4.4 + d.funnelBasePocketDepth, d.top - d.magnetPocketDepth - 0.5);
        tray = tray.cut(cylinder(p.x, p.y, d.joinZ + 1.4, 0.85, pilotEnd - (d.joinZ + 1.4)));
      }
    }
    for (const p of d.magnets) tray = tray.cut(cylinder(p.x, p.y, d.top - d.magnetPocketDepth, d.magnetPocketDiameter / 2, d.magnetPocketDepth + 0.1));
  }
  partReady("tray", tray, 3);
  aborted();
  let funnel = reusable("funnel")?.shape;
  if (!funnel) {
    const z = d.funnelMountZ;
    const bottom = -d.funnelDepth;
    const outlet = settings.funnelOutlet;
    const section = (w: number, h: number, height: number, x: number) => sketchRoundedRectangle(w, h, 2, { plane: "XY", origin: [x, d.width / 2, height] });
    // A low rectangular block with a sloped cavity and an outlet away from +X's tab.
    const envelope = rounded(0, 0, bottom, d.length, d.width, d.funnelDepth, 4)
      .fillet(0.6, (finder) => finder.parallelTo("XY"));
    funnel = envelope.clone()
      .cut(section(outlet, outlet, bottom, d.funnelOutletX).loftWith(section(d.length - 4.8, d.width - 4.8, -3, d.length / 2), {}))
      .cut(rounded(2.4, 2.4, -3.01, d.length - 4.8, d.width - 4.8, 3.2, 2))
      .cut(rounded(d.funnelOutletX - outlet / 2, (d.width - outlet) / 2, bottom - 0.1, outlet, outlet, 0.2, 2))
      .fillet(0.4, (finder) => finder.inPlane("XY", bottom).inBox(
        [d.funnelOutletX - outlet / 2 - 1, (d.width - outlet) / 2 - 1, bottom - 0.01],
        [d.funnelOutletX + outlet / 2 + 1, (d.width + outlet) / 2 + 1, bottom + 0.01]))
      .fillet(0.4, (finder) => finder.inPlane("XY", 0).inBox([2.3, 2.3, -0.01], [d.length - 2.3, d.width - 2.3, 0.01]));
    for (const p of d.funnelMounts) {
      // Solid corner lands receive only the protruding magnets, not base bosses.
      const land = p.y < d.width / 2 ? p.y : d.width - p.y;
      const span = land + d.magnetPocketDiameter / 2 + 1.2;
      const cornerLand = rounded(p.x < d.length / 2 ? 0 : d.length - span, p.y < d.width / 2 ? 0 : d.width - span,
        z - d.magnetPocketDepth - 1.2, span, span, -z + d.magnetPocketDepth + 1.2, 2)
        .fillet(0.6, (finder) => finder.parallelTo("XY"));
      funnel = funnel.fuse(cornerLand.intersect(envelope.clone()))
        .cut(cylinder(p.x, p.y, z, d.magnetPocketDiameter / 2, -z + 0.1));
      funnel = settings.funnelAlignment === "magnets"
        ? funnel.cut(cylinder(p.x, p.y, z - d.magnetPocketDepth, d.magnetPocketDiameter / 2, d.magnetPocketDepth + 0.1))
        : funnel.fuse(cylinder(p.x, p.y, z - 0.1, (d.magnetPocketDiameter - 0.3) / 2, d.funnelBasePocketDepth - 0.2)
          .fuse(cone(p.x, p.y, z + d.funnelBasePocketDepth * 0.45, d.magnetPocketDiameter / 2 + 0.2, (d.magnetPocketDiameter - 0.3) / 2, d.funnelBasePocketDepth * 0.25))
          .cut(box(p.x - 0.3, p.y - d.magnetPocketDiameter, z - 0.05, 0.6, d.magnetPocketDiameter * 2, d.magnetPocketDepth + 0.2)));
    }
  }
  partReady("funnel", funnel, 4);
  const gussetRun = 4.2;
  const gussetPlugX = frameWall - 0.3;
  // The tray keeps the existing corner receptacles in both modes. Pegs use
  // 0.3 mm diametral clearance and stop 0.3 mm above each receptacle floor.
  const lidPegDiameterClearance = 0.3;
  const lidPegDepthClearance = 0.3;
  const lidPegRadius = (d.magnetPocketDiameter - lidPegDiameterClearance) / 2;
  const lidPegHeight = d.magnetPocketDepth - lidPegDepthClearance;
  const lidMounts = settings.lidStyle === "cutout" ? d.magnets.filter((p) => p.x < d.length / 2) : d.magnets;
  const lidStripWidth = d.rim + 0.5;
  let lid = reusable("lid")?.shape;
  if (!lid) {
    if (settings.lidStyle === "cutout") {
      lid = rounded(0, 0, d.top, lidStripWidth, d.width, 3.4, 2);
    } else {
      lid = rounded(0, 0, d.top, d.length, d.width, 3.4, 4).fuse(rounded(d.length - 1, d.width / 2 - 7, d.top, 6, 14, 3.4, 2.5));
      const lidPocketInset = d.rim + 2;
      lid = lid.cut(rounded(lidPocketInset, lidPocketInset, d.top - 0.1, d.length - 2 * lidPocketInset, d.width - 2 * lidPocketInset, 2.1, 2));
      const lip = rounded(d.rim + 0.35, d.rim + 0.35, d.top - 1.2, d.length - 2 * d.rim - 0.7, d.width - 2 * d.rim - 0.7, 1.3, 3.35)
        .cut(rounded(d.rim + 1.75, d.rim + 1.75, d.top - 1.3, d.length - 2 * d.rim - 3.5, d.width - 2 * d.rim - 3.5, 1.5, 2));
      lid = lid.fuse(lip).fillet(0.6, (finder, shape) => finder.when(topMost(shape)).parallelTo("XY"));
    }
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
    for (const p of lidMounts) {
      lid = settings.lidAlignment === "pegs"
        // Overlap the lid by 0.1 mm so the peg fuses into one printable solid.
        ? lid.fuse(cylinder(p.x, p.y, d.top - lidPegHeight, lidPegRadius, lidPegHeight + 0.1))
        : lid.cut(cylinder(p.x, p.y, d.top - 0.1, d.magnetPocketDiameter / 2, d.magnetPocketDepth + 0.1));
    }
  }
  partReady("lid", lid, 5);
  const parts = { base, tray, slider, lid, funnel };
  const completed: string[] = [];
  if (configuration.validate !== false) {
  if (Object.values(parts).every((part) => !part.isNull && part.solids.length === 1)) completed.push("5 valid single solids");
  else throw new Error(`CAD build produced a null or multi-solid part: ${Object.entries(parts).map(([name, part]) => `${name}=${part.solids.length}`).join(", ")}`);
  const names = Object.keys(parts) as Array<keyof typeof parts>;
  for (let i = 0; i < names.length; i += 1) for (let j = i + 1; j < names.length; j += 1) {
    if (intersectionVolume(parts[names[i]], parts[names[j]]) >= 1e-5) throw new Error(`Assembly interference: ${names[i]} / ${names[j]}`);
  }
  completed.push("No pairwise assembly interference at the closed position");
  const outletProbe = rounded(d.funnelOutletX - settings.funnelOutlet / 2 + 0.1, (d.width - settings.funnelOutlet) / 2 + 0.1,
    -d.funnelDepth - 0.1, settings.funnelOutlet - 0.2, settings.funnelOutlet - 0.2, 0.2, 1.9);
  if (intersectionVolume(funnel, outletProbe) >= 1e-5) throw new Error("Funnel outlet must remain open");
  for (const x of d.screwXs) for (const y of d.screwYs) {
    const flowPath = sketchCircle(d.head / 2, { plane: "XY", origin: [d.funnelOutletX, d.width / 2, -d.funnelDepth] })
      .loftWith(sketchCircle(d.head / 2, { plane: "XY", origin: [x, y, -3] }), {});
    if (intersectionVolume(funnel, flowPath) >= 1e-5) throw new Error("Funnel corner lands block a screw flow path");
    if (intersectionVolume(funnel, cylinder(x, y, -2.5, d.head / 2, 2.6)) >= 1e-5) throw new Error("Funnel mouth blocks a base outlet");
  }
  for (const p of d.funnelMounts) {
    if (settings.funnelAlignment === "magnets") {
      for (const [part, z] of [[base, d.funnelMountZ], [funnel, d.funnelMountZ - d.magnetPocketDepth]] as const) {
        if (intersectionVolume(part, cylinder(p.x, p.y, z, settings.magnetDiameter / 2, settings.magnetThickness)) >= 1e-5) throw new Error("Funnel magnet pocket is blocked");
      }
    } else {
      // A shoulder catches the split peg after insertion; insertion flex is unmeasured.
      if (intersectionVolume(base, funnel.clone().translate(0, 0, -d.funnelBasePocketDepth * 0.35)) < 0.001) throw new Error("Funnel snap pegs lack retaining shoulders");
    }
  }
  for (const part of [base, funnel]) {
    const [min, max] = part.boundingBox.bounds;
    if (min[0] < -1e-5 || min[1] < -1e-5 || max[0] > d.length + 1e-5 || max[1] > d.width + 1e-5) throw new Error("Funnel attachment protrudes beyond the base footprint");
  }
  if (Math.abs(base.boundingBox.bounds[0][2]) > 1e-5) throw new Error("Base underside must stay on Z=0 without mounting protrusions");
  if (settings.joint === "screws") for (const p of d.joints) {
    if (intersectionVolume(base, cylinder(p.x, p.y, 0, 2.1, d.baseScrewHeadSeat - 0.1)) >= 1e-5) throw new Error("Embedded mount blocks assembly screw insertion");
    const head = cylinder(p.x, p.y, d.baseScrewHeadSeat - 2.2, 2.1, 2.2);
    const shaft = cylinder(p.x, p.y, d.baseScrewHeadSeat, 0.8, 5);
    if (intersectionVolume(base, head) >= 1e-5 || intersectionVolume(tray, shaft) >= 1e-5 ||
        d.baseScrewHeadSeat - 2.2 < d.funnelBasePocketDepth + 0.09) throw new Error("Assembly screw overlaps the funnel attachment or its pilot");
  }
  completed.push("Flat base underside and recessed screw heads clear funnel magnets or pegs");
  completed.push("Funnel mouth, continuous outlet, and attachment clearances verified");
  for (const x of [0.2, d.length - 0.2]) for (const y of [0.2, d.width - 0.2]) {
    if (intersectionVolume(funnel, cylinder(x, y, -d.funnelDepth / 2, 0.08, 0.2)) >= 1e-5) throw new Error("Funnel outer corners must be rounded");
  }
  for (const z of [-0.15, -d.funnelDepth + 0.05]) {
    if (intersectionVolume(funnel, box(0.05, d.width / 2, z, 0.1, 0.1, 0.1)) >= 1e-5 ||
        intersectionVolume(funnel, box(0.8, d.width / 2, z, 0.1, 0.1, 0.1)) < 0.0009) throw new Error("Funnel edge rounds must retain the adjacent wall");
  }
  // Sample the rounded cross-section above the outlet rim fillet: at the
  // bottom face the rim round intentionally removes this corner material.
  const sectionFraction = 1 / (d.funnelDepth - 3);
  const outletCorner = cylinder(
    (d.funnelOutletX - settings.funnelOutlet / 2) * (1 - sectionFraction) + 2.4 * sectionFraction + 0.1,
    (d.width - settings.funnelOutlet) / 2 * (1 - sectionFraction) + 2.4 * sectionFraction + 0.1,
    -d.funnelDepth + 1, 0.03, 0.02);
  if (intersectionVolume(funnel, outletCorner) < 0.00005) throw new Error("Funnel outlet must retain rounded corners");
  completed.push("Rounded funnel corners, outer edges, and outlet verified");
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
  const firstHoleX = d.screwXs[0]; const firstHoleY = d.screwYs[0];
  const squareCorner = cylinder(firstHoleX + d.drop / 2 - 0.15, firstHoleY + d.drop / 2 - 0.15, 0.2, 0.05, 0.2);
  const squareWall = cylinder(firstHoleX + d.drop / 2 + 0.15, firstHoleY, 0.2, 0.05, 0.2);
  if (intersectionVolume(base, squareCorner) >= 1e-5 || intersectionVolume(base, squareWall) < 0.001) {
    throw new Error("Base outlet must have a square straight opening");
  }
  const trayOpening = cylinder(firstHoleX, firstHoleY, d.joinZ, d.head / 2, d.deckThickness);
  const lowGuide = cylinder(d.length / 2, d.sliderInsetY + sliderGuideWidth / 2, d.joinZ, 0.2, d.deckThickness);
  const highGuide = cylinder(d.length / 2, d.width - d.sliderInsetY - sliderGuideWidth / 2, d.joinZ, 0.2, d.deckThickness);
  const lowOuterFloor = cylinder(d.length / 2, (frameWall + d.sliderInsetY) / 2, d.joinZ, 0.2, d.deckThickness);
  const highOuterFloor = cylinder(d.length / 2, d.width - (frameWall + d.sliderInsetY) / 2, d.joinZ, 0.2, d.deckThickness);
  const trayOpeningY = d.sliderInsetY + sliderGuideWidth;
  const roundedCornerMaterial = cylinder(d.rim + 0.3, trayOpeningY + 0.3, d.joinZ, 0.1, d.deckThickness);
  const roundedCornerOpening = cylinder(d.rim + trayOpeningCornerRadius, trayOpeningY + trayOpeningCornerRadius, d.joinZ, 0.1, d.deckThickness);
  if (intersectionVolume(tray, trayOpening) >= 1e-5 ||
      intersectionVolume(tray, lowGuide) < 0.01 || intersectionVolume(tray, highGuide) < 0.01 ||
      intersectionVolume(tray, lowOuterFloor) < 0.01 || intersectionVolume(tray, highOuterFloor) < 0.01) {
    throw new Error("Tray floor must retain rounded opening corners, both slider guides, and solid outer panels");
  }
  if (d.trayStyle === "cutout") {
    if (intersectionVolume(tray, roundedCornerMaterial) < 0.001 || intersectionVolume(tray, roundedCornerOpening) >= 1e-5) throw new Error("Tray cutout must retain rounded corners");
    completed.push("Full base floor, square outlets, and rounded tray opening with slider guides and solid outer panels verified");
  } else {
    // The deck repeats at each pitch; inspect both ends in both directions.
    for (const x of new Set([d.screwXs[0], d.screwXs.at(-1)!])) for (const y of new Set([d.screwYs[0], d.screwYs.at(-1)!])) {
      const corner = cylinder(x + d.drop / 2 - 0.12, y + d.drop / 2 - 0.12, d.joinZ + 0.05, 0.04, 0.15);
      const wall = cylinder(x + d.drop / 2 + 0.15, y, d.joinZ + 0.05, 0.04, 0.15);
      const flare = cylinder(x + d.drop / 2 + 0.12, y, d.deckTop - 0.06, 0.03, 0.04);
      try {
        if (intersectionVolume(tray, corner) >= 1e-5 || intersectionVolume(tray, wall) < 0.0007 || intersectionVolume(tray, flare) >= 1e-5) throw new Error("Tray square holes must retain their walls and entry flare");
      } finally { corner.delete(); wall.delete(); flare.delete(); }
    }
    const bridge = cylinder(firstHoleX - d.drop / 2 - 0.7, firstHoleY, d.joinZ, 0.1, d.deckThickness);
    if (intersectionVolume(tray, bridge) < 0.02) throw new Error("Square-hole tray must retain its deck between openings");
    completed.push("Square tray holes, entry flares, solid deck, and unchanged square base outlets verified");
  }
  const fullReleaseTravel = settings.columns * d.pitch;
  // Exclude the click tip here so the opposite-side rigid rib must catch.
  const sliderWithoutClickTip = d.detent
    ? slider.cut(cylinder(d.detent.tipX, d.detent.tipY, d.sliderZ, d.detent.noseRadius, d.sliderThickness))
    : slider;
  const sliderAtFullRelease = sliderWithoutClickTip.clone().translate(fullReleaseTravel, 0, 0);
  const sliderPastPulloutStop = sliderWithoutClickTip.clone().translate(fullReleaseTravel + d.pitch / 4, 0, 0);
  if (intersectionVolume(base, sliderAtFullRelease) >= 1e-5 ||
      intersectionVolume(base, sliderPastPulloutStop) < 0.01) {
    throw new Error("Slider pullout stop must clear full release travel and catch beyond it");
  }
  if (sliderStop.ribEndX - sliderStop.ribStartX < 10) throw new Error("Slider pullout guide rib is too short");
  for (const x of [sliderStop.ribStartX + 0.5, (sliderStop.ribStartX + sliderStop.ribEndX) / 2, sliderStop.ribEndX - 0.5]) {
    const ribProbe = box(x, sliderStop.ribY + 0.2, d.sliderZ + 0.2, 0.2, 0.2, d.sliderThickness - 0.4);
    const openingProbe = box(x, sliderStop.ribY + 0.2, d.sliderZ + 0.2, 0.2, 0.2, d.joinZ - d.sliderZ);
    if (intersectionVolume(slider, ribProbe) < 0.005 || intersectionVolume(base, openingProbe) >= 1e-5) {
      throw new Error("Rigid slider guide rib must run near the nose inside an open-top groove");
    }
  }
  completed.push("Low-side pullout groove, rigid nose-length slider rib, and full release travel verified");
  if (settings.lidAlignment === "pegs") {
    for (const peg of lidMounts) {
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
    for (const magnet of lidMounts) {
      const fittedMagnet = cylinder(magnet.x, magnet.y, d.top - d.magnetPocketDepth, settings.magnetDiameter / 2, settings.magnetThickness);
      if (intersectionVolume(tray, fittedMagnet) >= 1e-5 || intersectionVolume(lid, fittedMagnet.clone().translate(0, 0, d.magnetPocketDepth)) >= 1e-5) throw new Error("Magnet pocket does not clear its nominal magnet");
    }
    completed.push("Magnet pockets clear their nominal magnets");
  }
  if (d.joints.some((joint, index) => joint.x !== d.magnets[index].x || joint.y !== d.magnets[index].y)) throw new Error("Corner fasteners are not aligned with the magnets");
  if (settings.joint === "screws") {
    const screwTip = d.baseScrewHeadSeat + 5;
    if (d.top - d.magnetPocketDepth - screwTip < 0.5) throw new Error("Corner screw reaches the magnet pocket");
    const p = d.joints[0];
    const pilotEnd = Math.min(d.joinZ + 4.4 + d.funnelBasePocketDepth, d.top - d.magnetPocketDepth - 0.5);
    if (intersectionVolume(tray, cylinder(p.x, p.y, d.joinZ + 1.5, 0.3, pilotEnd - d.joinZ - 1.6)) >= 1e-5 ||
        intersectionVolume(tray, cylinder(p.x, p.y, pilotEnd + 0.1, 0.3, 0.2)) < 0.05) {
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
  if (settings.lidStyle === "full" && (intersectionVolume(lid, cylinder(lidCenterX, lidCenterY, d.top + 0.2, 0.25, 0.8)) >= 1e-5 ||
      intersectionVolume(lid, cylinder(lidCenterX, lidCenterY, d.top + 2.25, 0.25, 0.7)) < 0.1)) {
    throw new Error("Lid center pocket or roof is missing");
  }
  if (settings.lidStyle === "cutout") {
    if (lidMounts.length !== 2 || lid.boundingBox.bounds[1][0] > lidStripWidth + 1e-5 ||
        intersectionVolume(lid, cylinder(lidCenterX, lidCenterY, d.top, 0.3, 3.5)) >= 1e-5) throw new Error("Cutout lid must leave the top open and use only two mounts");
  }
  completed.push("Thin frame, reinforced corners, and selected lid coverage verified");
  const printedLid = printOrientation(lid.clone().rotate(180, [0, 0, 0], [1, 0, 0]));
  const [printedLidMin] = printedLid.boundingBox.bounds;
  if (Math.abs(printedLidMin[2]) > 1e-5) throw new Error("Lid print orientation is not seated on the build plane");
  if (settings.lidAlignment === "pegs") {
    for (const peg of lidMounts) {
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
  if (intersectionVolume(tray, cylinder(rootCornerX, rootCornerY, d.joinZ + 0.5, 0.1, 0.1)) < 0.002 ||
      intersectionVolume(tray, cylinder(tipCornerX, rootCornerY, d.joinZ + 0.5, 0.1, 0.1)) >= 1e-5 ||
      intersectionVolume(slider, cylinder(rootCornerX, rootCornerY, d.sliderZ + 0.5, 0.1, 0.1)) >= 1e-5 ||
      intersectionVolume(slider, cylinder(storageHandleX + 2.5, rootCornerY, d.sliderZ + 0.5, 0.1, 0.1)) < 0.002 ||
      intersectionVolume(slider, cylinder(storageHandleX - 0.3, d.sliderInsetY + 0.3, d.sliderZ + 0.5, 0.1, 0.1)) < 0.002 ||
      intersectionVolume(slider, cylinder(tipCornerX, rootCornerY, d.sliderZ + 0.5, 0.1, 0.1)) >= 1e-5) {
    throw new Error("Tray handle root must be square; slider convex root rounded and concave body junction square");
  }
  completed.push("Tray handle root square; slider convex root rounded and concave body junction square");
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
    if (intersectionVolume(base, cylinder(p.x + 1.8, p.y, d.baseScrewHeadSeat + 0.15, 0.08, 0.15)) >= 1e-5 ||
        intersectionVolume(base, cylinder(p.x + 1.8, p.y, d.baseScrewHeadSeat + 0.85, 0.08, 0.15)) < 0.001) {
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
  })) as Record<"base" | "tray" | "slider" | "lid" | "funnel", PartDiagnostic>;
  const partMeshes = Object.fromEntries(Object.entries(parts).map(([name, part]) =>
    [name, prepareMesh(name as ModelPart, part)])) as Record<ModelPart, TriangleMesh>;
  for (const name of Object.keys(parts) as Array<keyof typeof parts>) {
    const prior = partCache[name];
    partCache[name] = { key: keys[name], shape: parts[name], mesh: partMeshes[name], meshTolerance, diagnostic: diagnostics[name], stl: prior?.key === keys[name] ? prior.stl : undefined };
  }
  const partStl = (name: keyof typeof parts, shape: Shape3D): Blob => {
    const cached = partCache[name]!;
    return cached.stl ??= printOrientation(shape.clone()).blobSTL({ binary: true, tolerance: 0.04, angularTolerance: 0.15 });
  };
  const files: Partial<Record<GeneratedFileName, Blob>> = configuration.includeExports === false ? {} : {
    "funnel.stl": partStl("funnel", funnel),
    "base.stl": partStl("base", base), "tray.stl": partStl("tray", tray),
    "slider.stl": partStl("slider", slider), "lid.stl": partCache.lid!.stl ??= printOrientation(lid.clone().rotate(180, [0, 0, 0], [1, 0, 0])).blobSTL({ binary: true, tolerance: 0.04, angularTolerance: 0.15 }),
    "assembly.step": exportSTEP([{ shape: base, name: "base" }, { shape: tray, name: "tray" }, { shape: slider, name: "slider" }, { shape: lid, name: "lid" }, { shape: funnel, name: "funnel" }]),
  };
  return { files, warnings: [], verification: { completed, pending: ["Full per-station release and retention checks", "Physical print fit and detent force of the browser revision", "Funnel screw flow, bridging, snap insertion force, and magnet retention"] }, diagnostics, partMeshes };
}
