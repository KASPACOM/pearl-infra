import { Component, type ErrorInfo, type ReactNode } from 'react';

export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error?: Error }
> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Oysters Market render failure', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <section className="om-panel" role="alert">
          <span className="om-kicker">Render error</span>
          <h1>Oysters Market could not render this screen.</h1>
          <p>{this.state.error.message}</p>
        </section>
      );
    }

    return this.props.children;
  }
}
