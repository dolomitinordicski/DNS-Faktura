import {
  createConfirmationDraftWithHistory,
  createCorrectionRevision,
} from '../engine/confirmationEngine';
import type { Order } from '../domain/types';
import type { ConfirmationRecord } from '../contracts/persistence';
import {
  FirestoreConfirmationRepository,
  FirestorePublicConfirmationRepository,
} from '../persistence/firestoreConfirmationRepository';
import { dispatchConfirmationWithPublicToken } from './publicConfirmationService';

export async function createConfirmationBatch(input: {
  order: Order;
  selectedOrderLineIds: string[];
  priorConfirmations: ConfirmationRecord[];
  actorId: string;
  acceptanceTextVersion?: string;
  repository?: FirestoreConfirmationRepository;
}): Promise<ConfirmationRecord> {
  if (input.order.status !== 'SUBMITTED') {
    throw new Error('ORDER_NOT_SUBMITTED');
  }

  const now = new Date().toISOString();
  const repository = input.repository ?? new FirestoreConfirmationRepository();
  const id = `confirmation-${input.order.id}-${crypto.randomUUID()}`;

  const draft = createConfirmationDraftWithHistory({
    id,
    order: input.order,
    selectedOrderLineIds: input.selectedOrderLineIds,
    acceptanceTextVersion: input.acceptanceTextVersion ?? 'v1',
    priorConfirmations: input.priorConfirmations,
  });

  const record: ConfirmationRecord = {
    ...draft,
    createdAt: now,
    createdBy: input.actorId,
    updatedAt: now,
    updatedBy: input.actorId,
  };

  await repository.createDraft(record);
  return record;
}

export async function dispatchConfirmation(input: {
  confirmationId: string;
  actorId: string;
  expiresAt?: string;
  repository?: FirestorePublicConfirmationRepository;
}) {
  return dispatchConfirmationWithPublicToken({
    confirmationId: input.confirmationId,
    repository:
      input.repository ?? new FirestorePublicConfirmationRepository(),
    actorId: input.actorId,
    occurredAt: new Date().toISOString(),
    expiresAt: input.expiresAt,
  });
}

export async function approveConfirmationChange(input: {
  confirmationId: string;
  actorId: string;
  repository?: FirestoreConfirmationRepository;
}): Promise<ConfirmationRecord> {
  return (input.repository ?? new FirestoreConfirmationRepository()).confirmTransaction({
    confirmationId: input.confirmationId,
    actorId: input.actorId,
    occurredAt: new Date().toISOString(),
  });
}

export async function createConfirmationCorrection(input: {
  original: ConfirmationRecord;
  reason: string;
  actorId: string;
  repository?: FirestoreConfirmationRepository;
}): Promise<ConfirmationRecord> {
  const repository = input.repository ?? new FirestoreConfirmationRepository();
  const now = new Date().toISOString();
  const correction = createCorrectionRevision({
    id: `confirmation-${input.original.orderId}-r${input.original.revision + 1}-${crypto.randomUUID()}`,
    original: input.original,
    reason: input.reason,
  });

  const record: ConfirmationRecord = {
    ...correction,
    createdAt: now,
    createdBy: input.actorId,
    updatedAt: now,
    updatedBy: input.actorId,
  };

  await repository.createDraft(record);
  return record;
}

export async function voidConfirmation(input: {
  confirmationId: string;
  reason: string;
  actorId: string;
  repository?: FirestoreConfirmationRepository;
}): Promise<ConfirmationRecord> {
  return (input.repository ?? new FirestoreConfirmationRepository()).voidTransaction({
    confirmationId: input.confirmationId,
    actorId: input.actorId,
    occurredAt: new Date().toISOString(),
    reason: input.reason,
  });
}
