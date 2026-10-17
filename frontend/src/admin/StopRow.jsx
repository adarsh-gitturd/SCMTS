import { memo } from 'react'
import { formatCoord } from './adminLogic.js'
import StopForm from './StopForm.jsx'

// One stop in the list. mode: 'view' | 'edit' | 'confirm'.
// locked = a form is open somewhere, so Edit and Delete are disabled.
// Memoized: typing in a form does not re-render the other rows.
function StopRow({ stop, mode, locked, busy, onEdit, onAskDelete, onCancel, onSave, onConfirmDelete }) {
  if (mode === 'edit') {
    return (
      <li className="admin-row admin-row--open">
        <StopForm
          heading={`Edit '${stop.name}'`}
          initial={{ name: stop.name, lat: formatCoord(stop.lat), lng: formatCoord(stop.lng) }}
          submitLabel="Save changes"
          busy={busy}
          onSubmit={(body) => onSave(stop.id, body)}
          onCancel={() => onCancel(`edit-${stop.id}`)}
        />
      </li>
    )
  }

  return (
    <li className="admin-row">
      <div className="admin-row__main">
        <span className="admin-row__title">{stop.name}</span>
        <span className="admin-row__meta">
          Lat {formatCoord(stop.lat)}, Lng {formatCoord(stop.lng)}
        </span>
      </div>
      {mode === 'confirm' ? (
        <div className="admin-confirm">
          <p>
            Delete &apos;{stop.name}&apos;? This cannot be undone. Students&apos; saved places for this stop are
            removed too.
          </p>
          <div className="admin-actions">
            <button
              type="button"
              className="button--danger"
              disabled={busy}
              onClick={() => onConfirmDelete(stop.id, stop.name)}
            >
              {busy ? 'Deleting…' : 'Yes, delete'}
            </button>
            <button
              type="button"
              className="button--secondary"
              data-focus={`cancel-${stop.id}`}
              disabled={busy}
              onClick={() => onCancel(`delete-${stop.id}`)}
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
            data-focus={`edit-${stop.id}`}
            aria-label={`Edit ${stop.name}`}
            disabled={locked || busy}
            onClick={() => onEdit(stop.id)}
          >
            Edit
          </button>
          <button
            type="button"
            className="button--danger-outline"
            data-focus={`delete-${stop.id}`}
            aria-label={`Delete ${stop.name}`}
            disabled={locked || busy}
            onClick={() => onAskDelete(stop.id)}
          >
            Delete
          </button>
        </div>
      )}
    </li>
  )
}

export default memo(StopRow)
