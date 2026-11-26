import type { OrgRole } from "@/db/schema";

/** Pure role logic — safe to import from client components. */
export type { OrgRole };

/**
 * Customer roles, highest first. "admin" is the top role inside a company: the person
 * the workspace is handed to. The platform owner (the vendor) is NOT a workspace role;
 * see src/lib/platform.ts. "owner" survives only as a legacy alias of admin.
 */
export const ROLES: readonly OrgRole[] = ["admin", "member", "viewer"] as const;

export const ROLE_WEIGHT: Record<OrgRole, number> = {
  viewer: 1,
  member: 2,
  admin: 3,
  owner: 3, // legacy alias: identical to admin
};

/** Display name for a stored role (legacy "owner" shows as Admin). */
export const roleLabel = (role: OrgRole) => (role === "owner" ? "admin" : role);
export const isAdminRole = (role: OrgRole | null | undefined) => role === "admin" || role === "owner";

/** Minimum role per capability. The UI reads this too, but the server is the authority. */
export const PERMISSIONS = {
  VIEW_BOARD: "viewer",
  CREATE_OR_MOVE_TASK: "member",
  COMMENT: "member",
  USE_AI: "member",
  MANAGE_PROJECTS: "admin",
  MANAGE_SPRINTS: "admin",
  INVITE_OR_CHANGE_ROLES: "admin",
  MANAGE_BILLING: "admin",
  MANAGE_GROUPS: "admin",
  SHARE_LINKS: "admin",
  DELETE_ORGANIZATION: "admin",
} as const satisfies Record<string, OrgRole>;

export type Permission = keyof typeof PERMISSIONS;

export function hasRole(actual: OrgRole, required: OrgRole): boolean {
  return ROLE_WEIGHT[actual] >= ROLE_WEIGHT[required];
}

export function can(role: OrgRole | null | undefined, permission: Permission): boolean {
  return !!role && hasRole(role, PERMISSIONS[permission]);
}
