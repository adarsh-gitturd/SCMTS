import { memo } from 'react'
import { formatHour, shadeLevel } from './analyticsLogic.js'

// Trips per weekday (rows, Mon..Sun) and start hour (columns). Every cell shows its
// count as text ("0" when empty); the shading class is only an extra cue. The table
// scrolls sideways inside its own focusable region, never the page.
// Memoized on the heatmap object, which the page memoizes on the response.
function AnalyticsHeatmap({ heatmap }) {
  const { hours, rows, max } = heatmap
  return (
    <div className="heatmap-scroll" role="region" aria-labelledby="heatmap-caption" tabIndex={0}>
      <table className="heatmap">
        <caption id="heatmap-caption">Trips by weekday and start hour</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            {hours.map((h) => (
              <th scope="col" key={h}>
                {formatHour(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.weekday}>
              <th scope="row">
                <span aria-hidden="true">{row.short}</span>
                <span className="visually-hidden">{row.long}</span>
              </th>
              {row.counts.map((n, i) => (
                <td key={hours[i]} className={`heatmap__cell heatmap__cell--${shadeLevel(n, max)}`}>
                  {n}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default memo(AnalyticsHeatmap)
