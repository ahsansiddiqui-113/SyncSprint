/**
 * `npm run db:seed` — applies migrations and creates a persistent sign-in-able
 * demo account with its own seeded "Acme Engineering" workspace.
 *
 *   email:    demo@syncsprint.dev
 *   password: SEED_DEMO_PASSWORD env var (default: "syncsprint-demo")
 *
 * The 1-click demo on `/` does NOT need this: it creates a fresh tenant per visitor.
 */
import "dotenv/config";
import { eq } from "drizzle-orm";

async function main() {
  const { db } = await import("./index");
  const { runMigrations } = await import("./migrate");
  const { users } = await import("./schema");
  const { seedDemoWorkspace } = await import("../server/services/demo");
  const { auth } = await import("../lib/auth");

  await runMigrations(db);

  const email = "demo@syncsprint.dev";
  const password = process.env.SEED_DEMO_PASSWORD ?? "syncsprint-demo";
  let [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user) {
    await auth.api.signUpEmail({ body: { email, password, name: "Demo Owner" } });
    [user] = await db.select().from(users).where(eq(users.email, email));
  }
  await db.update(users).set({ isDemo: true }).where(eq(users.id, user!.id));
  const org = await seedDemoWorkspace(db, user!.id);

  console.log(`✔ Seeded workspace "${org.name}" → /w/${org.slug}/projects/ENG`);
  console.log(`  Sign in as ${email} (password from SEED_DEMO_PASSWORD or the default in this file)`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
