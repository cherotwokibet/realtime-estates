import test from "node:test";
import assert from "node:assert/strict";
import { validateTenantBrandConfig } from "../dist/index.js";

const brand = {
  tenantId: "synthetic-estates", slug: "synthetic-estates", companyName: "Synthetic Estates",
  colors: { primary: "#6A1833", secondary: "#194D3E", accent: "#D1A55F", background: "#FFFDF8" },
  logo: { url: "/brands/synthetic/logo.svg", alt: "Synthetic Estates logo" },
  contact: { email: "DEMO@example.invalid", phone: "0700000000" },
  locale: "en-KE", currency: "KES", features: { viewings: true, customerAccounts: false },
};
test("public brand config normalizes safe values and can be independently configured for another tenant", () => {
  const first = validateTenantBrandConfig(brand);
  const second = validateTenantBrandConfig({ ...brand, tenantId: "second-estates", slug: "second-estates", companyName: "Second Synthetic Estates", colors: { ...brand.colors, primary: "#123456" } });
  assert.equal(first.contact.phone, "+254700000000");
  assert.equal(first.contact.email, "demo@example.invalid");
  assert.equal(first.colors.primary, "#6a1833");
  assert.equal(second.colors.primary, "#123456");
  assert.equal(first.companyName, "Synthetic Estates");
});
test("branding rejects secret/unknown fields, scriptable URLs, CSS injection and misleading feature types", () => {
  const invalid = [
    { ...brand, apiKey: "synthetic-not-a-secret" },
    { ...brand, contact: { ...brand.contact, password: "synthetic-not-a-password" } },
    { ...brand, logo: { ...brand.logo, url: "javascript:alert(1)" } },
    { ...brand, logo: { ...brand.logo, url: "//example.invalid/logo.svg" } },
    { ...brand, logo: { ...brand.logo, url: "/brands/../private/logo.svg" } },
    { ...brand, logo: { ...brand.logo, url: "https://user:password@example.invalid/logo.svg" } },
    { ...brand, colors: { ...brand.colors, primary: "red; background:url(javascript:alert(1))" } },
    { ...brand, features: { ...brand.features, viewings: "false" } },
    { ...brand, slug: "../other-tenant" },
    { ...brand, currency: "USD" },
  ];
  for (const config of invalid) assert.throws(() => validateTenantBrandConfig(config));
});
