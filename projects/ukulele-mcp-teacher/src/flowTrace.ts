export type FlowTraceEntry = {
  id: number;
  at: string;
  elapsedMs: number;
  scope: string;
  event: string;
  details?: Record<string, unknown>;
};

declare global {
  interface Window {
    __ukuleleFlowTrace?: FlowTraceEntry[];
    __ukuleleFlowTraceStartedAt?: number;
  }
}

let nextTraceId = 1;
const maxEntries = 400;

export function isFlowDebugEnabled() {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.has('debug') || window.localStorage.getItem('ukulele-flow-debug') === '1';
}

export function traceFlow(scope: string, event: string, details?: Record<string, unknown>) {
  if (!isFlowDebugEnabled()) return null;

  window.__ukuleleFlowTraceStartedAt ??= performance.now();
  const entry: FlowTraceEntry = {
    id: nextTraceId,
    at: new Date().toLocaleTimeString(),
    elapsedMs: Math.round(performance.now() - window.__ukuleleFlowTraceStartedAt),
    scope,
    event,
    details,
  };
  nextTraceId += 1;

  window.__ukuleleFlowTrace = [...(window.__ukuleleFlowTrace ?? []), entry].slice(-maxEntries);
  console.info('[ukulele-flow]', entry);
  window.dispatchEvent(new CustomEvent<FlowTraceEntry>('ukulele-flow-trace', { detail: entry }));
  return entry;
}
