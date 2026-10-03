import { createConfirmationDraftWithHistory } from '../engine/confirmationEngine';
import type { Order } from '../domain/types';
import type { ConfirmationRecord } from '../contracts/persistence';
import { FirestoreConfirmationRepository } from '../persistence/firestoreConfirmationRepository';

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
