import 'leaflet/dist/leaflet.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer } from 'react-leaflet'
import AlertsStrip from '../alerts/AlertsStrip.jsx'
import AdvisorCard from '../advisor/AdvisorCard.jsx'
import { nearbyReference } from '../advisor/advisorLogic.js'
import NearbyBuses from '../advisor/NearbyBuses.jsx'
import { useBusRoutes } from '../advisor/useBusRoutes.js'
import { api } from '../api/client.js'
import { useAuth } from '../auth/useAuth.js'
import TripPanel from '../trip/TripPanel.jsx'
import { useTripRequest } from '../trip/useTripRequest.js'
import BusMarker from './BusMarker.jsx'
import ConnectionStatus from './ConnectionStatus.jsx'
import FocusBus from './FocusBus.jsx'
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

function BusLayer({ buses, topBusId, onMarker }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), STALE_CHECK_MS)
    return () => clearInterval(id)
  }, [])

  return [...buses.values()].map((bus) => (
    <BusMarker
      key={bus.bus_id}
      bus={bus}
      stale={isStale(bus, now)}
      highlight={bus.bus_id === topBusId}
      onMarker={onMarker}
    />
  ))
}

export default function LiveMap() {
  const { token, user } = useAuth()
  const { routes, stops, loading, error } = useStaticData()
  const { buses, conn } = useLiveBuses(token)
  // Trip state is lifted here so the map (highlights) and sibling panels can read it.
  const trip = useTripRequest()
  const [destId, setDestId] = useState(null)
  const [originId, setOriginId] = useState(null) // stop picked in manual mode
  const [focus, setFocus] = useState(null) // { busId, n } for FocusBus
  const markersRef = useRef(new Map()) // bus_id -> Leaflet marker

  const isStudent = user?.role === 'student'
  const busRoutes = useBusRoutes(isStudent)
  const topBusId = trip.state.phase === 'success' ? (trip.state.result.recommendations[0]?.bus_id ?? null) : null

  const stopsById = useMemo(() => new Map(stops.map((s) => [s.id, s])), [stops])
  const routeNames = useMemo(() => new Map(routes.map((r) => [r.id, r.name])), [routes])
  const result = trip.state.phase === 'success' ? trip.state.result : null
  const topRec = result?.recommendations[0] ?? null
  const manualOriginId = trip.state.originMode === 'manual' ? originId : null
  const reference = useMemo(
    () => nearbyReference(result, manualOriginId, stopsById),
    [result, manualOriginId, stopsById],
  )

  const registerMarker = useCallback((busId, marker) => {
    if (marker) markersRef.current.set(busId, marker)
    else markersRef.current.delete(busId)
  }, [])
  const showBus = useCallback((busId) => setFocus((f) => ({ busId, n: (f?.n ?? 0) + 1 })), [])

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
      {isStudent && !loading && (
        <AlertsStrip buses={buses} conn={conn} busRoutes={busRoutes} routeNames={routeNames} top={topRec} />
      )}
      {loading ? (
        <p className="map-loading">Loading map...</p>
      ) : (
        <div className="map-area">
          {isStudent && stops.length > 0 && (
            <div className="side-panel">
              <TripPanel
                stops={stops}
                destId={destId}
                onDestinationChange={changeDestination}
                originId={originId}
                onOriginChange={setOriginId}
                trip={trip}
              />
              <AdvisorCard
                tripState={trip.state}
                routeNames={routeNames}
                stopsById={stopsById}
                liveTop={topBusId === null ? undefined : buses.get(topBusId)}
                onReset={trip.reset}
                onShowBus={showBus}
              />
              <NearbyBuses
                buses={buses}
                reference={reference}
                busRoutes={busRoutes}
                routeNames={routeNames}
                onShowBus={showBus}
              />
            </div>
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
            <BusLayer buses={buses} topBusId={topBusId} onMarker={registerMarker} />
            <FocusBus focus={focus} markers={markersRef} />
          </MapContainer>
        </div>
      )}
    </section>
  )
}
