import { MAX_COLUMNS, MAX_ROWS, SCREW_PRESETS, type Settings } from './cad'
import { text, type Language } from './i18n'

export type Field = {
  key: keyof Settings
  category: SettingsCategory
  label: string
  description: string
  kind: 'number' | 'select' | 'boolean'
  unit?: string
  min?: number
  max?: number
  step?: number
  optional?: boolean
  options?: readonly { value: string; label: string }[]
}

export type SettingsCategory = 'basic' | 'operation' | 'screw-dimensions' | 'magnet' | 'clearance'

export function getSettingsCategories(language: Language): readonly { id: SettingsCategory; label: string; description: string }[] {
  return [
    { id: 'basic', label: text(language, 'categoryBasic'), description: text(language, 'categoryBasicDescription') },
    { id: 'operation', label: text(language, 'categoryOperation'), description: text(language, 'categoryOperationDescription') },
    { id: 'screw-dimensions', label: text(language, 'categoryScrewDimensions'), description: text(language, 'categoryScrewDimensionsDescription') },
    { id: 'magnet', label: text(language, 'categoryMagnet'), description: text(language, 'categoryMagnetDescription') },
    { id: 'clearance', label: text(language, 'categoryClearance'), description: text(language, 'categoryClearanceDescription') },
  ]
}

export type PrintPlateOption = {
  id: 'h2d-h2s' | 'h2c-a2l' | 'standard' | 'a1-mini'
  width: number
  depth: number
  label: string
  printers: string
}

export const PRINT_PLATE_OPTIONS: readonly PrintPlateOption[] = [
  { id: 'h2d-h2s', width: 350, depth: 320, label: '350 × 320 mm', printers: 'H2D / H2S' },
  { id: 'h2c-a2l', width: 330, depth: 320, label: '330 × 320 mm', printers: 'H2C / A2L' },
  { id: 'standard', width: 256, depth: 256, label: '256 × 256 mm', printers: 'X2D / P2S / P1 Series / X1 Series / A1' },
  { id: 'a1-mini', width: 180, depth: 180, label: '180 × 180 mm', printers: 'A1 mini' },
]

const screwOptions = Object.keys(SCREW_PRESETS).map((value) => ({ value, label: value }))

/** Form metadata. Add a Settings property here to expose it in the UI. */
export function getSettingsFields(language: Language): readonly Field[] {
  const t = (key: Parameters<typeof text>[1]) => text(language, key)
  return [
    { key: 'screw', category: 'basic', label: t('fieldScrew'), description: t('fieldScrewDescription'), kind: 'select', options: screwOptions },
    { key: 'rows', category: 'basic', label: t('fieldRows'), description: t('fieldRowsDescription'), kind: 'number', unit: t('pieces'), min: 1, max: MAX_ROWS, step: 1 },
    { key: 'columns', category: 'basic', label: t('fieldColumns'), description: t('fieldColumnsDescription'), kind: 'number', unit: t('times'), min: 1, max: MAX_COLUMNS, step: 1 },
    { key: 'screwSpaceHeight', category: 'operation', label: t('fieldScrewSpaceHeight'), description: t('fieldScrewSpaceHeightDescription'), kind: 'number', unit: 'mm', min: 3.5, max: 30, step: 0.1 },
    { key: 'joint', category: 'operation', label: t('fieldJoint'), description: t('fieldJointDescription'), kind: 'select', options: [{ value: 'screws', label: t('screws') }, { value: 'glue', label: t('glue') }] },
    { key: 'funnelAlignment', category: 'operation', label: t('fieldFunnelAlignment'), description: t('fieldFunnelAlignmentDescription'), kind: 'select', options: [{ value: 'magnets', label: t('magnets') }, { value: 'pegs', label: t('pegs') }] },
    { key: 'funnelOutlet', category: 'operation', label: t('fieldFunnelOutlet'), description: t('fieldFunnelOutletDescription'), kind: 'number', unit: 'mm', min: 10, max: 24, step: 1 },
    { key: 'lidStyle', category: 'operation', label: t('fieldLidStyle'), description: t('fieldLidStyleDescription'), kind: 'select', options: [{ value: 'full', label: t('lidFull') }, { value: 'cutout', label: t('lidCutout') }] },
    { key: 'lidAlignment', category: 'operation', label: t('fieldLidAlignment'), description: t('fieldLidAlignmentDescription'), kind: 'select', options: [{ value: 'magnets', label: t('magnets') }, { value: 'pegs', label: t('pegs') }] },
    { key: 'detent', category: 'operation', label: t('fieldDetent'), description: t('fieldDetentDescription'), kind: 'boolean' },
    { key: 'detentSpringWidth', category: 'operation', label: t('fieldDetentSpringWidth'), description: t('fieldDetentSpringWidthDescription'), kind: 'number', unit: 'mm', min: 1, max: 1.5, step: 0.05 },
    { key: 'detentSpringLength', category: 'operation', label: t('fieldDetentSpringLength'), description: t('fieldDetentSpringLengthDescription'), kind: 'number', unit: 'mm', min: 6, max: 18, step: 0.5 },
    { key: 'detentDiameter', category: 'operation', label: t('fieldDetentDiameter'), description: t('fieldDetentDiameterDescription'), kind: 'number', unit: 'mm', min: 2, max: 3.2, step: 0.1 },
    { key: 'headDiameter', category: 'screw-dimensions', label: t('fieldHeadDiameter'), description: t('fieldHeadDiameterDescription'), kind: 'number', unit: 'mm', min: 0.1, max: 20, step: 0.05, optional: true },
    { key: 'shaftDiameter', category: 'screw-dimensions', label: t('fieldShaftDiameter'), description: t('fieldShaftDiameterDescription'), kind: 'number', unit: 'mm', min: 0.1, max: 20, step: 0.05, optional: true },
    { key: 'slotWidth', category: 'screw-dimensions', label: t('fieldSlotWidth'), description: t('fieldSlotWidthDescription'), kind: 'number', unit: 'mm', min: 0.1, max: 20, step: 0.05, optional: true },
    { key: 'pitch', category: 'screw-dimensions', label: t('fieldPitch'), description: t('fieldPitchDescription'), kind: 'number', unit: 'mm', min: 0.1, max: 50, step: 0.1, optional: true },
    { key: 'magnetDiameter', category: 'magnet', label: t('fieldMagnetDiameter'), description: t('fieldMagnetDiameterDescription'), kind: 'number', unit: 'mm', min: 3, max: 8, step: 0.1 },
    { key: 'magnetThickness', category: 'magnet', label: t('fieldMagnetThickness'), description: t('fieldMagnetThicknessDescription'), kind: 'number', unit: 'mm', min: 1, max: 3, step: 0.1 },
    { key: 'slideClearance', category: 'clearance', label: t('fieldSlideClearance'), description: t('fieldSlideClearanceDescription'), kind: 'number', unit: 'mm', min: 0.15, max: 0.6, step: 0.05 },
    { key: 'trayHoleClearance', category: 'clearance', label: t('fieldTrayHoleClearance'), description: t('fieldTrayHoleClearanceDescription'), kind: 'number', unit: 'mm', min: 0.1, max: 1.2, step: 0.05 },
    { key: 'magnetDiameterClearance', category: 'clearance', label: t('fieldMagnetDiameterClearance'), description: t('fieldMagnetDiameterClearanceDescription'), kind: 'number', unit: 'mm', min: 0, max: 0.6, step: 0.05 },
    { key: 'magnetDepthClearance', category: 'clearance', label: t('fieldMagnetDepthClearance'), description: t('fieldMagnetDepthClearanceDescription'), kind: 'number', unit: 'mm', min: 0, max: 0.3, step: 0.05 },
  ]
}
