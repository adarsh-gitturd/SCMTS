import { memo } from 'react'
import { stopName } from './adminLogic.js'
import RouteForm from './RouteForm.jsx'

// One route in the list. mode: 'view' | 'edit' | 'confirm'.
// locked = a form is open somewhere; canEdit = stop names are loaded (the form needs them).
// Memoized: typing in a form does not re-render the other rows.
function RouteRow({
  route,
  stops,
  stopsById,
  mode,
  locked,
  canEdit,
  busy,
  onEdit,
  onAskDelete,
  onCancel,
  onSave,
  onConfirmDelete,
}) {
  if (mode === 'edit') {
    return (
      <li className="admin-row admin-row--open">
        <RouteForm
          heading={`Edit '${route.name}'`}
          initialName={route.name}
          initialStopIds={route.stopIds}
          stops={stops}
          stopsById={stopsById}
          submitLabel="Save changes"
          busy={busy}
          onSubmit={(body) => onSave(route.id, body)}
          onCancel={() => onCancel(`edit-${route.id}`)}
        />
      </li>
    )
  }

  const count = route.stopIds.length

  return (
    <li className="admin-row">
      <div className="admin-row__main">
        <span className="admin-row__title">{route.name}</span>
        <span className="admin-row__meta">{count === 1 ? '1 stop' : `${count} stops`}</span>
        {count > 0 && (
          <ol className="admin-route-stops">
            {route.stopIds.map((id, i) => (
              <li key={`${i}:${id}`}>{stopName(stopsById, id)}</li>
            ))}
          </ol>
        )}
      </div>
      {mode === 'confirm' ? (
        <div className="admin-confirm">
          <p>
            Delete route &apos;{route.name}&apos;? This cannot be undone. Its stop list is removed and past trips lose
            the link to it.
          </p>
          <div className="admin-actions">
            <button
              type="button"
              className="button--danger"
              disabled={busy}
              onClick={() => onConfirmDelete(route.id, route.name)}
            >
              {busy ? 'Deleting…' : 'Yes, delete'}
            </button>
            <button
              type="button"
              className="button--secondary"
              data-focus={`cancel-${route.id}`}
              disabled={busy}
              onClick={() => onCancel(`delete-${route.id}`)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="admin-actions">
          <button
            type="button"
            className="button--secondary"
            data-focus={`edit-${route.id}`}
            aria-label={`Edit ${route.name}`}
            disabled={locked || busy || !canEdit}
            onClick={() => onEdit(route.id)}
          >
            Edit
          </button>
          <button
            type="button"
            className="button--danger-outline"
            data-focus={`delete-${route.id}`}
            aria-label={`Delete ${route.name}`}
            disabled={locked || busy}
            onClick={() => onAskDelete(route.id)}
          >
            Delete
          </button>
        </div>
      )}
    </li>
  )
}

export default memo(RouteRow)
