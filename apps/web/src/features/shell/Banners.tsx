import { studio, useStudio } from '../../state/instance';
import { issueBanner } from '../../state/display';

export function Banners() {
  const issue = useStudio((s) => s.aiIssue);
  const notice = useStudio((s) => s.notice);
  const error = useStudio((s) => s.error);
  const { dismissIssue, dismissNotice } = studio.getState();
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
        <div className="banner banner-error" role="alert">
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
