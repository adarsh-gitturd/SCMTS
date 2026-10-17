import { basedOn, formatAverage, formatDelay, formatRating } from './analyticsLogic.js'

// One route's figures. Averages are shown as the server sent them (1 decimal),
// "No data" when null, always with the count they are based on. The delay uses
// words, a sign and a symbol; its colour is only an extra cue.
export default function AnalyticsRouteCard({ route }) {
  const delay = formatDelay(route.avgDelayMin)
  const timed = basedOn(route.timedTrips, 'timed trip', 'timed trips')

  return (
    <li className="fleet-card">
      <h3 className="fleet-card__title">{route.routeName}</h3>
      <p className="fleet-card__secondary analytics-card__id">Route #{route.routeId}</p>
      <dl className="fleet-card__fields">
        <dt>Trips</dt>
        <dd>{route.trips}</dd>
        <dt>Completed</dt>
        <dd>{route.completedTrips}</dd>
        <dt>Rating</dt>
        <dd>{formatRating(route.avgRating, route.ratedTrips)}</dd>
        <dt>Timed trips</dt>
        <dd>{route.timedTrips} (completed, with a prediction)</dd>
        <dt>Average duration</dt>
        <dd>
          {formatAverage(route.avgDurationMin, 'min')} <span className="analytics-basis">{timed}</span>
        </dd>
        <dt>Average predicted ETA</dt>
        <dd>
          {formatAverage(route.avgPredictedEtaMin, 'min')} <span className="analytics-basis">{timed}</span>
        </dd>
        <dt>Average delay</dt>
        <dd>
          <span className={`analytics-delay analytics-delay--${delay.tone}`}>
            {delay.symbol && <span aria-hidden="true">{delay.symbol} </span>}
            {delay.text}
          </span>{' '}
          <span className="analytics-basis">{timed}</span>
        </dd>
      </dl>
    </li>
  )
}
