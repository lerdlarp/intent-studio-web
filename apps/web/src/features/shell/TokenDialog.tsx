// "Access token" dialog: the server asked for its bearer token (API_TOKEN). Registered as the authFetch prompt; the
// request that got the 401 is retried with the token entered here (a refused token asks again).
import { useEffect, useState, type FormEvent } from 'react';
import { authFetch, type PromptOptions } from '../../api/auth';
import { Dialog } from './Dialog';

interface Ask {
  opts: PromptOptions;
  resolve: (token: string | null) => void;
}

export function TokenDialog() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [value, setValue] = useState('');

  useEffect(() => {
    authFetch.setPrompt((opts) => new Promise<string | null>((resolve) => setAsk({ opts, resolve })));
    return () => authFetch.setPrompt(null);
  }, []);

  if (!ask) return null;
  const finish = (token: string | null) => {
    ask.resolve(token);
    setAsk(null);
    setValue('');
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (value.trim()) finish(value.trim());
  };

  return (
    <Dialog title="Access token" onClose={() => finish(null)} testId="token-dialog">
      <form className="token-form" onSubmit={submit}>
        {ask.opts.rejected ? (
          <p role="alert" className="field-error-text">
            That token was not accepted. Check it and try again.
          </p>
        ) : (
          <p className="muted">This server needs an access token. Ask whoever runs it for the token.</p>
        )}
        <label className="field">
          <span>Token</span>
          <input
            type="password"
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            data-testid="token-input"
          />
        </label>
        <p className="muted small">It is kept in this browser only.</p>
        <div className="row end">
          <button type="button" onClick={() => finish(null)}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!value.trim()}>
            Continue
          </button>
        </div>
      </form>
    </Dialog>
  );
}
