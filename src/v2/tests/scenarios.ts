import type {
  BillingSheet,
  DeliveryLine,
  Order,
  PaymentCase,
} from '../domain/types';
import {
  approveRequestedChanges,
  assertConfirmationWithinRemaining,
  assertReplacementWithinOrder,
  createConfirmationDraft,
  createConfirmationDraftWithHistory,
  createCorrectionRevision,
  finalizeConfirmationReplacement,
  getRemainingConfirmableQuantity,
  markConfirmationSent,
  receiveConfirmationResponse,
  voidConfirmedConfirmation,
} from '../engine/confirmationEngine';
import {
  assertBillingSheetImmutable,
  assertBillingSheetRevisionLineage,
  assertBillingSheetSourcesFresh,
  buildConfirmedOrderBillingLines,
  checkBillingSheetFreshness,
  createBillingSheet,
  createBillingSheetRevision,
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

  const firstBatchDraft = createConfirmationDraft({
    id: 'confirmation-first-300',
    order,
    selectedOrderLineIds: ['line-wristband'],
    acceptanceTextVersion: 'v1',
  });
  const firstBatchSent = markConfirmationSent(firstBatchDraft, '2026-10-02T11:00:00Z');
  const firstBatchChanged = receiveConfirmationResponse({
    confirmation: firstBatchSent,
    requestedQuantities: { 'line-wristband': 300 },
    actorName: 'Area Contact',
    respondedAt: '2026-10-02T11:05:00Z',
  });
  const firstBatch = approveRequestedChanges({
    confirmation: firstBatchChanged,
    actorName: 'DNS Admin',
    confirmedAt: '2026-10-02T11:10:00Z',
  });

  equal(
    getRemainingConfirmableQuantity({
      orderLineQuantity: 500,
      priorConfirmations: [firstBatch],
      orderLineId: 'line-wristband',
    }),
    200,
    'S11 remaining quantity after first batch',
  );

  const secondBatch = createConfirmationDraftWithHistory({
    id: 'confirmation-second-200',
    order,
    selectedOrderLineIds: ['line-wristband'],
    acceptanceTextVersion: 'v1',
    priorConfirmations: [firstBatch],
  });
  equal(secondBatch.lines[0].proposedQuantity, 200, 'S11 second batch proposes remainder');
  results.push('S11');

  const secondSent = markConfirmationSent(secondBatch, '2026-10-02T11:15:00Z');
  const secondConfirmed = receiveConfirmationResponse({
    confirmation: secondSent,
    requestedQuantities: { 'line-wristband': 200 },
    actorName: 'Area Contact',
    respondedAt: '2026-10-02T11:20:00Z',
  });
  assertConfirmationWithinRemaining({
    confirmation: secondConfirmed,
    order,
    priorConfirmations: [firstBatch],
  });
  equal(secondConfirmed.status, 'CONFIRMED', 'S12 second batch confirmed');

  equal(
    getRemainingConfirmableQuantity({
      orderLineQuantity: 500,
      priorConfirmations: [firstBatch, secondConfirmed],
      orderLineId: 'line-wristband',
    }),
    0,
    'S12 no remaining quantity',
  );

  expectError(
    () =>
      createConfirmationDraftWithHistory({
        id: 'confirmation-third',
        order,
        selectedOrderLineIds: ['line-wristband'],
        acceptanceTextVersion: 'v1',
        priorConfirmations: [firstBatch, secondConfirmed],
      }),
    'NO_REMAINING_QUANTITY',
  );
  results.push('S12');

  const staleParallelDraft = createConfirmationDraft({
    id: 'confirmation-stale',
    order,
    selectedOrderLineIds: ['line-wristband'],
    acceptanceTextVersion: 'v1',
  });
  const staleParallelSent = markConfirmationSent(
    staleParallelDraft,
    '2026-10-02T11:25:00Z',
  );
  const staleParallelChanged = receiveConfirmationResponse({
    confirmation: staleParallelSent,
    requestedQuantities: { 'line-wristband': 250 },
    actorName: 'Area Contact',
    respondedAt: '2026-10-02T11:30:00Z',
  });
  const staleParallelApproved = approveRequestedChanges({
    confirmation: staleParallelChanged,
    actorName: 'DNS Admin',
    confirmedAt: '2026-10-02T11:35:00Z',
  });

  expectError(
    () =>
      assertConfirmationWithinRemaining({
        confirmation: staleParallelApproved,
        order,
        priorConfirmations: [firstBatch],
      }),
    'CONFIRMATION_EXCEEDS_REMAINING',
  );
  results.push('S13');

  const revisionOriginalDraft = createConfirmationDraft({
    id: 'confirmation-revision-original',
    order,
    selectedOrderLineIds: ['line-wristband'],
    acceptanceTextVersion: 'v1',
  });
  const revisionOriginalSent = markConfirmationSent(
    revisionOriginalDraft,
    '2026-10-02T12:00:00Z',
  );
  const revisionOriginalChanged = receiveConfirmationResponse({
    confirmation: revisionOriginalSent,
    requestedQuantities: { 'line-wristband': 300 },
    actorName: 'Area Contact',
    respondedAt: '2026-10-02T12:05:00Z',
  });
  const revisionOriginal = approveRequestedChanges({
    confirmation: revisionOriginalChanged,
    actorName: 'DNS Admin',
    confirmedAt: '2026-10-02T12:10:00Z',
  });

  const correctionDraft = createCorrectionRevision({
    id: 'confirmation-revision-correction',
    original: revisionOriginal,
    reason: 'Quantity correction before invoicing',
  });
  equal(correctionDraft.revision, 2, 'S14 correction revision number');
  equal(
    correctionDraft.supersedesConfirmationId,
    revisionOriginal.id,
    'S14 correction lineage',
  );
  equal(
    correctionDraft.lines[0].proposedQuantity,
    300,
    'S14 correction starts from prior confirmed quantity',
  );
  equal(
    revisionOriginal.lines[0].confirmedQuantity,
    300,
    'S14 original historical quantity remains unchanged',
  );

  const correctionSent = markConfirmationSent(
    correctionDraft,
    '2026-10-02T12:15:00Z',
  );
  const correctionChanged = receiveConfirmationResponse({
    confirmation: correctionSent,
    requestedQuantities: { 'line-wristband': 250 },
    actorName: 'Area Contact',
    respondedAt: '2026-10-02T12:20:00Z',
  });
  const correctionConfirmed = approveRequestedChanges({
    confirmation: correctionChanged,
    actorName: 'DNS Admin',
    confirmedAt: '2026-10-02T12:25:00Z',
  });

  assertReplacementWithinOrder({
    replacement: correctionConfirmed,
    original: revisionOriginal,
    order,
    otherConfirmations: [],
  });

  const replacement = finalizeConfirmationReplacement({
    original: revisionOriginal,
    replacement: correctionConfirmed,
    actorName: 'DNS Admin',
    supersededAt: '2026-10-02T12:30:00Z',
  });
  equal(replacement.original.status, 'SUPERSEDED', 'S14 original superseded');
  equal(replacement.replacement.status, 'CONFIRMED', 'S14 replacement active');
  equal(
    replacement.original.lines[0].confirmedQuantity,
    300,
    'S14 superseded record keeps historical quantity',
  );
  equal(
    replacement.replacement.lines[0].confirmedQuantity,
    250,
    'S14 replacement effective quantity',
  );
  equal(
    getRemainingConfirmableQuantity({
      orderLineQuantity: 500,
      priorConfirmations: [replacement.original, replacement.replacement],
      orderLineId: 'line-wristband',
    }),
    250,
    'S14 remaining uses only active replacement',
  );
  results.push('S14');

  const voidSourceDraft = createConfirmationDraft({
    id: 'confirmation-to-void',
    order,
    selectedOrderLineIds: ['line-ticket'],
    acceptanceTextVersion: 'v1',
  });
  const voidSourceSent = markConfirmationSent(
    voidSourceDraft,
    '2026-10-02T12:35:00Z',
  );
  const voidSource = receiveConfirmationResponse({
    confirmation: voidSourceSent,
    requestedQuantities: { 'line-ticket': 1000 },
    actorName: 'Area Contact',
    respondedAt: '2026-10-02T12:40:00Z',
  });
  const voided = voidConfirmedConfirmation({
    confirmation: voidSource,
    actorName: 'DNS Admin',
    voidedAt: '2026-10-02T12:45:00Z',
    reason: 'Order cancelled before invoicing',
  });
  equal(voided.status, 'VOIDED', 'S15 confirmation voided');
  equal(
    getRemainingConfirmableQuantity({
      orderLineQuantity: 1000,
      priorConfirmations: [voided],
      orderLineId: 'line-ticket',
    }),
    1000,
    'S15 void restores confirmable quantity',
  );
  equal(
    voided.lines[0].confirmedQuantity,
    1000,
    'S15 voided record keeps historical confirmed quantity',
  );
  results.push('S15');

  expectError(
    () =>
      createCorrectionRevision({
        id: 'invalid-revision',
        original: replacement.original,
        reason: 'Invalid second correction from superseded record',
      }),
    'ONLY_CONFIRMED_CAN_BE_REVISED',
  );
  expectError(
    () =>
      voidConfirmedConfirmation({
        confirmation: voided,
        actorName: 'DNS Admin',
        voidedAt: '2026-10-02T12:50:00Z',
        reason: 'Second void',
      }),
    'ONLY_CONFIRMED_CAN_BE_VOIDED',
  );
  results.push('S16');

  const frozenReady = markBillingSheetReady(
    createBillingSheet({
      id: 'billing-ready-r1',
      seasonId: '2026-27',
      organizationId: 'drei-zinnen',
      revision: 1,
      lines: orderBillingLines,
      createdAt: '2026-10-02T13:00:00Z',
    }),
    '2026-10-02T13:05:00Z',
  );
  equal(assertBillingSheetImmutable(frozenReady), true, 'S17 READY is frozen');

  const correctedOrderLines = buildConfirmedOrderBillingLines({
    confirmation: replacement.replacement,
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

  const readyRevision = createBillingSheetRevision({
    id: 'billing-ready-r2',
    original: frozenReady,
    lines: correctedOrderLines,
    reason: 'Confirmation corrected from 300 to 250 before invoicing',
    createdAt: '2026-10-02T13:10:00Z',
  });
  assertBillingSheetRevisionLineage({
    original: frozenReady,
    revision: readyRevision,
  });
  equal(readyRevision.status, 'DRAFT', 'S17 revision starts DRAFT');
  equal(readyRevision.revision, 2, 'S17 revision number');
  equal(
    readyRevision.supersedesBillingSheetId,
    frozenReady.id,
    'S17 revision lineage',
  );
  equal(
    frozenReady.lines[0].quantity,
    450,
    'S17 original READY snapshot remains unchanged',
  );
  equal(
    readyRevision.lines[0].quantity,
    250,
    'S17 new revision uses corrected quantity',
  );
  results.push('S17');

  const invoicedOriginal = markBillingSheetInvoiced(
    markBillingSheetReady(
      createBillingSheet({
        id: 'billing-invoiced-r1',
        seasonId: '2026-27',
        organizationId: 'drei-zinnen',
        revision: 1,
        lines: [graphic],
        createdAt: '2026-10-02T13:15:00Z',
      }),
      '2026-10-02T13:20:00Z',
    ),
    '2026-10-02T13:25:00Z',
  );
  equal(assertBillingSheetImmutable(invoicedOriginal), true, 'S18 INVOICED is frozen');

  const correctedGraphic = createManualServiceLine({
    id: 'manual-grafik-r2',
    sourceId: 'manual:drei-zinnen:grafik',
    description: 'Grafik Pocketfolder Drei Zinnen',
    quantity: 7,
    unit: 'hour',
    unitPrice: 65,
  });
  const invoicedRevision = createBillingSheetRevision({
    id: 'billing-invoiced-r2',
    original: invoicedOriginal,
    lines: [correctedGraphic],
    reason: 'Additional half hour identified after invoicing',
    createdAt: '2026-10-02T13:30:00Z',
  });
  equal(invoicedOriginal.status, 'INVOICED', 'S18 old invoice basis remains INVOICED');
  equal(invoicedOriginal.lines[0].amount, 422.5, 'S18 old invoiced amount unchanged');
  equal(invoicedRevision.status, 'DRAFT', 'S18 correction starts new DRAFT');
  equal(invoicedRevision.lines[0].amount, 455, 'S18 correction carries new amount');
  results.push('S18');

  expectError(
    () =>
      createBillingSheetRevision({
        id: 'invalid-billing-revision',
        original: createBillingSheet({
          id: 'billing-draft-only',
          seasonId: '2026-27',
          organizationId: 'drei-zinnen',
          revision: 1,
          lines: [],
        }),
        lines: [],
        reason: 'Should edit draft directly',
      }),
    'DRAFT_SHOULD_BE_EDITED_NOT_REVISED',
  );
  expectError(
    () => assertBillingSheetImmutable(readyRevision),
    'BILLING_SHEET_NOT_FROZEN',
  );
  results.push('S19');

  const freshnessSheet = createBillingSheet({
    id: 'billing-freshness',
    seasonId: '2026-27',
    organizationId: 'drei-zinnen',
    revision: 1,
    lines: orderBillingLines,
  });

  const freshResults = checkBillingSheetFreshness({
    sheet: freshnessSheet,
    sources: [
      {
        sourceType: 'ORDER_CONFIRMATION',
        sourceId: approved.id,
        currentRevision: approved.revision,
      },
    ],
  });
  equal(freshResults[0].state, 'FRESH', 'S20 current source is fresh');
  equal(
    assertBillingSheetSourcesFresh({
      sheet: freshnessSheet,
      sources: [
        {
          sourceType: 'ORDER_CONFIRMATION',
          sourceId: approved.id,
          currentRevision: approved.revision,
        },
      ],
    }),
    true,
    'S20 fresh sources accepted',
  );
  results.push('S20');

  const staleResults = checkBillingSheetFreshness({
    sheet: freshnessSheet,
    sources: [
      {
        sourceType: 'ORDER_CONFIRMATION',
        sourceId: approved.id,
        currentRevision: approved.revision + 1,
      },
    ],
  });
  equal(staleResults[0].state, 'STALE', 'S21 newer source revision detected');
  expectError(
    () =>
      assertBillingSheetSourcesFresh({
        sheet: freshnessSheet,
        sources: [
          {
            sourceType: 'ORDER_CONFIRMATION',
            sourceId: approved.id,
            currentRevision: approved.revision + 1,
          },
        ],
      }),
    'STALE_SOURCE',
  );
  results.push('S21');

  const missingResults = checkBillingSheetFreshness({
    sheet: freshnessSheet,
    sources: [],
  });
  equal(missingResults[0].state, 'MISSING_SOURCE', 'S22 missing source detected');
  expectError(
    () =>
      assertBillingSheetSourcesFresh({
        sheet: freshnessSheet,
        sources: [],
      }),
    'MISSING_SOURCE',
  );
  results.push('S22');

  return results;
}
