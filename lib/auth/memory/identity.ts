import { nanoid } from "nanoid";
import type { IdentityProvider } from "@/lib/auth/identity";
import type { User, Agent } from "@/lib/auth/types";

export class MemoryIdentityProvider implements IdentityProvider {
  private byId = new Map<string, User>();
  private byEmail = new Map<string, User>();
  private agents = new Map<string, Agent>();

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
}
