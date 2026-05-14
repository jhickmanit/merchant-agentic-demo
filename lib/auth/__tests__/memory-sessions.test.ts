import { MemoryIdentityProvider } from "@/lib/auth/memory/identity";
import { MemorySessionProvider } from "@/lib/auth/memory/sessions";
import { runSessionsContract } from "./sessions-contract";

runSessionsContract("MemorySessionProvider", async () => {
  const identity = new MemoryIdentityProvider();
  const session = new MemorySessionProvider(identity);
  return { identity, session };
});
