import { describe, expect, it } from "vitest";
import { deriveDimensions, validateSettings } from "./index";

describe("Python dimension parity", () => {
  it("matches the checked-in M2 4x2 dimensions", () => {
    const d = deriveDimensions({ rows: 4, columns: 2, screw: "M2" });
    expect(d.length).toBeCloseTo(44.3);
    expect(d.width).toBe(55);
    expect(d.top).toBe(14);
    expect(d.pitch).toBe(8);
    expect(d.screwXs).toEqual([22, 30]);
    expect(d.screwYs).toEqual([15.5, 23.5, 31.5, 39.5]);
  });

  it("matches the checked-in M2 4x10 dimensions", () => {
    const d = deriveDimensions({ rows: 4, columns: 10, screw: "M2" });
    expect(d.length).toBeCloseTo(108.3);
    expect(d.width).toBe(55);
    expect(d.screwXs.at(-1)).toBe(94);
  });

  it("rejects non-finite and oversized untrusted inputs", () => {
    expect(validateSettings({ magnetDiameter: Number.NaN })).not.toEqual([]);
    expect(validateSettings({ columns: 25 })).not.toEqual([]);
  });
});
