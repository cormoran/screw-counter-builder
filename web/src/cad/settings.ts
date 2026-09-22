import type { Settings, SettingsInput, ScrewPreset } from "./types";

export const SCREW_PRESETS: Readonly<Record<string, ScrewPreset>> = {
  "M1.5": { shaft: 1.5, head: 3, slot: 2.1, pitch: 8 },
  M2: { shaft: 2, head: 4.4, slot: 2.6, pitch: 8 },
  M3: { shaft: 3, head: 6, slot: 3.6, pitch: 10 },
};

/** Matches the maintained Python builder defaults. */
export const DEFAULT_SETTINGS: Readonly<Settings> = {
  detent: true,
  detentSpringWidth: 1.2,
  rows: 4,
  columns: 10,
  screw: "M2",
  joint: "screws",
  magnetDiameter: 6,
  magnetThickness: 2,
  magnetDiameterClearance: 0.3,
  magnetDepthClearance: 0.15,
  slideClearance: 0.3,
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
  if (settings.magnetDiameter < 3 || settings.magnetDiameter > 8) errors.push("Supported magnet diameter is 3..8 mm");
  if (settings.magnetThickness < 1 || settings.magnetThickness > 3) errors.push("Supported magnet thickness is 1..3 mm");
  if (settings.slideClearance < 0.15 || settings.slideClearance > 0.6) errors.push("slideClearance must be 0.15..0.6 mm");
  if (settings.magnetDiameterClearance < 0 || settings.magnetDiameterClearance > 0.6 || settings.magnetDepthClearance < 0 || settings.magnetDepthClearance > 0.3) {
    errors.push("Magnet clearance is outside the supported range");
  }
  if (settings.detentSpringWidth < 1 || settings.detentSpringWidth > 1.5) errors.push("detentSpringWidth must be 1.0..1.5 mm");
  if (!preset) return errors;
  const numericValues = [
    settings.magnetDiameter, settings.magnetThickness, settings.magnetDiameterClearance,
    settings.magnetDepthClearance, settings.slideClearance, settings.detentSpringWidth,
    settings.headDiameter, settings.shaftDiameter, settings.slotWidth, settings.pitch,
  ];
  if (numericValues.some((value) => value !== null && !Number.isFinite(value))) {
    errors.push("All numeric settings must be finite numbers");
    return errors;
  }
  const shaft = settings.shaftDiameter ?? preset.shaft;
  const head = settings.headDiameter ?? preset.head;
  const slot = settings.slotWidth ?? preset.slot;
  if (!(shaft > 0 && shaft + 0.3 <= slot && slot <= head - 0.6)) errors.push("Need shaft + 0.3 <= slot <= head - 0.6; measure the actual screw");
  const window = head + 1.6;
  const pitch = settings.pitch ?? Math.max(preset.pitch, Math.ceil(window + 2));
  if (pitch < window + 1.8) errors.push("Pitch needs >= window + 1.8 mm for separated batches");
  return errors;
}

export function assertValidSettings(input: SettingsInput = {}): Settings {
  const errors = validateSettings(input);
  if (errors.length) throw new Error(errors.join(". "));
  return normalizeSettings(input);
}
