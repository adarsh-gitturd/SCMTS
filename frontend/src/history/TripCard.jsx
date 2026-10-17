import { memo, useRef, useState } from 'react'
import { canRate, formatStartedAt, ratingLabel, validateRating } from './historyLogic.js'

const FEEDBACK_MAX = 500

function routeName(routesById, id) {
  const r = routesById.get(id)
  return r && typeof r.name === 'string' && r.name !== '' ? r.name : `Route #${id}`
}

function stopName(stopsById, id) {
  const s = stopsById.get(id)
  return s && typeof s.name === 'string' && s.name !== '' ? s.name : `Stop #${id}`
}

// The rating form, shown only for a started trip that had a bus. Owns its own
// input so typing re-renders just this card. onRate(tripId, rating, feedback)
// resolves to { ok, message }. onRate is stable (the hook's submitRating), so
// memoized cards are not re-rendered by a new closure each render.
function RatingForm({ tripId, onRate }) {
  const [rating, setRating] = useState(0)
  const [feedback, setFeedback] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const busyRef = useRef(false) // set synchronously so a double click cannot slip through

  const remaining = FEEDBACK_MAX - feedback.length

  async function handleSubmit(e) {
    e.preventDefault()
    if (busyRef.current || !validateRating(rating)) return
    busyRef.current = true
    setSubmitting(true)
    setError(null)
    const result = await onRate(tripId, rating, feedback)
    busyRef.current = false
    setSubmitting(false)
    // On success the list refetches and this card is replaced by the completed
    // view, so there is nothing more to do here. On failure keep the input and
    // show our wording (null = 401, the logout flow takes over).
    if (!result.ok && result.message) setError(result.message)
  }

  return (
    <form className="rating-form" onSubmit={handleSubmit}>
      <fieldset className="rating-choices">
        <legend>Rate this trip (1 = poor, 5 = excellent)</legend>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="rating-choice">
            <input
              type="radio"
              name={`rating-${tripId}`}
              value={n}
              checked={rating === n}
              onChange={() => setRating(n)}
              disabled={submitting}
            />
            {n}
          </label>
        ))}
      </fieldset>

      <label className="rating-feedback">
        Feedback (optional)
        <textarea
          value={feedback}
          maxLength={FEEDBACK_MAX}
          rows={2}
          disabled={submitting}
          onChange={(e) => setFeedback(e.target.value)}
        />
      </label>
      <p className="rating-counter">{remaining} characters left</p>

      <p className="rating-note">You can&apos;t change a rating after sending.</p>

      <button type="submit" disabled={submitting || !validateRating(rating)}>
        {submitting ? 'Sending…' : 'Send rating'}
      </button>

      <p className="error" aria-live="polite">
        {error}
      </p>
    </form>
  )
}

function TripCardBase({ trip, routesById, stopsById, onRate }) {
  const [formOpen, setFormOpen] = useState(false)
  const completed = trip.status === 'completed'
  const ratable = canRate(trip)

  return (
    <li className="trip-card">
      <h2 className="trip-dest">{trip.destination}</h2>
      <p className="trip-time">{formatStartedAt(trip.started_at)}</p>

      {trip.route_id !== null && <p className="trip-meta">Route: {routeName(routesById, trip.route_id)}</p>}
      {trip.board_stop_id !== null && <p className="trip-meta">Board at: {stopName(stopsById, trip.board_stop_id)}</p>}

      {completed ? (
        <>
          <p className="trip-status">✓ Completed</p>
          {ratingLabel(trip.rating) && <p className="trip-rating">{ratingLabel(trip.rating)}</p>}
          {trip.feedback && <p className="trip-feedback">“{trip.feedback}”</p>}
        </>
      ) : ratable ? (
        <>
          <p className="trip-status">• In progress or not rated yet</p>
          {formOpen ? (
            <RatingForm tripId={trip.id} onRate={onRate} />
          ) : (
            <button type="button" onClick={() => setFormOpen(true)}>
              Rate this trip
            </button>
          )}
        </>
      ) : (
        <p className="trip-status">No bus was available</p>
      )}
    </li>
  )
}

// Memoized: typing in one card's form must not re-render the whole list.
const TripCard = memo(TripCardBase)
export default TripCard
