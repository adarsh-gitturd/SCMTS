import { useEffect, useId, useMemo, useRef, useState } from 'react'
import AdminField from './AdminField.jsx'
import { addStop, moveItem, removeStop, ROUTE_STOPS_MAX, stopName, validateRouteForm } from './adminLogic.js'

// Add/edit form for one route: name plus an ordered stop list with Move up/down and
// Remove buttons, and a <select> of stops not yet in the route. Duplicates and more
// than 50 stops are prevented here (the server also rejects them). Zero stops is allowed.
// After a move or remove, focus stays on the matching button so keyboard users keep their place.
export default function RouteForm({
  heading,
  HeadingTag = 'h3',
  initialName,
  initialStopIds,
  stops,
  stopsById,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}) {
  const uid = useId()
  const [name, setName] = useState(initialName)
  const [stopIds, setStopIds] = useState(initialStopIds)
  const [selected, setSelected] = useState('')
  const [shown, setShown] = useState({}) // fields whose errors are visible
  const nameRef = useRef(null)
  const selectRef = useRef(null)
  const buttonsRef = useRef(new Map()) // "<id>:up" | "<id>:down" | "<id>:remove" -> button
  const focusRef = useRef(null) // button key or 'select' to focus after the next render

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  useEffect(() => {
    const key = focusRef.current
    if (!key) return
    focusRef.current = null
    const el = key === 'select' ? selectRef.current : buttonsRef.current.get(key)
    el?.focus()
  })

  const available = useMemo(() => {
    const chosen = new Set(stopIds)
    return stops.filter((s) => !chosen.has(s.id))
  }, [stops, stopIds])

  const check = validateRouteForm(name, stopIds)
  const nameError = shown.name ? check.errors.name : undefined
  const stopsError = shown.stops ? check.errors.stops : undefined
  const full = stopIds.length >= ROUTE_STOPS_MAX

  const buttonRef = (key) => (el) => {
    if (el) buttonsRef.current.set(key, el)
    else buttonsRef.current.delete(key)
  }

  const labelFor = (id) => (stopsById.has(id) ? stopName(stopsById, id) : `${stopName(stopsById, id)} (no longer exists)`)

  function move(index, dir) {
    const next = moveItem(stopIds, index, dir)
    if (next === stopIds) return
    const id = stopIds[index]
    const to = index + dir
    // Same button on the moved stop; at the top/bottom that one is now disabled, so use the other.
    let which = dir < 0 ? 'up' : 'down'
    if (to === 0) which = 'down'
    if (to === next.length - 1) which = 'up'
    focusRef.current = `${id}:${which}`
    setStopIds(next)
  }

  function remove(index) {
    const id = stopIds[index]
    const next = removeStop(stopIds, id)
    const neighbour = next[index] ?? next[index - 1]
    focusRef.current = neighbour === undefined ? 'select' : `${neighbour}:remove`
    setStopIds(next)
  }

  function add() {
    const next = addStop(stopIds, Number(selected))
    if (next === stopIds) return
    setStopIds(next)
    setSelected('')
    focusRef.current = 'select'
  }

  function handleSubmit(e) {
    e.preventDefault()
    setShown({ name: true, stops: true })
    if (!check.ok || busy) return
    onSubmit(check.body) // the hook blocks a second request while one is in flight
  }

  const selectId = `${uid}-add`
  const fullId = `${uid}-full`
  const stopsErrorId = `${uid}-stops-error`
  const selectDescribedBy = [full ? fullId : null, stopsError ? stopsErrorId : null].filter(Boolean).join(' ')

  return (
    <form className="admin-form" onSubmit={handleSubmit} noValidate>
      {heading && <HeadingTag className="admin-form__heading">{heading}</HeadingTag>}
      <AdminField
        id={`${uid}-name`}
        label="Name"
        inputRef={nameRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => setShown((s) => (s.name ? s : { ...s, name: true }))}
        error={nameError}
      />

      <fieldset className="admin-stops">
        <legend>
          Stops in order ({stopIds.length} of {ROUTE_STOPS_MAX})
        </legend>
        {stopIds.length === 0 ? (
          <p className="admin-field__hint">No stops yet. A route can be saved without stops.</p>
        ) : (
          <ol className="admin-order">
            {stopIds.map((id, i) => {
              const label = labelFor(id)
              return (
                <li key={id} className="admin-order__item">
                  <span className="admin-order__name">
                    {i + 1}. {label}
                  </span>
                  <span className="admin-order__buttons">
                    <button
                      type="button"
                      className="button--secondary"
                      ref={buttonRef(`${id}:up`)}
                      aria-label={`Move ${label} up`}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      <span aria-hidden="true">↑ </span>Up
                    </button>
                    <button
                      type="button"
                      className="button--secondary"
                      ref={buttonRef(`${id}:down`)}
                      aria-label={`Move ${label} down`}
                      disabled={i === stopIds.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <span aria-hidden="true">↓ </span>Down
                    </button>
                    <button
                      type="button"
                      className="button--danger-outline"
                      ref={buttonRef(`${id}:remove`)}
                      aria-label={`Remove ${label}`}
                      onClick={() => remove(i)}
                    >
                      Remove
                    </button>
                  </span>
                </li>
              )
            })}
          </ol>
        )}

        <div className="admin-field">
          <label htmlFor={selectId}>Stop to add</label>
          <div className="admin-add-stop">
            <select
              id={selectId}
              ref={selectRef}
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              aria-invalid={stopsError ? 'true' : undefined}
              aria-describedby={selectDescribedBy || undefined}
            >
              <option value="">{available.length > 0 ? 'Choose a stop…' : 'All stops are already in the route'}</option>
              {available.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.name} (#{s.id})
                </option>
              ))}
            </select>
            <button type="button" onClick={add} disabled={selected === '' || full}>
              Add stop
            </button>
          </div>
          {full && (
            <p id={fullId} className="admin-field__hint">
              A route can have at most {ROUTE_STOPS_MAX} stops.
            </p>
          )}
          {stopsError && (
            <p id={stopsErrorId} className="admin-field__error">
              Error: {stopsError}
            </p>
          )}
        </div>
      </fieldset>

      <div className="admin-actions">
        <button type="submit" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </button>
        <button type="button" className="button--secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  )
}
