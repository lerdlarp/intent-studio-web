// Inline tokens for sentence-style editors ("This is a [cafeteria] for [social dining]…"): a native select or a small
// text input styled as an underlined word, so the sentence reads as prose and every field stays a real form control.
import { useEffect, useState } from 'react';

export function TokenSelect<T extends string | number>({
  label,
  value,
  options,
  onChange,
  testId,
}: {
  label: string;
  value: T;
  options: readonly { value: T; text: string }[];
  onChange: (v: T) => void;
  testId?: string;
}) {
  const list = options.some((o) => o.value === value) ? options : [{ value, text: String(value) }, ...options];
  return (
    <span className="token">
      <select
        aria-label={label}
        value={String(value)}
        data-testid={testId}
        onChange={(e) => {
          const hit = list.find((o) => String(o.value) === e.target.value);
          if (hit) onChange(hit.value);
        }}
      >
        {list.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.text}
          </option>
        ))}
      </select>
    </span>
  );
}

/** A word-sized text input; commits on Enter or blur, Esc reverts. `onCommit` returns an error to keep the draft. */
export function TokenInput({
  label,
  value,
  onCommit,
  suffix,
  width,
  testId,
  inputMode = 'text',
}: {
  label: string;
  value: string;
  onCommit: (text: string) => string | null;
  suffix?: string;
  width?: number;
  testId?: string;
  inputMode?: 'text' | 'decimal';
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(null);
    setError(null);
  }, [value]);
  const commit = () => {
    if (draft === null || draft.trim() === value.trim()) {
      setDraft(null);
      setError(null);
      return;
    }
    const err = onCommit(draft);
    setError(err);
    if (!err) setDraft(null);
  };
  const shown = draft ?? value;
  return (
    <span className={`token token-input${error ? ' invalid' : ''}`}>
      <input
        aria-label={label}
        aria-invalid={error ? true : undefined}
        title={error ?? undefined}
        inputMode={inputMode}
        value={shown}
        data-testid={testId}
        style={{ width: `${Math.max(width ?? 3, shown.length + 1)}ch` }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            setDraft(null);
            setError(null);
          }
        }}
      />
      {suffix && <span className="token-suffix">{suffix}</span>}
      {error && (
        <span className="sr-only" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
