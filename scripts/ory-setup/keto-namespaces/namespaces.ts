import { Namespace, Context } from "@ory/permission-namespace-types";

class User implements Namespace {}

class Order implements Namespace {
  related: {
    owner: User[];
  } = { owner: [] };
  permits = {
    view: (ctx: Context): boolean =>
      this.related.owner.includes(ctx.subject),
  };
}

class Merchant implements Namespace {}

// Phase 4 will extend Agent + SpendCap with real relations.
class Agent implements Namespace {}
class SpendCap implements Namespace {}
