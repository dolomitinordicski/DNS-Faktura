import type { ConfirmationRecord } from '../contracts/persistence';

export interface LedgerOrderLineSnapshot {
  id: string;
  orderId: string;
  orderedQuantity: number;
}

export interface ExistingConfirmationLedger {
  orderId: string;
  confirmedByLine: Record<string, number>;
}

export interface LedgerBootstrapEntry {
  orderId: string;
  expectedConfirmedByLine: Record<string, number>;
  currentConfirmedByLine?: Record<string, number>;
  action: 'CREATE' | 'REPLACE' | 'UNCHANGED';
}

export interface LedgerBootstrapBlocker {
  code:
    | 'INVALID_CONFIRMED_QUANTITY'
    | 'ORDER_LINE_NOT_FOUND'
    | 'ORDER_LINE_SCOPE_MISMATCH'
    | 'CONFIRMED_EXCEEDS_ORDERED'
    | 'INVALID_EXISTING_LEDGER';
  confirmationId?: string;
  orderId: string;
  orderLineId?: string;
  detail?: string;
}

export interface LedgerBootstrapPlan {
  entries: LedgerBootstrapEntry[];
  blockers: LedgerBootstrapBlocker[];
}

function normalizedLedger(
  values: Record<string, number>,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, quantity]) => quantity !== 0)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function sameLedger(
  left: Record<string, number>,
  right: Record<string, number>,
) {
  const a = normalizedLedger(left);
  const b = normalizedLedger(right);
  return JSON.stringify(a) === JSON.stringify(b);
}

export function buildConfirmationLedgerBootstrapPlan(input: {
  confirmations: ConfirmationRecord[];
  orderLines: LedgerOrderLineSnapshot[];
  existingLedgers: ExistingConfirmationLedger[];
}): LedgerBootstrapPlan {
  const blockers: LedgerBootstrapBlocker[] = [];
  const orderLineById = new Map(
    input.orderLines.map((line) => [line.id, line]),
  );
  const expected = new Map<string, Record<string, number>>();

  for (const confirmation of input.confirmations) {
    if (confirmation.status !== 'CONFIRMED') continue;

    const ledger = expected.get(confirmation.orderId) ?? {};

    for (const line of confirmation.lines) {
      const quantity = line.confirmedQuantity;
      if (
        typeof quantity !== 'number' ||
        !Number.isFinite(quantity) ||
        quantity < 0
      ) {
        blockers.push({
          code: 'INVALID_CONFIRMED_QUANTITY',
          confirmationId: confirmation.id,
          orderId: confirmation.orderId,
          orderLineId: line.orderLineId,
        });
        continue;
      }

      const orderLine = orderLineById.get(line.orderLineId);
      if (!orderLine) {
        blockers.push({
          code: 'ORDER_LINE_NOT_FOUND',
          confirmationId: confirmation.id,
          orderId: confirmation.orderId,
          orderLineId: line.orderLineId,
        });
        continue;
      }

      if (orderLine.orderId !== confirmation.orderId) {
        blockers.push({
          code: 'ORDER_LINE_SCOPE_MISMATCH',
          confirmationId: confirmation.id,
          orderId: confirmation.orderId,
          orderLineId: line.orderLineId,
          detail: orderLine.orderId,
        });
        continue;
      }

      ledger[line.orderLineId] =
        (ledger[line.orderLineId] ?? 0) + quantity;
      expected.set(confirmation.orderId, ledger);
    }
  }

  for (const [orderId, quantities] of expected) {
    for (const [orderLineId, confirmedQuantity] of Object.entries(quantities)) {
      const orderLine = orderLineById.get(orderLineId);
      if (!orderLine) continue;
      if (confirmedQuantity > orderLine.orderedQuantity) {
        blockers.push({
          code: 'CONFIRMED_EXCEEDS_ORDERED',
          orderId,
          orderLineId,
          detail: `${String(confirmedQuantity)}>${String(
            orderLine.orderedQuantity,
          )}`,
        });
      }
    }
  }

  const existingByOrder = new Map(
    input.existingLedgers.map((ledger) => [ledger.orderId, ledger]),
  );

  for (const ledger of input.existingLedgers) {
    for (const [orderLineId, quantity] of Object.entries(
      ledger.confirmedByLine,
    )) {
      if (
        !Number.isFinite(quantity) ||
        quantity < 0 ||
        !orderLineById.has(orderLineId)
      ) {
        blockers.push({
          code: 'INVALID_EXISTING_LEDGER',
          orderId: ledger.orderId,
          orderLineId,
        });
      }
    }
  }

  const orderIds = new Set([
    ...expected.keys(),
    ...input.existingLedgers.map((ledger) => ledger.orderId),
  ]);

  const entries = [...orderIds]
    .sort()
    .map((orderId): LedgerBootstrapEntry => {
      const expectedConfirmedByLine = normalizedLedger(
        expected.get(orderId) ?? {},
      );
      const current = existingByOrder.get(orderId);
      const currentConfirmedByLine = current
        ? normalizedLedger(current.confirmedByLine)
        : undefined;

      return {
        orderId,
        expectedConfirmedByLine,
        currentConfirmedByLine,
        action: !current
          ? 'CREATE'
          : sameLedger(
                expectedConfirmedByLine,
                currentConfirmedByLine ?? {},
              )
            ? 'UNCHANGED'
            : 'REPLACE',
      };
    });

  return { entries, blockers };
}
