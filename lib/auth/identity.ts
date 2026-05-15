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
