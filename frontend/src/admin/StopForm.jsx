import { useEffect, useId, useRef, useState } from 'react'
import AdminField from './AdminField.jsx'
import { validateStopForm } from './adminLogic.js'

// Add/edit form for one stop. Inputs stay strings so "13." or "-" can be typed.
// A field's error shows once the field is left or after a submit attempt, then
// updates while typing. Invalid input never sends a request.
export default function StopForm({ heading, HeadingTag = 'h3', initial, submitLabel, busy, onSubmit, onCancel }) {
  const uid = useId()
  const [values, setValues] = useState(initial)
  const [shown, setShown] = useState({}) // fields whose errors are visible
  const nameRef = useRef(null)

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  const check = validateStopForm(values.name, values.lat, values.lng)
  const errorFor = (field) => (shown[field] ? check.errors[field] : undefined)

  const change = (field) => (e) => setValues((v) => ({ ...v, [field]: e.target.value }))
  const reveal = (field) => () => setShown((s) => (s[field] ? s : { ...s, [field]: true }))

  function handleSubmit(e) {
    e.preventDefault()
    setShown({ name: true, lat: true, lng: true })
    if (!check.ok || busy) return
    onSubmit(check.body) // the hook blocks a second request while one is in flight
  }

  return (
    <form className="admin-form" onSubmit={handleSubmit} noValidate>
      {heading && <HeadingTag className="admin-form__heading">{heading}</HeadingTag>}
      <AdminField
        id={`${uid}-name`}
        label="Name"
        inputRef={nameRef}
        value={values.name}
        onChange={change('name')}
        onBlur={reveal('name')}
        error={errorFor('name')}
      />
      <AdminField
        id={`${uid}-lat`}
        label="Latitude"
        hint="-90 to 90, e.g. 13.0102"
        inputMode="decimal"
        value={values.lat}
        onChange={change('lat')}
        onBlur={reveal('lat')}
        error={errorFor('lat')}
      />
      <AdminField
        id={`${uid}-lng`}
        label="Longitude"
        hint="-180 to 180, e.g. 80.2355"
        inputMode="decimal"
        value={values.lng}
        onChange={change('lng')}
        onBlur={reveal('lng')}
        error={errorFor('lng')}
      />
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
