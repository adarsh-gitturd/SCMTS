import { memo } from 'react'
import AnalyticsRouteCard from './AnalyticsRouteCard.jsx'

// Route cards in server order (trips desc). Memoized: routes keeps its identity until
// a new response arrives, so typing in the date inputs does not re-render the cards.
function AnalyticsRouteList({ routes }) {
  if (routes.length === 0) return <p>No trips with a route in this range.</p>
  return (
    <ul className="fleet-cards">
      {routes.map((route) => (
        <AnalyticsRouteCard key={route.routeId} route={route} />
      ))}
    </ul>
  )
}

export default memo(AnalyticsRouteList)
