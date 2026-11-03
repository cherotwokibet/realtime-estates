import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startStaffPreview } from '../apps/api/dev/staff-preview.mjs';
import { RealtorApiClient } from '../packages/api-client/dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export function secondBrandProfile(slug) {
  if (!['realtime-estates', 'sample-homes'].includes(slug))
    throw Error('Choose a synthetic brand.');
  const sample = slug === 'sample-homes',
    email = sample ? 'sample-homes@example.invalid' : 'realtime-preview@example.invalid';
  return {
    slug,
    tenantId: id(sample ? 2 : 1),
    foreignListing: id(sample ? 400 : 500),
    foreignEnquiry: id(sample ? 701 : 801),
    email,
    name: sample ? 'Sample Homes — synthetic second brand' : 'Realtime Estates — synthetic pilot',
    primary: sample ? '#10465b' : '#5e0202',
    secondary: sample ? '#305a49' : '#194d3e',
  };
}
export function secondBrandManifest(slug) {
  const p = secondBrandProfile(slug);
  return {
    policy: 'realtor-tenant-manifest-v1',
    slug,
    brand: {
      tenantId: p.tenantId,
      slug,
      companyName: p.name,
      colors: {
        primary: p.primary,
        secondary: p.secondary,
        accent: '#b77b27',
        background: '#ffffff',
      },
      logo: { url: '/synthetic-brand.svg', alt: p.name },
      contact: { email: p.email, phone: slug === 'sample-homes' ? '0700000002' : '0700000001' },
      locale: 'en-KE',
      currency: 'KES',
      features: { viewings: false, customerAccounts: false },
    },
    features: { advisorProfiles: false, contactActions: true },
    companyContent: {
      policy: 'public-company-content-v1',
      companySlug: slug,
      company: {
        summary: 'Fictional second-brand demonstration.',
        about: 'Synthetic preview only. No real stock, contact delivery or provider account.',
      },
      advisors: [],
      contact: { email: p.email },
    },
  };
}
/** Actual signed SDK/HTTP/restricted SQL; notification capture only, never provider delivery. */
export async function prepareSecondBrandDemo(slug) {
  if (process.env.NODE_ENV === 'production')
    throw Error('Synthetic demonstration refuses production.');
  const profile = secondBrandProfile(slug);
  const preview = await startStaffPreview({
    port: 0,
    tenantSlug: slug,
    actor: 'admin',
    enquiryPreview: 'synthetic-v1',
    enquiryCatalogue: 'synthetic-v1',
    reminderCaptureMode: 'capture-only-v1',
  });
  try {
    const api = new RealtorApiClient({
      baseUrl: preview.origin,
      allowLoopbackHttp: true,
      privacyNoticeVersion: 'synthetic-second-brand-v1',
    });
    const agent = { bearerToken: preview.enquiryStaff.agent.bearerToken };
    const inventory = await api.searchPropertiesV2();
    assert.ok(inventory.items.some((x) => x.id === preview.listingId));
    assert.ok(!inventory.items.some((x) => x.id === profile.foreignListing));
    await assert.rejects(
      () => api.getStaffEnquiryV2(profile.foreignEnquiry, agent),
      (e) => e.status === 403 || e.status === 404,
    );
    const enquiry = preview.enquiryFixtures.assigned,
      before = await api.getStaffEnquiryV2(enquiry, agent);
    const request = await api.requestViewingV2(
      enquiry,
      {
        operationId: randomUUID(),
        expectedEnquiryVersion: before.version,
        listingId: preview.listingId,
        preferredSlots: [],
        notes: `Synthetic ${slug} viewing.`,
      },
      agent,
    );
    const slot = {
      startAt: '2090-01-01T09:00:00.000Z',
      endAt: '2090-01-01T10:00:00.000Z',
      timeZone: 'Africa/Nairobi',
    };
    const proposed = await api.proposeViewingV2(
      enquiry,
      request.viewingId,
      { operationId: randomUUID(), expectedVersion: '1', slot },
      agent,
    );
    await api.confirmViewingV2(
      enquiry,
      request.viewingId,
      {
        operationId: randomUUID(),
        expectedVersion: '2',
        slot,
        channel: 'phone',
        agreedAt: proposed.completedAt,
        notes: 'Synthetic explicit agreement; no phone call occurred.',
      },
      agent,
    );
    const viewing = await api.getViewingV2(enquiry, request.viewingId, agent);
    const admission = await api.admitViewingReminderV2(
      enquiry,
      request.viewingId,
      {
        operationId: randomUUID(),
        expectedVersion: viewing.schedule.version,
        dueAt: viewing.confirmation.recordedAt,
        expiresAt: slot.startAt,
      },
      agent,
    );
    assert.equal(admission.outcome, 'admitted');
    assert.equal(admission.candidate.listingId, preview.listingId);
    const operation = { operationId: randomUUID() };
    const capture = await api.captureViewingReminderV2(admission, operation, agent);
    assert.equal(capture.outcome, 'captured');
    assert.equal(capture.mode, 'capture-only-v1');
    assert.equal(capture.enquiryId, enquiry);
    assert.equal(capture.actorId, preview.enquiryStaff.agent.actorId);
    assert.deepEqual(
      await api.getViewingReminderCaptureReceiptV2(admission, operation, agent),
      capture,
    );
    // Posting this brand's admission against a different company's enquiry confers no scope.
    await assert.rejects(
      () =>
        api.getViewingReminderAdmissionSnapshotV2(
          profile.foreignEnquiry,
          admission.operationId,
          agent,
        ),
      (e) => e.status === 403 || e.status === 404,
    );
    return {
      preview,
      manifest: secondBrandManifest(slug),
      proof: {
        slug,
        tenantId: profile.tenantId,
        name: profile.name,
        email: profile.email,
        primary: profile.primary,
        listingId: preview.listingId,
        inventoryIds: inventory.items.map((x) => x.id),
        foreignInventoryAbsent: true,
        foreignEnquiryDenied: true,
        notification: {
          mode: capture.mode,
          outcome: capture.outcome,
          enquiryId: capture.enquiryId,
          viewingId: capture.viewingId,
          actorId: capture.actorId,
          operationId: capture.operationId,
          readbackIdentical: true,
          foreignOriginalDenied: true,
          providerDelivery: false,
        },
      },
    };
  } catch (e) {
    await preview.close();
    throw e;
  }
}
