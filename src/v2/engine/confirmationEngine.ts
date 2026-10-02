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


export function getRemainingConfirmableQuantity(input: {
  orderLineQuantity: number;
  priorConfirmations: Confirmation[];
  orderLineId: string;
}): number {
  assertNonNegative(input.orderLineQuantity, 'orderLineQuantity');

  const alreadyConfirmed = input.priorConfirmations.reduce((sum, confirmation) => {
    if (confirmation.status !== 'CONFIRMED') return sum;
    const line = confirmation.lines.find((item) => item.orderLineId === input.orderLineId);
    return sum + (line?.confirmedQuantity ?? 0);
  }, 0);

  const remaining = input.orderLineQuantity - alreadyConfirmed;
  return remaining > 0 ? remaining : 0;
}

export function createConfirmationDraftWithHistory(input: {
  id: string;
  order: Order;
  selectedOrderLineIds: string[];
  acceptanceTextVersion: string;
  priorConfirmations: Confirmation[];
}): Confirmation {
  const base = createConfirmationDraft({
    id: input.id,
    order: input.order,
    selectedOrderLineIds: input.selectedOrderLineIds,
    acceptanceTextVersion: input.acceptanceTextVersion,
  });

  const lines = base.lines.map((line) => {
    const orderLine = input.order.lines.find((item) => item.id === line.orderLineId);
    if (!orderLine) throw new Error('ORDER_LINE_NOT_FOUND');

    const remaining = getRemainingConfirmableQuantity({
      orderLineQuantity: orderLine.orderedQuantity,
      priorConfirmations: input.priorConfirmations,
      orderLineId: line.orderLineId,
    });

    if (remaining <= 0) {
      throw new Error(`NO_REMAINING_QUANTITY:${line.orderLineId}`);
    }

    return {
      ...line,
      proposedQuantity: remaining,
    };
  });

  return { ...base, lines };
}

export function assertConfirmationWithinRemaining(input: {
  confirmation: Confirmation;
  order: Order;
  priorConfirmations: Confirmation[];
}) {
  for (const line of input.confirmation.lines) {
    const orderLine = input.order.lines.find((item) => item.id === line.orderLineId);
    if (!orderLine) throw new Error('ORDER_LINE_NOT_FOUND');

    const remaining = getRemainingConfirmableQuantity({
      orderLineQuantity: orderLine.orderedQuantity,
      priorConfirmations: input.priorConfirmations.filter(
        (item) => item.id !== input.confirmation.id,
      ),
      orderLineId: line.orderLineId,
    });

    const requested =
      line.requestedQuantity ??
      line.confirmedQuantity ??
      line.proposedQuantity;

    if (requested > remaining) {
      throw new Error(`CONFIRMATION_EXCEEDS_REMAINING:${line.orderLineId}`);
    }
  }
}


export function createCorrectionRevision(input: {
  id: string;
  original: Confirmation;
  reason: string;
  acceptanceTextVersion?: string;
}): Confirmation {
  if (input.original.status !== 'CONFIRMED') {
    throw new Error('ONLY_CONFIRMED_CAN_BE_REVISED');
  }
  if (!input.reason.trim()) throw new Error('REVISION_REASON_REQUIRED');

  return {
    id: input.id,
    seasonId: input.original.seasonId,
    organizationId: input.original.organizationId,
    orderId: input.original.orderId,
    revision: input.original.revision + 1,
    status: 'DRAFT',
    acceptanceTextVersion:
      input.acceptanceTextVersion ?? input.original.acceptanceTextVersion,
    supersedesConfirmationId: input.original.id,
    lifecycleReason: input.reason,
    lines: input.original.lines.map((line) => ({
      orderLineId: line.orderLineId,
      catalogItemId: line.catalogItemId,
      proposedQuantity:
        line.confirmedQuantity ??
        line.requestedQuantity ??
        line.proposedQuantity,
      unit: line.unit,
    })),
  };
}

export function voidConfirmedConfirmation(input: {
  confirmation: Confirmation;
  actorName: string;
  voidedAt: string;
  reason: string;
}): Confirmation {
  if (input.confirmation.status !== 'CONFIRMED') {
    throw new Error('ONLY_CONFIRMED_CAN_BE_VOIDED');
  }
  if (!input.reason.trim()) throw new Error('VOID_REASON_REQUIRED');

  return {
    ...input.confirmation,
    status: 'VOIDED',
    voidedAt: input.voidedAt,
    voidedBy: input.actorName,
    lifecycleReason: input.reason,
  };
}

export function finalizeConfirmationReplacement(input: {
  original: Confirmation;
  replacement: Confirmation;
  actorName: string;
  supersededAt: string;
}): {
  original: Confirmation;
  replacement: Confirmation;
} {
  if (input.original.status !== 'CONFIRMED') {
    throw new Error('ORIGINAL_NOT_CONFIRMED');
  }
  if (input.replacement.status !== 'CONFIRMED') {
    throw new Error('REPLACEMENT_NOT_CONFIRMED');
  }
  if (input.replacement.supersedesConfirmationId !== input.original.id) {
    throw new Error('INVALID_REPLACEMENT_LINEAGE');
  }
  if (input.replacement.revision !== input.original.revision + 1) {
    throw new Error('INVALID_REPLACEMENT_REVISION');
  }
  if (
    input.replacement.orderId !== input.original.orderId ||
    input.replacement.organizationId !== input.original.organizationId ||
    input.replacement.seasonId !== input.original.seasonId
  ) {
    throw new Error('INVALID_REPLACEMENT_SCOPE');
  }

  return {
    original: {
      ...input.original,
      status: 'SUPERSEDED',
      supersededByConfirmationId: input.replacement.id,
      supersededAt: input.supersededAt,
      supersededBy: input.actorName,
    },
    replacement: input.replacement,
  };
}

export function assertReplacementWithinOrder(input: {
  replacement: Confirmation;
  original: Confirmation;
  order: Order;
  otherConfirmations: Confirmation[];
}) {
  if (input.replacement.supersedesConfirmationId !== input.original.id) {
    throw new Error('INVALID_REPLACEMENT_LINEAGE');
  }

  assertConfirmationWithinRemaining({
    confirmation: input.replacement,
    order: input.order,
    priorConfirmations: input.otherConfirmations.filter(
      (item) => item.id !== input.original.id,
    ),
  });
}
