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
