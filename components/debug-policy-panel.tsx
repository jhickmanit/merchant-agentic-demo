"use client";

import { useState } from "react";

interface KetoCheck {
  namespace: string;
  object: string;
  relation: string;
  subject: string;
  allowed: boolean;
  durationMs: number;
}

type PolicyEvent =
  | { kind: "keto_check"; data: KetoCheck }
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
        authorizationDetails?: number;
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

const KIND_LABEL: Record<PolicyEvent["kind"], string> = {
  keto_check: "Keto",
  kya_verify: "Skyfire KYA",
  hydra_introspect: "Hydra introspect",
  auto_provision: "Auto-provision",
  hydra_bootstrap: "Hydra bootstrap",
};

const KIND_COLOR: Record<PolicyEvent["kind"], string> = {
  keto_check: "bg-emerald-50 dark:bg-emerald-950/30",
  kya_verify: "bg-sky-50 dark:bg-sky-950/30",
  hydra_introspect: "bg-violet-50 dark:bg-violet-950/30",
  auto_provision: "bg-amber-50 dark:bg-amber-950/30",
  hydra_bootstrap: "bg-fuchsia-50 dark:bg-fuchsia-950/30",
};

function eventOk(event: PolicyEvent): boolean {
  switch (event.kind) {
    case "keto_check":
      return event.data.allowed;
    case "kya_verify":
    case "hydra_introspect":
    case "hydra_bootstrap":
      return event.data.ok;
    case "auto_provision":
      return true; // auto-provision always succeeds or throws upstream
  }
}

function renderDetail(event: PolicyEvent): string {
  switch (event.kind) {
    case "keto_check":
      return `${event.data.namespace}:${event.data.object}#${event.data.relation}@${event.data.subject}`;
    case "kya_verify":
      return event.data.ok
        ? `agent=${event.data.agentId?.slice(0, 8)}… email=${event.data.userEmail} jti=${event.data.jti?.slice(0, 8)}…`
        : `error=${event.data.errorCode}`;
    case "hydra_introspect":
      return event.data.ok
        ? `sub=${event.data.sub?.slice(0, 8)}… act.sub=${event.data.actSub?.slice(0, 8)}… auth_details=${event.data.authorizationDetails}`
        : `error=${event.data.errorCode}`;
    case "auto_provision":
      return `owner=${event.data.createdOwner ? "created" : "existing"} agent=${event.data.createdAgent ? "created" : "existing"} (${event.data.ownerEmail})`;
    case "hydra_bootstrap":
      return event.data.cacheHit
        ? "cache hit (no Hydra round-trip)"
        : event.data.ok
          ? `client=${event.data.bridgeClientId?.slice(0, 12)}…`
          : `error=${event.data.errorCode}`;
  }
}

interface Props {
  /** Live Keto checks recorded during this page's render. */
  checks?: KetoCheck[];
  /** Policy events persisted at checkout time. */
  events?: PolicyEvent[];
}

export function DebugPolicyPanel({ checks = [], events = [] }: Props) {
  const [open, setOpen] = useState(false);

  // Render-time keto checks get hoisted into the same event vocabulary so the
  // panel shows one unified timeline.
  const allEvents: PolicyEvent[] = [
    ...events,
    ...checks.map((c): PolicyEvent => ({ kind: "keto_check", data: c })),
  ];
  if (allEvents.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40">
      <button
        onClick={() => setOpen(!open)}
        className="rounded-full bg-foreground/90 text-background px-3 py-1.5 text-xs font-mono shadow"
      >
        {open ? "▼" : "▲"} {allEvents.length} policy event
        {allEvents.length === 1 ? "" : "s"}
      </button>
      {open && (
        <div className="mt-2 max-w-md rounded-lg border bg-background p-3 shadow-lg space-y-2 text-xs font-mono">
          {allEvents.map((e, i) => (
            <div key={i} className={`rounded p-2 ${KIND_COLOR[e.kind]}`}>
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="font-semibold">{KIND_LABEL[e.kind]}</span>
                <span>{e.data.durationMs}ms</span>
              </div>
              <div>
                <span className="font-semibold">{eventOk(e) ? "✓" : "✗"}</span>{" "}
                <span className="break-all">{renderDetail(e)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
