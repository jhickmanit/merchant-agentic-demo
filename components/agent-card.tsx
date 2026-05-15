"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { revokeAgentAction } from "@/app/me/agents/actions";
import { formatCents } from "@/lib/format";

interface Props {
  id: string;
  displayName: string;
  agentType: string;
  spendCapCents: number | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  hydraClientId: string;
}

export function AgentCard(props: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isRevoked = !!props.revokedAt;

  return (
    <div className="rounded-lg border p-4 space-y-2">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-lg font-medium">{props.displayName}</div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {props.agentType}
          </div>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${
            isRevoked
              ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
              : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
          }`}
        >
          {isRevoked ? "Revoked" : "Active"}
        </span>
      </div>
      <div className="text-sm text-muted-foreground space-y-1">
        {props.spendCapCents != null && (
          <div>
            Spend cap:{" "}
            <span className="font-medium text-foreground">
              {formatCents(props.spendCapCents)}
            </span>
          </div>
        )}
        {props.expiresAt && (
          <div>
            Expires:{" "}
            <span className="font-medium text-foreground">
              {props.expiresAt.toLocaleDateString()}
            </span>
          </div>
        )}
        <div className="font-mono text-xs">
          OAuth2 client: {props.hydraClientId.slice(0, 12)}…
        </div>
      </div>
      {!isRevoked && (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await revokeAgentAction(props.id);
              router.refresh();
            })
          }
        >
          {pending ? "Revoking…" : "Revoke"}
        </Button>
      )}
    </div>
  );
}
