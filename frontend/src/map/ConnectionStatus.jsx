import { useEffect, useState } from 'react'

// Small live-feed badge. The countdown ticks here only, not in the page.
export default function ConnectionStatus({ conn }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (conn.kind !== 'reconnecting') return undefined
    // 250ms so the seconds shown are never more than a quarter second behind.
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [conn])

  let text
  switch (conn.kind) {
    case 'live':
      text = 'Live'
      break
    case 'reconnecting':
      text = `Reconnecting in ${Math.max(0, Math.ceil((conn.retryAt - now) / 1000))}s`
      break
    case 'forbidden':
      text = 'Not available'
      break
    default:
      text = 'Connecting...'
  }

  return (
    <div className={`conn conn--${conn.kind}`} role="status" aria-live="polite">
      <span className="conn__dot" aria-hidden="true" />
      {text}
    </div>
  )
}
