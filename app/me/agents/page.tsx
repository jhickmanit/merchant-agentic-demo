import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";

async function buildReq() {
  const store = await cookies();
  return { cookies: { get: (n: string) => store.get(n) } };
}

export default async function AgentsPage() {
  const { session } = getAuth();
  const result = await session.getCurrentSession(await buildReq());
  if (!result) redirect("/login?return_to=/me/agents");
  void headers;
  return (
    <div className="mx-auto max-w-3xl px-6 py-10 space-y-6">
      <h1 className="text-3xl font-bold">My agents</h1>
      <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
        No agents registered yet. Agent registration arrives in Phase 4.
      </div>
    </div>
  );
}
