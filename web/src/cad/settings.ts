import type { Settings, SettingsInput, ScrewPreset } from "./types";

export const SCREW_PRESETS: Readonly<Record<string, ScrewPreset>> = {
  "M1.5": { shaft: 1.5, head: 3, slot: 2.1, pitch: 8 },
  M2: { shaft: 2, head: 3.2, slot: 2.6, pitch: 8 },
  M3: { shaft: 3, head: 6, slot: 3.6, pitch: 10 },
};

/** Diametral clearance at the straight through-hole, tuned from print feedback. */
export const TRAY_HOLE_DIAMETER_CLEARANCE = 0.3;
/** A 45-degree, 0.3 mm chamfer around the top of each tray hole. */
export const TRAY_ENTRY_RADIAL_FLARE = 0.3;
export const RELEASE_WINDOW_DIAMETER_CLEARANCE = 1.0;

export function resolveScrewDimensions(settings: Settings): { headDiameter: number; shaftDiameter: number; slotWidth: number; pitch: number } | null {
  const preset = SCREW_PRESETS[settings.screw];
  if (!preset) return null;
  const headDiameter = settings.headDiameter ?? preset.head;
  return {
    headDiameter,
    shaftDiameter: settings.shaftDiameter ?? preset.shaft,
    slotWidth: settings.slotWidth ?? preset.slot,
    pitch: settings.pitch ?? Math.max(preset.pitch, Math.ceil(headDiameter + RELEASE_WINDOW_DIAMETER_CLEARANCE + 2)),
  };
}

/** Browser design defaults, tuned from physical print feedback. */
export const DEFAULT_SETTINGS: Readonly<Settings> = {
  detent: true,
  detentSpringWidth: 1.2,
  detentSpringLength: 9,
  detentDiameter: 2.6,
  rows: 4,
  columns: 10,
  screw: "M2",
  joint: "screws",
  lidAlignment: "magnets",
  magnetDiameter: 6,
  magnetThickness: 2,
  magnetDiameterClearance: 0.3,
  magnetDepthClearance: 0.15,
  slideClearance: 0.2,
  trayHoleClearance: TRAY_HOLE_DIAMETER_CLEARANCE,
  screwSpaceHeight: 15,
  headDiameter: null,
  shaftDiameter: null,
  slotWidth: null,
  pitch: null,
};

/** Conservative browser cap until benchmark data establishes a higher limit. */
export const MAX_ROWS = 12;
export const MAX_COLUMNS = 24;

export function normalizeSettings(input: SettingsInput = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...input };
}

export function validateSettings(input: SettingsInput = {}): string[] {
  const settings = normalizeSettings(input);
  const errors: string[] = [];
  const preset = SCREW_PRESETS[settings.screw];
  if (!preset) errors.push("screw must be M1.5, M2 or M3");
  if (!Number.isInteger(settings.rows) || settings.rows < 1 || settings.rows > MAX_ROWS || !Number.isInteger(settings.columns) || settings.columns < 1 || settings.columns > MAX_COLUMNS) {
    errors.push(`rows and columns must be positive integers within ${MAX_ROWS} × ${MAX_COLUMNS}`);
  }
  if (settings.joint !== "screws" && settings.joint !== "glue") errors.push("joint must be screws or glue");
  if (settings.lidAlignment !== "magnets" && settings.lidAlignment !== "pegs") errors.push("lidAlignment must be magnets or pegs");
  if (settings.magnetDiameter < 3 || settings.magnetDiameter > 8) errors.push("Supported magnet diameter is 3..8 mm");
  if (settings.magnetThickness < 1 || settings.magnetThickness > 3) errors.push("Supported magnet thickness is 1..3 mm");
  if (settings.slideClearance < 0.15 || settings.slideClearance > 0.6) errors.push("slideClearance must be 0.15..0.6 mm");
  if (settings.trayHoleClearance < 0.1 || settings.trayHoleClearance > 1.2) errors.push("trayHoleClearance must be 0.1..1.2 mm");
  if (settings.screwSpaceHeight < 3.5 || settings.screwSpaceHeight > 30) errors.push("screwSpaceHeight must be 3.5..30 mm");
  if (settings.magnetDiameterClearance < 0 || settings.magnetDiameterClearance > 0.6 || settings.magnetDepthClearance < 0 || settings.magnetDepthClearance > 0.3) {
    errors.push("Magnet clearance is outside the supported range");
  }
  if (settings.detentSpringWidth < 1 || settings.detentSpringWidth > 1.5) errors.push("detentSpringWidth must be 1.0..1.5 mm");
  if (settings.detentSpringLength < 6 || settings.detentSpringLength > 18) errors.push("detentSpringLength must be 6..18 mm");
  if (settings.detentDiameter < 2 || settings.detentDiameter > 3.2) errors.push("detentDiameter must be 2.0..3.2 mm");
  // The short corner screw stops below the magnet pocket, even at minimum height.
  const deckTop = 1.6 + 2 * settings.slideClearance + 2 + 0.75;
  const magnetPocketBottom = deckTop + settings.screwSpaceHeight + 1.2 - settings.magnetThickness - settings.magnetDepthClearance;
  if (settings.joint === "screws" && magnetPocketBottom < 7.8) errors.push("Need at least 0.5 mm between the corner screw and magnet pocket; increase screw space height or use a thinner magnet");
  if (!preset) return errors;
  const numericValues = [
    settings.screwSpaceHeight, settings.magnetDiameter, settings.magnetThickness, settings.magnetDiameterClearance,
    settings.magnetDepthClearance, settings.slideClearance, settings.trayHoleClearance, settings.detentSpringWidth, settings.detentSpringLength, settings.detentDiameter,
    settings.headDiameter, settings.shaftDiameter, settings.slotWidth, settings.pitch,
  ];
  if (numericValues.some((value) => value !== null && !Number.isFinite(value))) {
    errors.push("All numeric settings must be finite numbers");
    return errors;
  }
  const resolved = resolveScrewDimensions(settings)!;
  const shaft = resolved.shaftDiameter;
  const head = resolved.headDiameter;
  const slot = resolved.slotWidth;
  if (!(shaft > 0 && shaft + 0.3 <= slot && slot <= head - 0.6)) errors.push("Need shaft + 0.3 <= slot <= head - 0.6; measure the actual screw");
  const window = head + RELEASE_WINDOW_DIAMETER_CLEARANCE;
  const pitch = resolved.pitch;
  if (pitch < window + 1.8) errors.push("Pitch needs >= window + 1.8 mm for separated batches");
  return errors;
}

export function assertValidSettings(input: SettingsInput = {}): Settings {
  const errors = validateSettings(input);
  if (errors.length) throw new Error(errors.join(". "));
  return normalizeSettings(input);
}
