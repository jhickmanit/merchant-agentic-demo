import type { PermissionCheckArgs, PermissionProvider } from "@/lib/auth/permissions";
import type { Tuple } from "@/lib/auth/types";
import { Configuration, PermissionApi, RelationshipApi } from "@ory/keto-client";

const baseUrl = process.env.ORY_SDK_URL;
const apiKey = process.env.ORY_ADMIN_API_KEY ?? process.env.ORY_API_KEY;
if (!baseUrl) throw new Error("ORY_SDK_URL is not set");

const config = new Configuration({ basePath: baseUrl, accessToken: apiKey });
const permissionApi = new PermissionApi(config);
const relationshipApi = new RelationshipApi(config);

interface SubjectParsed {
  subject_id?: string;
  subject_set_namespace?: string;
  subject_set_object?: string;
  subject_set_relation?: string;
}

function parseSubject(subject: string): SubjectParsed {
  // Subject-set form: "Namespace:Object#Relation"
  const setMatch = subject.match(/^([^:]+):([^#]+)#(.+)$/);
  if (setMatch) {
    return {
      subject_set_namespace: setMatch[1],
      subject_set_object: setMatch[2],
      subject_set_relation: setMatch[3],
    };
  }
  // Direct subject like "User:abc" — Keto wants the raw string as subject_id.
  return { subject_id: subject };
}

export class OryPermissionProvider implements PermissionProvider {
  async check(args: PermissionCheckArgs): Promise<boolean> {
    const subj = parseSubject(args.subject);
    const result = await permissionApi.checkPermission({
      namespace: args.namespace,
      object: args.object,
      relation: args.relation,
      ...(subj.subject_id ? { subjectId: subj.subject_id } : {}),
      ...(subj.subject_set_namespace
        ? {
            subjectSetNamespace: subj.subject_set_namespace,
            subjectSetObject: subj.subject_set_object,
            subjectSetRelation: subj.subject_set_relation,
          }
        : {}),
    });
    return result.data.allowed;
  }

  async addTuple(t: Tuple): Promise<void> {
    const subj = parseSubject(t.subject);
    await relationshipApi.createRelationship({
      createRelationshipBody: {
        namespace: t.namespace,
        object: t.object,
        relation: t.relation,
        ...(subj.subject_id ? { subject_id: subj.subject_id } : {}),
        ...(subj.subject_set_namespace
          ? {
              subject_set: {
                namespace: subj.subject_set_namespace,
                object: subj.subject_set_object ?? "",
                relation: subj.subject_set_relation ?? "",
              },
            }
          : {}),
      },
    });
  }

  async removeTuple(t: Tuple): Promise<void> {
    const subj = parseSubject(t.subject);
    await relationshipApi.deleteRelationships({
      namespace: t.namespace,
      object: t.object,
      relation: t.relation,
      ...(subj.subject_id ? { subjectId: subj.subject_id } : {}),
      ...(subj.subject_set_namespace
        ? {
            subjectSetNamespace: subj.subject_set_namespace,
            subjectSetObject: subj.subject_set_object,
            subjectSetRelation: subj.subject_set_relation,
          }
        : {}),
    });
  }

  async listForObject(namespace: string, object: string): Promise<Tuple[]> {
    const result = await relationshipApi.getRelationships({ namespace, object });
    return (result.data.relation_tuples ?? []).map((r): Tuple => ({
      namespace: r.namespace,
      object: r.object,
      relation: r.relation,
      subject: r.subject_set
        ? `${r.subject_set.namespace}:${r.subject_set.object}#${r.subject_set.relation}`
        : (r.subject_id ?? ""),
    }));
  }
}
