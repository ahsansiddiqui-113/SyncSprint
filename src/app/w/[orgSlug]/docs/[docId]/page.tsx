import { notFound } from "next/navigation";
import { db } from "@/db";
import { can, hasRole } from "@/lib/rbac-shared";
import { loadWorkspace, orNotFound } from "@/server/page-guards";
import { getDoc } from "@/server/services/docs";
import { DocEditor } from "@/components/docs/doc-editor";

export const metadata = { title: "Doc" };

export default async function DocPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string; docId: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { orgSlug, docId } = await params;
  const { edit } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(docId)) notFound();
  const { user, org, role } = await loadWorkspace(orgSlug);
  const doc = await orNotFound(() => getDoc(db, user.id, org.id, docId));
  const canEdit = can(role, "CREATE_OR_MOVE_TASK");

  return (
    <DocEditor
      org={{ id: org.id, slug: org.slug, name: org.name }}
      doc={{
        id: doc.id,
        title: doc.title,
        content: doc.content,
        version: doc.version,
        updatedAt: doc.updatedAt.toISOString(),
        updatedByName: doc.updatedByName,
        tasks: doc.tasks,
      }}
      canEdit={canEdit}
      canDelete={canEdit && (doc.createdById === user.id || hasRole(role, "admin"))}
      startEditing={edit === "1" && canEdit}
    />
  );
}
