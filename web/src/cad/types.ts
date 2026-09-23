/** Public, UI-independent contract for the browser CAD generator. Dimensions are mm. */
export type ScrewSize = "M1.5" | "M2" | "M3";
export type JointType = "screws" | "glue";
export type LidAlignment = "magnets" | "pegs";

export interface Settings {
  detent: boolean;
  detentSpringWidth: number;
  detentSpringLength: number;
  /** Diameter of the slider click nub; the matching base recess adds 0.2 mm. */
  detentDiameter: number;
  rows: number;
  columns: number;
  screw: ScrewSize;
  /** Target screw length; selects the tray style in auto mode. */
  screwLength: number;
  trayStyle: "auto" | "holes" | "cutout";
  joint: JointType;
  lidAlignment: LidAlignment;
  lidStyle: "full" | "cutout";
  funnelAlignment: LidAlignment | "screws";
  /** Total funnel height; null preserves 11 mm of slope below the free-fall space. */
  funnelHeight: number | null;
  funnelOutlet: number;
  magnetDiameter: number;
  magnetThickness: number;
  magnetDiameterClearance: number;
  magnetDepthClearance: number;
  slideClearance: number;
  /** Extra side length beyond a measured screw head in each square base or tray opening. */
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
  trayStyle: "holes" | "cutout";
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
  funnelDepth: number;
  funnelSlopeZ: number;
  registration: Point2D[];
  funnelOutletX: number;
  funnelMountZ: number;
  funnelBasePocketDepth: number;
  baseScrewHeadSeat: number;
  funnelMounts: Point2D[];
  detent?: DetentDimensions;
  joints: Point2D[];
  magnets: Point2D[];
  magnetPocketDiameter: number;
  magnetPocketDepth: number;
}

export type ModelPart = "base" | "tray" | "slider" | "lid" | "funnel";
export type GeneratedFileName =
  | "base.stl"
  | "tray.stl"
  | "slider.stl"
  | "lid.stl"
  | "funnel.stl"
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

export type PartPreview = { part: ModelPart; mesh: TriangleMesh; dimensions: DerivedDimensions };
export type ProgressivePreview = { dimensions: DerivedDimensions; partMeshes: Partial<Record<ModelPart, TriangleMesh>> };

export interface GenerateOptions {
  /** Emitted as each part is meshed, before the whole model is ready. */
  onPart?: (preview: PartPreview) => void;
  onProgress?: (progress: GenerationProgress) => void;
  signal?: AbortSignal;
}
