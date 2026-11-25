"use server";

import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users, type OrgRole } from "@/db/schema";
import { auth } from "@/lib/auth";
import { toResult } from "@/lib/errors";
import { requireActor } from "@/lib/session";
import { toTaskDTO } from "@/lib/realtime-protocol";
import { broadcastOrgEvent } from "@/server/realtime-hub";
import { roleSchema } from "@/server/services/workspace";
import { seedDemoWorkspace, simulateTeammateActivity, switchDemoRole } from "@/server/services/demo";

/**
 * 1-click recruiter demo: creates a throwaway demo account + its own seeded
 * "Acme Engineering" tenant, signs in (Better Auth sets the cookie via the
 * nextCookies plugin) and lands on the board. No signup form, no shared state.
 */
export async function launchDemoAction() {
  const id = randomBytes(4).toString("hex");
  const { user } = await auth.api.signUpEmail({
    body: {
      name: "Demo Reviewer",
      email: `reviewer-${id}@demo.syncsprint.local`,
      password: randomBytes(24).toString("base64url"),
    },
  });
  await db.update(users).set({ isDemo: true }).where(eq(users.id, user.id));
  const org = await seedDemoWorkspace(db, user.id);
  redirect(`/w/${org.slug}/projects/ENG`);
}

export async function switchDemoRoleAction(organizationId: string, role: OrgRole) {
  return toResult(async () => {
    const actor = await requireActor();
    const parsed = roleSchema.parse(role);
    await switchDemoRole(db, actor.id, organizationId, parsed);
    broadcastOrgEvent(organizationId, { type: "MEMBERSHIP_CHANGED", actor, userId: actor.id, role: parsed });
    revalidatePath("/w", "layout");
    return { role: parsed };
  });
}

export async function simulateTeammateAction(organizationId: string, projectId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const { actor: mate, result, kind } = await simulateTeammateActivity(db, actor.id, organizationId, projectId);
    if (result.ok) {
      if ("rebalanced" in result && result.rebalanced) {
        broadcastOrgEvent(organizationId, { type: "COLUMN_REBALANCED", columnId: result.task.columnId, positions: result.rebalanced });
      }
      broadcastOrgEvent(organizationId, {
        type: "TASK_UPDATED",
        actor: mate,
        task: toTaskDTO(result.task),
        action: kind,
        changes: "changes" in result ? result.changes : undefined,
      });
    }
    return { by: mate.name, kind };
  });
}
