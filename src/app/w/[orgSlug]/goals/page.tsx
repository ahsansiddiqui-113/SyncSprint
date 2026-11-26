import { db } from "@/db";
import { loadWorkspace } from "@/server/page-guards";
import { listGoals } from "@/server/services/goals";
import { listMembers } from "@/server/services/workspace";
import { PageHeader } from "@/components/ui/card";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { GoalsBoard } from "@/components/goals/goals-board";

export const metadata = { title: "Goals" };

export default async function GoalsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { user, org, role } = await loadWorkspace(orgSlug);
  const [goals, members] = await Promise.all([listGoals(db, user.id, org.id), listMembers(db, user.id, org.id)]);
  return (
    <main className="w-full px-10 py-10 2xl:px-14">
      <PageHeader
        eyebrow={<Breadcrumbs items={[{ label: org.name, href: `/w/${org.slug}` }, { label: "Goals" }]} />}
        title="Goals"
        description="Objectives with measurable key results. Track a number, or let progress follow the tasks linked to it."
      />
      <GoalsBoard
        org={{ id: org.id, slug: org.slug }}
        role={role}
        initial={goals}
        members={members.map((m) => ({ id: m.userId, name: m.name }))}
      />
    </main>
  );
}
