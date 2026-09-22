import { describe, expect, it } from "vitest";
import { deriveDimensions, validateSettings } from "./index";

describe("browser CAD dimensions", () => {
  it("derives the print-feedback M2 4x2 dimensions", () => {
    const d = deriveDimensions({ rows: 4, columns: 2, screw: "M2" });
    expect(d.length).toBeCloseTo(44);
    expect(d.width).toBeCloseTo(54.2);
    expect(d.top).toBeCloseTo(21.8);
    expect(d.pitch).toBe(8);
    expect(d.drop).toBeCloseTo(d.head + 0.6);
    expect(d.deckThickness).toBeCloseTo(1.6);
    expect(d.screwXs).toEqual([22, 30]);
    expect(d.screwYs.map((y) => Number(y.toFixed(1)))).toEqual([15.1, 23.1, 31.1, 39.1]);
    expect(d.joints).toEqual(d.magnets);
  });

  it("derives the standard M2 4x10 positions", () => {
    const d = deriveDimensions({ rows: 4, columns: 10, screw: "M2" });
    expect(d.length).toBeCloseTo(108);
    expect(d.width).toBeCloseTo(54.2);
    expect(d.screwXs.at(-1)).toBe(94);
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
