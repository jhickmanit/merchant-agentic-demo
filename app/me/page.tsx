import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getAuth } from "@/lib/auth";
import { buildSessionRequest } from "@/lib/auth/request";

export default async function MePage() {
  const { session } = getAuth();
  const result = await session.getCurrentSession(await buildSessionRequest());
  if (!result) redirect("/login?return_to=/me");
  void headers; // forces dynamic rendering
  return (
    <div className="mx-auto max-w-3xl px-6 py-10 space-y-6">
      <h1 className="text-3xl font-bold">Your account</h1>
      <section className="rounded-lg border p-4">
        <div className="text-sm text-muted-foreground">Email</div>
        <div className="font-medium">{result.user.email}</div>
        {result.user.name && (
          <>
            <div className="mt-3 text-sm text-muted-foreground">Name</div>
            <div className="font-medium">{result.user.name}</div>
          </>
        )}
      </section>
      <Link href="/me/agents" className="block rounded-lg border p-4 hover:bg-accent">
        <div className="font-medium">My agents</div>
        <div className="text-sm text-muted-foreground">Register AI agents to shop on your behalf. Coming soon.</div>
      </Link>
    </div>
  );
}
