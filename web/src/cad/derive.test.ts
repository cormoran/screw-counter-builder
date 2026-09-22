import { describe, expect, it } from "vitest";
import { deriveDimensions, validateSettings } from "./index";

describe("browser CAD dimensions", () => {
  it("derives the print-feedback M2 4x2 dimensions", () => {
    const d = deriveDimensions({ rows: 4, columns: 2, screw: "M2" });
    expect(d.length).toBeCloseTo(43.85);
    expect(d.width).toBeCloseTo(54.2);
    expect(d.top).toBeCloseTo(21.8);
    expect(d.pitch).toBe(8);
    expect(d.drop).toBeCloseTo(d.head + 0.3);
    expect(d.deckThickness).toBeCloseTo(1.6);
    expect(d.screwXs).toEqual([22, 30]);
    expect(d.screwYs.map((y) => Number(y.toFixed(1)))).toEqual([15.1, 23.1, 31.1, 39.1]);
    expect(d.joints).toEqual(d.magnets);
  });

  it("derives the standard M2 4x10 positions", () => {
    const d = deriveDimensions({ rows: 4, columns: 10, screw: "M2" });
    expect(d.length).toBeCloseTo(107.85);
    expect(d.width).toBeCloseTo(54.2);
    expect(d.screwXs.at(-1)).toBe(94);
  });

  it("adjusts the tray hole without changing the measured screw head", () => {
    const d = deriveDimensions({ headDiameter: 4.5, trayHoleClearance: 0.4 });
    expect(d.head).toBe(4.5);
    expect(d.drop).toBeCloseTo(4.9);
    expect(d.window).toBeCloseTo(5.5);
    expect(validateSettings({ trayHoleClearance: 0.05 })).not.toEqual([]);
  });

  it("uses the adjustable spring length and bounds its range", () => {
    expect(deriveDimensions().detent?.springLength).toBe(13);
    expect(deriveDimensions({ detentSpringLength: 18 }).detent?.springLength).toBe(18);
    expect(validateSettings({ detentSpringLength: 11.5 })).not.toEqual([]);
    expect(validateSettings({ detentSpringLength: 18.5 })).not.toEqual([]);
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
