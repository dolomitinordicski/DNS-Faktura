import type {
  BillingSheet,
  DeliveryLine,
  Order,
  PaymentCase,
} from '../domain/types';
import {
  approveRequestedChanges,
  createConfirmationDraft,
  markConfirmationSent,
  receiveConfirmationResponse,
} from '../engine/confirmationEngine';
import {
  buildConfirmedOrderBillingLines,
  createBillingSheet,
  createManualServiceLine,
  markBillingSheetInvoiced,
  markBillingSheetReady,
} from '../engine/billingEngine';
import {
  canReleaseForDelivery,
  deriveDeliveryStatus,
  updateDeliveredQuantity,
} from '../engine/deliveryEngine';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message: string) {
  if (!Object.is(actual, expected)) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function expectError(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === code || message.startsWith(code)) return;
    throw new Error(`Expected error ${code}, got ${message}`);
  }
  throw new Error(`Expected error ${code}, but no error was thrown`);
}

const order: Order = {
  id: 'order-drei-zinnen-2026-27',
  seasonId: '2026-27',
  organizationId: 'drei-zinnen',
  status: 'SUBMITTED',
  lines: [
    {
      id: 'line-wristband',
      catalogItemId: '2026-27-wristband-14-yellow',
      category: 'wristband',
      label: 'Wristband yellow',
      orderedQuantity: 500,
      unit: 'piece',
    },
    {
      id: 'line-ticket',
      catalogItemId: '2026-27-wk-area',
      category: 'ticket',
      label: 'Weekly ticket area',
      orderedQuantity: 1000,
      unit: 'piece',
    },
    {
      id: 'line-pocketfolder',
      catalogItemId: '2026-27-pocketfolder-drei-zinnen',
      category: 'pocketfolder',
      label: 'Pocketfolder Drei Zinnen',
      orderedQuantity: 1500,
      unit: 'piece',
    },
  ],
};

export function runFakturaV2Scenarios() {
  const results: string[] = [];

  const partial = createConfirmationDraft({
    id: 'confirmation-a',
    order,
    selectedOrderLineIds: ['line-wristband', 'line-ticket'],
    acceptanceTextVersion: 'v1',
  });
  equal(partial.lines.length, 2, 'S01 selected line count');
  assert(
    !partial.lines.some((line) => line.orderLineId === 'line-pocketfolder'),
    'S01 Pocketfolder must stay outside the confirmation batch',
  );
  equal(order.lines[0].orderedQuantity, 500, 'S01 original order remains unchanged');
  results.push('S01');

  const sent = markConfirmationSent(partial, '2026-10-02T10:00:00Z');
  const unchanged = receiveConfirmationResponse({
    confirmation: sent,
    requestedQuantities: {
      'line-wristband': 500,
      'line-ticket': 1000,
    },
    actorName: 'Area Contact',
    respondedAt: '2026-10-02T10:05:00Z',
  });
  equal(unchanged.status, 'CONFIRMED', 'S02 unchanged response status');
  equal(unchanged.lines[0].confirmedQuantity, 500, 'S02 wristband confirmed quantity');
  equal(unchanged.lines[1].confirmedQuantity, 1000, 'S02 ticket confirmed quantity');
  equal(unchanged.confirmedBy, 'Area Contact', 'S02 actor');
  results.push('S02');

  const changeDraft = createConfirmationDraft({
    id: 'confirmation-change',
    order,
    selectedOrderLineIds: ['line-wristband'],
    acceptanceTextVersion: 'v1',
  });
  const changeSent = markConfirmationSent(changeDraft, '2026-10-02T10:10:00Z');
  const changed = receiveConfirmationResponse({
    confirmation: changeSent,
    requestedQuantities: { 'line-wristband': 450 },
    actorName: 'Area Contact',
    respondedAt: '2026-10-02T10:15:00Z',
  });
  equal(changed.status, 'CHANGE_REQUESTED', 'S03 change request status');
  equal(changed.lines[0].confirmedQuantity, undefined, 'S03 not confirmed before DNS approval');
  equal(changed.lines[0].requestedQuantity, 450, 'S03 requested quantity');

  const approved = approveRequestedChanges({
    confirmation: changed,
    actorName: 'DNS Admin',
    confirmedAt: '2026-10-02T10:20:00Z',
  });
  equal(approved.status, 'CONFIRMED', 'S03 approved status');
  equal(approved.lines[0].confirmedQuantity, 450, 'S03 approved confirmed quantity');
  equal(order.lines[0].orderedQuantity, 500, 'S03 source order remains 500');
  results.push('S03');

  const orderBillingLines = buildConfirmedOrderBillingLines({
    confirmation: approved,
    rates: [
      {
        catalogItemId: '2026-27-wristband-14-yellow',
        rateId: 'rate-wristband',
        rateRevision: 1,
        unitPrice: 0.159,
        prepaymentRequired: true,
        sourceDocument: 'Brady Italia / PDC · 1013437506',
      },
    ],
  });
  equal(orderBillingLines[0].quantity, 450, 'S04 billing quantity comes from confirmation');
  equal(orderBillingLines[0].amount, 71.55, 'S04 confirmed billing amount');
  equal(orderBillingLines[0].sourceId, approved.id, 'S05 source lineage uses confirmation');
  results.push('S04', 'S05');

  const graphic = createManualServiceLine({
    id: 'manual-grafik',
    sourceId: 'manual:drei-zinnen:grafik',
    description: 'Grafik Pocketfolder Drei Zinnen',
    quantity: 6.5,
    unit: 'hour',
    unitPrice: 65,
  });
  const cartography = createManualServiceLine({
    id: 'manual-kartografie',
    sourceId: 'manual:drei-zinnen:kartografie',
    description: 'Kartografie',
    quantity: 3,
    unit: 'hour',
    unitPrice: 80,
  });
  const corrections = createManualServiceLine({
    id: 'manual-korrekturen',
    sourceId: 'manual:drei-zinnen:korrekturen',
    description: 'Korrekturen',
    quantity: 1,
    unit: 'flat',
    unitPrice: 120,
  });
  equal(graphic.amount, 422.5, 'S06 graphic amount');
  equal(cartography.amount, 240, 'S06 cartography amount');
  equal(corrections.amount, 120, 'S06 corrections amount');
  results.push('S06');

  let sheet = createBillingSheet({
    id: 'billing-drei-zinnen-2026-27',
    seasonId: '2026-27',
    organizationId: 'drei-zinnen',
    revision: 1,
    lines: [...orderBillingLines, graphic, cartography, corrections],
  });
  sheet = markBillingSheetReady(sheet);
  sheet = markBillingSheetInvoiced(sheet);
  equal(sheet.status, 'INVOICED', 'S10 valid billing lifecycle');

  const openPayment: PaymentCase = {
    billingSheetId: sheet.id,
    required: true,
    status: 'OPEN',
  };
  equal(
    canReleaseForDelivery({ billingSheet: sheet, payment: openPayment }),
    false,
    'S07 open payment blocks delivery',
  );

  const paidPayment: PaymentCase = {
    ...openPayment,
    status: 'PAID',
    paidAt: '2026-10-03T09:00:00Z',
  };
  equal(
    canReleaseForDelivery({ billingSheet: sheet, payment: paidPayment }),
    true,
    'S07 paid payment releases delivery',
  );
  results.push('S07');

  const deliveryBase: DeliveryLine = {
    catalogItemId: '2026-27-wristband-14-yellow',
    confirmedQuantity: 450,
    deliveredQuantity: 0,
    remainingQuantity: 450,
  };
  const partialDelivery = updateDeliveredQuantity({
    line: deliveryBase,
    deliveredQuantity: 400,
  });
  equal(partialDelivery.remainingQuantity, 50, 'S08 remaining quantity');
  equal(deriveDeliveryStatus([partialDelivery]), 'PARTIAL', 'S08 partial status');

  const fullDelivery = updateDeliveredQuantity({
    line: deliveryBase,
    deliveredQuantity: 450,
  });
  equal(fullDelivery.remainingQuantity, 0, 'S08 full remaining');
  equal(deriveDeliveryStatus([fullDelivery]), 'DELIVERED', 'S08 delivered status');
  results.push('S08');

  expectError(
    () =>
      updateDeliveredQuantity({
        line: deliveryBase,
        deliveredQuantity: 451,
      }),
    'INVALID_DELIVERED_QUANTITY',
  );
  results.push('S09');

  const invalidSheet: BillingSheet = {
    ...sheet,
    status: 'INVOICED',
  };
  expectError(() => markBillingSheetReady(invalidSheet), 'INVALID_BILLING_STATE');
  results.push('S10');

  return results;
}
