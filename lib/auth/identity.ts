import type { User } from "./types";

export interface IdentityProvider {
  getById(id: string): Promise<User | null>;
  getByEmail(email: string): Promise<User | null>;
  createUser(traits: { email: string; name?: string }): Promise<User>;
  // Phase 4 will add createAgent(); declared here for forward-compat clarity.
}
