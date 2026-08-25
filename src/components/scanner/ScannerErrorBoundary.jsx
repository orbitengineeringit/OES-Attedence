import React from 'react';

/**
 * ScannerErrorBoundary
 * A lightweight, non-page-reloading error boundary for scanner sub-components.
 * On error, renders a compact inline fallback instead of the full-page ErrorBoundary.
 * Accepts an optional `fallback` prop for a custom fallback element.
 */
export default class ScannerErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('[SCANNER SUB-COMPONENT ERROR]:', error, info?.componentStack);
  }

  render() {
    if (this.state.hasError) {
      // Use custom fallback if provided, otherwise render nothing (don't crash the scanner)
      if (this.props.fallback) {
        return this.props.fallback;
      }
      // Silent fallback: render nothing so the rest of the scanner keeps working
      return null;
    }
    return this.props.children;
  }
}
