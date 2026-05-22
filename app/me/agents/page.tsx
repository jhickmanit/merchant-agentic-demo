import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { getAuth } from "@/lib/auth";
import { buildSessionRequest } from "@/lib/auth/request";
import { listAgentsForUser } from "@/lib/agents";
import { Button } from "@/components/ui/button";
import { AgentCard } from "@/components/agent-card";

export default async function AgentsPage() {
  const { session } = getAuth();
  const current = await session.getCurrentSession(await buildSessionRequest());
  if (!current) redirect("/login?return_to=/me/agents");

  const agents = await listAgentsForUser(getDb(), current.user.id);
  return (
    <div className="mx-auto max-w-3xl px-6 py-10 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">My agents</h1>
        <Link href="/me/agents/new">
          <Button>Register agent</Button>
        </Link>
      </div>
      {agents.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          No agents yet. Register one to let it shop on your behalf.
        </div>
      ) : (
        <ul className="space-y-3">
          {agents.map((a) => (
            <li key={a.id}>
              <AgentCard
                id={a.id}
                displayName={a.displayName}
                agentType={a.agentType}
                spendCapCents={a.spendCapCents}
                expiresAt={a.expiresAt}
                revokedAt={a.revokedAt}
                hydraClientId={a.hydraClientId}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
