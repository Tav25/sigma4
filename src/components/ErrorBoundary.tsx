import React from 'react';

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: any) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return <div style={{ color: 'red', padding: 12 }}>{String(this.state.error?.message || this.state.error)}</div>;
    }
    return this.props.children;
  }
}
