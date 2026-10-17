import { useRef, useState } from 'react'
import { parseCount } from './passengerLogic.js'
import { usePassengerLog } from './usePassengerLog.js'

// "Log passenger count" form. Stops come from the already loaded route (API order);
// nothing is fetched or sent on mount. Independent of the shift state.
export default function PassengerLog({ stops }) {
  const { busy, notice, submit } = usePassengerLog()
  const [stopValue, setStopValue] = useState('')
  const [countText, setCountText] = useState('')
  const [badInput, setBadInput] = useState(false) // browser could not parse the text (value is then "")
  const [touched, setTouched] = useState(false)
  const countRef = useRef(null)

  const stop = stops.find((s) => String(s.stop_id) === stopValue) ?? null
  const count = badInput ? null : parseCount(countText)
  const countInvalid = count === null
  const canSubmit = stop !== null && !countInvalid && !busy

  function handleCountChange(e) {
    setCountText(e.target.value)
    setBadInput(e.target.validity.badInput)
    setTouched(true)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!canSubmit) {
      setTouched(true)
      return
    }
    const ok = await submit(stop.stop_id, count, stop.name)
    if (!ok) return // failed: keep the stop and the count
    setCountText('')
    setBadInput(false)
    setTouched(false)
    countRef.current?.focus()
  }

  return (
    <section className="passengers" aria-labelledby="passengers-title">
      <h2 id="passengers-title">Passenger count</h2>
      <form className="passengers__form" onSubmit={handleSubmit} noValidate>
        <fieldset>
          <legend>Log passengers at a stop</legend>

          <label htmlFor="passengers-stop">Stop</label>
          <select
            id="passengers-stop"
            value={stopValue}
            disabled={busy}
            onChange={(e) => setStopValue(e.target.value)}
          >
            <option value="">Choose a stop</option>
            {stops.map((s) => (
              <option key={`${s.order}-${s.stop_id}`} value={String(s.stop_id)}>
                {s.order}. {s.name}
              </option>
            ))}
          </select>

          <label htmlFor="passengers-count">Number of passengers</label>
          <input
            id="passengers-count"
            ref={countRef}
            type="number"
            inputMode="numeric"
            min={0}
            max={200}
            step={1}
            value={countText}
            readOnly={busy}
            aria-invalid={touched && countInvalid}
            aria-describedby="passengers-count-error"
            onChange={handleCountChange}
          />
          <p id="passengers-count-error" className="passengers__error">
            {touched && countInvalid ? 'Enter a whole number from 0 to 200.' : ''}
          </p>

          <button type="submit" className="passengers__submit" disabled={!canSubmit}>
            {busy ? 'Sending…' : 'Submit'}
          </button>
        </fieldset>
      </form>

      <div className="passengers__live" aria-live="polite">
        {notice && (
          <p className={`passengers__notice passengers__notice--${notice.kind}`}>
            <span aria-hidden="true">{notice.kind === 'success' ? '✓ ' : '✕ '}</span>
            {notice.text}
          </p>
        )}
      </div>
    </section>
  )
}
