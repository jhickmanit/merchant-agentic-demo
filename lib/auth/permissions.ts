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
