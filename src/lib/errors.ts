export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN_NOT_A_MEMBER"
  | "FORBIDDEN_REQUIRES_VIEWER"
  | "FORBIDDEN_REQUIRES_MEMBER"
  | "FORBIDDEN_REQUIRES_ADMIN"
  | "FORBIDDEN_REQUIRES_OWNER"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "VERSION_CONFLICT"
  | "QUOTA_EXCEEDED"
  /** Billing: the workspace is read-only (trial over, payment overdue) or locked. */
  | "WORKSPACE_READ_ONLY"
  | "WORKSPACE_LOCKED"
  | "SEAT_LIMIT"
  /** Workspace security policy (Phase 9). */
  | "TWO_FACTOR_REQUIRED"
  | "IP_NOT_ALLOWED";

/** Errors whose `code` is safe to show to the client. */
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message?: string
  ) {
    super(message ?? code);
    this.name = "AppError";
  }
}

export type ActionResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: AppErrorCode | "INTERNAL"; message: string };

/** Wraps a server action body so AppErrors become typed results instead of opaque 500s. */
export async function toResult<T extends object>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, code: err.code, message: err.message };
    if (err instanceof ZodError) {
      return { ok: false, code: "VALIDATION", message: err.issues.map((i) => i.message).join("; ") };
    }
    console.error("[action] unexpected error", err);
    return { ok: false, code: "INTERNAL", message: "Something went wrong." };
  }
}
