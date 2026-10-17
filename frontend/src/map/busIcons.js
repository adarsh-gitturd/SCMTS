import L from 'leaflet'

// divIcon instead of Leaflet's default PNG marker (its image URLs break under Vite).
// Each status has its own colour (CSS) AND glyph, so it does not rely on colour alone.
// The html comes only from this constant table, never from server data.
export const STATUS_INFO = {
  on_route: { label: 'On route', glyph: '▶' },
  delayed: { label: 'Delayed', glyph: '!' },
  break: { label: 'On break', glyph: '‖' },
  out_of_service: { label: 'Out of service', glyph: '✕' },
  unknown: { label: 'Unknown', glyph: '?' },
}

const cache = new Map()

// Cached so a marker only gets a new icon when its status, staleness or highlight changes.
export function busIcon(status, stale, highlight = false) {
  const key = `${status}|${stale}|${highlight}`
  let icon = cache.get(key)
  if (!icon) {
    const info = STATUS_INFO[status] ?? STATUS_INFO.unknown
    icon = L.divIcon({
      className: `bus-icon bus-icon--${status}${stale ? ' bus-icon--stale' : ''}${highlight ? ' bus-icon--top' : ''}`,
      html: `<span aria-hidden="true">${info.glyph}</span>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
      popupAnchor: [0, -14],
    })
    cache.set(key, icon)
  }
  return icon
}
