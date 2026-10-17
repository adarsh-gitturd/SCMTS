import 'leaflet/dist/leaflet.css'
import { useEffect, useState } from 'react'
import { MapContainer, TileLayer } from 'react-leaflet'
import { api } from '../api/client.js'
import { useAuth } from '../auth/useAuth.js'
import TripPanel from '../trip/TripPanel.jsx'
import { useTripRequest } from '../trip/useTripRequest.js'
import BusMarker from './BusMarker.jsx'
import ConnectionStatus from './ConnectionStatus.jsx'
import { isStale } from './liveBusLogic.js'
import StaticLayer from './StaticLayer.jsx'
import { useLiveBuses } from './useLiveBuses.js'

const FALLBACK_CENTER = [13.01, 80.23]
const STALE_CHECK_MS = 5000

function validStop(s) {
  return s && Number.isInteger(s.id) && Number.isFinite(s.lat) && Number.isFinite(s.lng)
}

// Loads routes and stops (D1) once.
function useStaticData() {
  const [state, setState] = useState({ loading: true, error: null, routes: [], stops: [] })

  useEffect(() => {
    let cancelled = false
    Promise.all([api.get('/routes'), api.get('/stops')])
      .then(([routes, stops]) => {
        if (cancelled) return
        setState({
          loading: false,
          error: null,
          routes: Array.isArray(routes) ? routes : [],
          stops: Array.isArray(stops) ? stops.filter(validStop) : [],
        })
      })
      .catch((err) => {
        if (cancelled) return
        const msg = err?.status === 0 ? 'server not reachable' : err?.message || 'unknown error'
        setState({ loading: false, error: `Could not load routes and stops (${msg}).`, routes: [], stops: [] })
      })
    return () => {
      cancelled = true
    }
  }, [])

  return state
}

function BusLayer({ buses, topBusId }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), STALE_CHECK_MS)
    return () => clearInterval(id)
  }, [])

  return [...buses.values()].map((bus) => (
    <BusMarker key={bus.bus_id} bus={bus} stale={isStale(bus, now)} highlight={bus.bus_id === topBusId} />
  ))
}

export default function LiveMap() {
  const { token, user } = useAuth()
  const { routes, stops, loading, error } = useStaticData()
  const { buses, conn } = useLiveBuses(token)
  // Trip state is lifted here so the map (highlights) and sibling panels can read it.
  const trip = useTripRequest()
  const [destId, setDestId] = useState(null)

  const isStudent = user?.role === 'student'
  const topBusId = trip.state.phase === 'success' ? (trip.state.result.recommendations[0]?.bus_id ?? null) : null

  function changeDestination(id) {
    setDestId(id)
    trip.reset() // drops a running request and the old result
  }

  const bounds = stops.length > 0 ? stops.map((s) => [s.lat, s.lng]) : null

  return (
    <section className="map-wrap">
      <div className="map-bar">
        <ConnectionStatus conn={conn} />
        {conn.kind === 'forbidden' && <p className="error">You are not allowed to view live buses.</p>}
        {error && <p className="error">{error}</p>}
      </div>
      {loading ? (
        <p className="map-loading">Loading map...</p>
      ) : (
        <div className="map-area">
          {isStudent && stops.length > 0 && (
            <TripPanel stops={stops} destId={destId} onDestinationChange={changeDestination} trip={trip} />
          )}
          <MapContainer
            className="map"
            {...(bounds ? { bounds, boundsOptions: { padding: [24, 24], maxZoom: 17 } } : { center: FALLBACK_CENTER, zoom: 15 })}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              maxZoom={19}
            />
            <StaticLayer routes={routes} stops={stops} selectedStopId={destId} />
            <BusLayer buses={buses} topBusId={topBusId} />
          </MapContainer>
        </div>
      )}
    </section>
  )
}
