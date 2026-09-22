/** Public, UI-independent contract for the browser CAD generator. Dimensions are mm. */
export type ScrewSize = "M1.5" | "M2" | "M3";
export type JointType = "screws" | "glue";

export interface Settings {
  detent: boolean;
  detentSpringWidth: number;
  detentSpringLength: number;
  rows: number;
  columns: number;
  screw: ScrewSize;
  joint: JointType;
  magnetDiameter: number;
  magnetThickness: number;
  magnetDiameterClearance: number;
  magnetDepthClearance: number;
  slideClearance: number;
  /** Extra diameter around a measured screw head in each tray through-hole. */
  trayHoleClearance: number;
  /** Free vertical space above the tray deck, below the lid lip, in mm. */
  screwSpaceHeight: number;
  /** Measured maximum head diameter. `null` uses the screw preset. */
  headDiameter: number | null;
  shaftDiameter: number | null;
  slotWidth: number | null;
  pitch: number | null;
}

export type SettingsInput = Partial<Settings>;

export interface ScrewPreset {
  shaft: number;
  head: number;
  slot: number;
  pitch: number;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface DetentDimensions {
  tipX: number;
  tipY: number;
  noseRadius: number;
  notchRadius: number;
  notchX: number[];
  springLength: number;
  springWidth: number;
  springHeight: number;
  reliefGap: number;
  nominalDeflection: number;
  maxLateralDeflection: number;
  note: string;
}

/** Calculated dimensions shared by preview, CAD construction, and export metadata. */
export interface DerivedDimensions {
  shaft: number;
  head: number;
  slot: number;
  drop: number;
  window: number;
  pitch: number;
  rim: number;
  wall: number;
  sliderInsetY: number;
  releaseX: number;
  screwXs: number[];
  screwYs: number[];
  length: number;
  width: number;
  floor: number;
  sliderZ: number;
  sliderThickness: number;
  joinZ: number;
  deckThickness: number;
  deckTop: number;
  screwSpaceHeight: number;
  top: number;
  detent?: DetentDimensions;
  joints: Point2D[];
  magnets: Point2D[];
  magnetPocketDiameter: number;
  magnetPocketDepth: number;
}

export type ModelPart = "base" | "tray" | "slider" | "lid";
export type GeneratedFileName =
  | "base.stl"
  | "tray.stl"
  | "slider.stl"
  | "lid.stl"
  | "assembly.step"
  | "dimensions.json";

export type GenerationProgress = {
  phase: "initializing" | "building" | "validating" | "exporting";
  completed?: number;
  total?: number;
  message?: string;
};

export type VerificationResult = {
  /** Checks that were actually evaluated by the selected CAD engine. */
  completed: string[];
  /** Checks intentionally not claimed by the browser implementation. */
  pending: string[];
};

export type PartDiagnostic = {
  volume: number;
  bounds: { min: [number, number, number]; max: [number, number, number] };
};

/** Triangle buffers in millimetres and assembled CAD coordinates. */
export type TriangleMesh = {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
};

export interface GeneratedModel {
  files: Record<GeneratedFileName, Blob>;
  dimensions: DerivedDimensions;
  warnings: string[];
  verification: VerificationResult;
  diagnostics: Record<ModelPart, PartDiagnostic>;
  /** Display mesh per part. UI transforms these for assembled/exploded views. */
  partMeshes: Record<ModelPart, TriangleMesh>;
}

/** Geometry returned while editing settings. It deliberately has no export files. */
export interface PreviewModel {
  dimensions: DerivedDimensions;
  partMeshes: Record<ModelPart, TriangleMesh>;
}

export interface GenerateOptions {
  onProgress?: (progress: GenerationProgress) => void;
  signal?: AbortSignal;
}
