import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { RegisterAgentForm } from "@/components/register-agent-form";

export default async function NewAgentPage() {
  const store = await cookies();
  const { session } = getAuth();
  const current = await session.getCurrentSession({
    cookies: { get: (n: string) => store.get(n) },
  });
  if (!current) redirect("/login?return_to=/me/agents/new");

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 space-y-6">
      <h1 className="text-3xl font-bold">Register an agent</h1>
      <p className="text-sm text-muted-foreground">
        Agents shop on your behalf. We&apos;ll create a Kratos identity, a Hydra OAuth2 client, and a Keto delegation tuple.
      </p>
      <RegisterAgentForm />
    </div>
  );
}
