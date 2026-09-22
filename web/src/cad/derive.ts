import { assertValidSettings, RELEASE_WINDOW_DIAMETER_CLEARANCE, resolveScrewDimensions } from "./settings";
import type { DerivedDimensions, Settings, SettingsInput } from "./types";

/** Browser CAD dimensions. Keep shape decisions here for future UI controls. */
export function deriveDimensions(input: SettingsInput | Settings = {}): DerivedDimensions {
  const c = assertValidSettings(input);
  const resolved = resolveScrewDimensions(c)!;
  const shaft = resolved.shaftDiameter;
  const head = resolved.headDiameter;
  const slot = resolved.slotWidth;
  const drop = head + c.trayHoleClearance;
  const window = head + RELEASE_WINDOW_DIAMETER_CLEARANCE;
  const pitch = resolved.pitch;
  const rim = Math.max(10, c.magnetDiameter + 4);
  const wall = rim - 1.3;
  const sliderInsetY = wall + c.slideClearance;
  let margin = Math.max(rim + drop / 2 + 1.5, sliderInsetY + window / 2 + 2.5);
  if (c.detent) margin = Math.max(margin, sliderInsetY + window / 2 + c.detentSpringWidth + 2.3);
  const releaseX = Math.max(14, 8 + window / 2 + 2);
  const screwXs = Array.from({ length: c.columns }, (_, index) => releaseX + pitch * (index + 1));
  const length = screwXs.at(-1)! + rim + drop / 2 + 1.5;
  const width = Math.max(2 * margin + (c.rows - 1) * pitch, 2 * rim + 12);
  const screwYs = Array.from({ length: c.rows }, (_, index) => width / 2 + pitch * (index - (c.rows - 1) / 2));
  const floor = 1.6;
  const sliderZ = floor + c.slideClearance;
  const sliderThickness = 2;
  const joinZ = sliderZ + sliderThickness + c.slideClearance;
  const deckThickness = 1.6;
  const deckTop = joinZ + deckThickness;
  // The lid lip projects 1.2 mm below the mating plane.
  const top = deckTop + c.screwSpaceHeight + 1.2;
  const magnetCenter = rim / 2 + 0.5;
  const magnets = [magnetCenter, length - magnetCenter].flatMap((x) => [magnetCenter, width - magnetCenter].map((y) => ({ x, y })));
  const joints = magnets.map(({ x, y }) => ({ x, y }));
  const result: DerivedDimensions = {
    shaft, head, slot, drop, window, pitch, rim, wall, sliderInsetY, releaseX,
    screwXs, screwYs, length, width, floor, sliderZ, sliderThickness, joinZ, deckThickness, deckTop, screwSpaceHeight: c.screwSpaceHeight, top,
    joints, magnets,
    magnetPocketDiameter: c.magnetDiameter + c.magnetDiameterClearance,
    magnetPocketDepth: c.magnetThickness + c.magnetDepthClearance,
  };
  if (c.detent) {
    // 0.7 mm nominal engagement at the rail, independent of slide clearance.
    const tipY = width - wall - 0.4;
    result.detent = {
      tipX: 12, tipY, noseRadius: 1.1, notchRadius: 1.2,
      notchX: Array.from({ length: c.columns + 1 }, (_, index) => 12 + index * pitch),
      springLength: 15, springWidth: c.detentSpringWidth, springHeight: sliderThickness,
      reliefGap: 1.2, nominalDeflection: 0.7, maxLateralDeflection: 0.8,
      note: "Elastic interference between stops is intentional; forces not calibrated.",
    };
  }
  return result;
}
