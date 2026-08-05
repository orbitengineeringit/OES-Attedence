import React from 'react';
import { ShieldAlert, RefreshCw, Home } from 'lucide-react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[RENDER ERROR]:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    } else {
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="glass-panel-heavy mx-auto my-12 max-w-2xl rounded-xl p-8 text-center">
          <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-xl border border-rose-100 bg-rose-50 text-rose-600">
            <ShieldAlert className="h-7 w-7" />
          </div>

          <h3 className="text-lg font-semibold text-slate-900">Something went wrong</h3>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500">
            The interface hit an unexpected render error. You can retry the view or return to the dashboard.
          </p>

          <div className="mt-6 max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-4 text-left text-xs text-rose-700">
            <p className="mb-2 border-b border-slate-200 pb-2 font-semibold text-slate-500">Error details</p>
            <pre className="whitespace-pre-wrap text-[11px] leading-relaxed">
              {this.state.error?.stack || this.state.error?.toString() || 'Unknown runtime exception'}
            </pre>
          </div>

          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
            <button onClick={this.handleReset} className="ui-button border border-rose-100 bg-rose-50 text-rose-700 hover:bg-rose-100">
              <RefreshCw className="h-4 w-4" />
              Retry
            </button>
            <button onClick={() => { window.location.href = '/dashboard'; }} className="ui-button ui-button-secondary">
              <Home className="h-4 w-4" />
              Return home
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
