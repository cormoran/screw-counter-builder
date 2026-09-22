import { deriveDimensions } from "./derive";
import { assertValidSettings } from "./settings";
import type { GenerateOptions, GeneratedFileName, GeneratedModel, SettingsInput } from "./types";

const EXPECTED_FILES: readonly GeneratedFileName[] = [
  "base.stl", "tray.stl", "slider.stl", "lid.stl", "assembly.step", "dimensions.json",
];

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("CAD generation was cancelled", "AbortError");
}

/**
 * Generate the four print parts and their assembled STEP representation.
 *
 * The CAD kernel is lazy loaded so that opening the configuration page does not
 * download OpenCascade. `buildWithReplicad` owns all kernel-specific code.
 */
export async function generateModel(input: SettingsInput = {}, options: GenerateOptions = {}): Promise<GeneratedModel> {
  const settings = assertValidSettings(input);
  const dimensions = deriveDimensions(settings);
  const report = options.onProgress;
  throwIfAborted(options.signal);
  report?.({ phase: "initializing", message: "Loading the CAD engine…" });
  const { buildWithReplicad } = await import("./replicad");
  throwIfAborted(options.signal);
  report?.({ phase: "building", completed: 0, total: 4, message: "Building parts…" });
  const result = await buildWithReplicad(settings, dimensions, options);
  throwIfAborted(options.signal);
  report?.({ phase: "validating", message: "Preparing export metadata…" });

  const metadata = {
    settings,
    derived: dimensions,
    diagnostics: result.diagnostics,
    checks: result.verification.completed,
    pending_checks: result.verification.pending,
    physical_print_test: false,
    print_orientation: "STLs lie flat; lid exterior face down; no slicer supports intended",
    assembly_screws: settings.joint === "screws"
      ? "4 x M2x8; flat-underhead diameter <=4.2, height <=2.2; pilot 1.7"
      : "adhesive on mating lands, keep out of slide path",
  };
  result.files["dimensions.json"] = new Blob([JSON.stringify(metadata, null, 2)], { type: "application/json" });
  for (const filename of EXPECTED_FILES) {
    if (!(filename in result.files)) throw new Error(`CAD export did not produce ${filename}`);
  }
  report?.({ phase: "exporting", completed: 5, total: 5, message: "Exports are ready." });
  return { ...result, files: result.files as Record<GeneratedFileName, Blob>, dimensions };
}
