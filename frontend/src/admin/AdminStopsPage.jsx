import { useCallback, useEffect, useRef, useState } from 'react'
import AdminLayout from './AdminLayout.jsx'
import StopForm from './StopForm.jsx'
import StopRow from './StopRow.jsx'
import { useAdminStops } from './useAdminStops.js'

const EMPTY_STOP = { name: '', lat: '', lng: '' }

// One thing open at a time: null | { kind: 'add' } | { kind: 'edit', id } | { kind: 'confirm', id }.
// While a form is open, the other Add/Edit/Delete buttons are disabled so typed input is
// never lost. A delete confirm can move to another row (nothing typed there).
export default function AdminStopsPage() {
  const { state, busy, retry, save, remove } = useAdminStops()
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

  const { phase, stops } = state
  // An edit/confirm for a stop that is no longer in the list counts as closed.
  const current = active && (active.kind === 'add' || stops.some((s) => s.id === active.id)) ? active : null
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

  // id null = add. A failed submit keeps the form open with the admin's input.
  const submit = useCallback(
    async (id, body) => {
      const result = await save(id, body)
      if (result.blocked) return
      if (result.ok) {
        setNotice({ kind: 'success', text: `Stop '${body.name}' ${id === null ? 'added' : 'saved'}.` })
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
        setNotice({ kind: 'success', text: `Stop '${name}' deleted.` })
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
    <AdminLayout title="Stops">
      <div className="admin-page" ref={pageRef}>
        <div className="admin-live" aria-live="polite">
          {phase === 'error' && <p className="admin-notice admin-notice--error">Error: {state.error}</p>}
          {notice && (
            <p className={`admin-notice admin-notice--${notice.kind}`}>
              {notice.kind === 'error' && 'Error: '}
              {notice.text}
            </p>
          )}
        </div>

        {phase === 'loading' && <p>Loading stops…</p>}

        {phase === 'error' && (
          <button type="button" onClick={retry}>
            Retry
          </button>
        )}

        {phase === 'ready' && (
          <>
            <section className="admin-section">
              <h2>Add a stop</h2>
              {current?.kind === 'add' ? (
                <StopForm
                  initial={EMPTY_STOP}
                  submitLabel="Add stop"
                  busy={busy}
                  onSubmit={submitAdd}
                  onCancel={cancelAdd}
                />
              ) : (
                <button type="button" data-focus="add" disabled={formOpen || busy} onClick={openAdd}>
                  New stop
                </button>
              )}
            </section>

            <section className="admin-section">
              <h2>All stops ({stops.length})</h2>
              {stops.length === 0 ? (
                <p>No stops yet.</p>
              ) : (
                <ul className="admin-list">
                  {stops.map((stop) => (
                    <StopRow
                      key={stop.id}
                      stop={stop}
                      mode={current && current.kind !== 'add' && current.id === stop.id ? current.kind : 'view'}
                      locked={formOpen}
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
