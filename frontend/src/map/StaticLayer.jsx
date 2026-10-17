import { memo } from 'react'
import { CircleMarker, Polyline, Popup } from 'react-leaflet'

const STOP = { color: '#333', weight: 2, fillColor: '#fff', fillOpacity: 1 }
const SELECTED_STOP = { color: '#e65100', weight: 4, fillColor: '#ffcc80', fillOpacity: 1 }

// Stops and route lines (D1). Memoized: props are loaded once, so bus updates
// never re-render this; only a new selected (destination) stop does.
function StaticLayer({ routes, stops, selectedStopId }) {
  const byId = new Map(stops.map((s) => [s.id, s]))

  const lines = routes
    .map((r) => {
      const points = [...(r.stops ?? [])]
        .sort((a, b) => a.order - b.order)
        .map((rs) => byId.get(rs.stop_id))
        .filter(Boolean)
        .map((s) => [s.lat, s.lng])
      return { id: r.id, name: r.name, points }
    })
    .filter((l) => l.points.length >= 2)

  return (
    <>
      {lines.map((l) => (
        <Polyline key={l.id} positions={l.points} pathOptions={{ color: '#1f5fbf', weight: 4, opacity: 0.6 }}>
          <Popup>{l.name}</Popup>
        </Polyline>
      ))}
      {stops.map((s) => (
        <CircleMarker
          key={s.id}
          center={[s.lat, s.lng]}
          radius={s.id === selectedStopId ? 10 : 6}
          pathOptions={s.id === selectedStopId ? SELECTED_STOP : STOP}
        >
          <Popup>{s.name}</Popup>
        </CircleMarker>
      ))}
    </>
  )
}

export default memo(StaticLayer)
