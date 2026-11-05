import { studio, useStudio } from '../../state/instance';
import { issueBanner } from '../../state/display';

export function Banners() {
  const issue = useStudio((s) => s.aiIssue);
  const notice = useStudio((s) => s.notice);
  const error = useStudio((s) => s.error);
  const canRetry = useStudio((s) => s.canRetry);
  const busy = useStudio((s) => s.busy);
  const { dismissIssue, dismissNotice, retryLast, dismissError } = studio.getState();
  return (
    <div className="banners">
      {issue && (
        <div className="banner banner-info" role="status" data-testid="ai-issue" data-kind={issueBanner(issue).kind}>
          <span>
            <strong>{issueBanner(issue).title}</strong> <span className="small">{issueBanner(issue).detail}</span>
          </span>
          <button type="button" className="link" onClick={dismissIssue} aria-label="Dismiss agent notice">
            Dismiss
          </button>
        </div>
      )}
      {notice && (
        <div className="banner banner-warn" role="alert">
          <span>{notice}</span>
          <button type="button" className="link" onClick={dismissNotice} aria-label="Dismiss notice">
            Dismiss
          </button>
        </div>
      )}
      {error && (
        <div className="banner banner-error" role="alert" data-testid="error-banner">
          <span>{error}</span>
          <span className="row">
            {canRetry && (
              <button type="button" onClick={() => void retryLast()} disabled={busy !== null} data-testid="error-retry">
                Retry
              </button>
            )}
            <button type="button" className="link" onClick={dismissError} aria-label="Dismiss error">
              Dismiss
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
