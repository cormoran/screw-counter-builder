import { useState, type ChangeEvent } from 'react'
import type { Field } from '../settings-schema'
import type { Settings } from '../cad'
import { resolveScrewDimensions } from '../cad/settings'

type Props = { fields: readonly Field[]; settings: Settings; onChange: (key: keyof Settings, value: Settings[keyof Settings]) => void }

export function SettingsForm({ fields, settings, onChange }: Props) {
  const [clearedField, setClearedField] = useState<string | null>(null)
  const screwDimensions = resolveScrewDimensions(settings)
  return <div className="fields">
    {fields.map((field) => {
      const value = settings[field.key]
      const id = `setting-${field.key}`
      const presetValue = screwDimensions && field.key in screwDimensions ? screwDimensions[field.key as keyof typeof screwDimensions] : null
      const handleChange = (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const next = field.kind === 'boolean' ? (event.target as HTMLInputElement).checked : event.target.value
        if (field.kind === 'number' && field.optional) setClearedField(next === '' ? id : null)
        onChange(field.key, field.kind === 'number' ? (next === '' ? null : Number(next)) : next as Settings[keyof Settings])
      }
      return <div className={field.kind === 'boolean' ? 'field switch-field' : 'field'} key={field.key}>
        {field.kind === 'boolean' ? <>
          <div><label htmlFor={id}>{field.label}</label><p>{field.description}</p></div>
          <input id={id} type="checkbox" checked={Boolean(value)} onChange={handleChange} />
        </> : <>
          <label htmlFor={id}>{field.label}</label>
          {field.kind === 'select' ? <select id={id} value={String(value)} onChange={handleChange}>
            {field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select> : <div className="number-input">
            <input id={id} type="number" value={typeof value === 'number' ? value : field.optional && clearedField !== id ? presetValue ?? '' : ''} min={field.min} max={field.max} step={field.step} onChange={handleChange} onBlur={() => { if (clearedField === id) setClearedField(null) }} aria-describedby={`${id}-help`} />
            <span>{field.unit}</span>
          </div>}
          <p id={`${id}-help`}>{field.description}</p>
        </>}
      </div>
    })}
  </div>
}
