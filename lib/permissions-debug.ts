// Lightweight recorder for the demo Debug Policy Panel.
// Stores per-request policy events in an AsyncLocalStorage scope so the
// page (or the route handler persisting them to the order) can render them.
// Not a security feature — purely demo prop.

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Keto permission check — `permissions.check()` calls.
 * Shape preserved from the original implementation for backward compat;
 * existing render-time pages on /orders/<id> still see these via
 * getRecordedChecks().
 */
export interface RecordedCheck {
  namespace: string;
  object: string;
  relation: string;
  subject: string;
  allowed: boolean;
  durationMs: number;
}

/**
 * A wider vocabulary of policy events captured during checkout so the order
 * detail page can render exactly what the merchant did across Kratos
 * (auto-provision), Keto (permission), Hydra (introspect), and Skyfire (KYA
 * verify). Each event has a discriminated `kind`.
 */
export type PolicyEvent =
  | { kind: "keto_check"; data: RecordedCheck }
  | {
      kind: "kya_verify";
      data: {
        ok: boolean;
        agentId?: string;
        userEmail?: string;
        jti?: string;
        issuer?: string;
        errorCode?: string;
        durationMs: number;
      };
    }
  | {
      kind: "hydra_introspect";
      data: {
        ok: boolean;
        active?: boolean;
        sub?: string;
        actSub?: string;
        authorizationDetails?: number; // count
        errorCode?: string;
        durationMs: number;
      };
    }
  | {
      kind: "auto_provision";
      data: {
        createdOwner: boolean;
        createdAgent: boolean;
        ownerEmail: string;
        agentId: string;
        durationMs: number;
      };
    }
  | {
      kind: "hydra_bootstrap";
      data: {
        ok: boolean;
        cacheHit: boolean;
        bridgeClientId?: string;
        errorCode?: string;
        durationMs: number;
      };
    };

interface Scope {
  events: PolicyEvent[];
}

const store = new AsyncLocalStorage<Scope>();

export function recordPolicyEvent(event: PolicyEvent) {
  store.getStore()?.events.push(event);
}

/**
 * Backward-compat: existing callers in components/order pages call
 * recordCheck() with a Keto check; route it through the unified store.
 */
export function recordCheck(check: RecordedCheck) {
  recordPolicyEvent({ kind: "keto_check", data: check });
}

/**
 * Return ONLY Keto checks recorded in the current scope. Backward-compat
 * for existing render-time panel callers that only care about Keto.
 */
export function getRecordedChecks(): RecordedCheck[] {
  return (store.getStore()?.events ?? [])
    .filter((e): e is Extract<PolicyEvent, { kind: "keto_check" }> => e.kind === "keto_check")
    .map((e) => e.data);
}

export function getRecordedEvents(): PolicyEvent[] {
  return store.getStore()?.events ?? [];
}

export function withRecording<T>(fn: () => Promise<T>): Promise<T> {
  return store.run({ events: [] }, fn);
}
