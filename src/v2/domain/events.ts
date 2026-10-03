import type {
  BillingSheetStatus,
  ConfirmationStatus,
  DeliveryStatus,
  OrganizationId,
  PaymentStatus,
  SeasonId,
} from '../domain/types';

export type DomainEventType =
  | 'CONFIRMATION_CREATED'
  | 'CONFIRMATION_SENT'
  | 'CONFIRMATION_CHANGE_REQUESTED'
  | 'CONFIRMATION_CONFIRMED'
  | 'CONFIRMATION_SUPERSEDED'
  | 'CONFIRMATION_VOIDED'
  | 'BILLING_MANUAL_LINE_ADDED'
  | 'BILLING_MANUAL_LINE_UPDATED'
  | 'BILLING_MANUAL_LINE_REMOVED'
  | 'BILLING_REVISION_CREATED'
  | 'BILLING_READY'
  | 'BILLING_INVOICED'
  | 'PAYMENT_MARKED_OPEN'
  | 'PAYMENT_MARKED_PAID'
  | 'DELIVERY_CREATED'
  | 'DELIVERY_UPDATED'
  | 'DELIVERY_COMPLETED';

export interface DomainEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  type: DomainEventType;
  occurredAt: string;
  actorId: string;
  actorLabel?: string;
  seasonId: SeasonId;
  organizationId: OrganizationId;
  entityType: 'CONFIRMATION' | 'BILLING_SHEET' | 'PAYMENT' | 'DELIVERY';
  entityId: string;
  entityRevision?: number;
  payload: TPayload;
}

export interface ConfirmationEventPayload extends Record<string, unknown> {
  fromStatus?: ConfirmationStatus;
  toStatus: ConfirmationStatus;
  reason?: string;
}

export interface BillingEventPayload extends Record<string, unknown> {
  fromStatus?: BillingSheetStatus;
  toStatus: BillingSheetStatus;
  totalAmount: number;
}

export interface PaymentEventPayload extends Record<string, unknown> {
  fromStatus?: PaymentStatus;
  toStatus: PaymentStatus;
  reference?: string;
}

export interface DeliveryEventPayload extends Record<string, unknown> {
  fromStatus?: DeliveryStatus;
  toStatus: DeliveryStatus;
  deliveredQuantity?: number;
  remainingQuantity?: number;
}

export function createDomainEvent<TPayload extends Record<string, unknown>>(input: {
  id: string;
  type: DomainEventType;
  occurredAt: string;
  actorId: string;
  actorLabel?: string;
  seasonId: SeasonId;
  organizationId: OrganizationId;
  entityType: DomainEvent['entityType'];
  entityId: string;
  entityRevision?: number;
  payload: TPayload;
}): DomainEvent<TPayload> {
  if (!input.id.trim()) throw new Error('EVENT_ID_REQUIRED');
  if (!input.occurredAt.trim()) throw new Error('EVENT_TIMESTAMP_REQUIRED');
  if (!input.actorId.trim()) throw new Error('EVENT_ACTOR_REQUIRED');
  if (!input.entityId.trim()) throw new Error('EVENT_ENTITY_REQUIRED');

  return {
    ...input,
    payload: { ...input.payload },
  };
}

export function assertAppendOnlyEventSequence(events: DomainEvent[]) {
  const ids = new Set<string>();

  for (const event of events) {
    if (ids.has(event.id)) {
      throw new Error(`DUPLICATE_EVENT_ID:${event.id}`);
    }
    ids.add(event.id);
  }

  for (let index = 1; index < events.length; index += 1) {
    const previous = Date.parse(events[index - 1].occurredAt);
    const current = Date.parse(events[index].occurredAt);
    if (Number.isFinite(previous) && Number.isFinite(current) && current < previous) {
      throw new Error('EVENT_SEQUENCE_NOT_CHRONOLOGICAL');
    }
  }

  return true;
}
