import type { IdentityProvider } from "./identity";
import type { SessionProvider } from "./sessions";
import type { PermissionProvider } from "./permissions";

import { MemoryIdentityProvider } from "./memory/identity";
import { MemorySessionProvider } from "./memory/sessions";
import { MemoryPermissionProvider } from "./memory/permissions";
import { recordCheck } from "@/lib/permissions-debug";

function instrumentPermissions<T extends PermissionProvider>(p: T): T {
  const original = p.check.bind(p);
  p.check = async (args) => {
    const start = performance.now();
    const allowed = await original(args);
    recordCheck({ ...args, allowed, durationMs: Math.round(performance.now() - start) });
    return allowed;
  };
  return p;
}

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
    const permission = instrumentPermissions(new MemoryPermissionProvider());
    cached = { identity, session, permission };
    return cached;
  }

  if (which === "ory") {
    // Lazy require so MemoryX users (CI / tests) don't pay the @ory/client cost.
    // The Ory adapters are added in tasks P2.7-P2.9; until then this branch will
    // throw at call time if anyone tries to use it without AUTH_PROVIDER=memory.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { OryIdentityProvider } = require("./ory/identity");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { OrySessionProvider } = require("./ory/sessions");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { OryPermissionProvider } = require("./ory/permissions");
    cached = {
      identity: new OryIdentityProvider(),
      session: new OrySessionProvider(),
      permission: instrumentPermissions(new OryPermissionProvider()),
    };
    return cached;
  }

  throw new Error(`Unknown AUTH_PROVIDER: ${which}`);
}

/** For tests — reset the cached providers between cases. */
export function resetAuthForTests() {
  cached = null;
}
