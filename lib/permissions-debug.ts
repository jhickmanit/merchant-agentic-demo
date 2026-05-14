// Lightweight recorder for the demo Debug Policy Panel.
// Stores per-request permission checks in an AsyncLocalStorage scope so the
// page can render them. Not a security feature — purely demo prop.

import { AsyncLocalStorage } from "node:async_hooks";

export interface RecordedCheck {
  namespace: string;
  object: string;
  relation: string;
  subject: string;
  allowed: boolean;
  durationMs: number;
}

const store = new AsyncLocalStorage<{ checks: RecordedCheck[] }>();

export function recordCheck(check: RecordedCheck) {
  const ctx = store.getStore();
  if (ctx) ctx.checks.push(check);
}

export function getRecordedChecks(): RecordedCheck[] {
  return store.getStore()?.checks ?? [];
}

export function withRecording<T>(fn: () => Promise<T>): Promise<T> {
  return store.run({ checks: [] }, fn);
}
