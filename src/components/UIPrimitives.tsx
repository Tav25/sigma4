import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react'

export type ActionVariant = 'primary' | 'secondary' | 'text'

export function ActionButton({ variant = 'secondary', className = '', children, ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ActionVariant }) {
  return <button type="button" {...props}
    className={['plan-button', 'plan-' + variant, className].filter(Boolean).join(' ')}>
    {children}
  </button>
}

/** Common inspector disclosure used in Plan 2D, Frame 3D and Section. */
export function InspectorGroup({ title, children, defaultExpanded = true, description, testId }:{
  title: string
  children: ReactNode
  defaultExpanded?: boolean
  description?: string
  testId?: string
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  return <section className="ui-inspector-group" data-testid={testId}>
    <button type="button" className="ui-inspector-toggle"
      aria-expanded={expanded} onClick={() => setExpanded(x => !x)}>
      <span><strong>{title}</strong>{description && <small>{description}</small>}</span>
      <span aria-hidden="true">{expanded ? '⌃' : '⌄'}</span>
    </button>
    {expanded && <div className="ui-inspector-content">{children}</div>}
  </section>
}

export function ModelStatus({ valid, errorCount, structuralErrorCount = 0, hasGarage = false, demo = false, compact = false }: {
  valid: boolean | null
  errorCount: number
  structuralErrorCount?: number
  hasGarage?: boolean
  demo?: boolean
  compact?: boolean
}) {
  return <section className={'ui-model-status' + (compact ? ' ui-model-status-compact' : '')}
    data-testid="ui-model-status" aria-label="Проверки проекта">
    <div className="ui-status-item" data-testid="ui-geometry-status" data-state={valid === null ? 'unknown' : valid ? 'valid' : 'error'}>
      <span aria-hidden="true">{valid === null ? '?' : valid ? '✓' : '!'}</span>
      <span>{valid === null ? 'Модель ещё не проверена' : valid ? 'Проверка модели: без ошибок' : 'Ошибки модели: ' + errorCount}</span>
    </div>
    <div className="ui-status-item ui-status-unverified" data-testid="ui-engineering-status">
      <span aria-hidden="true">!</span>
      <span>Несущая способность: <strong>не рассчитана</strong></span>
    </div>
    {demo && <div className="ui-status-demo" data-testid="ui-demo-status">3D: демонстрационный каркас</div>}
    {!compact && <div className="ui-status-explanation">
      Проверка модели не подтверждает соответствие IRC/CSA и безопасность строительства.
      {structuralErrorCount > 0 && ' Ошибки контактов и опор: ' + structuralErrorCount + '.'}
      {hasGarage && ' Для гаражных ворот необходим отдельный расчёт перемычки и пространственной жёсткости.'}
      {demo && ' 3D содержит демонстрационную модель; план 2D ещё не построен.'}
    </div>}
  </section>
}
