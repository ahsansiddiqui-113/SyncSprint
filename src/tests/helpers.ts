import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { runMigrations } from "@/db/migrate";
import { boardColumns, orgMembers, tasks, users, type OrgRole } from "@/db/schema";
import { createOrganization, createProject } from "@/server/services/workspace";
import { createTask } from "@/server/services/tasks";

let migrated: Promise<void> | null = null;

/** In-memory PGlite (DATABASE_URL=pglite://memory) migrated once per test file. */
export async function testDb() {
  migrated ??= runMigrations(db, "pglite://memory");
  await migrated;
  return db;
}

let n = 0;
export async function makeUser(name = "User") {
  n += 1;
  const [u] = await db
    .insert(users)
    .values({ name: `${name} ${n}`, email: `${name.toLowerCase().replace(/\s+/g, "")}-${n}-${Date.now()}@test.local` })
    .returning();
  return u!;
}

export async function addMember(organizationId: string, userId: string, role: OrgRole) {
  await db.insert(orgMembers).values({ organizationId, userId, role });
}

/**
 * A tenant with an owner, one user per other role, a project (4 columns) and one task.
 */
export async function makeTenant(label: string) {
  const owner = await makeUser(`${label} Owner`);
  const admin = await makeUser(`${label} Admin`);
  const member = await makeUser(`${label} Member`);
  const viewer = await makeUser(`${label} Viewer`);
  const org = await createOrganization(db, owner.id, { name: `${label} Org` });
  await addMember(org.id, admin.id, "admin");
  await addMember(org.id, member.id, "member");
  await addMember(org.id, viewer.id, "viewer");
  const project = await createProject(db, owner.id, { organizationId: org.id, name: `${label} Project`, key: "ENG" });
  const columns = await db
    .select()
    .from(boardColumns)
    .where(eq(boardColumns.projectId, project.id))
    .orderBy(asc(boardColumns.position));
  const task = await createTask(db, member.id, { organizationId: org.id, columnId: columns[0]!.id, title: `${label} first task` });
  return { org, project, columns, task, owner, admin, member, viewer };
}

export async function getTask(id: string) {
  const [t] = await db.select().from(tasks).where(eq(tasks.id, id));
  return t;
}
