import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, deriveDimensions, validateSettings } from "./index";

describe("browser CAD dimensions", () => {
  it("selects the tray by the inclusive 5 mm boundary and preserves explicit choices", () => {
    expect(deriveDimensions().trayStyle).toBe("holes");
    for (const screwLength of [1, 4.9, 5]) expect(deriveDimensions({ screwLength }).trayStyle).toBe("holes");
    for (const screwLength of [5.1, 10, 100]) expect(deriveDimensions({ screwLength }).trayStyle).toBe("cutout");
    expect(deriveDimensions({ screwLength: 3, trayStyle: "cutout" }).trayStyle).toBe("cutout");
    expect(deriveDimensions({ screwLength: 12, trayStyle: "holes" }).trayStyle).toBe("holes");
    for (const screwLength of [0, 101, NaN, Infinity, null]) expect(validateSettings({ screwLength: screwLength as number })).not.toEqual([]);
    expect(validateSettings({ trayStyle: "unknown" as "auto" })).not.toEqual([]);
  });

  it("defaults the outlet to 10 mm and accepts 5 mm while retaining head clearance", () => {
    expect(DEFAULT_SETTINGS.funnelOutlet).toBe(10);
    for (const funnelOutlet of [5, 10, 24]) expect(validateSettings({ funnelOutlet })).toEqual([]);
    for (const funnelOutlet of [4.9, 24.1, NaN]) expect(validateSettings({ funnelOutlet })).toContain("funnelOutlet must be 5..24 mm");
    expect(validateSettings({ screw: "M3", funnelOutlet: 5 })).toContain("Funnel outlet needs at least head + 1 mm");
  });

  it("moves coaxial corner mounts outward while retaining pocket walls", () => {
    expect(deriveDimensions().joints[0]).toEqual({ x: 4.5, y: 4.5 });
    for (const magnetDiameter of [3, 5, 6, 8]) for (const magnetDiameterClearance of [0, 0.6]) {
      const d = deriveDimensions({ magnetDiameter, magnetDiameterClearance, joint: "glue" });
      expect(d.joints).toEqual(d.magnets);
      expect(d.funnelMounts).toEqual(d.joints);
      expect(d.joints[0].x).toBeLessThan(d.rim / 2 + 0.5);
      expect(d.joints[0].x - d.magnetPocketDiameter / 2).toBeGreaterThanOrEqual(1.35 - 1e-8);
    }
  });

  it("keeps the funnel low, fixes it at screw corners, and offsets the outlet away from the tab", () => {
    for (const columns of [1, 10, 24]) {
      const d = deriveDimensions({ columns });
      expect(d.funnelDepth).toBe(14);
      expect(d.funnelMounts).toEqual(d.joints);
      expect(d.funnelMountZ).toBeCloseTo(-0.65);
      expect(d.baseScrewHeadSeat).toBeCloseTo(3.8);
      expect(d.funnelOutletX).toBeLessThan(d.length / 2);
      expect(d.funnelOutletX - DEFAULT_SETTINGS.funnelOutlet / 2).toBeGreaterThan(2.4);
    }
    expect(validateSettings({ magnetDiameter: 4.9 })).toContain("Screw joints need magnet or peg diameter at least 5 mm for screw access");
    expect(validateSettings({ magnetDiameter: 5 })).toEqual([]);
    expect(validateSettings({ magnetDiameter: 3, joint: "glue" })).toEqual([]);
  });

  it("derives the print-feedback M2 4x2 dimensions", () => {
    const d = deriveDimensions({ rows: 4, columns: 2, screw: "M2" });
    expect(d.length).toBeCloseTo(43.25);
    expect(d.width).toBeCloseTo(53);
    expect(d.top).toBeCloseTo(20.95);
    expect(d.pitch).toBe(8);
    expect(d.head).toBeCloseTo(3.2);
    expect(d.drop).toBeCloseTo(3.5);
    expect(d.deckThickness).toBeCloseTo(0.75);
    expect(d.screwXs).toEqual([22, 30]);
    expect(d.screwYs.map((y) => Number(y.toFixed(1)))).toEqual([14.5, 22.5, 30.5, 38.5]);
    expect(d.joints).toEqual(d.magnets);
  });

  it("derives the standard M2 4x10 positions", () => {
    const d = deriveDimensions({ rows: 4, columns: 10, screw: "M2" });
    expect(d.length).toBeCloseTo(107.25);
    expect(d.width).toBeCloseTo(53);
    expect(d.screwXs.at(-1)).toBe(94);
  });

  it("adjusts the base outlet without changing the measured screw head", () => {
    const d = deriveDimensions({ headDiameter: 4.5, trayHoleClearance: 0.4 });
    expect(d.head).toBe(4.5);
    expect(d.drop).toBeCloseTo(4.9);
    expect(d.window).toBeCloseTo(5.5);
    expect(validateSettings({ trayHoleClearance: 0.05 })).not.toEqual([]);
  });

  it("uses the adjustable spring length and bounds its range", () => {
    expect(deriveDimensions().detent?.springLength).toBe(9);
    expect(deriveDimensions({ detentSpringLength: 6 }).detent?.springLength).toBe(6);
    expect(deriveDimensions({ detentSpringLength: 18 }).detent?.springLength).toBe(18);
    expect(validateSettings({ detentSpringLength: 5.5 })).not.toEqual([]);
    expect(validateSettings({ detentSpringLength: 18.5 })).not.toEqual([]);
  });

  it("sizes both sides of the click detent from its diameter", () => {
    expect(deriveDimensions().detent?.noseRadius).toBeCloseTo(1.3);
    expect(deriveDimensions().detent?.notchRadius).toBeCloseTo(1.4);
    expect(deriveDimensions({ detentDiameter: 2 }).detent?.noseRadius).toBeCloseTo(1);
    expect(validateSettings({ detentDiameter: 1.9 })).not.toEqual([]);
    expect(validateSettings({ detentDiameter: 3.3 })).not.toEqual([]);
  });

  it("accepts both lid alignment methods", () => {
    expect(validateSettings({ lidAlignment: "magnets" })).toEqual([]);
    expect(validateSettings({ lidAlignment: "pegs" })).toEqual([]);
    expect(validateSettings({ lidAlignment: "invalid" as "pegs" })).not.toEqual([]);
  });

  it("rejects non-finite and oversized untrusted inputs", () => {
    expect(validateSettings({ magnetDiameter: Number.NaN })).not.toEqual([]);
    expect(validateSettings({ columns: 25 })).not.toEqual([]);
    expect(validateSettings({ screwSpaceHeight: 3 })).not.toEqual([]);
    expect(validateSettings({ screwSpaceHeight: 3.5, magnetThickness: 3, magnetDepthClearance: 0.3 })).not.toEqual([]);
    expect(validateSettings({ screwSpaceHeight: 3.5, magnetThickness: 3, magnetDepthClearance: 0.3, joint: "glue" })).toEqual([]);
  });

  it("changes the enclosure height while retaining the lid clearance", () => {
    const standard = deriveDimensions();
    const taller = deriveDimensions({ screwSpaceHeight: 20 });
    expect(standard.screwSpaceHeight).toBe(15);
    expect(taller.top - standard.top).toBeCloseTo(5);
    expect(taller.top - taller.deckTop - 1.2).toBeCloseTo(20);
  });
});
