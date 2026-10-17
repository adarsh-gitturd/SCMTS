const TIMEOUT_MS = 8000 // browser timeout, starts after permission is granted
const GUARD_MS = 20_000 // our own limit, also covers an unanswered permission prompt
const MAX_AGE_MS = 60_000

// One position fix -> { lat, lng }. Rejects with an Error whose .reason is
// 'denied' | 'unavailable' | 'timeout' | 'unsupported'. Nothing is logged or stored.
export function getPosition() {
  return new Promise((resolve, reject) => {
    const fail = (reason) => {
      const err = new Error(`location ${reason}`)
      err.reason = reason
      reject(err)
    }
    if (!window.isSecureContext || !('geolocation' in navigator)) {
      fail('unsupported')
      return
    }
    const guard = setTimeout(() => fail('timeout'), GUARD_MS)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(guard)
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude })
      },
      (err) => {
        clearTimeout(guard)
        if (err.code === err.PERMISSION_DENIED) fail('denied')
        else if (err.code === err.TIMEOUT) fail('timeout')
        else fail('unavailable')
      },
      { enableHighAccuracy: false, timeout: TIMEOUT_MS, maximumAge: MAX_AGE_MS },
    )
  })
}
