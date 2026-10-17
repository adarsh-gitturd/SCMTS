import { formatClock, SHIFT_STATUSES, statusLabel } from './shiftLogic.js'
import { useDriverShift } from './useDriverShift.js'

const PHASE_TEXT = {
  idle: 'Not sharing',
  starting: 'Starting… getting your location',
  sharing: 'Sharing location',
  ending: 'Ending shift…',
}

function statusText(status) {
  const info = SHIFT_STATUSES.find((o) => o.value === status)
  return info ? `${info.glyph} ${info.label}` : statusLabel(null)
}

// Shift controls: GPS sharing and status buttons. Never opens a WebSocket.
export default function DriverControls() {
  const { state, start, cancel, end, changeStatus } = useDriverShift()
  const { phase, status } = state
  const sharing = phase === 'sharing'

  let mainButton
  if (phase === 'idle') {
    mainButton = (
      <button type="button" className="shift__main" onClick={start}>
        Start shift
      </button>
    )
  } else if (phase === 'starting') {
    mainButton = (
      <button type="button" className="shift__main shift__main--stop" onClick={cancel} disabled={!state.canCancel}>
        Cancel
      </button>
    )
  } else {
    mainButton = (
      <button
        type="button"
        className="shift__main shift__main--stop"
        onClick={end}
        disabled={phase !== 'sharing' || state.statusBusy}
      >
        {phase === 'ending' ? 'Ending…' : 'End shift'}
      </button>
    )
  }

  return (
    <section className="shift" aria-labelledby="shift-title">
      <h2 id="shift-title">Shift</h2>
      <p className={`shift__phase shift__phase--${phase}`}>{PHASE_TEXT[phase]}</p>
      {mainButton}

      <div className="shift__live" aria-live="polite">
        {state.message && <p className="shift__message">{state.message}</p>}
        {(phase === 'starting' || sharing) && state.gpsWaiting && <p className="shift__message">Waiting for GPS signal</p>}
        {sharing && state.connProblem && <p className="shift__message">Connection problem, retrying</p>}
      </div>

      <p className="shift__sent">
        {state.lastSentAt === null ? 'Nothing sent yet' : `Last sent ${formatClock(state.lastSentAt)}`}
      </p>
      {state.rejected > 0 && (
        <p className="shift__note">
          {state.rejected === 1 ? '1 location update was rejected.' : `${state.rejected} location updates were rejected.`}
        </p>
      )}

      <p className="shift__current">
        Status: <strong>{statusText(status)}</strong>
      </p>
      {phase === 'idle' && status === null && (
        <p className="shift__note">
          Your bus status is unknown until you start a shift. If sharing stopped without End shift, students see your
          bus as “not reporting”.
        </p>
      )}

      <div className="shift__statuses" role="group" aria-label="Bus status">
        {SHIFT_STATUSES.map((o) => (
          <button
            key={o.value}
            type="button"
            className="shift__status"
            aria-pressed={status === o.value}
            disabled={!sharing || state.statusBusy}
            onClick={() => changeStatus(o.value)}
          >
            <span className="shift__glyph" aria-hidden="true">
              {o.glyph}
            </span>
            {o.label}
          </button>
        ))}
      </div>
      <div className="shift__live" aria-live="polite">
        {state.statusMessage && <p className="shift__message">{state.statusMessage}</p>}
      </div>

      <p className="shift__note">Keep this screen on and the page open while sharing.</p>
    </section>
  )
}
