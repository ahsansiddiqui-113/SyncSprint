"use server";

import { db } from "@/db";
import { toResult } from "@/lib/errors";
import { requireActor } from "@/lib/session";
import { broadcastOrgEvent } from "@/server/realtime-hub";
import * as svc from "@/server/services/capacity";

const changed = (organizationId: string, actor: { id: string; name: string }) => broadcastOrgEvent(organizationId, { type: "CAPACITY_CHANGED", actor });

export async function getWorkloadAction(organizationId: string, from: string, to: string, today?: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const { settings, people, timeOff } = await svc.getWorkload(db, actor.id, organizationId, { from, to, today });
    return {
      settings,
      people,
      timeOff: timeOff.map((t) => ({ id: t.id, userId: t.userId, kind: t.kind, startDate: t.startDate, endDate: t.endDate, note: t.note })),
    };
  });
}

export async function setWorkScheduleAction(organizationId: string, hours: number[], nearThreshold: number) {
  return toResult(async () => {
    const actor = await requireActor();
    const r = await svc.setWorkSchedule(db, actor.id, organizationId, { hours, nearThreshold });
    changed(organizationId, actor);
    return r;
  });
}

export async function setMemberCapacityAction(organizationId: string, userId: string, hours: number[] | null) {
  return toResult(async () => {
    const actor = await requireActor();
    const r = await svc.setMemberCapacity(db, actor.id, organizationId, userId, hours);
    changed(organizationId, actor);
    return { hours: r };
  });
}

export async function addTimeOffAction(organizationId: string, input: { userId: string | null; kind?: string; startDate: string; endDate: string; note?: string | null }) {
  return toResult(async () => {
    const actor = await requireActor();
    const r = await svc.addTimeOff(db, actor.id, organizationId, input);
    changed(organizationId, actor);
    return { id: r.id };
  });
}

export async function deleteTimeOffAction(organizationId: string, id: string) {
  return toResult(async () => {
    const actor = await requireActor();
    await svc.deleteTimeOff(db, actor.id, organizationId, id);
    changed(organizationId, actor);
    return {};
  });
}
