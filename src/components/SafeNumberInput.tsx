
import { useState, useEffect, useRef, useId } from 'react'

export interface SafeNumberInputProps {
  value: number
  onChange: (value: number) => boolean | void
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
  const skipBlurRef = useRef(false)
  const inputId = useId()

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
      const accepted = onChange(res.value)
      if (accepted === false) {
        setError('Изменение отклонено. Проверьте сообщение проекта.')
        return
      }
      setError(null)
      setDraft(String(res.value))
    } else {
      setError(res.error ?? '\u041d\u0435\u0432\u0435\u0440\u043d\u043e\u0435 \u0437\u043d\u0430\u0447\u0435\u043d\u0438\u0435')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      skipBlurRef.current = true
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
    if (skipBlurRef.current) {
      skipBlurRef.current = false
      return
    }
    commit()
  }

  return (
    <div className="param-group">
      {label && <label className="param-label" htmlFor={inputId}>{label}</label>}
      <input
        id={inputId}
        aria-invalid={!!error}
        aria-describedby={error ? `${inputId}-error` : undefined}
        type="text"
        className="param-input"
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setError(null) }}
        onFocus={() => setFocused(true)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      />
      {error && <div id={`${inputId}-error`} role="alert" style={{ color: '#dc2626', fontSize: 12, marginTop: 4 }}>{error}</div>}
    </div>
  )
}
