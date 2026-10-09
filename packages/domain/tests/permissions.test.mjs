import test from "node:test";
import assert from "node:assert/strict";
import { authorizePropertyAction, createListing, assignListingAgent, kesFromMajor } from "../dist/index.js";

const context = { tenantId: "tenant-a" };
const resource = { tenantId: "tenant-a", ownerId: "agent-owner", assignedAgentId: "agent-owner", publiclyVisible: false };
const actor = (subjectId, role, tenantId = "tenant-a") => ({ subjectId, memberships: [{ tenantId, role, active: true }] });
const actions = ["read", "create", "edit", "submit-review", "review", "publish", "archive", "manage-availability"];

test("guest/customer cannot create listings or inspect private stock", () => {
  for (const user of [{ subjectId: null, memberships: [] }, actor("customer", "customer")]) {
    for (const action of actions) assert.equal(authorizePropertyAction(user, context, action, resource).allowed, false, action);
    assert.equal(authorizePropertyAction(user, context, "read", { ...resource, publiclyVisible: true }).allowed, true);
  }
});
test("assigned agent can edit their tenant records but cannot review/publish", () => {
  for (const id of ["agent-owner", "agent-assigned"]) {
    const assigned = { ...resource, assignedAgentId: id };
    for (const action of ["read", "edit", "submit-review", "manage-availability"]) assert.equal(authorizePropertyAction(actor(id, "agent"), context, action, assigned).allowed, true);
    for (const action of ["review", "publish", "archive"]) assert.equal(authorizePropertyAction(actor(id, "agent"), context, action, assigned).allowed, false);
  }
  assert.equal(authorizePropertyAction(actor("agent-owner", "agent"), context, "create", resource).allowed, true);
  assert.equal(authorizePropertyAction(actor("agent-assigned", "agent"), context, "create", resource).allowed, false);
});
test("reassignment revokes the original creator's private access without changing creator history", () => {
  const listing = createListing({ id: "synthetic", tenantId: "tenant-a", ownerId: "agent-owner", draft: {
    title: "Synthetic draft", description: "Synthetic draft", propertyType: "studio", purpose: "rent", price: kesFromMajor("20000"), rentalPeriod: "month", fees: [], images: [], location: { county: "Synthetic", town: "Synthetic" },
  } });
  assert.equal(listing.assignedAgentId, "agent-owner");
  const reassigned = assignListingAgent(listing, "agent-assigned");
  const accessResource = { tenantId: reassigned.tenantId, ownerId: reassigned.ownerId, assignedAgentId: reassigned.assignedAgentId, publiclyVisible: false };
  for (const action of ["read", "edit", "submit-review", "manage-availability"]) {
    assert.equal(authorizePropertyAction(actor("agent-owner", "agent"), context, action, accessResource).allowed, false);
    assert.equal(authorizePropertyAction(actor("agent-assigned", "agent"), context, action, accessResource).allowed, true);
  }
  assert.equal(reassigned.ownerId, "agent-owner");
  assert.equal(assignListingAgent(reassigned, null).assignedAgentId, null);
  assert.equal(authorizePropertyAction(actor("agent-owner", "agent"), context, "edit", { ...accessResource, assignedAgentId: null }).allowed, false);
});
test("cross-owner editing and arbitrary record attribution are denied", () => {
  const other = actor("agent-other", "agent");
  for (const action of actions) assert.equal(authorizePropertyAction(other, context, action, resource).allowed, false);
  const customerOwner = actor("agent-owner", "customer");
  assert.equal(authorizePropertyAction(customerOwner, context, "edit", resource).allowed, false);
});
test("tenant admin is tenant-wide; inactive or other-tenant membership cannot grant authority", () => {
  for (const action of actions) assert.equal(authorizePropertyAction(actor("admin", "admin"), context, action, resource).allowed, true);
  for (const user of [actor("admin", "admin", "tenant-b"), { subjectId: "admin", memberships: [{ tenantId: "tenant-a", role: "admin", active: false }] }]) {
    for (const action of actions) assert.equal(authorizePropertyAction(user, context, action, resource).allowed, false);
  }
});
test("resource/context tenant mismatch denies even public reads and privileged roles", () => {
  for (const user of [actor("admin", "admin"), actor("agent-owner", "agent"), { subjectId: "operator", memberships: [], platformOwner: true }]) {
    for (const action of actions) {
      const result = authorizePropertyAction(user, { tenantId: "tenant-b", platformAccess: { tenantId: "tenant-b", reason: "Incident support", auditId: "audit-synthetic" } }, action, { ...resource, publiclyVisible: true });
      assert.equal(result.allowed, false);
      assert.equal(result.code, "TENANT_MISMATCH");
    }
  }
});
test("platform owner requires explicit matching tenant context with reason and audit identifier", () => {
  const operator = { subjectId: "operator", memberships: [], platformOwner: true };
  for (const grant of [undefined, { tenantId: "tenant-b", reason: "Support", auditId: "audit-1" }, { tenantId: "tenant-a", reason: "", auditId: "audit-1" }, { tenantId: "tenant-a", reason: "Support", auditId: "" }]) {
    assert.equal(authorizePropertyAction(operator, { ...context, platformAccess: grant }, "edit", resource).allowed, false);
  }
  const grant = { tenantId: "tenant-a", reason: "Reproduce synthetic permission test", auditId: "audit-synthetic" };
  const result = authorizePropertyAction(operator, { ...context, platformAccess: grant }, "edit", resource);
  assert.equal(result.allowed, true);
  assert.deepEqual(result.audit, grant);
  assert.equal(authorizePropertyAction({ ...operator, subjectId: null }, { ...context, platformAccess: grant }, "edit", resource).allowed, false);
});
test("unknown actions/roles deny by default", () => {
  assert.equal(authorizePropertyAction(actor("admin", "admin"), context, "delete-everything", resource).allowed, false);
  assert.equal(authorizePropertyAction(actor("agent-owner", "superuser"), context, "edit", resource).allowed, false);
});
