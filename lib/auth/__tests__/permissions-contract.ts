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
