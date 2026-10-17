import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { STATUS_INFO } from '../map/busIcons.js'
import { alertLabel, VISIBLE_LIMIT } from './alertsLogic.js'
import { useAlerts } from './useAlerts.js'

// Alerts strip for students, derived from the live feed. The visible list is not
// a live region; only new alerts go into the hidden polite region, so updates and
// reordering are never re-announced.
export default function AlertsStrip({ buses, conn, busRoutes, routeNames, top }) {
  const { visible, liveText, dismiss } = useAlerts({ buses, conn, busRoutes, routeNames, top, info: STATUS_INFO })
  const sectionRef = useRef(null)
  const focusRef = useRef(undefined) // key to focus after a dismiss, null = the strip itself

  // After a dismiss, move focus to the neighbouring alert's button, else to the strip.
  useEffect(() => {
    if (focusRef.current === undefined) return
    const key = focusRef.current
    focusRef.current = undefined
    const section = sectionRef.current
    if (!section) return
    const target = key === null ? null : section.querySelector(`[data-key="${key}"] button`)
    ;(target ?? section).focus()
  }, [visible])

  const handleDismiss = useCallback(
    (key) => {
      const i = visible.findIndex((a) => a.key === key)
      focusRef.current = visible[i + 1]?.key ?? visible[i - 1]?.key ?? null
      dismiss(key)
    },
    [visible, dismiss],
  )

  return (
    <section className="alerts" aria-labelledby="alerts-heading" ref={sectionRef} tabIndex={-1}>
      <h2 id="alerts-heading" className="visually-hidden">
        Service alerts
      </h2>
      <p className="visually-hidden" aria-live="polite">
        {liveText}
      </p>
      {visible.length > 0 && <AlertList alerts={visible} onDismiss={handleDismiss} />}
    </section>
  )
}

const AlertList = memo(function AlertList({ alerts, onDismiss }) {
  const [expanded, setExpanded] = useState(false)
  const rows = expanded ? alerts : alerts.slice(0, VISIBLE_LIMIT)
  const hidden = alerts.length - VISIBLE_LIMIT

  return (
    <div className="alerts__box">
      <ul className="alerts__list">
        {rows.map((a) => (
          <li key={a.key} data-key={a.key} className={`alerts__item${a.tag ? ' alerts__item--trip' : ''}`}>
            <span className="alerts__glyph" aria-hidden="true">
              {a.glyph}
            </span>
            <span className="alerts__text" title={alertLabel(a)}>
              {a.text}
              {a.tag && <strong className="alerts__tag"> · {a.tag}</strong>}
            </span>
            <button
              type="button"
              className="alerts__dismiss"
              aria-label={`Dismiss: ${alertLabel(a)}`}
              onClick={() => onDismiss(a.key)}
            >
              <span aria-hidden="true">×</span>
            </button>
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <button type="button" className="alerts__more" aria-expanded={expanded} onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'Show fewer' : `+${hidden} more`}
        </button>
      )}
    </div>
  )
})
