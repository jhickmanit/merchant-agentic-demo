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
