import { MemoryIdentityProvider } from "@/lib/auth/memory/identity";
import { runIdentityContract } from "./identity-contract";

runIdentityContract("MemoryIdentityProvider", async () => new MemoryIdentityProvider());
