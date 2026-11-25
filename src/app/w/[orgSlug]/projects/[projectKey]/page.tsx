import { db } from "@/db";
import { toTaskDTO } from "@/lib/realtime-protocol";
import { aiConfigured } from "@/lib/ai-router";
import { loadWorkspace, orNotFound } from "@/server/page-guards";
import { getBoard } from "@/server/services/workspace";
import { KanbanBoard } from "@/components/board/kanban-board";

export default async function BoardPage({ params }: { params: Promise<{ orgSlug: string; projectKey: string }> }) {
  const { orgSlug, projectKey } = await params;
  const { user } = await loadWorkspace(orgSlug);
  const board = await orNotFound(() => getBoard(db, user.id, orgSlug, projectKey));

  return (
    <KanbanBoard
      // Remount on role change so permissions in the UI never lag the server.
      key={`${board.project.id}:${board.role}`}
      me={{ id: user.id, name: user.name }}
      org={{ id: board.org.id, slug: board.org.slug, name: board.org.name, isDemo: board.org.isDemo }}
      role={board.role}
      project={{ id: board.project.id, key: board.project.key, name: board.project.name }}
      columns={board.columns.map((c) => ({ id: c.id, title: c.title, color: c.color }))}
      initialTasks={board.tasks.map(toTaskDTO)}
      members={board.members.map((m) => ({ id: m.userId, name: m.name, avatarUrl: m.avatarUrl, role: m.role }))}
      aiEnabled={aiConfigured()}
    />
  );
}
