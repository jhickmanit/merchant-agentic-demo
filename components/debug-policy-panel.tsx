"use client";

import { useState } from "react";

interface Check {
  namespace: string;
  object: string;
  relation: string;
  subject: string;
  allowed: boolean;
  durationMs: number;
}

export function DebugPolicyPanel({ checks }: { checks: Check[] }) {
  const [open, setOpen] = useState(false);
  if (checks.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-40">
      <button
        onClick={() => setOpen(!open)}
        className="rounded-full bg-foreground/90 text-background px-3 py-1.5 text-xs font-mono shadow"
      >
        {open ? "▼" : "▲"} {checks.length} Keto check{checks.length === 1 ? "" : "s"}
      </button>
      {open && (
        <div className="mt-2 max-w-md rounded-lg border bg-background p-3 shadow-lg space-y-2 text-xs font-mono">
          {checks.map((c, i) => (
            <div
              key={i}
              className={`rounded p-2 ${c.allowed ? "bg-emerald-50 dark:bg-emerald-950/30" : "bg-rose-50 dark:bg-rose-950/30"}`}
            >
              <div className="text-muted-foreground">{c.durationMs}ms</div>
              <div>
                <span className="font-semibold">{c.allowed ? "✓ ALLOW" : "✗ DENY"}</span>{" "}
                {c.namespace}:{c.object}#{c.relation}@{c.subject}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
