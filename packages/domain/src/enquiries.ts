import { DomainError, requireText, requireTimestamp } from './errors.js';
import type { TenantId } from './permissions.js';

export type EnquiryStatus =
  'new' | 'contacted' | 'qualified' | 'viewing-scheduled' | 'negotiating' | 'won' | 'lost' | 'spam';
export type ViewingStatus =
  'requested' | 'confirmed' | 'completed' | 'no-show' | 'cancelled' | 'declined';
export interface WorkflowEvent<S extends string> {
  readonly from: S;
  readonly to: S;
  readonly at: string;
  readonly actorId: string;
  readonly reason: string | null;
}
export interface Enquiry {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly propertyId: string;
  readonly assignedAgentId: string | null;
  readonly status: EnquiryStatus;
  readonly events: readonly WorkflowEvent<EnquiryStatus>[];
}
export interface Viewing {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly enquiryId: string;
  readonly status: ViewingStatus;
  readonly startsAt: string;
  readonly events: readonly WorkflowEvent<ViewingStatus>[];
}
export interface WorkflowChange {
  readonly actorId: string;
  readonly at: string;
  readonly reason?: string;
}

const enquiryTransitions: Readonly<Record<EnquiryStatus, readonly EnquiryStatus[]>> = {
  new: ['contacted', 'lost', 'spam'],
  contacted: ['qualified', 'viewing-scheduled', 'lost', 'spam'],
  qualified: ['viewing-scheduled', 'negotiating', 'won', 'lost'],
  'viewing-scheduled': ['qualified', 'negotiating', 'won', 'lost'],
  negotiating: ['won', 'lost'],
  won: [],
  lost: [],
  spam: [],
};
const viewingTransitions: Readonly<Record<ViewingStatus, readonly ViewingStatus[]>> = {
  requested: ['confirmed', 'cancelled', 'declined'],
  confirmed: ['completed', 'no-show', 'cancelled'],
  completed: [],
  'no-show': [],
  cancelled: [],
  declined: [],
};

export function createEnquiry(input: {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly propertyId: string;
  readonly assignedAgentId?: string | null;
}): Enquiry {
  return Object.freeze({
    id: requireText(input.id, 'Enquiry ID'),
    tenantId: requireText(input.tenantId, 'Tenant ID'),
    propertyId: requireText(input.propertyId, 'Property ID'),
    assignedAgentId:
      input.assignedAgentId == null
        ? null
        : requireText(input.assignedAgentId, 'Assigned agent ID'),
    status: 'new',
    events: Object.freeze([]),
  });
}
export function transitionEnquiry(
  enquiry: Enquiry,
  status: EnquiryStatus,
  change: WorkflowChange,
): Enquiry {
  if (!enquiryTransitions[enquiry.status]?.includes(status))
    throw new DomainError(
      'INVALID_TRANSITION',
      `Cannot move an enquiry from ${enquiry.status} to ${status}.`,
    );
  const reason =
    status === 'lost' || status === 'spam'
      ? requireText(change.reason ?? '', 'Closure reason')
      : change.reason?.trim() || null;
  const event: WorkflowEvent<EnquiryStatus> = Object.freeze({
    from: enquiry.status,
    to: status,
    at: requireTimestamp(change.at),
    actorId: requireText(change.actorId, 'Actor ID'),
    reason,
  });
  return Object.freeze({ ...enquiry, status, events: Object.freeze([...enquiry.events, event]) });
}
export function createViewing(input: {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly enquiryId: string;
  readonly startsAt: string;
}): Viewing {
  return Object.freeze({
    id: requireText(input.id, 'Viewing ID'),
    tenantId: requireText(input.tenantId, 'Tenant ID'),
    enquiryId: requireText(input.enquiryId, 'Enquiry ID'),
    startsAt: requireTimestamp(input.startsAt),
    status: 'requested',
    events: Object.freeze([]),
  });
}
export function transitionViewing(
  viewing: Viewing,
  status: ViewingStatus,
  change: WorkflowChange,
): Viewing {
  if (!viewingTransitions[viewing.status]?.includes(status))
    throw new DomainError(
      'INVALID_TRANSITION',
      `Cannot move a viewing from ${viewing.status} to ${status}.`,
    );
  const reason =
    status === 'cancelled' || status === 'declined'
      ? requireText(change.reason ?? '', 'Viewing reason')
      : change.reason?.trim() || null;
  const event: WorkflowEvent<ViewingStatus> = Object.freeze({
    from: viewing.status,
    to: status,
    at: requireTimestamp(change.at),
    actorId: requireText(change.actorId, 'Actor ID'),
    reason,
  });
  return Object.freeze({ ...viewing, status, events: Object.freeze([...viewing.events, event]) });
}
