import { useEffect, useState } from 'react'
import { api } from '../api/client.js'
import { busRouteMap } from './advisorLogic.js'

const EMPTY = new Map()

// bus_id -> route_id from GET /buses, loaded once (the WS frames carry no route).
// Only the ids are kept. On error the map stays empty and the list says "Route unknown".
export function useBusRoutes(enabled) {
  const [busRoutes, setBusRoutes] = useState(EMPTY)

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    api
      .get('/buses')
      .then((list) => {
        if (!cancelled) setBusRoutes(busRouteMap(list))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [enabled])

  return busRoutes
}
