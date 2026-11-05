// Small labelled inputs for the inspector. Text-like fields keep a local draft and commit on Enter or blur (Escape
// reverts); the parent passes the display-unit text and gets the typed text back. A field whose commit is rejected
// shows the message next to it until the next edit.
import { useEffect, useId, useState, type ReactNode } from 'react';

export interface TextFieldProps {
  label: string;
  /** The committed value as display text. */
  value: string;
  /** Commit the typed text; return an error message to reject it, or null when it was taken. */
  onCommit: (text: string) => string | null;
  placeholder?: string;
  suffix?: ReactNode;
  testId?: string;
  maxLength?: number;
  inputMode?: 'decimal' | 'numeric' | 'text';
  className?: string;
  hint?: ReactNode;
}

export function TextField({ label, value, onCommit, placeholder, suffix, testId, maxLength, inputMode = 'decimal', className, hint }: TextFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(null);
    setError(null);
  }, [value]);
  const commit = () => {
    if (draft === null || draft.trim() === value.trim()) {
      setDraft(null);
      return;
    }
    const err = onCommit(draft);
    setError(err);
    if (err === null) setDraft(null);
  };
  return (
    <div className={`field-row${className ? ` ${className}` : ''}`}>
      <label htmlFor={id}>{label}</label>
      <span className="field-control">
        <input
          id={id}
          data-testid={testId}
          value={draft ?? value}
          placeholder={placeholder}
          maxLength={maxLength}
          inputMode={inputMode}
          aria-invalid={error !== null}
          aria-describedby={error ? `${id}-err` : undefined}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setDraft(null);
              setError(null);
            }
          }}
        />
        {suffix && <span className="muted small suffix">{suffix}</span>}
      </span>
      {error && (
        <span className="field-error small" id={`${id}-err`} role="alert">
          {error}
        </span>
      )}
      {hint && <span className="field-hint muted small">{hint}</span>}
    </div>
  );
}

export interface SelectFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  testId?: string;
  hint?: ReactNode;
}

export function SelectField({ label, value, onChange, children, testId, hint }: SelectFieldProps) {
  const id = useId();
  return (
    <div className="field-row">
      <label htmlFor={id}>{label}</label>
      <span className="field-control">
        <select id={id} data-testid={testId} value={value} onChange={(e) => onChange(e.target.value)}>
          {children}
        </select>
      </span>
      {hint && <span className="field-hint muted small">{hint}</span>}
    </div>
  );
}
