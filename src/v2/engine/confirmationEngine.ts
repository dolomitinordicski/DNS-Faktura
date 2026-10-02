import type {
  Confirmation,
  ConfirmationLine,
  Order,
} from '../domain/types';

function assertNonNegative(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative number`);
  }
}

export function createConfirmationDraft(input: {
  id: string;
  order: Order;
  selectedOrderLineIds: string[];
  acceptanceTextVersion: string;
}): Confirmation {
  if (input.order.status !== 'SUBMITTED') {
    throw new Error('ORDER_NOT_SUBMITTED');
  }

  const selected = new Set(input.selectedOrderLineIds);
  const lines: ConfirmationLine[] = input.order.lines
    .filter((line) => selected.has(line.id))
    .map((line) => ({
      orderLineId: line.id,
      catalogItemId: line.catalogItemId,
      proposedQuantity: line.orderedQuantity,
      unit: line.unit,
    }));

  if (!lines.length) throw new Error('EMPTY_CONFIRMATION');

  return {
    id: input.id,
    seasonId: input.order.seasonId,
    organizationId: input.order.organizationId,
    orderId: input.order.id,
    revision: 1,
    status: 'DRAFT',
    acceptanceTextVersion: input.acceptanceTextVersion,
    lines,
  };
}

export function markConfirmationSent(
  confirmation: Confirmation,
  sentAt: string,
): Confirmation {
  if (confirmation.status !== 'DRAFT') throw new Error('INVALID_CONFIRMATION_STATE');
  return { ...confirmation, status: 'SENT', sentAt };
}

export function receiveConfirmationResponse(input: {
  confirmation: Confirmation;
  requestedQuantities: Record<string, number>;
  actorName: string;
  respondedAt: string;
}): Confirmation {
  if (input.confirmation.status !== 'SENT') {
    throw new Error('INVALID_CONFIRMATION_STATE');
  }

  let changed = false;

  const lines = input.confirmation.lines.map((line) => {
    const requested =
      input.requestedQuantities[line.orderLineId] ?? line.proposedQuantity;
    assertNonNegative(requested, 'requestedQuantity');

    if (requested !== line.proposedQuantity) changed = true;

    return changed || requested !== line.proposedQuantity
      ? { ...line, requestedQuantity: requested }
      : { ...line, confirmedQuantity: requested };
  });

  if (changed) {
    return {
      ...input.confirmation,
      status: 'CHANGE_REQUESTED',
      lines: lines.map((line) => ({
        ...line,
        confirmedQuantity: undefined,
      })),
    };
  }

  return {
    ...input.confirmation,
    status: 'CONFIRMED',
    lines,
    confirmedAt: input.respondedAt,
    confirmedBy: input.actorName,
  };
}

export function approveRequestedChanges(input: {
  confirmation: Confirmation;
  actorName: string;
  confirmedAt: string;
}): Confirmation {
  if (input.confirmation.status !== 'CHANGE_REQUESTED') {
    throw new Error('INVALID_CONFIRMATION_STATE');
  }

  return {
    ...input.confirmation,
    status: 'CONFIRMED',
    lines: input.confirmation.lines.map((line) => ({
      ...line,
      confirmedQuantity: line.requestedQuantity ?? line.proposedQuantity,
    })),
    confirmedAt: input.confirmedAt,
    confirmedBy: input.actorName,
  };
}
