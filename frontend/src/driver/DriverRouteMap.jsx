import 'leaflet/dist/leaflet.css'
import { useMemo } from 'react'
import { MapContainer, TileLayer } from 'react-leaflet'
import StaticLayer from '../map/StaticLayer.jsx'
import { toMapLayers } from './driverLogic.js'

// Small static map of one route: stops as markers, a line in stop order.
// No live buses and no WebSocket.
export default function DriverRouteMap({ route }) {
  const { routes, stops } = useMemo(() => toMapLayers(route), [route])
  if (stops.length === 0) return null

  const bounds = stops.map((s) => [s.lat, s.lng])

  return (
    <MapContainer className="driver-map" bounds={bounds} boundsOptions={{ padding: [24, 24], maxZoom: 17 }}>
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        maxZoom={19}
      />
      <StaticLayer routes={routes} stops={stops} selectedStopId={null} />
    </MapContainer>
  )
}
