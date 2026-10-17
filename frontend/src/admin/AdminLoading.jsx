import { useEffect, useState } from 'react'

// Suspense fallback for admin pages. The live region is rendered empty at once and
// filled after 200 ms, so fast chunk loads show nothing (no flash).
export default function AdminLoading() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const id = setTimeout(() => setShow(true), 200)
    return () => clearTimeout(id)
  }, [])

  return (
    <div className="admin-page" aria-live="polite">
      {show && <p>Loading...</p>}
    </div>
  )
}
