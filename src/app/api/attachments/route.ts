import { NextResponse } from "next/server";
import { db } from "@/db";
import { AppError } from "@/lib/errors";
import { getSession } from "@/lib/session";
import { broadcastOrgEvent } from "@/server/realtime-hub";
import { MAX_ATTACHMENT_BYTES, uploadAttachment } from "@/server/services/attachments";

export const runtime = "nodejs";

const STATUS: Record<string, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  FORBIDDEN_NOT_A_MEMBER: 404,
  FORBIDDEN_REQUIRES_MEMBER: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  QUOTA_EXCEEDED: 413,
};

const UUID = /^[0-9a-f-]{36}$/i;

/** Multipart upload: fields organizationId, taskId, file. The actor comes from the session cookie. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, code: "UNAUTHENTICATED", message: "Sign in again" }, { status: 401 });
  // Reject oversized bodies before buffering them.
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_ATTACHMENT_BYTES + 64 * 1024) {
    return NextResponse.json({ ok: false, code: "VALIDATION", message: "Files can be up to 4 MB" }, { status: 413 });
  }
  try {
    const form = await req.formData();
    const organizationId = String(form.get("organizationId") ?? "");
    const taskId = String(form.get("taskId") ?? "");
    const file = form.get("file");
    if (!UUID.test(organizationId) || !UUID.test(taskId) || !(file instanceof File)) {
      throw new AppError("VALIDATION", "Choose a file to upload");
    }
    if (file.size > MAX_ATTACHMENT_BYTES) throw new AppError("VALIDATION", "Files can be up to 4 MB");
    const data = Buffer.from(await file.arrayBuffer());
    const { attachment, projectId } = await uploadAttachment(db, session.user.id, organizationId, {
      taskId,
      filename: file.name,
      contentType: file.type,
      data,
    });
    broadcastOrgEvent(organizationId, {
      type: "ATTACHMENTS_CHANGED",
      actor: { id: session.user.id, name: session.user.name },
      projectId,
      taskId,
    });
    return NextResponse.json({ ok: true, attachment: { ...attachment, createdAt: attachment.createdAt.toISOString() } });
  } catch (err) {
    if (err instanceof AppError) {
      return NextResponse.json({ ok: false, code: err.code, message: err.message }, { status: STATUS[err.code] ?? 400 });
    }
    console.error("[attachments] upload failed", err);
    return NextResponse.json({ ok: false, code: "INTERNAL", message: "Upload failed" }, { status: 500 });
  }
}
