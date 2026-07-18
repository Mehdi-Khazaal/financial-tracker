import React from 'react';

interface AppErrorBoundaryProps {
  children: React.ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
  recoveryKey: number;
}

export class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false, recoveryKey: 0 };

  static getDerivedStateFromError(): Partial<AppErrorBoundaryState> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Uncaught application error', error, info.componentStack);
  }

  private retry = () => {
    this.setState(previous => ({ hasError: false, recoveryKey: previous.recoveryKey + 1 }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <main className="app-error-boundary" role="alert">
          <div>
            <span>Fintrack recovery</span>
            <h1>Something went wrong.</h1>
            <p>Your saved financial data was not changed. Try the screen again or reload the app for a clean start.</p>
            <div className="app-error-actions">
              <button type="button" className="btn-gradient pressable" onClick={this.retry}>Try again</button>
              <button type="button" className="btn-ghost pressable" onClick={() => window.location.reload()}>Reload app</button>
            </div>
          </div>
        </main>
      );
    }

    return <React.Fragment key={this.state.recoveryKey}>{this.props.children}</React.Fragment>;
  }
}