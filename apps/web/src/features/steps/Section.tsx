// One labelled part of a step panel: an optional step number, an upper-case title, a short hint on the right, then its
// controls. Every step uses it so target, luminaire, count (and the like) never run together.
import type { ReactNode } from 'react';

export function StepSection({
  id,
  n,
  title,
  hint,
  children,
  testId,
  className,
}: {
  id: string;
  n?: number;
  title: string;
  hint?: ReactNode;
  children: ReactNode;
  testId?: string;
  className?: string;
}) {
  return (
    <section
      className={`step-sec${className ? ` ${className}` : ''}`}
      aria-labelledby={`sec-${id}`}
      data-testid={testId}
    >
      <div className="step-sec-head">
        {n !== undefined && (
          <span className="step-sec-n" aria-hidden="true">
            {n}
          </span>
        )}
        <h4 id={`sec-${id}`}>{title}</h4>
        {hint && <span className="step-sec-hint">{hint}</span>}
      </div>
      {children}
    </section>
  );
}
