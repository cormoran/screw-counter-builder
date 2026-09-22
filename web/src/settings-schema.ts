import { MAX_COLUMNS, MAX_ROWS, SCREW_PRESETS, type Settings } from './cad'

export type Field = {
  key: keyof Settings
  group: 'basic' | 'detail'
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

const screwOptions = Object.keys(SCREW_PRESETS).map((value) => ({ value, label: value }))

/** Form metadata. Add a Settings property here to expose it in the UI. */
export const SETTINGS_FIELDS: readonly Field[] = [
  { key: 'rows', group: 'basic', label: '1回に出す本数', description: '引く方向と直交する穴の数です。', kind: 'number', unit: '本', min: 1, max: MAX_ROWS, step: 1 },
  { key: 'columns', group: 'basic', label: '取り出し回数', description: '引き出して取り出せる回数です。', kind: 'number', unit: '回', min: 1, max: MAX_COLUMNS, step: 1 },
  { key: 'screw', group: 'basic', label: '対象のねじ', description: '頭径などの初期値を選びます。実物を測った場合は詳細設定で上書きできます。', kind: 'select', options: screwOptions },
  { key: 'joint', group: 'basic', label: '本体の接合方法', description: 'ねじ留めは M2×8 を4本使います。', kind: 'select', options: [{ value: 'screws', label: 'ねじ留め' }, { value: 'glue', label: '接着' }] },
  { key: 'detent', group: 'detail', label: 'クリック感を付ける', description: '各停止位置に軽いクリック感を付けます。', kind: 'boolean' },
  { key: 'detentSpringWidth', group: 'detail', label: 'ばね幅', description: 'クリック用の板ばねの幅です。', kind: 'number', unit: 'mm', min: 1, max: 1.5, step: 0.05 },
  { key: 'magnetDiameter', group: 'detail', label: '磁石の直径', description: 'ふた用の円形磁石の実測直径です。', kind: 'number', unit: 'mm', min: 3, max: 8, step: 0.1 },
  { key: 'magnetThickness', group: 'detail', label: '磁石の厚み', description: 'ふた用の円形磁石の実測厚みです。', kind: 'number', unit: 'mm', min: 1, max: 3, step: 0.1 },
  { key: 'magnetDiameterClearance', group: 'detail', label: '磁石穴の径クリアランス', description: '磁石直径に加える余裕です。', kind: 'number', unit: 'mm', min: 0, max: 0.6, step: 0.05 },
  { key: 'magnetDepthClearance', group: 'detail', label: '磁石穴の深さクリアランス', description: '磁石の厚みに加える余裕です。', kind: 'number', unit: 'mm', min: 0, max: 0.3, step: 0.05 },
  { key: 'slideClearance', group: 'detail', label: 'スライドのクリアランス', description: 'スライダーの片側と上下に確保する余裕です。', kind: 'number', unit: 'mm', min: 0.15, max: 0.6, step: 0.05 },
  { key: 'screwSpaceHeight', group: 'detail', label: 'ねじ収納スペースの高さ', description: 'トレー上面から閉じたふたの内側までの高さです。', kind: 'number', unit: 'mm', min: 3.5, max: 30, step: 0.1 },
  { key: 'headDiameter', group: 'detail', label: 'ねじ頭径', description: '空欄なら選択したねじの初期値を使います。', kind: 'number', unit: 'mm', min: 0.1, max: 20, step: 0.1, optional: true },
  { key: 'shaftDiameter', group: 'detail', label: 'ねじ軸径', description: '空欄なら選択したねじの初期値を使います。', kind: 'number', unit: 'mm', min: 0.1, max: 20, step: 0.1, optional: true },
  { key: 'slotWidth', group: 'detail', label: 'スロット幅', description: '空欄なら選択したねじの初期値を使います。', kind: 'number', unit: 'mm', min: 0.1, max: 20, step: 0.1, optional: true },
  { key: 'pitch', group: 'detail', label: 'ピッチ', description: '隣り合う取り出し位置の間隔です。空欄なら自動計算します。', kind: 'number', unit: 'mm', min: 0.1, max: 50, step: 0.1, optional: true },
]
