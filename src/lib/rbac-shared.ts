import type { OrgRole } from "@/db/schema";

/** Pure role logic — safe to import from client components. */
export type { OrgRole };

export const ROLES: readonly OrgRole[] = ["owner", "admin", "member", "viewer"] as const;

export const ROLE_WEIGHT: Record<OrgRole, number> = {
  viewer: 1,
  member: 2,
  admin: 3,
  owner: 4,
};

/** Minimum role per capability. The UI reads this too, but the server is the authority. */
export const PERMISSIONS = {
  VIEW_BOARD: "viewer",
  CREATE_OR_MOVE_TASK: "member",
  COMMENT: "member",
  USE_AI: "member",
  MANAGE_PROJECTS: "admin",
  MANAGE_SPRINTS: "admin",
  INVITE_OR_CHANGE_ROLES: "admin",
  DELETE_ORGANIZATION: "owner",
} as const satisfies Record<string, OrgRole>;

export type Permission = keyof typeof PERMISSIONS;

export function hasRole(actual: OrgRole, required: OrgRole): boolean {
  return ROLE_WEIGHT[actual] >= ROLE_WEIGHT[required];
}

export function can(role: OrgRole | null | undefined, permission: Permission): boolean {
  return !!role && hasRole(role, PERMISSIONS[permission]);
}
