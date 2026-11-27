"use server";

import { headers } from "next/headers";
import { db } from "@/db";
import { auth } from "@/lib/auth";
import { appBaseUrl } from "@/lib/base-url";
import { toResult } from "@/lib/errors";
import { requireActor } from "@/lib/session";
import * as sso from "@/server/services/sso";

export async function getSsoAction(organizationId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    return await sso.getSso(db, actor.id, organizationId, appBaseUrl());
  });
}

export async function saveSsoAction(organizationId: string, input: sso.SsoInput) {
  return toResult(async () => {
    const actor = await requireActor();
    const h = await headers();
    await sso.saveSso(db, actor.id, organizationId, input, appBaseUrl(), (body) =>
      (auth.api as unknown as { registerSSOProvider: (o: { body: unknown; headers: Headers }) => Promise<unknown> }).registerSSOProvider({ body, headers: h })
    );
    return {};
  });
}

export async function verifySsoAction(organizationId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    await sso.verifySsoDomains(db, actor.id, organizationId);
    return {};
  });
}

export async function devVerifySsoAction(organizationId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    await sso.devMarkVerified(db, actor.id, organizationId);
    return {};
  });
}

export async function removeSsoAction(organizationId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    await sso.removeSso(db, actor.id, organizationId);
    return {};
  });
}

export async function setSsoRequiredAction(organizationId: string, on: boolean) {
  return toResult(async () => {
    const actor = await requireActor();
    await sso.setSsoRequired(db, actor.id, organizationId, on);
    return {};
  });
}

export async function rotateScimTokenAction(organizationId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    return { token: await sso.rotateScimToken(db, actor.id, organizationId) };
  });
}

export async function disableScimAction(organizationId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    await sso.disableScim(db, actor.id, organizationId);
    return {};
  });
}
