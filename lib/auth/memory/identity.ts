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
