"use client";

import { useState } from "react";
import { formatCents } from "@/lib/format";

interface KyaClaims {
  iss: string;
  aud: string;
  jti: string;
  iat: number;
  exp: number;
  ssi: string;
  amount: number;
  cur: string;
  hid: { email: string };
  aid: { id: string; name: string };
}

export function MandatePanel({
  claims,
  chargeId,
}: {
  claims: KyaClaims | null;
  chargeId: string | null;
}) {
  const [showRaw, setShowRaw] = useState(false);

  return (
    <section className="rounded-lg border-2 border-emerald-200 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
          Mandate (KYA Pay)
        </h2>
        {claims && (
          <button
            onClick={() => setShowRaw(!showRaw)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {showRaw ? "Show summary" : "Show raw claims"}
          </button>
        )}
      </div>

      {!claims ? (
        <div className="text-sm text-muted-foreground">
          Claims not persisted for this order (placed before Phase Polish).
          {chargeId && (
            <>
              {" "}Skyfire charge: <span className="font-mono text-xs">{chargeId}</span>
            </>
          )}
        </div>
      ) : showRaw ? (
        <pre className="overflow-x-auto rounded bg-background p-3 text-xs font-mono">
          {JSON.stringify(claims, null, 2)}
        </pre>
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Agent</dt>
          <dd className="font-medium">
            {claims.aid.name}{" "}
            <span className="font-mono text-xs text-muted-foreground">
              ({claims.aid.id.slice(0, 12)}…)
            </span>
          </dd>

          <dt className="text-muted-foreground">Authorized by</dt>
          <dd className="font-medium">{claims.hid.email}</dd>

          <dt className="text-muted-foreground">Amount</dt>
          <dd className="font-medium">
            {formatCents(claims.amount)} {claims.cur}
          </dd>

          <dt className="text-muted-foreground">Issued by</dt>
          <dd className="font-mono text-xs">{claims.iss}</dd>

          <dt className="text-muted-foreground">JWT id</dt>
          <dd className="font-mono text-xs">{claims.jti}</dd>

          <dt className="text-muted-foreground">Expires</dt>
          <dd className="text-xs">{new Date(claims.exp * 1000).toLocaleString()}</dd>

          {chargeId && (
            <>
              <dt className="text-muted-foreground">Skyfire charge</dt>
              <dd className="font-mono text-xs">{chargeId}</dd>
            </>
          )}
        </dl>
      )}
    </section>
  );
}
