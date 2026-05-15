# Phase 4 — Agent Registration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Logged-in users can register AI agents from `/me/agents/new`. Each agent is a first-class Kratos identity (via the new agent identity schema), paired with a real Hydra OAuth2 client, with `Agent:{aid}#owner@User:{uid}` written to Keto and a denormalized row in the local DB carrying spend cap + expiry. Owners can list agents and revoke them; revocation invalidates the Hydra client, deletes the Keto tuple, and stamps the local row as revoked.

**Architecture:** Three new pieces compose. (1) A second Kratos identity schema for agents, with traits `agent_id`, `owner_identity_id`, `agent_type`, `display_name`, `kya_credential_id` (empty in Phase 4, populated by Phase 6), `attestation_url` (empty in Phase 4). (2) An `OAuth2ClientProvider` interface with Memory + Ory adapters; the Ory adapter uses Hydra's admin API. (3) A schema migration adding columns to the existing `agents` table for fast lookups and spend-cap storage. The `registerAgent()` server action orchestrates Kratos identity creation → Hydra client creation → Keto tuple write → local DB row insert. `revokeAgent()` reverses in the opposite order.

**Tech Stack:** Builds on Phase 2's provider abstractions and Phase 3's Keto integration. Adds `@ory/client` Hydra admin endpoints (already in the SDK). No new dependencies.

**Parent plan:** [`docs/plans/2026-05-13-architecture-and-roadmap.md`](../2026-05-13-architecture-and-roadmap.md)

**Pre-conditions:**
- Phase 3 complete (60 commits, 47 unit + 6 e2e tests passing).
- Ory Network project active; user identity schema applied.
- Keto namespaces registered (P3.1).

**Standing preamble** for every task:
```bash
eval "$(fnm env --use-on-cd)"
cd /Users/jeff.hickman/Code/demos/merchant-agentic-demo
git branch --show-current  # must print: main
```

Stay on `main`. **Never** detach HEAD. **Never** write to `.claude/settings.json`. If `git commit` is blocked, report BLOCKED — the controller will commit.

**Carry-over findings from Phase 3 (important):**
- Hosted Ory Keto does NOT enforce OPL computed permits. Write all needed tuples explicitly.
- `@ory/keto-client` Configuration ignores `accessToken` — Bearer must go through `baseOptions.headers` (already fixed in `OryPermissionProvider`).
- Ory rewrites identity-schema IDs to content hashes. Use `listIdentitySchemas()` and pick the non-`preset://` ones. For the agent schema, we'll need a way to disambiguate between user and agent — write the agent schema with a distinct title and filter on it.

---

## File Structure (created/modified by this plan)

```
.
├── scripts/ory-setup/
│   ├── identity-schemas/
│   │   ├── user.schema.json              (already exists)
│   │   └── agent.schema.json             (new)
│   └── apply.sh                          (modified — uploads BOTH schemas)
├── db/
│   ├── schema.ts                         (modified — agents table extended)
│   └── migrations/                       (new migration)
├── lib/auth/
│   ├── identity.ts                       (modified — createAgent/getAgent/listAgentsByOwner)
│   ├── oauth2-clients.ts                 (new — OAuth2ClientProvider interface)
│   ├── memory/
│   │   ├── identity.ts                   (modified — add agent methods)
│   │   └── oauth2-clients.ts             (new — MemoryOAuth2ClientProvider)
│   ├── ory/
│   │   ├── identity.ts                   (modified — add agent methods + schema lookup)
│   │   ├── oauth2-clients.ts             (new — OryOAuth2ClientProvider via Hydra admin)
│   │   └── client.ts                     (modified — export OAuth2Api admin client)
│   ├── index.ts                          (modified — add oauth2 to providers, instrument)
│   └── __tests__/
│       ├── identity-contract.ts          (modified — agent contract added)
│       ├── memory-identity.test.ts       (modified — covers agent methods)
│       ├── oauth2-clients-contract.ts    (new)
│       └── memory-oauth2-clients.test.ts (new)
├── lib/agents.ts                         (new — registerAgent, revokeAgent, listForUser)
├── lib/__tests__/agents.test.ts          (new)
├── app/me/agents/
│   ├── page.tsx                          (rewritten — list + register button)
│   ├── new/
│   │   └── page.tsx                      (new — registration form, server action)
│   └── actions.ts                        (new — server actions registerAgent/revokeAgent)
├── components/
│   ├── agent-card.tsx                    (new)
│   └── register-agent-form.tsx           (new — client component)
└── e2e/
    └── agents.spec.ts                    (new — register + list + revoke flow)
```

---

## Task 1: Agent identity schema + DB schema extensions

**Files:**
- Create: `scripts/ory-setup/identity-schemas/agent.schema.json`
- Modify: `scripts/ory-setup/apply.sh` (upload BOTH user + agent schemas)
- Modify: `db/schema.ts` (extend `agents` table)
- Generate: new migration

**Step 1: Author agent schema**

Use Write tool. `scripts/ory-setup/identity-schemas/agent.schema.json`:

```json
{
  "$id": "https://schemas.merchant-agentic-demo.example/agent.schema.json",
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Agent",
  "type": "object",
  "properties": {
    "traits": {
      "type": "object",
      "properties": {
        "agent_id": {
          "type": "string",
          "title": "Agent ID"
        },
        "owner_identity_id": {
          "type": "string",
          "title": "Owner Kratos identity ID"
        },
        "agent_type": {
          "type": "string",
          "enum": ["shopping", "research", "general"],
          "title": "Agent type"
        },
        "display_name": {
          "type": "string",
          "title": "Display name"
        },
        "kya_credential_id": {
          "type": "string",
          "title": "KYA credential id (Phase 6)"
        },
        "attestation_url": {
          "type": "string",
          "title": "Attestation URL (Phase 6)"
        }
      },
      "required": ["owner_identity_id", "agent_type", "display_name"],
      "additionalProperties": false
    }
  }
}
```

**Step 2: Update `apply.sh` to upload both schemas**

Read current `scripts/ory-setup/apply.sh`. The user-schema upload currently uses `--replace "/identity/schemas=[{\"id\":\"user\",\"url\":\"base64://${USER_SCHEMA_B64}\"}]"`. Extend to upload both:

```bash
USER_SCHEMA_B64=$(base64 -i "${DIR}/identity-schemas/user.schema.json" | tr -d '\n')
AGENT_SCHEMA_B64=$(base64 -i "${DIR}/identity-schemas/agent.schema.json" | tr -d '\n')

ory patch identity-config --project "${ORY_PROJECT_ID}" \
  --replace "/identity/default_schema_id=\"user\"" \
  --replace "/identity/schemas=[{\"id\":\"user\",\"url\":\"base64://${USER_SCHEMA_B64}\"},{\"id\":\"agent\",\"url\":\"base64://${AGENT_SCHEMA_B64}\"}]"
```

(Ory will store both with their content-hash IDs and set the user schema's hash as the default. The agent schema will appear in `listIdentitySchemas()` as a separate entry with a different hash.)

**Step 3: Extend `db/schema.ts` `agents` table**

Read current `db/schema.ts`. Find the existing `agents` table (stub from Phase 1):

```ts
export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  ownerUserId: text("owner_user_id"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
```

Replace with:

```ts
export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  ownerUserId: text("owner_user_id").notNull(),
  agentType: text("agent_type", { enum: ["shopping", "research", "general"] }).notNull(),
  hydraClientId: text("hydra_client_id").notNull(),
  spendCapCents: integer("spend_cap_cents"),
  expiresAt: integer("expires_at", { mode: "timestamp" }),
  allowedMerchantsJson: text("allowed_merchants_json"), // JSON array of merchant slugs
  revokedAt: integer("revoked_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
```

(`ownerUserId` is now NOT NULL — Phase 4 requires it.)

**Step 4: Generate + apply migration**

```bash
pnpm db:generate
ls db/migrations/
```

Expect a new migration like `0001_*.sql`. Inspect — should add the new columns to `agents` and possibly recreate the table due to NOT NULL constraint changes on existing nullable column.

```bash
pnpm db:migrate
```

If the migrate fails because existing rows in `agents` would violate the new NOT NULL on `owner_user_id`: that's fine for the demo because the `agents` table is empty (it was just a stub). Either drop+recreate the dev DB:

```bash
rm -f local.db
pnpm db:migrate
pnpm db:seed
```

…or use a destructive migration. Confirm the table has the new columns:

```bash
node -e "const db = require('better-sqlite3')('./local.db'); console.log(db.prepare(\"PRAGMA table_info(agents)\").all());"
```

Expect 10 columns.

**Step 5: Run apply.sh to upload both schemas**

```bash
./scripts/ory-setup/apply.sh
```

Expect all OKs including the user/agent schema upload. Then verify two schemas now exist:

```bash
node --env-file=.env.local -e "
import('./lib/auth/ory/client.ts').then(async ({ identityAdmin }) => {
  const result = await identityAdmin.listIdentitySchemas({});
  const custom = result.data.filter(s => !s.id?.startsWith('preset://'));
  console.log('Found', custom.length, 'custom schemas');
  for (const s of custom) console.log('  id:', s.id?.slice(0, 16) + '...', 'has agent_id trait?');
});
"
```

Two custom schemas should be present. We can't easily tell which is which by ID alone — we'll need to fetch each and inspect its title. The next task handles disambiguation.

**Step 6: Typecheck + commit**

```bash
pnpm typecheck
git add -A
git commit -m "feat(agents): agent identity schema + db schema extensions"
git log --oneline -3
git status -sb
```

If commit blocked, report BLOCKED.

---

## Task 2: Extend IdentityProvider with agent methods + Memory implementation

**Files:**
- Modify: `lib/auth/types.ts` (add Agent type)
- Modify: `lib/auth/identity.ts` (add createAgent/getAgent/listAgentsByOwner)
- Modify: `lib/auth/memory/identity.ts`
- Modify: `lib/auth/__tests__/identity-contract.ts` (add agent tests)

**Step 1: Add Agent type to `lib/auth/types.ts`**

Append:

```ts
export interface Agent {
  id: string;
  displayName: string;
  ownerIdentityId: string;
  agentType: "shopping" | "research" | "general";
  kyaCredentialId?: string;
  attestationUrl?: string;
}
```

**Step 2: Extend `lib/auth/identity.ts`**

```ts
import type { User, Agent } from "./types";

export interface IdentityProvider {
  getById(id: string): Promise<User | null>;
  getByEmail(email: string): Promise<User | null>;
  createUser(traits: { email: string; name?: string }): Promise<User>;

  // Phase 4 — agent methods
  createAgent(traits: {
    displayName: string;
    ownerIdentityId: string;
    agentType: "shopping" | "research" | "general";
  }): Promise<Agent>;
  getAgentById(id: string): Promise<Agent | null>;
  listAgentsByOwner(ownerIdentityId: string): Promise<Agent[]>;
}
```

**Step 3: Update Memory implementation**

Modify `lib/auth/memory/identity.ts` to implement the new methods:

```ts
// Append to existing class:
private agents = new Map<string, Agent>();

async createAgent(traits: {
  displayName: string;
  ownerIdentityId: string;
  agentType: "shopping" | "research" | "general";
}): Promise<Agent> {
  const agent: Agent = {
    id: nanoid(16),
    displayName: traits.displayName,
    ownerIdentityId: traits.ownerIdentityId,
    agentType: traits.agentType,
  };
  this.agents.set(agent.id, agent);
  return agent;
}

async getAgentById(id: string): Promise<Agent | null> {
  return this.agents.get(id) ?? null;
}

async listAgentsByOwner(ownerIdentityId: string): Promise<Agent[]> {
  return [...this.agents.values()].filter((a) => a.ownerIdentityId === ownerIdentityId);
}
```

Add the `import type { Agent } ...` at the top.

**Step 4: Extend the contract test**

Append to `lib/auth/__tests__/identity-contract.ts` inside the `describe` block:

```ts
it("createAgent returns an agent with id, displayName, ownerIdentityId", async () => {
  const p = await makeProvider();
  const owner = await p.createUser({ email: "owner@example.com" });
  const agent = await p.createAgent({
    displayName: "Shoppy",
    ownerIdentityId: owner.id,
    agentType: "shopping",
  });
  expect(agent.id).toBeTruthy();
  expect(agent.displayName).toBe("Shoppy");
  expect(agent.ownerIdentityId).toBe(owner.id);
  expect(agent.agentType).toBe("shopping");
});

it("getAgentById round-trips", async () => {
  const p = await makeProvider();
  const owner = await p.createUser({ email: "owner@example.com" });
  const agent = await p.createAgent({ displayName: "A", ownerIdentityId: owner.id, agentType: "shopping" });
  const found = await p.getAgentById(agent.id);
  expect(found?.displayName).toBe("A");
});

it("listAgentsByOwner filters", async () => {
  const p = await makeProvider();
  const o1 = await p.createUser({ email: "o1@example.com" });
  const o2 = await p.createUser({ email: "o2@example.com" });
  await p.createAgent({ displayName: "A1", ownerIdentityId: o1.id, agentType: "shopping" });
  await p.createAgent({ displayName: "A2", ownerIdentityId: o1.id, agentType: "research" });
  await p.createAgent({ displayName: "B1", ownerIdentityId: o2.id, agentType: "general" });
  const o1Agents = await p.listAgentsByOwner(o1.id);
  expect(o1Agents).toHaveLength(2);
});
```

Run tests — they fail until `createAgent` lands. Then they pass.

**Step 5: Typecheck + commit**

```bash
pnpm typecheck
pnpm test 2>&1 | tail -3
git add -A
git commit -m "feat(auth): IdentityProvider gains agent methods + Memory impl"
```

If blocked, report BLOCKED.

---

## Task 3: OAuth2ClientProvider — interface + Memory + Ory

**Files:**
- Create: `lib/auth/oauth2-clients.ts` (interface)
- Create: `lib/auth/memory/oauth2-clients.ts`
- Create: `lib/auth/ory/oauth2-clients.ts`
- Create: `lib/auth/__tests__/oauth2-clients-contract.ts`
- Create: `lib/auth/__tests__/memory-oauth2-clients.test.ts`
- Modify: `lib/auth/types.ts` (OAuth2Client type)
- Modify: `lib/auth/ory/client.ts` (export OAuth2Api admin)
- Modify: `lib/auth/index.ts` (wire oauth2 into providers)

**Step 1: Types + interface**

In `lib/auth/types.ts`, append:

```ts
export interface OAuth2Client {
  id: string;          // Hydra's client_id
  ownerIdentityId: string;
  grantTypes: string[];
  metadata: Record<string, string | number | boolean>;
}
```

Create `lib/auth/oauth2-clients.ts`:

```ts
import type { OAuth2Client } from "./types";

export interface OAuth2ClientProvider {
  create(args: {
    ownerIdentityId: string;
    grantTypes: string[];
    metadata?: Record<string, string | number | boolean>;
  }): Promise<OAuth2Client>;
  get(id: string): Promise<OAuth2Client | null>;
  revoke(id: string): Promise<void>;
}
```

**Step 2: Memory implementation**

`lib/auth/memory/oauth2-clients.ts`:

```ts
import { nanoid } from "nanoid";
import type { OAuth2ClientProvider } from "@/lib/auth/oauth2-clients";
import type { OAuth2Client } from "@/lib/auth/types";

export class MemoryOAuth2ClientProvider implements OAuth2ClientProvider {
  private clients = new Map<string, OAuth2Client>();

  async create(args: {
    ownerIdentityId: string;
    grantTypes: string[];
    metadata?: Record<string, string | number | boolean>;
  }): Promise<OAuth2Client> {
    const client: OAuth2Client = {
      id: nanoid(16),
      ownerIdentityId: args.ownerIdentityId,
      grantTypes: args.grantTypes,
      metadata: args.metadata ?? {},
    };
    this.clients.set(client.id, client);
    return client;
  }

  async get(id: string): Promise<OAuth2Client | null> {
    return this.clients.get(id) ?? null;
  }

  async revoke(id: string): Promise<void> {
    this.clients.delete(id);
  }
}
```

**Step 3: Contract test**

`lib/auth/__tests__/oauth2-clients-contract.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { OAuth2ClientProvider } from "@/lib/auth/oauth2-clients";

export function runOAuth2ClientsContract(name: string, makeProvider: () => Promise<OAuth2ClientProvider>) {
  describe(`${name} — OAuth2ClientProvider contract`, () => {
    it("create returns a client with id, ownerIdentityId, grantTypes", async () => {
      const p = await makeProvider();
      const c = await p.create({
        ownerIdentityId: "user-1",
        grantTypes: ["client_credentials"],
        metadata: { kratos_identity_id: "agent-abc" },
      });
      expect(c.id).toBeTruthy();
      expect(c.ownerIdentityId).toBe("user-1");
      expect(c.grantTypes).toEqual(["client_credentials"]);
      expect(c.metadata.kratos_identity_id).toBe("agent-abc");
    });

    it("get returns a created client", async () => {
      const p = await makeProvider();
      const c = await p.create({ ownerIdentityId: "u", grantTypes: ["client_credentials"] });
      const found = await p.get(c.id);
      expect(found?.id).toBe(c.id);
    });

    it("get returns null for unknown id", async () => {
      const p = await makeProvider();
      expect(await p.get("nope")).toBeNull();
    });

    it("revoke removes the client", async () => {
      const p = await makeProvider();
      const c = await p.create({ ownerIdentityId: "u", grantTypes: ["client_credentials"] });
      await p.revoke(c.id);
      expect(await p.get(c.id)).toBeNull();
    });
  });
}
```

`lib/auth/__tests__/memory-oauth2-clients.test.ts`:

```ts
import { MemoryOAuth2ClientProvider } from "@/lib/auth/memory/oauth2-clients";
import { runOAuth2ClientsContract } from "./oauth2-clients-contract";

runOAuth2ClientsContract("MemoryOAuth2ClientProvider", async () => new MemoryOAuth2ClientProvider());
```

**Step 4: Ory implementation**

Update `lib/auth/ory/client.ts` to export `OAuth2Api`:

```ts
import { Configuration, FrontendApi, IdentityApi, OAuth2Api } from "@ory/client";
// ... existing config ...
export const oauth2Admin = new OAuth2Api(adminConfig);
```

`lib/auth/ory/oauth2-clients.ts`:

```ts
import type { OAuth2ClientProvider } from "@/lib/auth/oauth2-clients";
import type { OAuth2Client } from "@/lib/auth/types";
import { oauth2Admin } from "./client";

export class OryOAuth2ClientProvider implements OAuth2ClientProvider {
  async create(args: {
    ownerIdentityId: string;
    grantTypes: string[];
    metadata?: Record<string, string | number | boolean>;
  }): Promise<OAuth2Client> {
    const merged = { ...args.metadata, kratos_identity_id: args.ownerIdentityId };
    const result = await oauth2Admin.createOAuth2Client({
      oAuth2Client: {
        client_name: `agent-${args.ownerIdentityId}`,
        grant_types: args.grantTypes,
        token_endpoint_auth_method: "client_secret_basic",
        metadata: merged,
      },
    });
    return {
      id: result.data.client_id ?? "",
      ownerIdentityId: args.ownerIdentityId,
      grantTypes: result.data.grant_types ?? [],
      metadata: (result.data.metadata as Record<string, string | number | boolean>) ?? {},
    };
  }

  async get(id: string): Promise<OAuth2Client | null> {
    try {
      const result = await oauth2Admin.getOAuth2Client({ id });
      return {
        id: result.data.client_id ?? "",
        ownerIdentityId: (result.data.metadata as { kratos_identity_id?: string } | undefined)?.kratos_identity_id ?? "",
        grantTypes: result.data.grant_types ?? [],
        metadata: (result.data.metadata as Record<string, string | number | boolean>) ?? {},
      };
    } catch (err: unknown) {
      if ((err as { response?: { status?: number } })?.response?.status === 404) return null;
      throw err;
    }
  }

  async revoke(id: string): Promise<void> {
    await oauth2Admin.deleteOAuth2Client({ id });
  }
}
```

**Step 5: Wire into DI**

Modify `lib/auth/index.ts`:
- Add `oauth2: OAuth2ClientProvider` to the `Providers` type.
- In memory branch: `oauth2: new MemoryOAuth2ClientProvider()`.
- In ory branch: `oauth2: new OryOAuth2ClientProvider()` (lazy-required).

**Step 6: Run tests + commit**

```bash
pnpm typecheck
pnpm test 2>&1 | tail -5
```

Expect 47 + 4 = 51 tests passing.

```bash
git add -A
git commit -m "feat(auth): OAuth2ClientProvider interface + Memory + Ory implementations"
```

If commit blocked, report BLOCKED.

---

## Task 4: OryIdentityProvider gains agent methods + agent schema id lookup

**Files:**
- Modify: `lib/auth/ory/identity.ts`

**Step 1: Cache both schema IDs**

The current `OryIdentityProvider` looks up the user schema id once at startup. We now need both:

```ts
let cachedUserSchemaId: string | null = null;
let cachedAgentSchemaId: string | null = null;

async function getSchemaIds(): Promise<{ user: string; agent: string }> {
  if (cachedUserSchemaId && cachedAgentSchemaId) {
    return { user: cachedUserSchemaId, agent: cachedAgentSchemaId };
  }
  const result = await identityAdmin.listIdentitySchemas({});
  const customs = result.data.filter((s) => !s.id?.startsWith("preset://"));
  // Disambiguate by inspecting the schema content via the URL field.
  // The user schema's traits have an "email" trait; the agent's has "agent_id".
  for (const s of customs) {
    if (!s.id) continue;
    if (s.schema && typeof s.schema === "object") {
      const traits = (s.schema as { properties?: { traits?: { properties?: Record<string, unknown> } } })
        .properties?.traits?.properties;
      if (traits) {
        if ("email" in traits) cachedUserSchemaId = s.id;
        else if ("agent_id" in traits || "owner_identity_id" in traits) cachedAgentSchemaId = s.id;
      }
    }
  }
  if (!cachedUserSchemaId || !cachedAgentSchemaId) {
    throw new Error(`Could not identify both schemas. Custom schemas found: ${customs.map((c) => c.id?.slice(0, 16)).join(", ")}`);
  }
  return { user: cachedUserSchemaId, agent: cachedAgentSchemaId };
}
```

Note: `listIdentitySchemas` returns the schema's inline content under `.schema` per the OpenAPI spec. If the actual SDK doesn't include the content (returns only `id` + `url`), fetch each schema separately via `identityAdmin.getIdentitySchema({id})`.

**Step 2: Update `createUser` to use cached user schema id**

```ts
async createUser(traits: { email: string; name?: string }): Promise<User> {
  const { user: schemaId } = await getSchemaIds();
  const [first, ...rest] = (traits.name ?? "").split(/\s+/).filter(Boolean);
  const last = rest.join(" ") || undefined;
  const result = await identityAdmin.createIdentity({
    createIdentityBody: {
      schema_id: schemaId,
      traits: {
        email: traits.email,
        ...(first ? { name: { first, last } } : {}),
      },
    },
  });
  return toUser(result.data);
}
```

**Step 3: Add agent methods**

```ts
function toAgent(identity: { id: string; traits: unknown }): Agent {
  const traits = identity.traits as {
    display_name: string;
    owner_identity_id: string;
    agent_type: "shopping" | "research" | "general";
    kya_credential_id?: string;
    attestation_url?: string;
  };
  return {
    id: identity.id,
    displayName: traits.display_name,
    ownerIdentityId: traits.owner_identity_id,
    agentType: traits.agent_type,
    kyaCredentialId: traits.kya_credential_id || undefined,
    attestationUrl: traits.attestation_url || undefined,
  };
}

// Inside OryIdentityProvider class:
async createAgent(traits: {
  displayName: string;
  ownerIdentityId: string;
  agentType: "shopping" | "research" | "general";
}): Promise<Agent> {
  const { agent: schemaId } = await getSchemaIds();
  const result = await identityAdmin.createIdentity({
    createIdentityBody: {
      schema_id: schemaId,
      traits: {
        display_name: traits.displayName,
        owner_identity_id: traits.ownerIdentityId,
        agent_type: traits.agentType,
        agent_id: "",            // placeholder; Kratos assigns the canonical id
        kya_credential_id: "",   // Phase 6
        attestation_url: "",     // Phase 6
      },
    },
  });
  return toAgent(result.data);
}

async getAgentById(id: string): Promise<Agent | null> {
  try {
    const result = await identityAdmin.getIdentity({ id });
    return toAgent(result.data);
  } catch (err: unknown) {
    if ((err as { response?: { status?: number } })?.response?.status === 404) return null;
    throw err;
  }
}

async listAgentsByOwner(ownerIdentityId: string): Promise<Agent[]> {
  // Kratos doesn't have a trait-filter listIdentities query. We page through
  // all identities filtered by the agent schema id, then filter client-side
  // by traits.owner_identity_id. Acceptable for a demo with low agent counts.
  const { agent: schemaId } = await getSchemaIds();
  const all = await identityAdmin.listIdentities({ pageSize: 250 });
  return all.data
    .filter((i) => i.schema_id === schemaId)
    .map(toAgent)
    .filter((a) => a.ownerIdentityId === ownerIdentityId);
}
```

**Step 4: Typecheck + commit**

```bash
pnpm typecheck
pnpm test 2>&1 | tail -3
git add -A
git commit -m "feat(ory): identity provider supports agents + dual schema lookup"
```

If blocked, report BLOCKED.

---

## Task 5: registerAgent + revokeAgent server actions + `lib/agents.ts`

**Files:**
- Create: `lib/agents.ts` (orchestration)
- Create: `lib/__tests__/agents.test.ts`
- Create: `app/me/agents/actions.ts` (server actions)

**Step 1: Orchestration in `lib/agents.ts`**

```ts
import type { DB } from "@/db";
import { agents } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { IdentityProvider } from "@/lib/auth/identity";
import type { OAuth2ClientProvider } from "@/lib/auth/oauth2-clients";
import type { PermissionProvider } from "@/lib/auth/permissions";

export interface RegisterAgentInput {
  ownerIdentityId: string;
  displayName: string;
  agentType: "shopping" | "research" | "general";
  spendCapCents?: number;
  expiresAt?: Date;
  allowedMerchants?: string[];
}

export interface RegisteredAgent {
  id: string;
  hydraClientId: string;
}

export async function registerAgent(
  db: DB,
  providers: {
    identity: IdentityProvider;
    oauth2: OAuth2ClientProvider;
    permission: PermissionProvider;
  },
  input: RegisterAgentInput,
): Promise<RegisteredAgent> {
  // 1. Create Kratos agent identity
  const agent = await providers.identity.createAgent({
    displayName: input.displayName,
    ownerIdentityId: input.ownerIdentityId,
    agentType: input.agentType,
  });

  // 2. Create Hydra OAuth2 client (initially client_credentials; device_code added in Phase 7)
  const client = await providers.oauth2.create({
    ownerIdentityId: agent.id,
    grantTypes: ["client_credentials"],
    metadata: { kratos_identity_id: agent.id },
  });

  // 3. Write Keto ownership tuple
  try {
    await providers.permission.addTuple({
      namespace: "Agent",
      object: agent.id,
      relation: "owner",
      subject: `User:${input.ownerIdentityId}`,
    });
  } catch (err) {
    console.error(`Failed to write Agent:${agent.id}#owner tuple:`, err);
  }

  // 4. Insert denormalized row in local DB
  db.insert(agents).values({
    id: agent.id,
    displayName: input.displayName,
    ownerUserId: input.ownerIdentityId,
    agentType: input.agentType,
    hydraClientId: client.id,
    spendCapCents: input.spendCapCents ?? null,
    expiresAt: input.expiresAt ?? null,
    allowedMerchantsJson: input.allowedMerchants ? JSON.stringify(input.allowedMerchants) : null,
  }).run();

  return { id: agent.id, hydraClientId: client.id };
}

export async function revokeAgent(
  db: DB,
  providers: {
    oauth2: OAuth2ClientProvider;
    permission: PermissionProvider;
  },
  agentId: string,
  ownerIdentityId: string,
): Promise<void> {
  const row = await db.query.agents.findFirst({ where: eq(agents.id, agentId) });
  if (!row) throw new Error(`Agent ${agentId} not found`);
  if (row.ownerUserId !== ownerIdentityId) throw new Error(`Agent ${agentId} is not owned by ${ownerIdentityId}`);
  if (row.revokedAt) return;

  // 1. Revoke Hydra OAuth2 client (cuts off future tokens)
  try {
    await providers.oauth2.revoke(row.hydraClientId);
  } catch (err) {
    console.error(`Failed to revoke Hydra client ${row.hydraClientId}:`, err);
  }

  // 2. Delete Keto tuple
  try {
    await providers.permission.removeTuple({
      namespace: "Agent",
      object: agentId,
      relation: "owner",
      subject: `User:${ownerIdentityId}`,
    });
  } catch (err) {
    console.error(`Failed to remove Keto tuple for Agent:${agentId}:`, err);
  }

  // 3. Mark revoked locally (we keep the Kratos identity for audit; just stamp the row)
  db.update(agents).set({ revokedAt: new Date() }).where(eq(agents.id, agentId)).run();
}

export async function listAgentsForUser(db: DB, ownerIdentityId: string) {
  return db.query.agents.findMany({
    where: eq(agents.ownerUserId, ownerIdentityId),
    orderBy: (a, { desc }) => [desc(a.createdAt)],
  });
}
```

**Step 2: TDD tests**

`lib/__tests__/agents.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { freshTestDb } from "./helpers";
import { eq } from "drizzle-orm";
import { agents as agentsTable } from "@/db/schema";
import { registerAgent, revokeAgent, listAgentsForUser } from "@/lib/agents";
import { MemoryIdentityProvider } from "@/lib/auth/memory/identity";
import { MemoryOAuth2ClientProvider } from "@/lib/auth/memory/oauth2-clients";
import { MemoryPermissionProvider } from "@/lib/auth/memory/permissions";

describe("agent orchestration", () => {
  let testDb: ReturnType<typeof freshTestDb>;
  let identity: MemoryIdentityProvider;
  let oauth2: MemoryOAuth2ClientProvider;
  let permission: MemoryPermissionProvider;

  beforeEach(() => {
    testDb = freshTestDb();
    identity = new MemoryIdentityProvider();
    oauth2 = new MemoryOAuth2ClientProvider();
    permission = new MemoryPermissionProvider();
  });

  it("registerAgent: creates Kratos identity, Hydra client, Keto tuple, DB row", async () => {
    const owner = await identity.createUser({ email: "alice@example.com" });
    const result = await registerAgent(testDb.db, { identity, oauth2, permission }, {
      ownerIdentityId: owner.id,
      displayName: "Shoppy",
      agentType: "shopping",
      spendCapCents: 20000,
    });

    expect(result.id).toBeTruthy();
    expect(result.hydraClientId).toBeTruthy();

    const agent = await identity.getAgentById(result.id);
    expect(agent?.displayName).toBe("Shoppy");

    const client = await oauth2.get(result.hydraClientId);
    expect(client?.metadata.kratos_identity_id).toBe(result.id);

    const tuples = await permission.listForObject("Agent", result.id);
    expect(tuples.find((t) => t.relation === "owner")?.subject).toBe(`User:${owner.id}`);

    const row = await testDb.db.query.agents.findFirst({ where: eq(agentsTable.id, result.id) });
    expect(row?.spendCapCents).toBe(20000);
  });

  it("revokeAgent: removes Hydra client, Keto tuple, stamps revokedAt", async () => {
    const owner = await identity.createUser({ email: "alice@example.com" });
    const result = await registerAgent(testDb.db, { identity, oauth2, permission }, {
      ownerIdentityId: owner.id,
      displayName: "Shoppy",
      agentType: "shopping",
    });

    await revokeAgent(testDb.db, { oauth2, permission }, result.id, owner.id);

    expect(await oauth2.get(result.hydraClientId)).toBeNull();
    const tuples = await permission.listForObject("Agent", result.id);
    expect(tuples).toHaveLength(0);
    const row = await testDb.db.query.agents.findFirst({ where: eq(agentsTable.id, result.id) });
    expect(row?.revokedAt).toBeTruthy();
  });

  it("revokeAgent: throws if caller is not owner", async () => {
    const owner = await identity.createUser({ email: "alice@example.com" });
    const otherOwner = await identity.createUser({ email: "bob@example.com" });
    const result = await registerAgent(testDb.db, { identity, oauth2, permission }, {
      ownerIdentityId: owner.id,
      displayName: "Shoppy",
      agentType: "shopping",
    });

    await expect(revokeAgent(testDb.db, { oauth2, permission }, result.id, otherOwner.id))
      .rejects.toThrow(/not owned/);
  });

  it("listAgentsForUser returns only the caller's agents, newest first", async () => {
    const alice = await identity.createUser({ email: "alice@example.com" });
    const bob = await identity.createUser({ email: "bob@example.com" });
    await registerAgent(testDb.db, { identity, oauth2, permission }, { ownerIdentityId: alice.id, displayName: "A1", agentType: "shopping" });
    await registerAgent(testDb.db, { identity, oauth2, permission }, { ownerIdentityId: alice.id, displayName: "A2", agentType: "research" });
    await registerAgent(testDb.db, { identity, oauth2, permission }, { ownerIdentityId: bob.id, displayName: "B1", agentType: "general" });
    const alices = await listAgentsForUser(testDb.db, alice.id);
    expect(alices.map((a) => a.displayName).sort()).toEqual(["A1", "A2"]);
  });
});
```

Run tests — must fail (lib/agents.ts missing), then pass.

**Step 3: Server actions**

`app/me/agents/actions.ts`:

```ts
"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { getAuth } from "@/lib/auth";
import { registerAgent, revokeAgent } from "@/lib/agents";

interface RegisterFormData {
  displayName: string;
  agentType: "shopping" | "research" | "general";
  spendCapCents?: number;
  expiresAt?: string; // ISO date
}

export async function registerAgentAction(input: RegisterFormData) {
  const store = await cookies();
  const { session, identity, oauth2, permission } = getAuth();
  const current = await session.getCurrentSession({ cookies: { get: (n: string) => store.get(n) } });
  if (!current) throw new Error("Not signed in");

  const result = await registerAgent(getDb(), { identity, oauth2, permission }, {
    ownerIdentityId: current.user.id,
    displayName: input.displayName,
    agentType: input.agentType,
    spendCapCents: input.spendCapCents,
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
  });

  revalidatePath("/me/agents");
  return result;
}

export async function revokeAgentAction(agentId: string) {
  const store = await cookies();
  const { session, oauth2, permission } = getAuth();
  const current = await session.getCurrentSession({ cookies: { get: (n: string) => store.get(n) } });
  if (!current) throw new Error("Not signed in");

  await revokeAgent(getDb(), { oauth2, permission }, agentId, current.user.id);
  revalidatePath("/me/agents");
}
```

**Step 4: Commit**

```bash
pnpm typecheck
pnpm test 2>&1 | tail -3
git add -A
git commit -m "feat(agents): register/revoke orchestration + server actions"
```

If blocked, report BLOCKED.

---

## Task 6: /me/agents/new form + /me/agents list page + AgentCard

**Files:**
- Create: `app/me/agents/new/page.tsx`
- Create: `components/register-agent-form.tsx`
- Create: `components/agent-card.tsx`
- Rewrite: `app/me/agents/page.tsx`

**Step 1: shadcn components**

Add input + select via shadcn (idempotent):

```bash
pnpm dlx shadcn@latest add input label select --yes
```

**Step 2: RegisterAgentForm (client component)**

`components/register-agent-form.tsx`:

```tsx
"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { registerAgentAction } from "@/app/me/agents/actions";

export function RegisterAgentForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const formData = new FormData(e.currentTarget);
        const displayName = String(formData.get("displayName") || "");
        const agentType = (String(formData.get("agentType") || "shopping")) as "shopping" | "research" | "general";
        const spendCapDollars = parseFloat(String(formData.get("spendCapDollars") || "0"));
        const spendCapCents = isFinite(spendCapDollars) && spendCapDollars > 0
          ? Math.round(spendCapDollars * 100)
          : undefined;
        const expiresAt = String(formData.get("expiresAt") || "") || undefined;

        startTransition(async () => {
          try {
            await registerAgentAction({ displayName, agentType, spendCapCents, expiresAt });
            router.push("/me/agents");
          } catch (err) {
            setError((err as Error).message ?? "Failed to register");
          }
        });
      }}
      className="space-y-5 max-w-lg"
    >
      <div className="space-y-2">
        <Label htmlFor="displayName">Display name</Label>
        <Input id="displayName" name="displayName" required placeholder="e.g. PantryRestocker" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="agentType">Agent type</Label>
        <select id="agentType" name="agentType" defaultValue="shopping" className="block w-full rounded-md border bg-background px-3 py-2 text-sm">
          <option value="shopping">Shopping</option>
          <option value="research">Research</option>
          <option value="general">General</option>
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="spendCapDollars">Spend cap (USD)</Label>
        <Input id="spendCapDollars" name="spendCapDollars" type="number" step="0.01" min="0" placeholder="200.00" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="expiresAt">Expires (optional)</Label>
        <Input id="expiresAt" name="expiresAt" type="date" />
      </div>
      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>{pending ? "Registering…" : "Register agent"}</Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
```

**Step 3: `/me/agents/new/page.tsx`**

```tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { RegisterAgentForm } from "@/components/register-agent-form";

export default async function NewAgentPage() {
  const store = await cookies();
  const { session } = getAuth();
  const current = await session.getCurrentSession({ cookies: { get: (n: string) => store.get(n) } });
  if (!current) redirect("/login?return_to=/me/agents/new");

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 space-y-6">
      <h1 className="text-3xl font-bold">Register an agent</h1>
      <p className="text-sm text-muted-foreground">
        Agents shop on your behalf. We'll create a Kratos identity, a Hydra OAuth2 client, and a Keto delegation tuple.
      </p>
      <RegisterAgentForm />
    </div>
  );
}
```

**Step 4: AgentCard component**

`components/agent-card.tsx`:

```tsx
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
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{props.agentType}</div>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs ${isRevoked ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"}`}>
          {isRevoked ? "Revoked" : "Active"}
        </span>
      </div>
      <div className="text-sm text-muted-foreground space-y-1">
        {props.spendCapCents != null && (
          <div>Spend cap: <span className="font-medium text-foreground">{formatCents(props.spendCapCents)}</span></div>
        )}
        {props.expiresAt && (
          <div>Expires: <span className="font-medium text-foreground">{props.expiresAt.toLocaleDateString()}</span></div>
        )}
        <div className="font-mono text-xs">OAuth2 client: {props.hydraClientId.slice(0, 12)}…</div>
      </div>
      {!isRevoked && (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => startTransition(async () => {
            await revokeAgentAction(props.id);
            router.refresh();
          })}
        >
          {pending ? "Revoking…" : "Revoke"}
        </Button>
      )}
    </div>
  );
}
```

**Step 5: Rewrite `app/me/agents/page.tsx`**

```tsx
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { getAuth } from "@/lib/auth";
import { listAgentsForUser } from "@/lib/agents";
import { Button } from "@/components/ui/button";
import { AgentCard } from "@/components/agent-card";

export default async function AgentsPage() {
  const store = await cookies();
  const { session } = getAuth();
  const current = await session.getCurrentSession({ cookies: { get: (n: string) => store.get(n) } });
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
```

**Step 6: Visual smoke test**

```bash
pnpm dev &
DEV_PID=$!
sleep 8
# Anonymous → middleware redirect
curl -sI http://localhost:3000/me/agents 2>&1 | grep -E "(HTTP|location)" | head -3
curl -sI http://localhost:3000/me/agents/new 2>&1 | grep -E "(HTTP|location)" | head -3
kill $DEV_PID 2>/dev/null || true
wait $DEV_PID 2>/dev/null || true
```

Both should redirect to /login (middleware).

**Step 7: Commit**

```bash
pnpm typecheck
pnpm lint
git add -A
git commit -m "feat(agents): /me/agents list + new form + AgentCard"
```

If blocked, report BLOCKED.

---

## Task 7: E2E agents + README + final verification

**Files:**
- Create: `e2e/agents.spec.ts`
- Modify: `README.md`

**Step 1: E2E**

The fixture provides a `testUser`. We add an agents spec that:
1. Signs in.
2. Visits `/me/agents` → sees empty state.
3. Clicks "Register agent" → fills form → submits.
4. Sees the new agent card with Active status.
5. Clicks "Revoke" → reloads → status changes to "Revoked".
6. Reloads /me/agents → revoked agent still shown with the Revoked pill.

Borrow the `gotoAuthenticated` pattern from `e2e/fixtures/test-identity.ts`.

```ts
import { test, expect } from "./fixtures/test-identity";
import { gotoAuthenticated } from "./fixtures/test-identity";

test("register and revoke an agent", async ({ page, testUser }) => {
  await gotoAuthenticated(page, testUser, "/me/agents");

  await expect(page.getByRole("heading", { name: "My agents" })).toBeVisible();
  await expect(page.getByText(/No agents yet/)).toBeVisible();

  await page.getByRole("link", { name: "Register agent" }).click();
  await page.waitForURL(/\/me\/agents\/new/);

  await page.getByLabel("Display name").fill("Playwright Bot");
  await page.getByLabel("Agent type").selectOption("shopping");
  await page.getByLabel("Spend cap (USD)").fill("75");
  await page.getByRole("button", { name: /Register agent/i }).click();

  await page.waitForURL(/\/me\/agents$/);
  await expect(page.getByText("Playwright Bot")).toBeVisible();
  await expect(page.getByText("Active")).toBeVisible();

  await page.getByRole("button", { name: /Revoke/ }).click();
  await expect(page.getByText("Revoked")).toBeVisible({ timeout: 5000 });
});
```

**Adapting if the form labels don't match Playwright's accessor**: the spec uses `getByLabel("Display name")` which requires the `<label htmlFor="displayName">` from the form. If Playwright can't find it (test-id mismatch), use `page.locator("#displayName")` etc.

**Step 2: README**

Add a section after "Permissions":

```markdown
## Agents

Signed-in users can register AI agents at `/me/agents/new`. Each registered agent is a real entity in three places:

- **Kratos** — a separate identity with the agent schema (traits include `owner_identity_id`, `agent_type`, `display_name`).
- **Hydra** — an OAuth2 client (with `grant_types: ["client_credentials"]` for Phase 4; Phase 7 adds device-code).
- **Keto** — an `Agent:{aid}#owner@User:{uid}` tuple.

The local DB (`agents` table) denormalizes display name, spend cap, expiry, and revocation timestamp for fast queries.

Revoking an agent: invalidates the Hydra OAuth2 client, deletes the Keto tuple, and stamps the local row's `revoked_at` (the Kratos identity is kept for audit).

Future phases: Phase 6 binds agents to Skyfire KYA Pay credentials; Phase 7 wires the Hydra Login/Consent flow so an agent's KYA token can be exchanged for a delegated user-bound access token.
```

**Step 3: Full local CI sequence**

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test           # ~55+ unit tests
pnpm test:e2e       # 7 e2e tests (smoke, browse, auth, checkout, ownership-anon, ownership-keto, agents)
./scripts/ory-setup/apply.sh
```

All exit 0.

**Step 4: Commit**

```bash
git add -A
git commit -m "test(e2e) + docs: agents e2e + README phase 4 section"
```

If blocked, report BLOCKED.

---

## Final verification

- [ ] **Step 1: Full CI sequence passes** — typecheck, lint, vitest (~55 tests), playwright (7 e2e tests), apply.sh.

- [ ] **Step 2: Manual demo flow** —
  1. Sign in.
  2. Click your email → `/me`.
  3. Click "My agents" → empty state.
  4. Click "Register agent" → fill form (name, type, cap) → submit.
  5. See your agent in the list with "Active" badge.
  6. Click "Revoke" → status flips to "Revoked".
  7. Sign out, sign in as a different user → `/me/agents` is empty for them (filtered by owner).

- [ ] **Step 3: Tree clean, on main, ~68 commits total.**

---

## Phase 4 complete

End state:
- Agent identity schema applied to Ory project alongside user schema.
- `IdentityProvider` and `OAuth2ClientProvider` interfaces support agents with Memory + Ory implementations.
- `/me/agents/new` registers an agent across Kratos + Hydra + Keto + local DB in one action.
- `/me/agents` lists active and revoked agents with status pills.
- Revocation invalidates the Hydra client, removes the Keto tuple, and stamps the local row.
- Contract test suite covers Memory adapter for both interfaces.
- E2E test exercises the full registration → revocation flow.

**Next:** Phase 5 — Agent surfaces (MCP server, ACP JSON, browser-checkout path). Agents will use their OAuth2 client_credentials to authenticate to the merchant's MCP server and browse products. KYA Pay validation arrives in Phase 6. See `phase-5-agent-surfaces.md` (to be written when Phase 4 is complete).
