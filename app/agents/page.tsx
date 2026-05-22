import { redirect } from "next/navigation";

// The agents UI lives under /me/agents (it's owner-scoped). `/agents` is a
// convenience alias people instinctively try, so we just bounce them there.
export default function AgentsAliasPage() {
  redirect("/me/agents");
}
