// What hosted /studio shows in place of Studio while signing in, or when it can't open (studioGate.ts), and
// a boundary so a crash shows a message instead of a blank page. No Studio API calls here.
import { Component, type ReactNode } from 'react';
import { inFrame, type GateMessage } from '@/lib/studioGate';

const PINK = '#D94D8F';

export function GatePanel({ message, detail }: { message: Pick<GateMessage, 'kind' | 'title' | 'body' | 'reload'>; detail?: string }) {
  const busy = message.kind === 'signing_in';
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0E0F12] px-4 text-[#ECEDEF]" style={{ fontSize: 16 }}>
      <div role={busy ? 'status' : 'alert'} className="w-full max-w-md rounded-xl border border-[#272B34] bg-[#16181D] p-6 text-center">
        <div className="mb-4 flex items-center justify-center gap-2">
          <img src="/ralph-world.png" alt="" className="h-8 w-8 object-contain" />
          <span className="text-lg font-bold tracking-tight" style={{ fontFamily: '"Space Grotesk", system-ui, sans-serif' }}>VOICES Studio</span>
        </div>
        <h1 className="text-xl font-semibold">{busy && <span className="mr-2 inline-block animate-pulse" style={{ color: PINK }}>●</span>}{message.title}</h1>
        {message.body && <p className="mt-2 text-base text-[#A3A8B1]">{message.body}</p>}
        {detail && <p className="mt-3 break-words font-mono text-xs text-[#646A75]">{detail}</p>}
        {message.reload && (
          <button className="mt-5 rounded-lg px-5 py-2 text-base font-semibold text-white" style={{ background: PINK }} onClick={() => window.location.reload()}>Reload</button>
        )}
      </div>
    </div>
  );
}

/** A render error anywhere in Studio shows this rather than unmounting to a blank page. */
export class StudioErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error('[studio] crashed:', error); }
  render() {
    if (!this.state.error) return this.props.children;
    const framed = inFrame();
    return <GatePanel detail={this.state.error.message} message={{
      kind: 'crashed', title: 'Studio hit a problem',
      body: framed ? 'Reload this browser tab (⌘R, or Ctrl+R). If it happens again, send Brook the line below.' : 'Reload the page. If it happens again, send Brook the line below.',
      reload: !framed,
    }} />;
  }
}
