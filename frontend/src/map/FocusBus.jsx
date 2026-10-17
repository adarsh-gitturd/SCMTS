import { useEffect } from 'react'
import { useMap } from 'react-leaflet'

const MIN_ZOOM = 16

// Pans to a bus and opens its popup when focus changes ({ busId, n }; n makes a
// repeat click on the same bus count). markers = Map bus_id -> Leaflet marker.
export default function FocusBus({ focus, markers }) {
  const map = useMap()

  useEffect(() => {
    if (!focus) return undefined
    const marker = markers.current.get(focus.busId)
    if (!marker) return undefined
    const open = () => marker.openPopup()
    map.once('moveend', open)
    map.setView(marker.getLatLng(), Math.max(map.getZoom(), MIN_ZOOM), { animate: true })
    return () => {
      map.off('moveend', open)
    }
  }, [focus, map, markers])

  return null
}
