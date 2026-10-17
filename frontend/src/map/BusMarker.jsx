import { memo } from 'react'
import { Marker, Popup } from 'react-leaflet'
import { STATUS_INFO, busIcon } from './busIcons.js'

// Memoized: re-renders only when this bus's data or staleness changes. react-leaflet
// moves the existing marker (setLatLng) instead of re-creating it.
// highlight = top recommended bus of the current trip.
function BusMarker({ bus, stale, highlight = false }) {
  const info = STATUS_INFO[bus.status] ?? STATUS_INFO.unknown
  const label = `Bus ${bus.bus_id}: ${info.label}${stale ? ' (stale)' : ''}${highlight ? ', recommended' : ''}`

  return (
    <Marker
      position={[bus.lat, bus.lng]}
      icon={busIcon(bus.status, stale, highlight)}
      zIndexOffset={highlight ? 1000 : 0}
      title={label}
      alt={label}
    >
      <Popup>
        <strong>Bus {bus.bus_id}</strong>
        <br />
        Status: {info.label}
        {stale && ' (stale)'}
        <br />
        Speed: {bus.speed === null ? 'n/a' : `${Math.round(bus.speed)} km/h`}
        <br />
        Updated: {new Date(bus.ts).toLocaleTimeString()}
      </Popup>
    </Marker>
  )
}

export default memo(BusMarker)
