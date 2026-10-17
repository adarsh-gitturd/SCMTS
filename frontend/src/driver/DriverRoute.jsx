import { driverRouteErrorMessage, driverRouteView } from './driverLogic.js'
import DriverRouteMap from './DriverRouteMap.jsx'
import { useDriverRoute } from './useDriverRoute.js'

// Messages for 200 responses without a usable route. Error messages come from driverRouteErrorMessage.
const EMPTY_MESSAGES = {
  'no-route': 'Your bus has no route assigned yet. Ask an admin.',
  'no-stops': 'This route has no stops yet.',
}

function BusInfo({ data }) {
  return (
    <p className="driver-bus">
      Your bus: <strong>{data.plate}</strong> <span className="driver-bus__id">(Bus #{data.bus_id})</span>
    </p>
  )
}

export default function DriverRoute() {
  const { state, retry } = useDriverRoute()
  const view = driverRouteView(state)
  const data = state.data

  if (view === 'none') return null // 401: logout flow takes over

  if (view === 'loading') {
    return (
      <section className="driver">
        <p>Loading your route…</p>
      </section>
    )
  }

  if (view === 'route') {
    const { route } = data
    return (
      <section className="driver">
        <BusInfo data={data} />
        <h2>{route.name}</h2>
        <ol className="driver-stops">
          {route.stops.map((s) => (
            <li key={`${s.order}-${s.stop_id}`} className="driver-stop">
              <span className="driver-stop__order">{s.order}</span>
              <span className="driver-stop__name">{s.name}</span>
            </li>
          ))}
        </ol>
        <DriverRouteMap route={route} />
      </section>
    )
  }

  const isEmpty = view === 'no-route' || view === 'no-stops'
  // A bad 200 response has status 200, which also maps to "Something went wrong".
  const message = isEmpty ? EMPTY_MESSAGES[view] : driverRouteErrorMessage(state.status)

  return (
    <section className="driver">
      {isEmpty && <BusInfo data={data} />}
      {view === 'no-stops' && <h2>{data.route.name}</h2>}
      <p className={isEmpty ? 'driver-message' : 'driver-message error'} aria-live="polite">
        {message}
      </p>
      <button type="button" className="driver-retry" onClick={retry}>
        Retry
      </button>
    </section>
  )
}
