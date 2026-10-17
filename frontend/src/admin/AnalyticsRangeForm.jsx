// From/To date range. Controlled by the page; Enter or Apply submits once (the page
// ignores a submit while a load is running). Errors start with "Error:" and are
// linked to their input by aria-describedby.
export default function AnalyticsRangeForm({ values, errors, onChange, onApply, onReset, fromRef, toRef }) {
  return (
    <form className="admin-form analytics-form" onSubmit={onApply} noValidate>
      <p id="analytics-range-hint" className="admin-field__hint">
        Campus dates, both included. Leave both empty for the last 30 days.
      </p>
      <div className="analytics-form__fields">
        <DateField
          id="analytics-from"
          label="From"
          value={values.from}
          error={errors.from}
          inputRef={fromRef}
          onChange={(e) => onChange('from', e.target.value)}
        />
        <DateField
          id="analytics-to"
          label="To"
          value={values.to}
          error={errors.to}
          inputRef={toRef}
          onChange={(e) => onChange('to', e.target.value)}
        />
      </div>
      <div className="admin-actions">
        <button type="submit">Apply</button>
        <button type="button" className="button--secondary" onClick={onReset}>
          Reset to default
        </button>
      </div>
    </form>
  )
}

function DateField({ id, label, value, error, inputRef, onChange }) {
  const errorId = error ? `${id}-error` : null
  return (
    <div className="admin-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        ref={inputRef}
        type="date"
        value={value}
        onChange={onChange}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={['analytics-range-hint', errorId].filter(Boolean).join(' ')}
      />
      {error && (
        <p id={errorId} className="admin-field__error">
          Error: {error}
        </p>
      )}
    </div>
  )
}
