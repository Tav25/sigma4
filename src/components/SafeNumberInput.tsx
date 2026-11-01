
import { useState, useEffect, useRef } from 'react'

export interface SafeNumberInputProps {
  value: number
  onChange: (value: number) => void
  validate: (raw: string) => { ok: boolean; value?: number; error?: string }
  label?: string
  min?: number
  max?: number
}

export function SafeNumberInput({ value, onChange, validate, label }: SafeNumberInputProps) {
  const [draft, setDraft] = useState(String(value))
  const [error, setError] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)
  const cancelRef = useRef(false)

  useEffect(() => {
    if (!focused && error === null) {
      setDraft(String(value))
    }
  }, [value, focused, error])

  const commit = () => {
    if (cancelRef.current) {
      cancelRef.current = false
      setDraft(String(value))
      setError(null)
      return
    }
    const res = validate(draft)
    if (res.ok && res.value !== undefined) {
      onChange(res.value)
      setError(null)
      setDraft(String(res.value))
    } else {
      setError(res.error ?? '\u041d\u0435\u0432\u0435\u0440\u043d\u043e\u0435 \u0437\u043d\u0430\u0447\u0435\u043d\u0438\u0435')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
      ;(e.target as HTMLInputElement).blur()
    } else if (e.key === 'Escape') {
      cancelRef.current = true
      setDraft(String(value))
      setError(null)
      ;(e.target as HTMLInputElement).blur()
    }
  }

  const handleBlur = () => {
    setFocused(false)
    commit()
  }

  return (
    <div className="param-group">
      {label && <label className="param-label">{label}</label>}
      <input
        type="text"
        className="param-input"
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setError(null) }}
        onFocus={() => setFocused(true)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      />
      {error && <div style={{ color: '#dc2626', fontSize: 12, marginTop: 4 }}>{error}</div>}
    </div>
  )
}
