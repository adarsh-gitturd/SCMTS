// Pure helpers for the driver passenger count form (POST /driver/passengers).
// No React, no fetch. Check: node src/driver/passengerLogic.check.js

const MAX_COUNT = 200 // server rejects above this

// Exact error strings from docs/API.md. Only compared, never shown.
const SERVER_NOT_ON_ROUTE = 'stop is not on your route'
const SERVER_NO_BUS = 'no bus assigned'
const SERVER_STOP_NOT_FOUND = 'stop not found'

const GENERIC_MESSAGE = 'Something went wrong. Please try again.'

export const UNCLEAR_SAVE_MESSAGE =
  "The count may have been saved, but the server's reply was unclear. Check before logging again."

// Input text -> integer 0..200, or null. Digits only: no sign, decimal point,
// exponent or spaces (" 5 " is rejected, not trimmed). Leading zeros are fine ("018" -> 18).
export function parseCount(text) {
  if (typeof text !== 'string' || !/^\d+$/.test(text)) return null
  const n = Number(text)
  return n <= MAX_COUNT ? n : null
}

// Body exactly as docs/API.md: { count, stop_id }, both integers. null when either is invalid.
export function buildPassengerBody(stopId, count) {
  if (!Number.isInteger(stopId) || stopId <= 0) return null
  if (!Number.isInteger(count) || count < 0 || count > MAX_COUNT) return null
  return { count, stop_id: stopId }
}

// Own wording per status; never server text. serverMessage (ApiError.message) is only
// compared with the documented strings to tell the 400 and 404 variants apart.
// 401 -> null (logout flow takes over).
export function passengerErrorMessage(status, serverMessage) {
  switch (status) {
    case 401:
      return null
    case 0:
      return 'Cannot reach the server. Check your connection and try again.'
    case 400:
      return serverMessage === SERVER_NOT_ON_ROUTE
        ? 'That stop is not on your route.'
        : 'That count or stop was not accepted. Check the values.'
    case 403:
      return 'This page is for drivers only.'
    case 404:
      if (serverMessage === SERVER_STOP_NOT_FOUND) return 'That stop no longer exists. Reload the page.'
      if (serverMessage === SERVER_NO_BUS) return 'No bus is assigned to you. Ask an admin.'
      return GENERIC_MESSAGE
    case 409:
      return 'Your bus has no route assigned. Ask an admin.'
    case 429:
      return 'Please wait a second before logging again.'
    default:
      return GENERIC_MESSAGE
  }
}

// "Logged 1 passenger at X" / "Logged 18 passengers at X" (0 is plural too).
export function successMessage(count, stopName) {
  return `Logged ${count} ${count === 1 ? 'passenger' : 'passengers'} at ${stopName}`
}

// Checks the 201 body { id }. Returns the id or null.
export function parseCreated(data) {
  return data && Number.isInteger(data.id) && data.id > 0 ? data.id : null
}
