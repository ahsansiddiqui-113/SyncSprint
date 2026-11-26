import { describe, expect, it } from "vitest";
import { seedDemoWorkspace } from "@/server/services/demo";
import { listNotifications } from "@/server/services/notifications";
import { listDocs } from "@/server/services/docs";
import { listGoals } from "@/server/services/goals";
import { makeUser, testDb } from "./helpers";

describe("demo workspace", () => {
  it("seeds every phase, including inbox, docs, goals and logged time", async () => {
    const db = await testDb();
    const me = await makeUser("Visitor");
    const org = await seedDemoWorkspace(db, me.id);
    const inbox = await listNotifications(db, me.id, org.id);
    expect(inbox.unread).toBe(4);
    expect((await listDocs(db, me.id, org.id)).map((d) => d.title)).toContain("Billing webhooks runbook");
    const goals = await listGoals(db, me.id, org.id);
    expect(goals).toHaveLength(2);
    expect(goals.find((g) => g.title === "Launch self-serve billing")!.keyResults[1]!.total).toBe(3);
  });
});
