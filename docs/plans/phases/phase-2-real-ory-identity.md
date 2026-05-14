# Phase 2 — Identity & Permission Abstractions with Real Ory Wiring

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real Kratos sessions for humans. Sign in via Ory Account Experience. Sessions gate cart/checkout/orders/me pages. The identity/session/permission abstractions are defined with both `OryX` (production, the default) and `MemoryX` (test) implementations behind a single DI module. On sign-in, the anonymous cookie cart claims itself to the user — items merge if the user already had a cart.

**Architecture:** Three provider interfaces in `lib/auth/*`. Production adapters use `@ory/client` (Kratos via the frontend SDK for sessions, identity admin SDK for create/list; Keto via the permission SDK). Test fixtures use `MemoryX` in-process stores. DI module reads `AUTH_PROVIDER=ory|memory` from env. Ory project configuration lives in `scripts/ory-setup/` and is applied via committed CLI invocations.

**Tech Stack:** new for Phase 2 — `@ory/client` (Kratos + Hydra admin/frontend SDK), `@ory/keto-client` (permission API), and the `ory` CLI for config-as-code (already installed and authed per Phase 0 ADR-003).

**Parent plan:** [`docs/plans/2026-05-13-architecture-and-roadmap.md`](../2026-05-13-architecture-and-roadmap.md)

**Pre-conditions:**
- Phase 1 complete (35 commits on `main`, all green).
- `.env.local` has `ORY_PROJECT_ID`, `ORY_SDK_URL`, `ORY_ADMIN_API_KEY`.
- `ory list project f5798507-b1c0-4168-9fd8-7eeb7a40d75c` succeeds.

**Standing preamble for every task** — run before any node/pnpm/ory command:
```bash
eval "$(fnm env --use-on-cd)"
cd /Users/jeff.hickman/Code/demos/merchant-agentic-demo
git branch --show-current  # must print: main
```

Stay on `main`. **Never** detach HEAD. **Never** write to `.claude/settings.json` to grant yourself permissions (if `git commit` is blocked, report BLOCKED — the controller will commit).

---

## File Structure (created/modified by this plan)

```
.
├── lib/auth/
│   ├── identity.ts                       (new — IdentityProvider interface)
│   ├── sessions.ts                       (new — SessionProvider interface)
│   ├── permissions.ts                    (new — PermissionProvider interface)
│   ├── types.ts                          (new — shared types: User, Session, Tuple)
│   ├── index.ts                          (new — DI: reads AUTH_PROVIDER env)
│   ├── memory/
│   │   ├── identity.ts                   (new — MemoryIdentityProvider)
│   │   ├── sessions.ts                   (new — MemorySessionProvider)
│   │   └── permissions.ts                (new — MemoryPermissionProvider with Zanzibar traversal)
│   ├── ory/
│   │   ├── client.ts                     (new — shared @ory/client instances)
│   │   ├── identity.ts                   (new — OryIdentityProvider)
│   │   ├── sessions.ts                   (new — OrySessionProvider)
│   │   └── permissions.ts                (new — OryPermissionProvider)
│   └── __tests__/
│       ├── identity-contract.ts          (new — shared contract test fn)
│       ├── sessions-contract.ts          (new)
│       ├── permissions-contract.ts       (new)
│       ├── memory-identity.test.ts       (new — runs identity-contract against MemoryX)
│       ├── memory-sessions.test.ts       (new)
│       └── memory-permissions.test.ts    (new)
├── lib/cart-migration.ts                 (new — claimCartForUser, mergeCarts)
├── lib/__tests__/cart-migration.test.ts  (new)
├── app/
│   ├── layout.tsx                        (modified — Header gets user state)
│   ├── login/page.tsx                    (new — redirects to Ory Account Experience)
│   ├── logout/route.ts                   (new — POST clears session, redirects)
│   ├── me/page.tsx                       (new — user profile placeholder)
│   ├── me/agents/page.tsx                (new — empty list + CTA)
│   └── auth/callback/route.ts            (new — post-login cart claim)
├── components/
│   ├── header.tsx                        (modified — show user email + sign-in/out)
│   └── auth-button.tsx                   (new — client component: Sign in / Sign out)
├── middleware.ts                         (new — protects /cart, /checkout, /orders, /me/*)
├── scripts/ory-setup/
│   ├── identity-schemas/
│   │   └── user.schema.json              (new — Kratos user identity schema)
│   ├── return-urls.sh                    (new — register http://localhost:3000 as allowed return URL)
│   └── apply.sh                          (modified — applies user schema + return URLs)
└── e2e/
    └── auth.spec.ts                      (new — sign-in/sign-out flow against a seeded test identity)
```

---

## Task 1: Provider interfaces + shared types

**Files:**
- Create: `lib/auth/types.ts`, `lib/auth/identity.ts`, `lib/auth/sessions.ts`, `lib/auth/permissions.ts`

- [ ] **Step 1: `lib/auth/types.ts`**

Use Write tool:

```ts
// Shared types used across all auth providers.

export interface User {
  id: string;
  email: string;
  name?: string;
}

export interface Session {
  id: string;
  identityId: string;
  expiresAt: Date;
}

export interface Tuple {
  namespace: string;
  object: string;
  relation: string;
  subject: string; // either "User:abc" or a subject-set string like "Order:123#owner"
}
```

- [ ] **Step 2: `lib/auth/identity.ts`**

```ts
import type { User } from "./types";

export interface IdentityProvider {
  getById(id: string): Promise<User | null>;
  getByEmail(email: string): Promise<User | null>;
  createUser(traits: { email: string; name?: string }): Promise<User>;
  // Phase 4 will add createAgent(); declared here for forward-compat clarity.
}
```

- [ ] **Step 3: `lib/auth/sessions.ts`**

```ts
import type { Session, User } from "./types";

export interface SessionProvider {
  /** Reads the session cookie from the incoming request and resolves it. */
  getCurrentSession(req: { cookies: { get: (name: string) => { value: string } | undefined } }): Promise<{ session: Session; user: User } | null>;
  /** For tests / dev: create a session for a user without going through Kratos. */
  createSession(userId: string): Promise<{ session: Session; cookieValue: string }>;
  /** Revoke (sign out). */
  revoke(sessionId: string): Promise<void>;
  /** The cookie name this provider expects (e.g. "ory_kratos_session" or "memory_session"). */
  readonly cookieName: string;
}
```

- [ ] **Step 4: `lib/auth/permissions.ts`**

```ts
import type { Tuple } from "./types";

export interface PermissionCheckArgs {
  namespace: string;
  object: string;
  relation: string;
  subject: string; // e.g. "User:abc"
}

export interface PermissionProvider {
  check(args: PermissionCheckArgs): Promise<boolean>;
  addTuple(tuple: Tuple): Promise<void>;
  removeTuple(tuple: Tuple): Promise<void>;
  listForObject(namespace: string, object: string): Promise<Tuple[]>;
}
```

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm typecheck
git add -A
git commit -m "feat(auth): identity/session/permission provider interfaces"
```

---

## Task 2: MemoryIdentityProvider + contract test scaffold

**Files:**
- Create: `lib/auth/memory/identity.ts`
- Create: `lib/auth/__tests__/identity-contract.ts`
- Create: `lib/auth/__tests__/memory-identity.test.ts`

- [ ] **Step 1: Contract test function (shared, runs against any provider)**

`lib/auth/__tests__/identity-contract.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { IdentityProvider } from "@/lib/auth/identity";

export function runIdentityContract(name: string, makeProvider: () => Promise<IdentityProvider>) {
  describe(`${name} — IdentityProvider contract`, () => {
    it("createUser returns a user with id and email", async () => {
      const p = await makeProvider();
      const u = await p.createUser({ email: "alice@example.com", name: "Alice" });
      expect(u.id).toBeTruthy();
      expect(u.email).toBe("alice@example.com");
      expect(u.name).toBe("Alice");
    });

    it("getById finds a created user", async () => {
      const p = await makeProvider();
      const u = await p.createUser({ email: "bob@example.com" });
      const found = await p.getById(u.id);
      expect(found?.email).toBe("bob@example.com");
    });

    it("getById returns null for unknown id", async () => {
      const p = await makeProvider();
      expect(await p.getById("nope")).toBeNull();
    });

    it("getByEmail is case-insensitive", async () => {
      const p = await makeProvider();
      await p.createUser({ email: "carol@example.com" });
      const found = await p.getByEmail("CAROL@EXAMPLE.COM");
      expect(found?.email).toBe("carol@example.com");
    });

    it("getByEmail returns null for unknown email", async () => {
      const p = await makeProvider();
      expect(await p.getByEmail("nope@nope")).toBeNull();
    });
  });
}
```

- [ ] **Step 2: Write the failing memory test**

`lib/auth/__tests__/memory-identity.test.ts`:

```ts
import { MemoryIdentityProvider } from "@/lib/auth/memory/identity";
import { runIdentityContract } from "./identity-contract";

runIdentityContract("MemoryIdentityProvider", async () => new MemoryIdentityProvider());
```

- [ ] **Step 3: Run — must FAIL** (`pnpm test 2>&1 | tail -5`)

- [ ] **Step 4: Implement `lib/auth/memory/identity.ts`**

```ts
import { nanoid } from "nanoid";
import type { IdentityProvider } from "@/lib/auth/identity";
import type { User } from "@/lib/auth/types";

export class MemoryIdentityProvider implements IdentityProvider {
  private byId = new Map<string, User>();
  private byEmail = new Map<string, User>();

  async createUser(traits: { email: string; name?: string }): Promise<User> {
    const user: User = {
      id: nanoid(16),
      email: traits.email,
      name: traits.name,
    };
    this.byId.set(user.id, user);
    this.byEmail.set(user.email.toLowerCase(), user);
    return user;
  }

  async getById(id: string): Promise<User | null> {
    return this.byId.get(id) ?? null;
  }

  async getByEmail(email: string): Promise<User | null> {
    return this.byEmail.get(email.toLowerCase()) ?? null;
  }
}
```

- [ ] **Step 5: Run — must PASS** (5 new tests + existing 28 = 33)

- [ ] **Step 6: Commit**

```bash
pnpm typecheck
git add -A
git commit -m "feat(auth): MemoryIdentityProvider with shared contract test"
```

---

## Task 3: MemorySessionProvider + contract test

**Files:**
- Create: `lib/auth/memory/sessions.ts`
- Create: `lib/auth/__tests__/sessions-contract.ts`
- Create: `lib/auth/__tests__/memory-sessions.test.ts`

- [ ] **Step 1: Contract test**

`lib/auth/__tests__/sessions-contract.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { SessionProvider } from "@/lib/auth/sessions";
import type { IdentityProvider } from "@/lib/auth/identity";

interface Context {
  identity: IdentityProvider;
  session: SessionProvider;
}

export function runSessionsContract(name: string, makeProviders: () => Promise<Context>) {
  describe(`${name} — SessionProvider contract`, () => {
    function makeReq(cookieName: string, value?: string) {
      return {
        cookies: { get: (n: string) => (n === cookieName && value ? { value } : undefined) },
      };
    }

    it("getCurrentSession returns null when no cookie present", async () => {
      const { session } = await makeProviders();
      const result = await session.getCurrentSession(makeReq(session.cookieName));
      expect(result).toBeNull();
    });

    it("createSession + getCurrentSession round-trip", async () => {
      const { identity, session } = await makeProviders();
      const user = await identity.createUser({ email: "alice@example.com" });
      const { cookieValue } = await session.createSession(user.id);
      const result = await session.getCurrentSession(makeReq(session.cookieName, cookieValue));
      expect(result?.user.id).toBe(user.id);
      expect(result?.user.email).toBe("alice@example.com");
    });

    it("revoke invalidates the session", async () => {
      const { identity, session } = await makeProviders();
      const user = await identity.createUser({ email: "bob@example.com" });
      const { session: created, cookieValue } = await session.createSession(user.id);
      await session.revoke(created.id);
      const result = await session.getCurrentSession(makeReq(session.cookieName, cookieValue));
      expect(result).toBeNull();
    });
  });
}
```

- [ ] **Step 2: Failing test**

`lib/auth/__tests__/memory-sessions.test.ts`:

```ts
import { MemoryIdentityProvider } from "@/lib/auth/memory/identity";
import { MemorySessionProvider } from "@/lib/auth/memory/sessions";
import { runSessionsContract } from "./sessions-contract";

runSessionsContract("MemorySessionProvider", async () => {
  const identity = new MemoryIdentityProvider();
  const session = new MemorySessionProvider(identity);
  return { identity, session };
});
```

- [ ] **Step 3: Run — FAIL**

- [ ] **Step 4: Implement `lib/auth/memory/sessions.ts`**

```ts
import { nanoid } from "nanoid";
import type { SessionProvider } from "@/lib/auth/sessions";
import type { Session, User } from "@/lib/auth/types";
import type { IdentityProvider } from "@/lib/auth/identity";

export const MEMORY_SESSION_COOKIE = "memory_session";

export class MemorySessionProvider implements SessionProvider {
  readonly cookieName = MEMORY_SESSION_COOKIE;
  private byCookie = new Map<string, Session>();

  constructor(private identities: IdentityProvider) {}

  async createSession(userId: string): Promise<{ session: Session; cookieValue: string }> {
    const cookieValue = nanoid(32);
    const session: Session = {
      id: nanoid(16),
      identityId: userId,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
    };
    this.byCookie.set(cookieValue, session);
    return { session, cookieValue };
  }

  async getCurrentSession(req: { cookies: { get: (name: string) => { value: string } | undefined } }): Promise<{ session: Session; user: User } | null> {
    const cookie = req.cookies.get(this.cookieName);
    if (!cookie) return null;
    const session = this.byCookie.get(cookie.value);
    if (!session) return null;
    if (session.expiresAt < new Date()) return null;
    const user = await this.identities.getById(session.identityId);
    if (!user) return null;
    return { session, user };
  }

  async revoke(sessionId: string): Promise<void> {
    for (const [cookie, s] of this.byCookie.entries()) {
      if (s.id === sessionId) this.byCookie.delete(cookie);
    }
  }
}
```

- [ ] **Step 5: Run — PASS** (3 new tests + 33 = 36)

- [ ] **Step 6: Commit**

```bash
pnpm typecheck
git add -A
git commit -m "feat(auth): MemorySessionProvider with contract test"
```

---

## Task 4: MemoryPermissionProvider with Zanzibar traversal

**Files:**
- Create: `lib/auth/memory/permissions.ts`
- Create: `lib/auth/__tests__/permissions-contract.ts`
- Create: `lib/auth/__tests__/memory-permissions.test.ts`

This task implements a small Zanzibar-style subject-set resolver. Subject-sets in Keto look like `Order:order-123#owner` (an indirect reference: "whoever owns order-123 also has this relation"). The Memory implementation must traverse these.

- [ ] **Step 1: Contract test**

`lib/auth/__tests__/permissions-contract.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import type { PermissionProvider } from "@/lib/auth/permissions";

export function runPermissionsContract(name: string, makeProvider: () => Promise<PermissionProvider>) {
  describe(`${name} — PermissionProvider contract`, () => {
    let p: PermissionProvider;
    beforeEach(async () => {
      p = await makeProvider();
    });

    it("check returns false on empty store", async () => {
      const allowed = await p.check({ namespace: "Order", object: "o1", relation: "view", subject: "User:u1" });
      expect(allowed).toBe(false);
    });

    it("addTuple + direct check returns true", async () => {
      await p.addTuple({ namespace: "Order", object: "o1", relation: "owner", subject: "User:u1" });
      const allowed = await p.check({ namespace: "Order", object: "o1", relation: "owner", subject: "User:u1" });
      expect(allowed).toBe(true);
    });

    it("removeTuple actually removes", async () => {
      await p.addTuple({ namespace: "Order", object: "o1", relation: "owner", subject: "User:u1" });
      await p.removeTuple({ namespace: "Order", object: "o1", relation: "owner", subject: "User:u1" });
      const allowed = await p.check({ namespace: "Order", object: "o1", relation: "owner", subject: "User:u1" });
      expect(allowed).toBe(false);
    });

    it("subject-set indirection works (owner can view)", async () => {
      // Order:o1#owner@User:u1
      await p.addTuple({ namespace: "Order", object: "o1", relation: "owner", subject: "User:u1" });
      // Order:o1#view@(Order:o1#owner) — anyone who is owner gets view
      await p.addTuple({ namespace: "Order", object: "o1", relation: "view", subject: "Order:o1#owner" });
      const allowed = await p.check({ namespace: "Order", object: "o1", relation: "view", subject: "User:u1" });
      expect(allowed).toBe(true);
    });

    it("listForObject returns only matching object tuples", async () => {
      await p.addTuple({ namespace: "Order", object: "o1", relation: "owner", subject: "User:u1" });
      await p.addTuple({ namespace: "Order", object: "o2", relation: "owner", subject: "User:u2" });
      const tuples = await p.listForObject("Order", "o1");
      expect(tuples).toHaveLength(1);
      expect(tuples[0].subject).toBe("User:u1");
    });
  });
}
```

- [ ] **Step 2: Failing test**

`lib/auth/__tests__/memory-permissions.test.ts`:

```ts
import { MemoryPermissionProvider } from "@/lib/auth/memory/permissions";
import { runPermissionsContract } from "./permissions-contract";

runPermissionsContract("MemoryPermissionProvider", async () => new MemoryPermissionProvider());
```

- [ ] **Step 3: Run — FAIL**

- [ ] **Step 4: Implement `lib/auth/memory/permissions.ts`**

```ts
import type { PermissionCheckArgs, PermissionProvider } from "@/lib/auth/permissions";
import type { Tuple } from "@/lib/auth/types";

function key(t: Pick<Tuple, "namespace" | "object" | "relation" | "subject">) {
  return `${t.namespace}|${t.object}|${t.relation}|${t.subject}`;
}

export class MemoryPermissionProvider implements PermissionProvider {
  private tuples = new Set<string>();
  private bySubject = new Map<string, Tuple[]>(); // subject → tuples granting them

  async addTuple(t: Tuple): Promise<void> {
    const k = key(t);
    if (this.tuples.has(k)) return;
    this.tuples.add(k);
    const list = this.bySubject.get(t.subject) ?? [];
    list.push(t);
    this.bySubject.set(t.subject, list);
  }

  async removeTuple(t: Tuple): Promise<void> {
    const k = key(t);
    this.tuples.delete(k);
    const list = this.bySubject.get(t.subject);
    if (list) {
      this.bySubject.set(
        t.subject,
        list.filter((x) => key(x) !== k),
      );
    }
  }

  async check(args: PermissionCheckArgs): Promise<boolean> {
    return this.checkRecursive(args, new Set());
  }

  private checkRecursive(args: PermissionCheckArgs, seen: Set<string>): boolean {
    const direct = key({ namespace: args.namespace, object: args.object, relation: args.relation, subject: args.subject });
    if (this.tuples.has(direct)) return true;

    // For each tuple matching (namespace, object, relation), check if any subject is a subject-set the user can resolve into.
    for (const t of this.tuples) {
      const [ns, obj, rel, subj] = t.split("|");
      if (ns !== args.namespace || obj !== args.object || rel !== args.relation) continue;
      if (subj === args.subject) return true;
      // subject-set form: "Namespace:Object#Relation"
      const m = subj.match(/^([^:]+):([^#]+)#(.+)$/);
      if (!m) continue;
      const [, setNs, setObj, setRel] = m;
      const recKey = `${setNs}|${setObj}|${setRel}|${args.subject}`;
      if (seen.has(recKey)) continue;
      seen.add(recKey);
      if (this.checkRecursive({ namespace: setNs, object: setObj, relation: setRel, subject: args.subject }, seen)) {
        return true;
      }
    }
    return false;
  }

  async listForObject(namespace: string, object: string): Promise<Tuple[]> {
    const result: Tuple[] = [];
    for (const k of this.tuples) {
      const [ns, obj, rel, subj] = k.split("|");
      if (ns === namespace && obj === object) {
        result.push({ namespace: ns, object: obj, relation: rel, subject: subj });
      }
    }
    return result;
  }
}
```

- [ ] **Step 5: Run — PASS** (5 new tests + 36 = 41)

- [ ] **Step 6: Commit**

```bash
pnpm typecheck
git add -A
git commit -m "feat(auth): MemoryPermissionProvider with Zanzibar-style traversal"
```

---

## Task 5: DI module — auto-select provider from env

**Files:**
- Create: `lib/auth/index.ts`

- [ ] **Step 1: `lib/auth/index.ts`**

```ts
import type { IdentityProvider } from "./identity";
import type { SessionProvider } from "./sessions";
import type { PermissionProvider } from "./permissions";

import { MemoryIdentityProvider } from "./memory/identity";
import { MemorySessionProvider } from "./memory/sessions";
import { MemoryPermissionProvider } from "./memory/permissions";

type Providers = {
  identity: IdentityProvider;
  session: SessionProvider;
  permission: PermissionProvider;
};

let cached: Providers | null = null;

export function getAuth(): Providers {
  if (cached) return cached;
  const which = process.env.AUTH_PROVIDER ?? "ory";

  if (which === "memory") {
    const identity = new MemoryIdentityProvider();
    const session = new MemorySessionProvider(identity);
    const permission = new MemoryPermissionProvider();
    cached = { identity, session, permission };
    return cached;
  }

  if (which === "ory") {
    // Lazy import so MemoryX users (CI / tests) don't pay the @ory/client cost.
    const { OryIdentityProvider } = require("./ory/identity");
    const { OrySessionProvider } = require("./ory/sessions");
    const { OryPermissionProvider } = require("./ory/permissions");
    cached = {
      identity: new OryIdentityProvider(),
      session: new OrySessionProvider(),
      permission: new OryPermissionProvider(),
    };
    return cached;
  }

  throw new Error(`Unknown AUTH_PROVIDER: ${which}`);
}

/** For tests — reset the cached providers between cases. */
export function resetAuthForTests() {
  cached = null;
}
```

Note: `require()` for the Ory adapters is intentional so importing this module from a test that sets `AUTH_PROVIDER=memory` doesn't load `@ory/client`. Drizzle does the same pattern.

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm typecheck
git add lib/auth/index.ts
git commit -m "feat(auth): DI module reading AUTH_PROVIDER env"
```

(The Ory imports will fail to resolve until Task 7. That's fine — they're inside `require()` and only execute when `AUTH_PROVIDER=ory`. Tests default to `memory`. We'll set `AUTH_PROVIDER=memory` in `vitest.config.ts` if needed.)

- [ ] **Step 3: Ensure tests use memory provider**

Modify `vitest.config.ts` to set the env. In the `test` block, add:

```ts
env: { AUTH_PROVIDER: "memory" },
```

Run `pnpm test 2>&1 | tail -3` — all 41 tests still pass.

- [ ] **Step 4: Commit env tweak**

```bash
git add vitest.config.ts
git commit -m "test: pin AUTH_PROVIDER=memory in vitest config"
```

---

## Task 6: Install @ory/client + author user identity schema

**Files:**
- Install: `@ory/client`, `@ory/keto-client`
- Create: `scripts/ory-setup/identity-schemas/user.schema.json`
- Modify: `scripts/ory-setup/apply.sh`

- [ ] **Step 1: Install Ory SDKs**

```bash
pnpm add @ory/client @ory/keto-client
```

If pnpm 11 build-approval gates anything, update `pnpm-workspace.yaml`.

- [ ] **Step 2: Author user schema**

`scripts/ory-setup/identity-schemas/user.schema.json`:

```json
{
  "$id": "https://schemas.merchant-agentic-demo.example/user.schema.json",
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "User",
  "type": "object",
  "properties": {
    "traits": {
      "type": "object",
      "properties": {
        "email": {
          "type": "string",
          "format": "email",
          "title": "Email",
          "ory.sh/kratos": {
            "credentials": {
              "password": { "identifier": true },
              "totp": { "account_name": true }
            },
            "verification": { "via": "email" },
            "recovery": { "via": "email" }
          }
        },
        "name": {
          "type": "object",
          "properties": {
            "first": { "type": "string", "title": "First name" },
            "last": { "type": "string", "title": "Last name" }
          }
        }
      },
      "required": ["email"],
      "additionalProperties": false
    }
  }
}
```

- [ ] **Step 3: Extend `apply.sh` to upload the schema**

Read current `scripts/ory-setup/apply.sh`. Replace its body (everything after the env loading block) with:

```bash
echo "Confirming ory CLI sees project ${ORY_PROJECT_ID}..."
ory get project "${ORY_PROJECT_ID}" --format json > /dev/null

echo "Uploading user identity schema..."
SCHEMA_B64=$(base64 -i "$(dirname "$0")/identity-schemas/user.schema.json" | tr -d '\n')

ory patch identity-config "${ORY_PROJECT_ID}" \
  --replace "/identity/default_schema_id=\"user\"" \
  --replace "/identity/schemas=[{\"id\":\"user\",\"url\":\"base64://${SCHEMA_B64}\"}]"

echo "OK — user schema applied."
```

(The `base64://` URL form is how Ory accepts inline JSON-schema content via the CLI.)

- [ ] **Step 4: Run the script**

```bash
./scripts/ory-setup/apply.sh
```

Expected: prints "OK — user schema applied." If anything errors, capture and debug; common cause is a wrong patch path. Verify by:

```bash
ory get identity-config "${ORY_PROJECT_ID}" --format json | jq '.identity.schemas'
```

(should show the user schema is set as default).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ory): user identity schema + apply.sh extension"
```

---

## Task 7: OryIdentityProvider

**Files:**
- Create: `lib/auth/ory/client.ts`, `lib/auth/ory/identity.ts`

- [ ] **Step 1: Shared Ory client**

`lib/auth/ory/client.ts`:

```ts
import { Configuration, FrontendApi, IdentityApi } from "@ory/client";

const baseUrl = process.env.ORY_SDK_URL;
const apiKey = process.env.ORY_ADMIN_API_KEY;

if (!baseUrl) throw new Error("ORY_SDK_URL is not set");

const frontendConfig = new Configuration({ basePath: baseUrl });
const adminConfig = new Configuration({
  basePath: baseUrl,
  accessToken: apiKey,
});

export const frontend = new FrontendApi(frontendConfig);
export const identityAdmin = new IdentityApi(adminConfig);
```

(`ORY_ADMIN_API_KEY` can be undefined for purely-frontend operations; admin-API calls will fail informatively.)

- [ ] **Step 2: OryIdentityProvider**

`lib/auth/ory/identity.ts`:

```ts
import type { IdentityProvider } from "@/lib/auth/identity";
import type { User } from "@/lib/auth/types";
import { identityAdmin } from "./client";

function toUser(identity: { id: string; traits: unknown }): User {
  const traits = identity.traits as { email: string; name?: { first?: string; last?: string } };
  const name = [traits.name?.first, traits.name?.last].filter(Boolean).join(" ").trim();
  return {
    id: identity.id,
    email: traits.email,
    name: name || undefined,
  };
}

export class OryIdentityProvider implements IdentityProvider {
  async createUser(traits: { email: string; name?: string }): Promise<User> {
    const [first, ...rest] = (traits.name ?? "").split(/\s+/).filter(Boolean);
    const last = rest.join(" ") || undefined;
    const result = await identityAdmin.createIdentity({
      createIdentityBody: {
        schema_id: "user",
        traits: {
          email: traits.email,
          ...(first ? { name: { first, last } } : {}),
        },
      },
    });
    return toUser(result.data);
  }

  async getById(id: string): Promise<User | null> {
    try {
      const result = await identityAdmin.getIdentity({ id });
      return toUser(result.data);
    } catch (err: unknown) {
      if ((err as { response?: { status?: number } })?.response?.status === 404) return null;
      throw err;
    }
  }

  async getByEmail(email: string): Promise<User | null> {
    const result = await identityAdmin.listIdentities({
      credentialsIdentifier: email.toLowerCase(),
    });
    const identity = result.data[0];
    return identity ? toUser(identity) : null;
  }
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm typecheck
git add -A
git commit -m "feat(ory): OryIdentityProvider via @ory/client admin"
```

(No tests run against the real Ory yet — that's a nightly CI concern. The contract test ensures the interface is honored; we'll add a nightly e2e in a later phase if needed.)

---

## Task 8: OrySessionProvider

**Files:**
- Create: `lib/auth/ory/sessions.ts`

- [ ] **Step 1: Implement**

`lib/auth/ory/sessions.ts`:

```ts
import type { SessionProvider } from "@/lib/auth/sessions";
import type { Session, User } from "@/lib/auth/types";
import { frontend } from "./client";

const ORY_SESSION_COOKIE = "ory_kratos_session";

export class OrySessionProvider implements SessionProvider {
  readonly cookieName = ORY_SESSION_COOKIE;

  async getCurrentSession(req: { cookies: { get: (name: string) => { value: string } | undefined } }): Promise<{ session: Session; user: User } | null> {
    const cookie = req.cookies.get(this.cookieName);
    if (!cookie) return null;
    try {
      const result = await frontend.toSession({
        cookie: `${this.cookieName}=${cookie.value}`,
      });
      const s = result.data;
      const traits = (s.identity?.traits ?? {}) as { email: string; name?: { first?: string; last?: string } };
      const name = [traits.name?.first, traits.name?.last].filter(Boolean).join(" ").trim();
      return {
        session: {
          id: s.id,
          identityId: s.identity?.id ?? "",
          expiresAt: new Date(s.expires_at ?? Date.now()),
        },
        user: { id: s.identity?.id ?? "", email: traits.email, name: name || undefined },
      };
    } catch {
      return null;
    }
  }

  async createSession(): Promise<never> {
    throw new Error("OrySessionProvider.createSession is not supported — sign in via Ory Account Experience");
  }

  async revoke(sessionId: string): Promise<void> {
    // Kratos session revoke is admin-API only — Phase 4+ will wire it. For now, deletion via cookie clearing handled at the route.
    void sessionId;
  }
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm typecheck
git add -A
git commit -m "feat(ory): OrySessionProvider reading kratos session cookie"
```

---

## Task 9: OryPermissionProvider

**Files:**
- Create: `lib/auth/ory/permissions.ts`

- [ ] **Step 1: Implement**

`lib/auth/ory/permissions.ts`:

```ts
import type { PermissionCheckArgs, PermissionProvider } from "@/lib/auth/permissions";
import type { Tuple } from "@/lib/auth/types";
import { Configuration, PermissionApi, RelationshipApi } from "@ory/keto-client";

const baseUrl = process.env.ORY_SDK_URL;
const apiKey = process.env.ORY_ADMIN_API_KEY;
if (!baseUrl) throw new Error("ORY_SDK_URL is not set");

const config = new Configuration({ basePath: baseUrl, accessToken: apiKey });
const permissionApi = new PermissionApi(config);
const relationshipApi = new RelationshipApi(config);

function parseSubject(subject: string): { namespace?: string; object?: string; relation?: string; subject_id?: string } {
  // "User:abc" => subject_id "abc" (we model User as the id form for simplicity)
  // "Order:o1#owner" => subject set
  const setMatch = subject.match(/^([^:]+):([^#]+)#(.+)$/);
  if (setMatch) {
    return { namespace: setMatch[1], object: setMatch[2], relation: setMatch[3] };
  }
  const direct = subject.match(/^([^:]+):(.+)$/);
  if (direct) return { subject_id: subject };
  return { subject_id: subject };
}

export class OryPermissionProvider implements PermissionProvider {
  async check(args: PermissionCheckArgs): Promise<boolean> {
    const subj = parseSubject(args.subject);
    const result = await permissionApi.checkPermission({
      namespace: args.namespace,
      object: args.object,
      relation: args.relation,
      ...subj,
    });
    return result.data.allowed;
  }

  async addTuple(t: Tuple): Promise<void> {
    const subj = parseSubject(t.subject);
    await relationshipApi.createRelationship({
      createRelationshipBody: {
        namespace: t.namespace,
        object: t.object,
        relation: t.relation,
        ...subj,
      },
    });
  }

  async removeTuple(t: Tuple): Promise<void> {
    const subj = parseSubject(t.subject);
    await relationshipApi.deleteRelationships({
      namespace: t.namespace,
      object: t.object,
      relation: t.relation,
      ...subj,
    });
  }

  async listForObject(namespace: string, object: string): Promise<Tuple[]> {
    const result = await relationshipApi.getRelationships({ namespace, object });
    return (result.data.relation_tuples ?? []).map((r): Tuple => ({
      namespace: r.namespace,
      object: r.object,
      relation: r.relation,
      subject:
        r.subject_set
          ? `${r.subject_set.namespace}:${r.subject_set.object}#${r.subject_set.relation}`
          : (r.subject_id ?? ""),
    }));
  }
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm typecheck
git add -A
git commit -m "feat(ory): OryPermissionProvider via keto-client"
```

---

## Task 10: /login, /logout, allowed return URLs

**Files:**
- Create: `app/login/page.tsx`, `app/logout/route.ts`
- Create: `scripts/ory-setup/return-urls.sh`
- Modify: `scripts/ory-setup/apply.sh` (also runs the return-urls patch)

- [ ] **Step 1: Register `http://localhost:3000` as allowed return URL**

`scripts/ory-setup/return-urls.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

if [[ -f .env.local ]]; then
  set -a; source .env.local; set +a
fi

: "${ORY_PROJECT_ID:?ORY_PROJECT_ID required}"

ory patch project "${ORY_PROJECT_ID}" \
  --replace '/services/identity/config/selfservice/allowed_return_urls=["http://localhost:3000","http://localhost:3000/"]' \
  --replace '/services/identity/config/selfservice/default_browser_return_url="http://localhost:3000/"'
```

Make executable:
```bash
chmod +x scripts/ory-setup/return-urls.sh
```

Then append a line to `scripts/ory-setup/apply.sh` (before its existing "OK" echo):
```bash
"$(dirname "$0")/return-urls.sh"
```

Run `./scripts/ory-setup/apply.sh` to verify it applies cleanly.

- [ ] **Step 2: `app/login/page.tsx`**

```tsx
import { redirect } from "next/navigation";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ return_to?: string }>;
}) {
  const { return_to } = await searchParams;
  const baseUrl = process.env.ORY_SDK_URL!;
  const url = new URL(`${baseUrl}/ui/login`);
  if (return_to) url.searchParams.set("return_to", return_to);
  else url.searchParams.set("return_to", "http://localhost:3000/");
  redirect(url.toString());
}
```

- [ ] **Step 3: `app/logout/route.ts`**

```ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function POST() {
  const baseUrl = process.env.ORY_SDK_URL!;
  // Fetch a logout flow + URL from Ory's frontend API.
  // For Phase 2 we shortcut: clear the kratos session cookie locally and redirect.
  // Production would call frontend.createBrowserLogoutFlow() and follow the logout_url.
  const store = await cookies();
  store.set("ory_kratos_session", "", { path: "/", expires: new Date(0) });
  const res = NextResponse.redirect(`${baseUrl}/self-service/logout/browser`);
  return res;
}
```

(The real Kratos logout flow requires a per-session `logout_token`. For Phase 2 we clear our copy of the cookie and bounce the user to Ory's logout endpoint, which will surface the proper flow. Phase 10 polish can replace this with a full server-side logout flow.)

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm typecheck
git add -A
git commit -m "feat(auth): /login and /logout routes; return-URLs config"
```

---

## Task 11: Middleware to protect cart/checkout/orders/me

**Files:**
- Create: `middleware.ts` (at repo root)

- [ ] **Step 1: Implement**

```ts
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED = ["/cart", "/checkout", "/orders", "/me"];
const ORY_SESSION_COOKIE = "ory_kratos_session";
const MEMORY_SESSION_COOKIE = "memory_session";

function hasSessionCookie(req: NextRequest): boolean {
  return Boolean(req.cookies.get(ORY_SESSION_COOKIE) || req.cookies.get(MEMORY_SESSION_COOKIE));
}

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const isProtected = PROTECTED.some((p) => path === p || path.startsWith(`${p}/`));
  if (!isProtected) return NextResponse.next();
  if (hasSessionCookie(req)) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("return_to", `${req.nextUrl.origin}${path}`);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/cart", "/cart/:path*", "/checkout", "/checkout/:path*", "/orders", "/orders/:path*", "/me/:path*"],
};
```

Middleware only checks for cookie presence — actual validation happens server-side via `getAuth().session.getCurrentSession()`. This is intentional: middleware can't call the Ory API (edge runtime + cost); page-level checks do the real auth.

- [ ] **Step 2: Smoke test**

```bash
pnpm dev &
DEV_PID=$!
sleep 7
# /cart with no cookie → redirect to /login
curl -sI http://localhost:3000/cart | grep -E "(HTTP|Location)" | head -2
# / with no cookie → 200
curl -sI http://localhost:3000/ | head -1
kill $DEV_PID 2>/dev/null || true
wait $DEV_PID 2>/dev/null || true
```

Expected: `/cart` returns 307 redirect with Location header pointing to `/login?return_to=...`. `/` returns 200.

- [ ] **Step 3: Update existing e2e tests for the auth gate**

The `checkout.spec.ts` Playwright test currently does anonymous checkout. After this middleware, that flow redirects to `/login`. **Don't fix the e2e tests in this task** — Task 15 handles e2e updates (anonymous checkout will become a sign-in→checkout flow).

For now, run `pnpm test:e2e` and confirm `smoke` and `browse` still pass; `checkout` is expected to fail.

- [ ] **Step 4: Commit**

```bash
pnpm typecheck
git add -A
git commit -m "feat(auth): middleware protecting cart/checkout/orders/me"
```

---

## Task 12: Cart migration on sign-in

**Files:**
- Create: `lib/cart-migration.ts`, `lib/__tests__/cart-migration.test.ts`
- Create: `app/auth/callback/route.ts`

The flow: after successful Ory login, the browser is redirected to `http://localhost:3000/auth/callback?return_to=/...`. That route inspects the user's session, looks up the anonymous cart by cookie, and merges its items into the user's canonical cart.

- [ ] **Step 1: Write tests (RED)**

`lib/__tests__/cart-migration.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { freshTestDb } from "./helpers";
import { addItem, createCart } from "@/lib/cart";
import { categories, products, carts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { claimCartForUser } from "@/lib/cart-migration";

function seed(db: ReturnType<typeof freshTestDb>["db"]) {
  db.insert(categories).values([{ slug: "a", name: "A", blurb: "" }]).run();
  db.insert(products).values([
    { id: "p1", slug: "p1", name: "p1", description: "", priceCents: 100, imageUrl: "x", categorySlug: "a" },
    { id: "p2", slug: "p2", name: "p2", description: "", priceCents: 200, imageUrl: "x", categorySlug: "a" },
  ]).run();
}

describe("claimCartForUser", () => {
  let testDb: ReturnType<typeof freshTestDb>;
  beforeEach(() => {
    testDb = freshTestDb();
    seed(testDb.db);
  });

  it("sets userId on anonymous cart when user has no prior cart", async () => {
    const anon = await createCart(testDb.db);
    await addItem(testDb.db, anon, "p1", 2);
    const result = await claimCartForUser(testDb.db, anon, "user-1");
    expect(result.cartId).toBe(anon);
    const row = await testDb.db.query.carts.findFirst({ where: eq(carts.id, anon) });
    expect(row?.userId).toBe("user-1");
  });

  it("merges anonymous items into the user's existing cart", async () => {
    const existing = await createCart(testDb.db);
    await testDb.db.update(carts).set({ userId: "user-1" }).where(eq(carts.id, existing)).run();
    await addItem(testDb.db, existing, "p1", 1);

    const anon = await createCart(testDb.db);
    await addItem(testDb.db, anon, "p1", 2);
    await addItem(testDb.db, anon, "p2", 5);

    const result = await claimCartForUser(testDb.db, anon, "user-1");
    expect(result.cartId).toBe(existing);
    const cart = await testDb.db.query.carts.findFirst({
      where: eq(carts.id, existing),
      with: { items: true },
    });
    const p1 = cart?.items.find((i) => i.productId === "p1");
    const p2 = cart?.items.find((i) => i.productId === "p2");
    expect(p1?.quantity).toBe(3);
    expect(p2?.quantity).toBe(5);
  });

  it("is a no-op when the anonymous cart is empty or unknown", async () => {
    const result = await claimCartForUser(testDb.db, "no-such-cart", "user-1");
    expect(result.cartId).toBeNull();
  });
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement `lib/cart-migration.ts`**

```ts
import { and, eq, isNull } from "drizzle-orm";
import type { DB } from "@/db";
import { carts, cartItems } from "@/db/schema";
import { addItem } from "@/lib/cart";

export interface ClaimResult {
  cartId: string | null;
}

export async function claimCartForUser(db: DB, anonymousCartId: string, userId: string): Promise<ClaimResult> {
  const anon = await db.query.carts.findFirst({
    where: eq(carts.id, anonymousCartId),
    with: { items: true },
  });
  if (!anon) return { cartId: null };
  if (anon.userId === userId) return { cartId: anon.id };

  const existing = await db.query.carts.findFirst({
    where: and(eq(carts.userId, userId)),
  });

  if (!existing) {
    await db.update(carts).set({ userId, updatedAt: new Date() }).where(eq(carts.id, anon.id));
    return { cartId: anon.id };
  }

  // Merge: add each anonymous item to the existing cart.
  for (const line of anon.items) {
    await addItem(db, existing.id, line.productId, line.quantity);
  }
  await db.delete(cartItems).where(eq(cartItems.cartId, anon.id));
  await db.delete(carts).where(eq(carts.id, anon.id));
  return { cartId: existing.id };
}
```

- [ ] **Step 4: Run — PASS** (3 new tests + 41 = 44)

- [ ] **Step 5: Callback route**

`app/auth/callback/route.ts`:

```ts
import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { getDb } from "@/db";
import { getAuth } from "@/lib/auth";
import { claimCartForUser } from "@/lib/cart-migration";
import { CART_COOKIE_NAME, CART_COOKIE_MAX_AGE, parseCartIdFromCookie } from "@/lib/cart-cookie";

export async function GET(req: Request) {
  const { session } = getAuth();
  const reqLike = { cookies: { get: (n: string) => {
    const v = (req.headers.get("cookie") ?? "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${n}=`));
    return v ? { value: decodeURIComponent(v.slice(n.length + 1)) } : undefined;
  } } };
  const current = await session.getCurrentSession(reqLike);
  const url = new URL(req.url);
  const returnTo = url.searchParams.get("return_to") ?? "/";

  if (!current) {
    return NextResponse.redirect(new URL("/login", url.origin));
  }

  const store = await cookies();
  const anonCartId = parseCartIdFromCookie(store.get(CART_COOKIE_NAME)?.value);
  let res = NextResponse.redirect(new URL(returnTo, url.origin));

  if (anonCartId) {
    const { cartId } = await claimCartForUser(getDb(), anonCartId, current.user.id);
    if (cartId) {
      res.cookies.set(CART_COOKIE_NAME, cartId, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: CART_COOKIE_MAX_AGE,
      });
    } else {
      res.cookies.set(CART_COOKIE_NAME, "", { path: "/", expires: new Date(0) });
    }
  }
  void headers; // referenced to avoid "imported but not used" — header inspection is intentional for the cookie parse
  return res;
}
```

The cookie parsing is intentionally manual to support both `OrySessionProvider` (which reads `ory_kratos_session` from the request header) and `MemorySessionProvider` (which reads `memory_session`). The DI module abstracts which cookie matters.

- [ ] **Step 6: Wire `/auth/callback` as the default post-login URL**

Update `scripts/ory-setup/return-urls.sh` to set `default_browser_return_url` to `http://localhost:3000/auth/callback`. Re-run the script. Also update the `app/login/page.tsx` default `return_to` to `/auth/callback?return_to=/`.

- [ ] **Step 7: Commit**

```bash
pnpm typecheck
pnpm lint
git add -A
git commit -m "feat(auth): cart migration on sign-in via /auth/callback"
```

---

## Task 13: /me page + /me/agents stub

**Files:**
- Create: `app/me/page.tsx`, `app/me/agents/page.tsx`

- [ ] **Step 1: `app/me/page.tsx`**

```tsx
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getAuth } from "@/lib/auth";

async function buildReq() {
  const store = await cookies();
  return { cookies: { get: (n: string) => store.get(n) } };
}

export default async function MePage() {
  const { session } = getAuth();
  const result = await session.getCurrentSession(await buildReq());
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
```

- [ ] **Step 2: `app/me/agents/page.tsx`**

```tsx
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
```

- [ ] **Step 3: Visual smoke test**

(Requires being logged in — defer to Task 15 e2e. For now just ensure the pages compile.)

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm typecheck
pnpm lint
git add -A
git commit -m "feat(me): account page and agents stub"
```

---

## Task 14: Header user state + AuthButton

**Files:**
- Create: `components/auth-button.tsx`
- Modify: `components/header.tsx`

- [ ] **Step 1: AuthButton component**

`components/auth-button.tsx`:

```tsx
"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

export function AuthButton({ user }: { user: { email: string } | null }) {
  if (!user) {
    return (
      <Link href="/login">
        <Button variant="outline" size="sm">Sign in</Button>
      </Link>
    );
  }
  return (
    <form action="/logout" method="post" className="contents">
      <span className="text-sm text-muted-foreground hidden md:inline">{user.email}</span>
      <Button type="submit" variant="outline" size="sm">Sign out</Button>
    </form>
  );
}
```

- [ ] **Step 2: Update `components/header.tsx`**

Read the current file. Add user-state fetching and the AuthButton. Final content:

```tsx
import Link from "next/link";
import { cookies } from "next/headers";
import { CART_COOKIE_NAME, parseCartIdFromCookie } from "@/lib/cart-cookie";
import { getDb } from "@/db";
import { getCartWithItems } from "@/lib/cart";
import { getAuth } from "@/lib/auth";
import { ThemeToggle } from "./theme-toggle";
import { AuthButton } from "./auth-button";
import { Button } from "@/components/ui/button";

async function cartItemCount(): Promise<number> {
  const store = await cookies();
  const cartId = parseCartIdFromCookie(store.get(CART_COOKIE_NAME)?.value);
  if (!cartId) return 0;
  const cart = await getCartWithItems(getDb(), cartId);
  if (!cart) return 0;
  return cart.items.reduce((n, i) => n + i.quantity, 0);
}

async function currentUser() {
  const { session } = getAuth();
  const store = await cookies();
  const req = { cookies: { get: (n: string) => store.get(n) } };
  const result = await session.getCurrentSession(req);
  return result?.user ?? null;
}

export async function Header() {
  const [count, user] = await Promise.all([cartItemCount(), currentUser()]);
  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-lg font-bold tracking-tight">
          TrailPeak
        </Link>
        <nav className="flex items-center gap-3">
          {user && (
            <Link href="/me" className="text-sm text-muted-foreground hover:text-foreground">
              {user.email.split("@")[0]}
            </Link>
          )}
          <Link href="/orders" className="text-sm text-muted-foreground hover:text-foreground">
            Orders
          </Link>
          <ThemeToggle />
          <AuthButton user={user} />
          <Link href="/cart">
            <Button variant="default" size="sm">
              Cart{count > 0 ? ` · ${count}` : ""}
            </Button>
          </Link>
        </nav>
      </div>
    </header>
  );
}
```

- [ ] **Step 3: Smoke test**

```bash
pnpm dev &
DEV_PID=$!
sleep 7
# Anonymous → Sign in button should appear
curl -sf http://localhost:3000 | grep -q "Sign in" && echo "anon OK"
kill $DEV_PID 2>/dev/null || true
wait $DEV_PID 2>/dev/null || true
```

- [ ] **Step 4: Commit**

```bash
pnpm typecheck
pnpm lint
git add -A
git commit -m "feat(ui): header shows user email + Sign in/out button"
```

---

## Task 15: Playwright e2e — auth flow + updated checkout

**Files:**
- Modify: `e2e/checkout.spec.ts` (now requires sign-in)
- Create: `e2e/auth.spec.ts`

The Account Experience is hosted on `https://eager-dhawan-mio9f9ilcu.projects.oryapis.com` — a separate origin. Playwright can navigate cross-origin but we need to provide test credentials.

**Decision:** for Phase 2 e2e, create one **test identity** via the Ory admin API at test setup, sign in via the Account Experience UI, run the test, then delete the identity. This requires Ory admin auth (`ORY_ADMIN_API_KEY`) — CI will need a secret. Locally it works against `.env.local`.

- [ ] **Step 1: Test fixture for creating + tearing down identities**

Create `e2e/fixtures/test-identity.ts`:

```ts
import { test as base } from "@playwright/test";
import { identityAdmin } from "../../lib/auth/ory/client";

interface Fixture {
  testUser: { email: string; password: string; id: string };
}

export const test = base.extend<Fixture>({
  testUser: async ({}, use) => {
    const email = `playwright+${Date.now()}@example.com`;
    const password = "TestPassword123!";
    const result = await identityAdmin.createIdentity({
      createIdentityBody: {
        schema_id: "user",
        traits: { email },
        credentials: { password: { config: { password } } },
      },
    });
    const id = result.data.id;
    await use({ email, password, id });
    await identityAdmin.deleteIdentity({ id });
  },
});

export { expect } from "@playwright/test";
```

- [ ] **Step 2: `e2e/auth.spec.ts`**

```ts
import { test, expect } from "./fixtures/test-identity";

test("sign in and sign out", async ({ page, testUser }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in" }).click();
  // Wait for Ory Account Experience to load
  await page.waitForURL(/projects\.oryapis\.com\/ui\/login/);
  await page.getByLabel("Email").fill(testUser.email);
  await page.getByLabel("Password").fill(testUser.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  // Should land on /auth/callback then redirect home
  await page.waitForURL(/localhost:3000\/$/);
  // Header now shows user email
  await expect(page.getByText(testUser.email.split("@")[0])).toBeVisible();
  // Sign out
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});
```

- [ ] **Step 3: Update `e2e/checkout.spec.ts` to require sign-in**

Replace `e2e/checkout.spec.ts`:

```ts
import { test, expect } from "./fixtures/test-identity";

test("sign in, add to cart, check out, see order", async ({ page, testUser }) => {
  await page.goto("/p/merino-tee");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await page.waitForResponse((r) => r.url().includes("/api/cart/items") && r.ok());
  // Navigate to cart → redirect to /login
  await page.getByRole("link", { name: /Cart/ }).click();
  await page.waitForURL(/projects\.oryapis\.com\/ui\/login/);
  await page.getByLabel("Email").fill(testUser.email);
  await page.getByLabel("Password").fill(testUser.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  // Land on /cart (the original protected target)
  await page.waitForURL(/\/cart/);
  await expect(page.getByRole("heading", { name: "Your cart" })).toBeVisible();
  await expect(page.getByText("Merino Tee")).toBeVisible();
  // Check out
  await page.getByRole("link", { name: "Check out" }).click();
  await page.waitForURL(/\/checkout/);
  await page.getByRole("button", { name: /Place stub order/ }).click();
  await page.waitForURL(/\/orders\//);
  await expect(page.getByRole("heading", { name: "Order placed" })).toBeVisible();
});
```

- [ ] **Step 4: Run all e2e tests**

```bash
pnpm test:e2e 2>&1 | tail -15
```

Expected: 3 tests passing (smoke, browse, auth) + 1 (checkout). Total 4.

Sign-in flow relies on Ory's UI — if the locators (Email field, Password field, Sign in button) don't match the live Account Experience HTML, adjust to whatever the actual page uses. Be tolerant: `page.getByLabel(/email/i)` works if the actual label is "Email address" too.

If `testUser` creation fails because the user schema doesn't have a `password` credential config: re-run `./scripts/ory-setup/apply.sh` to verify the schema was applied and includes the password credential identifier.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test(e2e): auth flow + updated checkout requiring sign-in"
```

---

## Task 16: README update + final verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README**

Add a section after "Run" describing the auth flow:

```markdown
## Sign in

Anonymous browsing works without an account. To check out (or visit `/cart`, `/orders`, or `/me`), you must sign in.

Sign-in is hosted by Ory Account Experience at the project's URL. For local dev:

1. Click **Sign in** in the header → redirects to Ory's hosted UI.
2. **Register** a new account with any email + a password meeting the policy.
3. After sign-in, you're redirected to `/auth/callback` which claims your anonymous cart and bounces home.

To wipe local state (DB + Ory test identities), run `./scripts/demo-reset.sh` (added in Phase 10).
```

Update the "Setup" section's env requirements: ensure `ORY_ADMIN_API_KEY` is documented as required (the e2e suite uses it).

- [ ] **Step 2: Final local CI sequence**

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test           # ~44 unit tests
pnpm test:e2e       # 4 e2e tests
./scripts/ory-setup/apply.sh
```

All exit 0.

- [ ] **Step 3: Manual demo flow**

```bash
pnpm dev
# Open http://localhost:3000
# 1. Browse anonymously — cart cookie set, can add items
# 2. Click Cart → redirect to /login → Ory UI → register → land back on /cart with items merged
# 3. Check out → /orders/<id>
# 4. Sign out → header shows "Sign in" again
# 5. Visit /me → redirect to /login (gated)
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README updates for phase 2 sign-in flow"
```

---

## Final verification

- [ ] **Step 1: Full local CI sequence passes** (~44 unit tests, 4 e2e tests).

- [ ] **Step 2: Manual demo flow works** end-to-end (anonymous browse → sign in → claim cart → checkout → sign out).

- [ ] **Step 3: Tree clean, on main, ~50 commits total since project start.**

---

## Phase 2 complete

End state:
- Real Kratos sessions gate the protected routes.
- `IdentityProvider`/`SessionProvider`/`PermissionProvider` abstractions exist with both `OryX` and `MemoryX` implementations behind a single DI module.
- Anonymous cart claims itself to the user on first sign-in; items merge if the user already had a cart.
- ~44 unit tests cover identity/session/permission contracts against the memory implementations.
- 4 Playwright e2e tests cover landing, browse, auth, and checkout (now requiring sign-in).
- `scripts/ory-setup/` applies the user identity schema and the allowed-return-URLs config.

**Next:** Phase 3 — wire real Keto namespace policies for order ownership. Order detail pages will use `getAuth().permission.check()` to gate "view" instead of doing direct DB ownership checks. See `phase-3-keto-permissions.md` (to be written when Phase 2 is complete).
