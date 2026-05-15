import { MemoryOAuth2ClientProvider } from "@/lib/auth/memory/oauth2-clients";
import { runOAuth2ClientsContract } from "./oauth2-clients-contract";

runOAuth2ClientsContract("MemoryOAuth2ClientProvider", async () => new MemoryOAuth2ClientProvider());
