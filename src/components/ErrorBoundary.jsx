import React from 'react';
import { AlertTriangle, RefreshCw, Home, Copy, Check } from 'lucide-react';

// Catches a render error so one broken component does not blank the whole
// app. React unmounts the entire tree on an uncaught error, which on a
// single-page app means a white screen and no way back — the person cannot
// even reach another page, because the router went with it.
//
// A class component because that is the only thing React lets catch errors.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, where: '', at: '', componentStack: '', open: false, copied: false };
  }

  static getDerivedStateFromError(error) {
    return { error, where: window.location.href, at: new Date().toISOString() };
  }

  componentDidCatch(error, info) {
    // Kept in the console rather than sent anywhere: there is no error
    // reporting service wired up, and inventing one silently would be worse.
    console.error('[ui] a component failed to render', error, info?.componentStack);
    this.setState({ componentStack: info?.componentStack || '' });
  }

  // What went wrong, in one block the person can screenshot or copy and send
  // us: the message, the page it happened on and the code's own trail. Shown
  // only when asked for, so the card stays friendly. A crash we cannot make
  // happen ourselves is otherwise a crash we cannot fix.
  details() {
    const { error, where, at, componentStack } = this.state;
    return [
      `Error: ${error?.message || String(error)}`,
      `Page: ${where}`,
      `Time: ${at}`,
      `Browser: ${navigator.userAgent}`,
      '',
      String(error?.stack || '').trim(),
      componentStack ? `\nComponents:${componentStack.replace(/\n\s*$/, '')}` : '',
    ].filter((line, i) => line || i === 4).join('\n');
  }

  copy = async () => {
    try {
      await navigator.clipboard.writeText(this.details());
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 1500);
    } catch { /* no clipboard (an old browser or an insecure page): a screenshot still works */ }
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid min-h-[60vh] place-items-center px-4">
        <div className="panel w-full min-w-0 max-w-md text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-brand-gold-bg text-brand-gold-ink">
            <AlertTriangle size={22} />
          </div>
          <h1 className="title mt-4 text-xl">This part of the page stopped working</h1>
          <p className="helper">Nothing you did caused it and nothing was lost. Reload to carry on; if it keeps happening, tell us what you were doing and we will fix it.</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button type="button" onClick={() => window.location.reload()} className="primary"><RefreshCw size={16} />Reload</button>
            <a href="/" className="secondary"><Home size={16} />Go home</a>
          </div>
          <button type="button" onClick={() => this.setState((s) => ({ open: !s.open }))} aria-expanded={this.state.open}
            className="mt-4 text-sm font-semibold text-brand-teal underline-offset-2 hover:underline">
            {this.state.open ? 'Hide details' : 'Show details'}
          </button>
          {this.state.open && <div className="mt-3 text-left">
            <p className="text-xs text-brand-muted">Send this to the Klal Connect team (a screenshot is fine) so we can see what went wrong.</p>
            <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-brand-tint p-3 text-xs text-brand-body">{this.details()}</pre>
            <button type="button" onClick={this.copy} className="secondary mt-2 py-1.5 text-xs">
              {this.state.copied ? <><Check size={14} />Copied</> : <><Copy size={14} />Copy details</>}
            </button>
          </div>}
        </div>
      </div>
    );
  }
}
