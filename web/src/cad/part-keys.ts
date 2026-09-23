import type { DerivedDimensions, Settings } from "./types";

// Keep each key limited to the dimensions read while constructing that part.
// A new geometry dependency must be added here when a part is edited.
export function partKeys(settings: Settings, d: DerivedDimensions) {
  return {
    base: JSON.stringify([d.length, d.width, d.joinZ, d.wall, d.floor, d.pitch, settings.columns, d.screwXs, d.screwYs, d.drop, d.joints,
      d.detent ? [d.detent.tipY, d.detent.notchX, d.detent.notchRadius] : null, settings.joint, d.funnelMounts, d.funnelMountZ, d.funnelBasePocketDepth, d.baseScrewHeadSeat, d.magnetPocketDiameter, d.magnetPocketDepth, settings.funnelAlignment]),
    tray: JSON.stringify([d.trayStyle, d.screwXs, d.screwYs, d.drop, d.length, d.width, d.rim, d.joinZ, d.deckThickness, d.deckTop, d.top, d.baseScrewHeadSeat, d.funnelBasePocketDepth, d.sliderInsetY, d.joints, d.magnets, d.magnetPocketDiameter, d.magnetPocketDepth, settings.joint]),
    funnel: JSON.stringify([d.length, d.width, d.funnelOutletX, d.funnelDepth, d.funnelMountZ, d.funnelBasePocketDepth, d.funnelMounts, d.magnetPocketDiameter, d.magnetPocketDepth, settings.funnelAlignment, settings.funnelOutlet]),
    slider: JSON.stringify([d.width, d.sliderInsetY, d.sliderZ, d.length, d.sliderThickness, d.pitch, settings.columns, d.releaseX, d.window, d.slot, d.screwXs, d.screwYs, d.detent]),
    lid: JSON.stringify([d.top, d.length, d.width, d.rim, d.deckTop, d.magnets, d.magnetPocketDiameter, d.magnetPocketDepth, settings.lidAlignment, settings.lidStyle]),
  };
}
