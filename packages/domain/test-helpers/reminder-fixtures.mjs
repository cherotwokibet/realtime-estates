import { outcomeFixture } from './viewing-outcome-fixtures.mjs';
/** Fictional already-saved models for transport validation, never past HTTP execution or delivery. */
export function reminderFixture({
  enquiry,
  viewing,
  listing,
  actor,
  admissionOperation,
  captureOperation,
} = {}) {
  const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    f = outcomeFixture({ enquiry, viewing, listing, actor });
  admissionOperation ??= id(80);
  captureOperation ??= id(90);
  const dueAt = '2020-01-01T08:35:00.000Z',
    expiresAt = '2020-01-01T08:50:00.000Z',
    candidate = {
      enquiryId: f.enquiry,
      viewingId: f.viewing,
      listingId: f.listing,
      viewingVersion: '3',
      cycleNumber: '1',
      slot: structuredClone(f.previous.proposedSlot),
      confirmationRecordedAt: f.schedule.outcome.previousUpdatedAt,
      agreedAt: f.previous.agreement.agreedAt,
      dueAt,
      expiresAt,
    };
  const admissionCommand = {
      operationId: admissionOperation,
      expectedVersion: '3',
      dueAt,
      expiresAt,
    },
    captureCommand = { operationId: captureOperation };
  const admission = {
    operationId: admissionOperation,
    enquiryId: f.enquiry,
    viewingId: f.viewing,
    actorId: f.actor,
    kind: 'admit_reminder',
    mode: 'capture-only-v1',
    expectedVersion: '3',
    observedVersion: '3',
    request: { dueAt, expiresAt },
    outcome: 'admitted',
    reason: null,
    candidate,
    completedAt: '2020-01-01T08:32:00.000Z',
  };
  const captured = {
    operationId: captureOperation,
    admissionOperationId: admissionOperation,
    enquiryId: f.enquiry,
    viewingId: f.viewing,
    actorId: f.actor,
    kind: 'capture_reminder',
    mode: 'capture-only-v1',
    expectedVersion: '3',
    observedVersion: '3',
    outcome: 'captured',
    reason: null,
    capture: {
      operationId: captureOperation,
      admissionOperationId: admissionOperation,
      viewingVersion: '3',
      capturedAt: '2020-01-01T08:40:00.000Z',
    },
    completedAt: '2020-01-01T08:40:00.000Z',
  };
  return {
    enquiry: f.enquiry,
    viewing: f.viewing,
    listing: f.listing,
    actor: f.actor,
    admissionCommand,
    captureCommand,
    admission,
    captured,
  };
}
