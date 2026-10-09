export type TenantId = string;
export type Role = "guest" | "customer" | "agent" | "admin" | "platform-owner";
export type TenantRole = "customer" | "agent" | "admin";
export interface Membership { readonly tenantId: TenantId; readonly role: TenantRole; readonly active: boolean }
/** Actors/memberships must be obtained from verified server-side identity, never trusted request JSON. */
export interface Actor { readonly subjectId: string | null; readonly memberships: readonly Membership[]; readonly platformOwner?: boolean }
export interface PlatformAccessGrant { readonly tenantId: TenantId; readonly reason: string; readonly auditId: string }
export interface AccessContext { readonly tenantId: TenantId; readonly platformAccess?: PlatformAccessGrant }
export interface PropertyAccessResource {
  readonly tenantId: TenantId;
  /** Immutable creator history, not the legal owner and not a continuing authorization grant. */
  readonly ownerId: string;
  readonly assignedAgentId?: string | null;
  readonly publiclyVisible: boolean;
}
export type PropertyAction = "read" | "create" | "edit" | "submit-review" | "review" | "publish" | "archive" | "manage-availability";
export interface AccessDecision {
  readonly allowed: boolean;
  readonly code: "PUBLIC_READ" | "TENANT_ADMIN" | "ASSIGNED_AGENT" | "PLATFORM_CONTEXT" | "TENANT_MISMATCH" | "UNAUTHENTICATED" | "NO_MEMBERSHIP" | "FORBIDDEN" | "PLATFORM_CONTEXT_REQUIRED" | "INVALID_CONTEXT";
  readonly audit?: PlatformAccessGrant;
}

const PROPERTY_ACTIONS = new Set<PropertyAction>(["read", "create", "edit", "submit-review", "review", "publish", "archive", "manage-availability"]);
const TENANT_ROLES = new Set<TenantRole>(["customer", "agent", "admin"]);
const allowed = (code: AccessDecision["code"], audit?: PlatformAccessGrant): AccessDecision => audit ? { allowed: true, code, audit: { ...audit } } : { allowed: true, code };
const denied = (code: AccessDecision["code"]): AccessDecision => ({ allowed: false, code });

/** A policy decision only: the server must persist its audit record and enforce it around every data query/mutation. */
export function authorizePropertyAction(actor: Actor, context: AccessContext, action: PropertyAction, resource: PropertyAccessResource): AccessDecision {
  if (!context.tenantId?.trim() || !resource.tenantId?.trim() || !PROPERTY_ACTIONS.has(action)) return denied("INVALID_CONTEXT");
  if (context.tenantId !== resource.tenantId) return denied("TENANT_MISMATCH");
  if (actor.platformOwner === true) {
    if (!actor.subjectId?.trim()) return denied("UNAUTHENTICATED");
    const grant = context.platformAccess;
    if (!grant || grant.tenantId !== context.tenantId || !grant.reason?.trim() || !grant.auditId?.trim()) return denied("PLATFORM_CONTEXT_REQUIRED");
    return allowed("PLATFORM_CONTEXT", grant);
  }
  if (action === "read" && resource.publiclyVisible === true) return allowed("PUBLIC_READ");
  if (!actor.subjectId?.trim()) return denied("UNAUTHENTICATED");
  const memberships = actor.memberships.filter(membership => membership.active === true && membership.tenantId === context.tenantId && TENANT_ROLES.has(membership.role));
  if (memberships.length === 0) return denied("NO_MEMBERSHIP");
  if (memberships.some(membership => membership.role === "admin")) return allowed("TENANT_ADMIN");
  if (memberships.some(membership => membership.role === "agent")) {
    if (action === "create") return resource.ownerId === actor.subjectId && resource.assignedAgentId === actor.subjectId ? allowed("ASSIGNED_AGENT") : denied("FORBIDDEN");
    if (resource.assignedAgentId === actor.subjectId && ["read", "edit", "submit-review", "manage-availability"].includes(action)) return allowed("ASSIGNED_AGENT");
  }
  return denied("FORBIDDEN");
}
