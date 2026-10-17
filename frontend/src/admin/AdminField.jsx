// Labelled text input with optional hint and inline error, both linked by aria-describedby.
// The error starts with "Error:" so it is not shown by colour alone.
export default function AdminField({ id, label, hint, error, inputRef, ...input }) {
  const hintId = hint ? `${id}-hint` : null
  const errorId = error ? `${id}-error` : null
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className="admin-field">
      <label htmlFor={id}>{label}</label>
      {hint && (
        <p id={hintId} className="admin-field__hint">
          {hint}
        </p>
      )}
      <input
        id={id}
        ref={inputRef}
        type="text"
        autoComplete="off"
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy}
        {...input}
      />
      {error && (
        <p id={errorId} className="admin-field__error">
          Error: {error}
        </p>
      )}
    </div>
  )
}
