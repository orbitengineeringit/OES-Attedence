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
        <div className="mx-auto my-12 max-w-2xl rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-rose-100 bg-rose-50 text-rose-600">
            <ShieldAlert className="h-6 w-6" />
          </div>

          <h3 className="text-base font-semibold text-slate-900">Something went wrong</h3>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-500">
            The interface hit an unexpected render error. You can retry the view or return to the dashboard.
          </p>

          <div className="mt-5 max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-4 text-left text-xs text-rose-700">
            <p className="mb-2 border-b border-slate-200 pb-2 font-medium text-slate-600">Error details</p>
            <pre className="whitespace-pre-wrap text-[11px] leading-relaxed">
              {this.state.error?.stack || this.state.error?.toString() || 'Unknown runtime exception'}
            </pre>
          </div>

          <div className="mt-5 flex flex-col justify-center gap-3 sm:flex-row">
            <button 
              onClick={this.handleReset} 
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 transition-colors cursor-pointer min-h-[40px]"
            >
              <RefreshCw className="h-4 w-4" />
              Retry
            </button>
            <button 
              onClick={() => { window.location.href = '/dashboard'; }} 
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer min-h-[40px]"
            >
              <Home className="h-4 w-4" />
              Return to dashboard
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
