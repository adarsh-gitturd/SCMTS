import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AdminLayout from './AdminLayout.jsx'
import RouteForm from './RouteForm.jsx'
import RouteRow from './RouteRow.jsx'
import { useAdminRoutes } from './useAdminRoutes.js'

const NO_STOP_IDS = []

// One thing open at a time: null | { kind: 'add' } | { kind: 'edit', id } | { kind: 'confirm', id }.
// While a form is open, the other Add/Edit/Delete buttons are disabled so typed input is
// never lost. Forms need stop names, so Add/Edit stay disabled until stops have loaded.
export default function AdminRoutesPage() {
  const { routes, stops, retryRoutes, retryStops, busy, save, remove } = useAdminRoutes()
  const [active, setActive] = useState(null)
  const [notice, setNotice] = useState(null) // { kind: 'success' | 'error', text }
  const pageRef = useRef(null)
  const focusRef = useRef(null) // data-focus key to focus after the next render

  // Move focus after a form or confirm opens/closes; the target may only exist after the render.
  useEffect(() => {
    const key = focusRef.current
    if (!key) return
    focusRef.current = null
    const root = pageRef.current
    const el = root?.querySelector(`[data-focus="${key}"]`) ?? root?.querySelector('[data-focus="add"]')
    el?.focus()
  })

  const stopsById = useMemo(() => new Map(stops.items.map((s) => [s.id, s])), [stops.items])
  const stopsReady = stops.phase === 'ready'
  const list = routes.items
  // An edit/confirm for a route that is no longer in the list counts as closed.
  const current = active && (active.kind === 'add' || list.some((r) => r.id === active.id)) ? active : null
  const formOpen = current?.kind === 'add' || current?.kind === 'edit'

  const openAdd = useCallback(() => {
    setNotice(null)
    setActive({ kind: 'add' })
  }, [])

  const openEdit = useCallback((id) => {
    setNotice(null)
    setActive({ kind: 'edit', id })
  }, [])

  const askDelete = useCallback((id) => {
    setNotice(null)
    focusRef.current = `cancel-${id}`
    setActive({ kind: 'confirm', id })
  }, [])

  const cancel = useCallback((focusKey) => {
    focusRef.current = focusKey
    setActive(null)
  }, [])

  const cancelAdd = useCallback(() => cancel('add'), [cancel])

  // id null = add. A failed submit keeps the form open with the admin's input
  // (also for an unknown stop: stops are refetched and the stop shows as "no longer exists").
  const submit = useCallback(
    async (id, body) => {
      const result = await save(id, body)
      if (result.blocked) return
      if (result.ok) {
        setNotice({ kind: 'success', text: `Route '${body.name}' ${id === null ? 'added' : 'saved'}.` })
        focusRef.current = id === null ? 'add' : `edit-${id}`
        setActive(null)
        return
      }
      if (result.message) setNotice({ kind: 'error', text: result.message })
      if (result.gone) {
        focusRef.current = 'add'
        setActive(null)
      }
    },
    [save],
  )

  const submitAdd = useCallback((body) => submit(null, body), [submit])

  const confirmDelete = useCallback(
    async (id, name) => {
      const result = await remove(id)
      if (result.blocked) return
      if (result.ok) {
        setNotice({ kind: 'success', text: `Route '${name}' deleted.` })
        focusRef.current = 'add'
      } else {
        if (result.message) setNotice({ kind: 'error', text: result.message })
        focusRef.current = result.gone ? 'add' : `delete-${id}`
      }
      setActive(null)
    },
    [remove],
  )

  return (
    <AdminLayout title="Routes">
      <div className="admin-page" ref={pageRef}>
        <div className="admin-live" aria-live="polite">
          {routes.phase === 'error' && (
            <p className="admin-notice admin-notice--error">Error loading routes: {routes.error}</p>
          )}
          {stops.phase === 'error' && (
            <p className="admin-notice admin-notice--error">
              Error loading stops: {stops.error} Routes cannot be added or edited without stop names.
            </p>
          )}
          {notice && (
            <p className={`admin-notice admin-notice--${notice.kind}`}>
              {notice.kind === 'error' && 'Error: '}
              {notice.text}
            </p>
          )}
        </div>

        {(routes.phase === 'error' || stops.phase === 'error') && (
          <div className="admin-actions">
            {routes.phase === 'error' && (
              <button type="button" onClick={retryRoutes}>
                Retry loading routes
              </button>
            )}
            {stops.phase === 'error' && (
              <button type="button" onClick={retryStops}>
                Retry loading stops
              </button>
            )}
          </div>
        )}

        {routes.phase === 'loading' && <p>Loading routes…</p>}
        {routes.phase !== 'loading' && stops.phase === 'loading' && <p>Loading stop names…</p>}

        {routes.phase === 'ready' && (
          <>
            <section className="admin-section">
              <h2>Add a route</h2>
              {current?.kind === 'add' && stopsReady ? (
                <RouteForm
                  initialName=""
                  initialStopIds={NO_STOP_IDS}
                  stops={stops.items}
                  stopsById={stopsById}
                  submitLabel="Add route"
                  busy={busy}
                  onSubmit={submitAdd}
                  onCancel={cancelAdd}
                />
              ) : (
                <button type="button" data-focus="add" disabled={formOpen || busy || !stopsReady} onClick={openAdd}>
                  New route
                </button>
              )}
            </section>

            <section className="admin-section">
              <h2>All routes ({list.length})</h2>
              {list.length === 0 ? (
                <p>No routes yet.</p>
              ) : (
                <ul className="admin-list">
                  {list.map((route) => (
                    <RouteRow
                      key={route.id}
                      route={route}
                      stops={stops.items}
                      stopsById={stopsById}
                      mode={
                        current && current.kind !== 'add' && current.id === route.id && (current.kind !== 'edit' || stopsReady)
                          ? current.kind
                          : 'view'
                      }
                      locked={formOpen}
                      canEdit={stopsReady}
                      busy={busy}
                      onEdit={openEdit}
                      onAskDelete={askDelete}
                      onCancel={cancel}
                      onSave={submit}
                      onConfirmDelete={confirmDelete}
                    />
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </AdminLayout>
  )
}
