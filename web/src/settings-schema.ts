import { MAX_COLUMNS, MAX_ROWS, SCREW_PRESETS, type Settings } from './cad'

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

export const SETTINGS_CATEGORIES: readonly { id: SettingsCategory; label: string; description: string }[] = [
  { id: 'basic', label: '基本', description: 'ねじの種類と一度に出す量' },
  { id: 'operation', label: '収納・操作', description: '容量と操作感' },
  { id: 'screw-dimensions', label: 'ねじの実測値', description: '実物に合わせる寸法' },
  { id: 'magnet', label: '磁石', description: 'ふた用磁石の寸法' },
  { id: 'clearance', label: 'クリアランス', description: 'プリンターに合わせる余裕' },
]

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
export const SETTINGS_FIELDS: readonly Field[] = [
  { key: 'screw', category: 'basic', label: '対象のねじ', description: '選択すると頭径などをそのねじの初期値に戻します。実測値は下で上書きできます。', kind: 'select', options: screwOptions },
  { key: 'rows', category: 'basic', label: '1回に出す本数', description: '引く方向と直交する穴の数です。', kind: 'number', unit: '本', min: 1, max: MAX_ROWS, step: 1 },
  { key: 'columns', category: 'basic', label: '取り出し回数', description: '引き出して取り出せる回数です。', kind: 'number', unit: '回', min: 1, max: MAX_COLUMNS, step: 1 },
  { key: 'screwSpaceHeight', category: 'operation', label: 'ねじ収納スペースの高さ', description: 'トレー上面から閉じたふたの内側までの高さです。', kind: 'number', unit: 'mm', min: 3.5, max: 30, step: 0.1 },
  { key: 'joint', category: 'operation', label: '本体の接合方法', description: 'ねじ留めは四隅に M2×5 を4本使います。', kind: 'select', options: [{ value: 'screws', label: 'ねじ留め' }, { value: 'glue', label: '接着' }] },
  { key: 'detent', category: 'operation', label: 'クリック感を付ける', description: '各停止位置でスライダーを保持します。', kind: 'boolean' },
  { key: 'detentSpringWidth', category: 'operation', label: 'ばね幅', description: 'クリック用の板ばねの幅です。', kind: 'number', unit: 'mm', min: 1, max: 1.5, step: 0.05 },
  { key: 'detentSpringLength', category: 'operation', label: 'ばね長さ', description: '短くするとクリック用の板ばねが硬くなります。', kind: 'number', unit: 'mm', min: 12, max: 18, step: 0.5 },
  { key: 'headDiameter', category: 'screw-dimensions', label: 'ねじ頭径', description: '選んだねじの初期値です。実測値で上書きできます。', kind: 'number', unit: 'mm', min: 0.1, max: 20, step: 0.05, optional: true },
  { key: 'shaftDiameter', category: 'screw-dimensions', label: 'ねじ軸径', description: '選んだねじの初期値です。実測値で上書きできます。', kind: 'number', unit: 'mm', min: 0.1, max: 20, step: 0.05, optional: true },
  { key: 'slotWidth', category: 'screw-dimensions', label: 'スロット幅', description: '選んだねじの初期値です。実測値で上書きできます。', kind: 'number', unit: 'mm', min: 0.1, max: 20, step: 0.05, optional: true },
  { key: 'pitch', category: 'screw-dimensions', label: 'ピッチ', description: '自動計算値です。変更すると上書きできます。', kind: 'number', unit: 'mm', min: 0.1, max: 50, step: 0.1, optional: true },
  { key: 'magnetDiameter', category: 'magnet', label: '磁石の直径', description: 'ふた用の円形磁石の実測直径です。', kind: 'number', unit: 'mm', min: 3, max: 8, step: 0.1 },
  { key: 'magnetThickness', category: 'magnet', label: '磁石の厚み', description: 'ふた用の円形磁石の実測厚みです。', kind: 'number', unit: 'mm', min: 1, max: 3, step: 0.1 },
  { key: 'slideClearance', category: 'clearance', label: 'スライドのクリアランス', description: 'スライダーの片側と上下に確保する余裕です。', kind: 'number', unit: 'mm', min: 0.15, max: 0.6, step: 0.05 },
  { key: 'trayHoleClearance', category: 'clearance', label: 'トレー穴の径クリアランス', description: 'ねじ頭径に加える余裕です。小さくすると穴が狭くなります。', kind: 'number', unit: 'mm', min: 0.1, max: 1.2, step: 0.05 },
  { key: 'magnetDiameterClearance', category: 'clearance', label: '磁石穴の径クリアランス', description: '磁石直径に加える余裕です。', kind: 'number', unit: 'mm', min: 0, max: 0.6, step: 0.05 },
  { key: 'magnetDepthClearance', category: 'clearance', label: '磁石穴の深さクリアランス', description: '磁石の厚みに加える余裕です。', kind: 'number', unit: 'mm', min: 0, max: 0.3, step: 0.05 },
]
