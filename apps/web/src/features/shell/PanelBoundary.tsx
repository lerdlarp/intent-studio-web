// Error boundary for one panel (plan / 3D / inspector / ledger): a render error in a panel shows a short message with
// "Reload panel" (remounts it) instead of blanking the whole app. The design in the store is not touched.
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  name: string;
  children: ReactNode;
}
interface State {
  error: Error | null;
  generation: number;
}

export class PanelBoundary extends Component<Props, State> {
  override state: State = { error: null, generation: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.warn(`[${this.props.name}] panel error`, error, info.componentStack);
  }

  private reload = () => this.setState((s) => ({ error: null, generation: s.generation + 1 }));

  override render(): ReactNode {
    if (this.state.error)
      return (
        <div className="panel-error banner banner-error" role="alert" data-testid="panel-error">
          <span>
            The {this.props.name} panel stopped working ({this.state.error.message || 'unknown error'}). Your design is
            safe.
          </span>
          <button type="button" onClick={this.reload}>
            Reload panel
          </button>
        </div>
      );
    return <PanelGeneration key={this.state.generation}>{this.props.children}</PanelGeneration>;
  }
}

function PanelGeneration({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
