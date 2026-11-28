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
import { DEMO_EMAIL_DOMAIN } from "@/server/services/auth-emails";

/**
 * 1-click recruiter demo: creates a throwaway demo account + its own seeded
 * "Acme Engineering" tenant, signs in (Better Auth sets the cookie via the
 * nextCookies plugin) and lands on the board. No signup form, no shared state.
 */
export async function launchDemoAction() {
  const id = randomBytes(4).toString("hex");
  const email = `reviewer-${id}${DEMO_EMAIL_DOMAIN}`;
  const password = randomBytes(24).toString("base64url");
  const { user, token } = await auth.api.signUpEmail({ body: { name: "Demo Reviewer", email, password } });
  // Demo addresses can't receive mail: mark the throwaway account verified, then sign in
  // (when email verification is required, sign-up itself doesn't start a session).
  await db.update(users).set({ isDemo: true, emailVerified: true }).where(eq(users.id, user.id));
  if (!token) await auth.api.signInEmail({ body: { email, password } });
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
