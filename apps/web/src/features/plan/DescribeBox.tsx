// Describe box: free text → new intents (server interpret, offline interpreter fallback).
import { useState, type FormEvent } from 'react';
import { studio, useStudio } from '../../state/instance';

export function DescribeBox() {
  const describing = useStudio((s) => s.describing);
  const [text, setText] = useState('');
  const [result, setResult] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || describing) return;
    const ids = await studio.getState().describe(t);
    if (ids.length > 0) {
      setText('');
      setResult(`Added ${ids.length} intent${ids.length === 1 ? '' : 's'}.`);
    } else setResult('');
  };

  return (
    <form className="describe" onSubmit={(e) => void submit(e)} role="search" aria-label="Describe lighting">
      <label className="grow">
        <span className="sr-only">Describe the lighting you want</span>
        <input
          value={text}
          maxLength={4000}
          onChange={(e) => setText(e.target.value)}
          placeholder="Describe it, e.g. “wash the east wall and accent the artwork”"
          aria-label="Describe the lighting you want"
        />
      </label>
      <button type="submit" disabled={!text.trim() || describing}>
        {describing ? 'Adding…' : 'Add'}
      </button>
      <span className="muted small" role="status" aria-live="polite">
        {result}
      </span>
    </form>
  );
}
