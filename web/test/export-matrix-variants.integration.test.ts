import { describe, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { verifyExport } from "./helpers/verify-export";

// Vite turns ?url into a browser URL. Use the installed WASM path for this
// Node/Vitest integration probe; production code keeps the Vite asset URL.
vi.mock("replicad-opencascadejs/wasm?url", () => ({
  default: resolve(dirname(fileURLToPath(import.meta.url)), "../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
}));

// Each file owns a finite WASM heap, matching the disposable export worker.
describe("CAD export matrix", () => {
  it.each([
    { rows: 4, columns: 2, screw: "M2" as const, joint: "screws" as const, screwSpaceHeight: 10 },
    { rows: 1, columns: 1, screw: "M3" as const, joint: "glue" as const, lidAlignment: "pegs" as const, screwSpaceHeight: 3.5 },
    { rows: 1, columns: 1, screw: "M2" as const, joint: "glue" as const, detent: false, slideClearance: 0.6 },
    { rows: 1, columns: 1, screw: "M2" as const, joint: "screws" as const, detentDiameter: 3.2, detentSpringLength: 6 },
  ])("generates the $screw $rows x $columns $joint validation case", verifyExport, 120_000);
});
