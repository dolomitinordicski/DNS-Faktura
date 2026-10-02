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
  markBillingSheetReadyWhenValid,
  evaluateBillingReadiness,
} from '../engine/billingEngine';
import {
  canReleaseForDelivery,
  createDeliveryFromBilling,
  deriveDeliveryStatus,
  evaluateDeliveryReadiness,
  recordDeliveryQuantity,
  updateDeliveredQuantity,
} from '../engine/deliveryEngine';
import {
  assertAppendOnlyEventSequence,
  createDomainEvent,
} from '../domain/events';
import {
  assertDeliveryMatchesBilling,
  assertFrozenBillingSheet,
  assertFrozenConfirmation,
  assertPaymentMatchesBilling,
} from '../contracts/persistenceInvariants';
import {
  FAKTURA_V1_MIGRATION_MATRIX,
  migrationItemsByAction,
} from '../migration/v1MigrationMatrix';
import {
  CatalogPriceAdapter,
  FairAdapter,
  IdmAdapter,
  OrdersAdapter,
} from '../adapters/sourceAdapters';
import { assembleBillingDraft } from '../application/billingOrchestrator';
import {
  evaluateAssembledBillingReadiness,
  evaluateLiveBillingReadiness,
  markAssembledBillingReady,
} from '../application/billingReadiness';
import {
  persistBillingDraft,
  persistBillingReady,
} from '../application/billingPersistenceService';
import {
  invoiceBillingAndOpenPayment,
  markPaymentPaid,
} from '../application/invoicingService';
import {
  createDeliveryCase,
  recordDeliveredQuantity,
} from '../application/deliveryService';
import {
  dispatchConfirmationWithPublicToken,
  hashConfirmationToken,
} from '../application/publicConfirmationService';
import {
  resolvePublicConfirmation,
  submitPublicConfirmation,
} from '../application/publicConfirmationApi';
import type {
  BillingSheetRecord,
  BillingSheetRepository,
  DeliveryRecord,
  DeliveryRepository,
  InvoicingRepository,
  PaymentRecord,
  PaymentRepository,
  ConfirmationDispatchRepository,
  ConfirmationRecord,
  PublicConfirmationTokenRecord,
} from '../contracts/persistence';

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

export async function runFakturaV2Scenarios() {
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

  const readinessDraft = createBillingSheet({
    id: 'billing-readiness-valid',
    seasonId: '2026-27',
    organizationId: 'drei-zinnen',
    revision: 1,
    lines: orderBillingLines,
  });
  const readinessSources = [
    {
      sourceType: 'ORDER_CONFIRMATION' as const,
      sourceId: approved.id,
      currentRevision: approved.revision,
    },
  ];
  const readinessConfirmations = [
    {
      id: approved.id,
      revision: approved.revision,
      status: approved.status,
    },
  ];
  const readinessResult = evaluateBillingReadiness({
    sheet: readinessDraft,
    sources: readinessSources,
    confirmations: readinessConfirmations,
    requiredSourceTypes: ['ORDER_CONFIRMATION'],
  });
  equal(readinessResult.ready, true, 'S23 complete sheet is ready');
  const readinessReady = markBillingSheetReadyWhenValid({
    sheet: readinessDraft,
    sources: readinessSources,
    confirmations: readinessConfirmations,
    requiredSourceTypes: ['ORDER_CONFIRMATION'],
    readyAt: '2026-10-02T14:00:00Z',
  });
  equal(readinessReady.status, 'READY', 'S23 guarded transition reaches READY');
  results.push('S23');

  const incompleteReadiness = evaluateBillingReadiness({
    sheet: readinessDraft,
    sources: [],
    confirmations: [],
    requiredSourceTypes: ['ORDER_CONFIRMATION', 'FAIR'],
  });
  equal(incompleteReadiness.ready, false, 'S24 incomplete sheet blocked');
  assert(
    incompleteReadiness.issues.some((issue) => issue.code === 'MISSING_REQUIRED_SOURCE_TYPE'),
    'S24 missing mandatory source detected',
  );
  assert(
    incompleteReadiness.issues.some((issue) => issue.code === 'MISSING_CONFIRMATION'),
    'S24 missing confirmation detected',
  );
  assert(
    incompleteReadiness.issues.some((issue) => issue.code === 'MISSING_SOURCE'),
    'S24 missing source detected',
  );
  expectError(
    () =>
      markBillingSheetReadyWhenValid({
        sheet: readinessDraft,
        sources: [],
        confirmations: [],
        requiredSourceTypes: ['ORDER_CONFIRMATION', 'FAIR'],
      }),
    'BILLING_NOT_READY',
  );
  results.push('S24');

  const staleConfirmationReadiness = evaluateBillingReadiness({
    sheet: readinessDraft,
    sources: [
      {
        sourceType: 'ORDER_CONFIRMATION',
        sourceId: approved.id,
        currentRevision: approved.revision + 1,
      },
    ],
    confirmations: [
      {
        id: approved.id,
        revision: approved.revision + 1,
        status: 'CONFIRMED',
      },
    ],
  });
  equal(staleConfirmationReadiness.ready, false, 'S25 stale revision blocked');
  assert(
    staleConfirmationReadiness.issues.some(
      (issue) => issue.code === 'CONFIRMATION_REVISION_MISMATCH',
    ),
    'S25 confirmation revision mismatch detected',
  );
  assert(
    staleConfirmationReadiness.issues.some((issue) => issue.code === 'STALE_SOURCE'),
    'S25 stale source detected',
  );
  results.push('S25');

  const invalidEconomicSheet: BillingSheet = {
    ...readinessDraft,
    id: 'billing-invalid-economic-data',
    lines: [
      {
        ...readinessDraft.lines[0],
        unitPrice: Number.NaN,
        amount: Number.NaN,
      },
    ],
  };
  const invalidEconomicReadiness = evaluateBillingReadiness({
    sheet: invalidEconomicSheet,
    sources: readinessSources,
    confirmations: readinessConfirmations,
  });
  equal(invalidEconomicReadiness.ready, false, 'S26 invalid economic data blocked');
  assert(
    invalidEconomicReadiness.issues.some((issue) => issue.code === 'INVALID_UNIT_PRICE'),
    'S26 invalid unit price detected',
  );
  assert(
    invalidEconomicReadiness.issues.some((issue) => issue.code === 'INVALID_AMOUNT'),
    'S26 invalid amount detected',
  );
  results.push('S26');

  const invoicedMaterialSheet = markBillingSheetInvoiced(
    markBillingSheetReady(readinessDraft, '2026-10-02T14:05:00Z'),
    '2026-10-02T14:10:00Z',
  );
  const materialOpenPayment: PaymentCase = {
    billingSheetId: invoicedMaterialSheet.id,
    required: true,
    status: 'OPEN',
  };
  const blockedDelivery = evaluateDeliveryReadiness({
    billingSheet: invoicedMaterialSheet,
    payment: materialOpenPayment,
  });
  equal(blockedDelivery.releasable, false, 'S27 prepayment blocks delivery');
  assert(
    blockedDelivery.issues.some((issue) => issue.code === 'PREPAYMENT_REQUIRED'),
    'S27 prepayment issue present',
  );

  const materialPaidPayment: PaymentCase = {
    ...materialOpenPayment,
    status: 'PAID',
    paidAt: '2026-10-02T14:15:00Z',
  };
  const releasedDelivery = createDeliveryFromBilling({
    id: 'delivery-from-billing',
    orderId: order.id,
    confirmationIds: [approved.id],
    billingSheet: invoicedMaterialSheet,
    payment: materialPaidPayment,
  });
  equal(releasedDelivery.status, 'PENDING', 'S27 released delivery starts pending');
  equal(releasedDelivery.billingSheetId, invoicedMaterialSheet.id, 'S27 billing linkage');
  equal(releasedDelivery.lines[0].confirmedQuantity, 450, 'S27 delivery uses invoiced quantity');
  results.push('S27');

  const partiallyRecorded = recordDeliveryQuantity({
    delivery: releasedDelivery,
    catalogItemId: '2026-27-wristband-14-yellow',
    deliveredQuantity: 400,
  });
  equal(partiallyRecorded.status, 'PARTIAL', 'S28 partial delivery status');
  equal(partiallyRecorded.lines[0].remainingQuantity, 50, 'S28 delivery residue');
  const fullyRecorded = recordDeliveryQuantity({
    delivery: partiallyRecorded,
    catalogItemId: '2026-27-wristband-14-yellow',
    deliveredQuantity: 450,
  });
  equal(fullyRecorded.status, 'DELIVERED', 'S28 full delivery status');
  results.push('S28');

  const noPrepayLine = {
    ...orderBillingLines[0],
    id: 'order-no-prepayment',
    prepaymentRequired: false,
  };
  const noPrepaySheet = markBillingSheetInvoiced(
    markBillingSheetReady(
      createBillingSheet({
        id: 'billing-no-prepayment',
        seasonId: '2026-27',
        organizationId: 'drei-zinnen',
        revision: 1,
        lines: [noPrepayLine],
      }),
    ),
  );
  const noPrepayOpen: PaymentCase = {
    billingSheetId: noPrepaySheet.id,
    required: false,
    status: 'OPEN',
  };
  equal(
    evaluateDeliveryReadiness({
      billingSheet: noPrepaySheet,
      payment: noPrepayOpen,
    }).releasable,
    true,
    'S29 non-prepayment material can be released after invoicing',
  );
  results.push('S29');

  const wrongPayment: PaymentCase = {
    billingSheetId: 'another-sheet',
    required: true,
    status: 'PAID',
  };
  const mismatch = evaluateDeliveryReadiness({
    billingSheet: invoicedMaterialSheet,
    payment: wrongPayment,
  });
  equal(mismatch.releasable, false, 'S30 payment must belong to exact sheet');
  assert(
    mismatch.issues.some((issue) => issue.code === 'PAYMENT_CASE_MISMATCH'),
    'S30 payment mismatch detected',
  );
  results.push('S30');

  const auditEvents = [
    createDomainEvent({
      id: 'event-1',
      type: 'CONFIRMATION_SENT',
      occurredAt: '2026-10-02T15:00:00Z',
      actorId: 'dns-admin',
      actorLabel: 'DNS Admin',
      seasonId: '2026-27',
      organizationId: 'drei-zinnen',
      entityType: 'CONFIRMATION',
      entityId: approved.id,
      entityRevision: approved.revision,
      payload: { fromStatus: 'DRAFT', toStatus: 'SENT' },
    }),
    createDomainEvent({
      id: 'event-2',
      type: 'CONFIRMATION_CONFIRMED',
      occurredAt: '2026-10-02T15:05:00Z',
      actorId: 'area-contact',
      actorLabel: 'Area Contact',
      seasonId: '2026-27',
      organizationId: 'drei-zinnen',
      entityType: 'CONFIRMATION',
      entityId: approved.id,
      entityRevision: approved.revision,
      payload: { fromStatus: 'SENT', toStatus: 'CONFIRMED' },
    }),
    createDomainEvent({
      id: 'event-3',
      type: 'BILLING_INVOICED',
      occurredAt: '2026-10-02T15:10:00Z',
      actorId: 'dns-admin',
      seasonId: '2026-27',
      organizationId: 'drei-zinnen',
      entityType: 'BILLING_SHEET',
      entityId: invoicedMaterialSheet.id,
      entityRevision: invoicedMaterialSheet.revision,
      payload: {
        fromStatus: 'READY',
        toStatus: 'INVOICED',
        totalAmount: invoicedMaterialSheet.totalAmount,
      },
    }),
  ];
  equal(assertAppendOnlyEventSequence(auditEvents), true, 'S31 audit sequence valid');
  results.push('S31');

  expectError(
    () =>
      assertAppendOnlyEventSequence([
        auditEvents[0],
        { ...auditEvents[1], id: auditEvents[0].id },
      ]),
    'DUPLICATE_EVENT_ID',
  );
  expectError(
    () =>
      assertAppendOnlyEventSequence([
        auditEvents[1],
        auditEvents[0],
      ]),
    'EVENT_SEQUENCE_NOT_CHRONOLOGICAL',
  );
  results.push('S32');

  equal(assertFrozenConfirmation(approved), true, 'S33 confirmed confirmation frozen');
  equal(assertFrozenBillingSheet(invoicedMaterialSheet), true, 'S33 invoiced sheet frozen');
  equal(
    assertPaymentMatchesBilling({
      payment: materialPaidPayment,
      billingSheet: invoicedMaterialSheet,
    }),
    true,
    'S33 payment linkage valid',
  );
  equal(
    assertDeliveryMatchesBilling({
      delivery: releasedDelivery,
      billingSheet: invoicedMaterialSheet,
    }),
    true,
    'S33 delivery linkage valid',
  );
  results.push('S33');

  expectError(
    () =>
      assertPaymentMatchesBilling({
        payment: { ...materialPaidPayment, billingSheetId: 'wrong-sheet' },
        billingSheet: invoicedMaterialSheet,
      }),
    'PAYMENT_CASE_MISMATCH',
  );
  expectError(
    () =>
      assertDeliveryMatchesBilling({
        delivery: { ...releasedDelivery, billingSheetId: 'wrong-sheet' },
        billingSheet: invoicedMaterialSheet,
      }),
    'DELIVERY_BILLING_MISMATCH',
  );
  results.push('S34');

  const deletions = migrationItemsByAction('DELETE_AFTER_CUTOVER');
  assert(
    deletions.some((item) => item.path === 'src/services/orderBilling.ts'),
    'S35 orderBilling must be deleted after cutover',
  );
  assert(
    deletions.some((item) => item.path === 'src/services/unifiedBilling.ts'),
    'S35 unifiedBilling must be deleted after cutover',
  );
  assert(
    FAKTURA_V1_MIGRATION_MATRIX.some(
      (item) =>
        item.path === 'src/services/orders.ts' &&
        item.action === 'REWRITE_ADAPTER',
    ),
    'S35 orders service must become adapter, not survive unchanged',
  );
  results.push('S35');

  const ordersAdapter = new OrdersAdapter({
    async loadHeaders() {
      return [
        {
          id: 'submitted-order',
          seasonId: '2026-27',
          organizationId: 'drei-zinnen',
          status: 'submitted',
        },
        {
          id: 'confirmed-source-order',
          seasonId: '2026-27',
          organizationId: 'drei-zinnen',
          status: 'confirmed',
        },
        {
          id: 'draft-order',
          seasonId: '2026-27',
          organizationId: 'drei-zinnen',
          status: 'draft',
        },
      ];
    },
    async loadLines() {
      return [
        {
          id: 'submitted-line',
          ticketOrderId: 'submitted-order',
          seasonId: '2026-27',
          organizationId: 'drei-zinnen',
          catalogItemId: '2026-27-wristband-14-yellow',
          quantity: 500,
        },
        {
          id: 'confirmed-source-line',
          ticketOrderId: 'confirmed-source-order',
          seasonId: '2026-27',
          organizationId: 'drei-zinnen',
          catalogItemId: '2026-27-wk-area',
          quantity: 250,
        },
        {
          id: 'draft-line',
          ticketOrderId: 'draft-order',
          seasonId: '2026-27',
          organizationId: 'drei-zinnen',
          catalogItemId: '2026-27-wk-area',
          quantity: 1000,
        },
      ];
    },
    async loadCatalog() {
      return [
        {
          id: '2026-27-wristband-14-yellow',
          category: 'wristband',
          code: 'WB-YELLOW',
          label: { de: 'Armband gelb', it: 'Braccialetto giallo' },
        },
        {
          id: '2026-27-wk-area',
          category: 'ticket',
          code: 'WK-AREA',
          label: { de: 'Wochenkarte Gebiet' },
        },
      ];
    },
  });
  const adaptedOrders = await ordersAdapter.loadSubmittedOrders('2026-27');
  equal(
    adaptedOrders.length,
    2,
    'S36 adapter preserves submitted source orders after operational status advances',
  );
  equal(adaptedOrders[0].lines[0].orderedQuantity, 500, 'S36 quantity mapped');
  results.push('S36');

  const fairAdapter = new FairAdapter({
    async loadPublishedRows() {
      return [
        {
          organizationId: 'drei-zinnen',
          totalAmount: 12345.67,
          sourceLabel: 'DNS FAIR 2026/27',
          revision: 3,
        },
      ];
    },
  });
  const fairContribution = await fairAdapter.loadContribution({
    seasonId: '2026-27',
    organizationId: 'drei-zinnen',
  });
  equal(fairContribution?.amount, 12345.67, 'S37 FAIR amount mapped');
  equal(fairContribution?.sourceRevision, 3, 'S37 FAIR revision mapped');
  equal(fairContribution?.documentLabel, 'DNS FAIR 2026/27', 'S37 FAIR label mapped');
  results.push('S37');

  equal(adaptedOrders[0].lines[0].category, 'wristband', 'S38 catalog category mapped');
  equal(adaptedOrders[0].lines[0].label, 'Armband gelb', 'S38 German catalog label preferred');
  results.push('S38');

  const idmAdapter = new IdmAdapter({
    async loadProgram() {
      return {
        seasonId: '2026-27',
        amountPerReportingArea: 15000,
        reportingAreaIds: ['drei-zinnen'],
        sourceLabel: 'IDM Premiumpartner WS2026/27',
        revision: 1,
      };
    },
    async loadAllocations() {
      return [
        {
          id: 'allocation-drei-zinnen',
          seasonId: '2026-27',
          reportingAreaId: 'drei-zinnen',
          organizationId: 'drei-zinnen',
          share: 0.4,
          revision: 3,
        },
      ];
    },
  });
  const idmCharge = await idmAdapter.loadCharge({
    seasonId: '2026-27',
    organizationId: 'drei-zinnen',
  });
  equal(idmCharge?.amount, 6000, 'S39 IDM amount uses allocation share');
  equal(idmCharge?.sourceRevision, 3, 'S39 IDM lineage uses newest relevant revision');
  results.push('S39');

  const catalogPriceAdapter = new CatalogPriceAdapter({
    async loadRates() {
      return [
        {
          id: 'rate-r1',
          seasonId: '2026-27',
          catalogItemId: '2026-27-wristband-14-yellow',
          unitPrice: 0.15,
          revision: 1,
          active: true,
          prepaymentRequired: true,
          documentLabel: 'Old rate',
        },
        {
          id: 'rate-r2',
          seasonId: '2026-27',
          catalogItemId: '2026-27-wristband-14-yellow',
          unitPrice: 0.159,
          revision: 2,
          active: true,
          prepaymentRequired: true,
          documentLabel: 'Brady Italia / PDC · 1013437506',
        },
      ];
    },
  });
  const unitPrice = await catalogPriceAdapter.loadUnitPrice({
    seasonId: '2026-27',
    catalogItemId: '2026-27-wristband-14-yellow',
  });
  equal(unitPrice?.unitPrice, 0.159, 'S40 latest active rate selected');
  equal(unitPrice?.rateRevision, 2, 'S40 latest rate revision');
  equal(unitPrice?.prepaymentRequired, true, 'S40 prepayment propagated');
  results.push('S40');

  const orchestratedConfirmation = {
    ...unchanged,
    id: 'confirmation-orchestrated',
    orderId: order.id,
    lines: [
      {
        orderLineId: 'line-wristband',
        catalogItemId: '2026-27-wristband-14-yellow',
        proposedQuantity: 500,
        confirmedQuantity: 500,
        unit: 'piece' as const,
      },
    ],
  };

  const assembled = await assembleBillingDraft({
    id: 'billing-orchestrated',
    seasonId: '2026-27',
    organizationId: 'drei-zinnen',
    revision: 1,
    confirmations: [orchestratedConfirmation],
    sources: {
      orders: {
        async loadSubmittedOrders() {
          return [order];
        },
      },
      fair: {
        async loadContribution() {
          return {
            sourceId: 'fair:2026-27:drei-zinnen',
            sourceRevision: 4,
            amount: 100,
            documentLabel: 'DNS FAIR',
          };
        },
      },
      idm: {
        async loadCharge() {
          return {
            sourceId: 'idm:2026-27:drei-zinnen',
            sourceRevision: 2,
            amount: 50,
            documentLabel: 'IDM Premiumpartner',
          };
        },
      },
      catalogPrices: {
        async loadUnitPrice() {
          return {
            rateId: 'rate-wristband-r2',
            rateRevision: 2,
            unitPrice: 0.159,
            prepaymentRequired: true,
            documentLabel: 'Brady Italia / PDC · 1013437506',
          };
        },
      },
    },
    createdAt: '2026-10-02T16:30:00Z',
  });

  equal(assembled.issues.length, 0, 'S41 orchestrator has no blockers');
  equal(assembled.sheet.lines.length, 3, 'S41 FAIR + IDM + confirmed material');
  equal(assembled.sheet.totalAmount, 229.5, 'S41 aggregated total');
  const materialLine = assembled.sheet.lines.find(
    (line) => line.sourceType === 'ORDER_CONFIRMATION',
  );
  equal(materialLine?.quantity, 500, 'S41 confirmed quantity used');
  equal(materialLine?.rateId, 'rate-wristband-r2', 'S41 rate lineage id frozen');
  equal(materialLine?.rateRevision, 2, 'S41 rate revision frozen');
  equal(materialLine?.description, 'Wristband yellow', 'S41 Data Entry label used');
  results.push('S41');

  const blockedAssembly = await assembleBillingDraft({
    id: 'billing-orchestrated-missing-rate',
    seasonId: '2026-27',
    organizationId: 'drei-zinnen',
    revision: 1,
    confirmations: [orchestratedConfirmation],
    sources: {
      orders: {
        async loadSubmittedOrders() {
          return [order];
        },
      },
      fair: {
        async loadContribution() {
          return null;
        },
      },
      idm: {
        async loadCharge() {
          return null;
        },
      },
      catalogPrices: {
        async loadUnitPrice() {
          return null;
        },
      },
    },
  });
  equal(blockedAssembly.sheet.lines.length, 0, 'S42 missing rate is not fabricated');
  assert(
    blockedAssembly.issues.some((issue) => issue.code === 'MISSING_RATE'),
    'S42 missing rate blocker exposed',
  );
  results.push('S42');

  const readinessCatalog = {
    async loadUnitPrice() {
      return {
        rateId: 'rate-wristband-r2',
        rateRevision: 2,
        unitPrice: 0.159,
        prepaymentRequired: true,
        documentLabel: 'Brady Italia / PDC · 1013437506',
      };
    },
  };

  const liveReadinessSources = {
    fair: {
      async loadContribution() {
        return {
          sourceId: 'fair:2026-27:drei-zinnen',
          sourceRevision: 4,
          amount: 100,
          documentLabel: 'DNS FAIR',
        };
      },
    },
    idm: {
      async loadCharge() {
        return {
          sourceId: 'idm:2026-27:drei-zinnen',
          sourceRevision: 2,
          amount: 50,
          documentLabel: 'IDM Premiumpartner',
        };
      },
    },
    catalogPrices: readinessCatalog,
    confirmations: {
      async getById(id: string) {
        if (id !== orchestratedConfirmation.id) return null;
        return {
          ...orchestratedConfirmation,
          createdAt: '2026-10-02T16:00:00Z',
          createdBy: 'dns-admin',
          updatedAt: '2026-10-02T16:10:00Z',
          updatedBy: 'area-contact',
        };
      },
      async listActiveByOrder() {
        return [];
      },
      async createDraft() {},
      async confirmTransaction() {
        throw new Error('NOT_USED');
      },
      async finalizeReplacementTransaction() {
        throw new Error('NOT_USED');
      },
    },
  };
  const assembledReadiness = await evaluateAssembledBillingReadiness({
    assembly: assembled,
    catalogPrices: readinessCatalog,
    requiredSourceTypes: ['FAIR', 'IDM', 'ORDER_CONFIRMATION'],
  });
  equal(assembledReadiness.ready, true, 'S43 assembled billing is ready');
  const assembledReadySheet = await markAssembledBillingReady({
    assembly: assembled,
    catalogPrices: readinessCatalog,
    requiredSourceTypes: ['FAIR', 'IDM', 'ORDER_CONFIRMATION'],
    readyAt: '2026-10-02T16:45:00Z',
  });
  equal(assembledReadySheet.status, 'READY', 'S43 guarded application transition');
  results.push('S43');

  const staleRateReadiness = await evaluateAssembledBillingReadiness({
    assembly: assembled,
    catalogPrices: {
      async loadUnitPrice() {
        return {
          rateId: 'rate-wristband-r3',
          rateRevision: 3,
          unitPrice: 0.169,
          prepaymentRequired: true,
          documentLabel: 'Updated supplier source',
        };
      },
    },
    requiredSourceTypes: ['FAIR', 'IDM', 'ORDER_CONFIRMATION'],
  });
  equal(staleRateReadiness.ready, false, 'S44 stale commercial rate blocks READY');
  assert(
    staleRateReadiness.issues.some((issue) => issue.code === 'STALE_RATE'),
    'S44 stale rate issue exposed',
  );
  results.push('S44');

  const blockedReadiness = await evaluateAssembledBillingReadiness({
    assembly: blockedAssembly,
    catalogPrices: {
      async loadUnitPrice() {
        return null;
      },
    },
    requiredSourceTypes: ['ORDER_CONFIRMATION'],
  });
  equal(blockedReadiness.ready, false, 'S45 assembly blocker prevents READY');
  assert(
    blockedReadiness.issues.some((issue) => issue.code === 'MISSING_RATE'),
    'S45 missing-rate assembly blocker preserved',
  );
  results.push('S45');

  let persistedRecord: BillingSheetRecord | null = null;
  const memoryBillingRepository: BillingSheetRepository = {
    async getById(id) {
      return persistedRecord?.id === id ? persistedRecord : null;
    },
    async listByOrganization(input) {
      return persistedRecord &&
        persistedRecord.seasonId === input.seasonId &&
        persistedRecord.organizationId === input.organizationId
        ? [persistedRecord]
        : [];
    },
    async saveDraft(record) {
      if (record.status !== 'DRAFT') throw new Error('ONLY_DRAFT_CAN_BE_SAVED');
      if (persistedRecord && persistedRecord.status !== 'DRAFT') {
        throw new Error('BILLING_SHEET_FROZEN');
      }
      persistedRecord = { ...record };
    },
    async markReadyTransaction(input) {
      if (!persistedRecord) throw new Error('BILLING_SHEET_NOT_FOUND');
      if (persistedRecord.status !== 'DRAFT') {
        throw new Error('INVALID_BILLING_STATE');
      }
      if (persistedRecord.updatedAt !== input.expectedUpdatedAt) {
        throw new Error('BILLING_DRAFT_CHANGED');
      }
      persistedRecord = {
        ...persistedRecord,
        status: 'READY',
        readyAt: input.occurredAt,
        updatedAt: input.occurredAt,
        updatedBy: input.actorId,
      };
      return persistedRecord;
    },
  };

  const savedDraft = await persistBillingDraft({
    assembly: assembled,
    repository: memoryBillingRepository,
    actorId: 'dns-admin',
    occurredAt: '2026-10-02T17:00:00Z',
  });
  equal(savedDraft.status, 'DRAFT', 'S46 saved record remains DRAFT');
  equal(savedDraft.createdBy, 'dns-admin', 'S46 createdBy persisted');
  equal(savedDraft.updatedAt, '2026-10-02T17:00:00Z', 'S46 optimistic token');
  results.push('S46');

  const persistedReady = await persistBillingReady({
    assembly: assembled,
    repository: memoryBillingRepository,
    sources: liveReadinessSources,
    actorId: 'dns-admin',
    occurredAt: '2026-10-02T17:05:00Z',
    expectedUpdatedAt: savedDraft.updatedAt!,
    requiredSourceTypes: ['FAIR', 'IDM', 'ORDER_CONFIRMATION'],
  });
  equal(persistedReady.status, 'READY', 'S47 persisted transition reaches READY');
  equal(persistedReady.readyAt, '2026-10-02T17:05:00Z', 'S47 ready timestamp');
  results.push('S47');

  persistedRecord = {
    ...savedDraft,
    updatedAt: '2026-10-02T17:03:00Z',
    updatedBy: 'another-operator',
  };
  let changedDraftBlocked = false;
  try {
    await persistBillingReady({
      assembly: assembled,
      repository: memoryBillingRepository,
      sources: liveReadinessSources,
      actorId: 'dns-admin',
      occurredAt: '2026-10-02T17:06:00Z',
      expectedUpdatedAt: savedDraft.updatedAt!,
      requiredSourceTypes: ['FAIR', 'IDM', 'ORDER_CONFIRMATION'],
    });
  } catch (error) {
    changedDraftBlocked =
      error instanceof Error && error.message === 'BILLING_DRAFT_CHANGED';
  }
  equal(changedDraftBlocked, true, 'S48 changed draft blocked transactionally');
  results.push('S48');

  let invoicingBilling: BillingSheetRecord = {
    ...persistedReady,
    status: 'READY',
    updatedAt: '2026-10-02T17:05:00Z',
    updatedBy: 'dns-admin',
  };
  let invoicingPayment: PaymentRecord | null = null;

  const memoryInvoicingRepository: InvoicingRepository = {
    async invoiceAndOpenPaymentTransaction(input) {
      if (invoicingBilling.status !== 'READY') {
        throw new Error('INVALID_BILLING_STATE');
      }
      if (invoicingPayment) {
        throw new Error('PAYMENT_CASE_ALREADY_EXISTS');
      }

      invoicingBilling = {
        ...invoicingBilling,
        status: 'INVOICED',
        invoicedAt: input.occurredAt,
        updatedAt: input.occurredAt,
        updatedBy: input.actorId,
      };
      invoicingPayment = {
        billingSheetId: invoicingBilling.id,
        required: invoicingBilling.lines.some(
          (line) =>
            line.sourceType === 'ORDER_CONFIRMATION' &&
            line.quantity > 0 &&
            line.prepaymentRequired === true,
        ),
        status: 'OPEN',
        reference: input.reference,
        updatedAt: input.occurredAt,
        updatedBy: input.actorId,
      };

      return {
        billingSheet: invoicingBilling,
        payment: invoicingPayment,
      };
    },
  };

  const paymentRepository: PaymentRepository = {
    async getByBillingSheetId(id) {
      return invoicingPayment?.billingSheetId === id
        ? invoicingPayment
        : null;
    },
    async setStatusTransaction(input) {
      if (!invoicingPayment) throw new Error('PAYMENT_CASE_NOT_FOUND');
      if (invoicingBilling.status !== 'INVOICED') {
        throw new Error('BILLING_NOT_INVOICED');
      }
      if (input.status !== 'PAID') return invoicingPayment;
      if (invoicingPayment.status === 'PAID') {
        if (
          input.reference !== undefined &&
          invoicingPayment.reference !== input.reference
        ) {
          throw new Error('PAYMENT_ALREADY_PAID');
        }
        return invoicingPayment;
      }
      invoicingPayment = {
        ...invoicingPayment,
        status: 'PAID',
        paidAt: input.occurredAt,
        reference: input.reference ?? invoicingPayment.reference,
        updatedAt: input.occurredAt,
        updatedBy: input.actorId,
      };
      return invoicingPayment;
    },
  };

  const invoicedBundle = await invoiceBillingAndOpenPayment({
    billingSheetId: invoicingBilling.id,
    repository: memoryInvoicingRepository,
    actorId: 'dns-admin',
    occurredAt: '2026-10-02T17:10:00Z',
    reference: 'INV-2026-001',
  });
  equal(invoicedBundle.billingSheet.status, 'INVOICED', 'S49 READY becomes INVOICED');
  equal(invoicedBundle.payment.status, 'OPEN', 'S49 payment starts OPEN');
  equal(invoicedBundle.payment.required, true, 'S49 material prepayment required');
  results.push('S49');

  const paidCase = await markPaymentPaid({
    billingSheetId: invoicedBundle.billingSheet.id,
    repository: paymentRepository,
    actorId: 'dns-admin',
    occurredAt: '2026-10-02T17:15:00Z',
    reference: 'BANK-REF-001',
  });
  equal(paidCase.status, 'PAID', 'S50 payment reaches PAID');
  equal(paidCase.paidAt, '2026-10-02T17:15:00Z', 'S50 payment timestamp');
  equal(paidCase.reference, 'BANK-REF-001', 'S50 payment reference');
  results.push('S50');

  let conflictingPaymentBlocked = false;
  try {
    await markPaymentPaid({
      billingSheetId: invoicedBundle.billingSheet.id,
      repository: paymentRepository,
      actorId: 'dns-admin',
      occurredAt: '2026-10-02T17:16:00Z',
      reference: 'DIFFERENT-REF',
    });
  } catch (error) {
    conflictingPaymentBlocked =
      error instanceof Error && error.message === 'PAYMENT_ALREADY_PAID';
  }
  equal(conflictingPaymentBlocked, true, 'S51 conflicting paid reference blocked');
  results.push('S51');

  persistedRecord = invoicedBundle.billingSheet;
  let deliveryRecord: DeliveryRecord | null = null;

  const deliveryRepository: DeliveryRepository = {
    async getById(id) {
      return deliveryRecord?.id === id ? deliveryRecord : null;
    },
    async createTransaction(record) {
      if (deliveryRecord) throw new Error('DELIVERY_ALREADY_EXISTS');
      if (record.status !== 'PENDING') {
        throw new Error('DELIVERY_MUST_START_PENDING');
      }
      deliveryRecord = { ...record };
    },
    async recordQuantityTransaction(input) {
      if (!deliveryRecord) throw new Error('DELIVERY_NOT_FOUND');
      const updated = recordDeliveryQuantity({
        delivery: deliveryRecord,
        catalogItemId: input.catalogItemId,
        deliveredQuantity: input.deliveredQuantity,
      });
      deliveryRecord = {
        ...updated,
        createdAt: deliveryRecord.createdAt,
        createdBy: deliveryRecord.createdBy,
        updatedAt: input.occurredAt,
        updatedBy: input.actorId,
      };
      return deliveryRecord;
    },
  };

  const createdDelivery = await createDeliveryCase({
    id: 'delivery-order-drei-zinnen',
    orderId: order.id,
    confirmationIds: [orchestratedConfirmation.id],
    billingSheetId: invoicedBundle.billingSheet.id,
    billingRepository: memoryBillingRepository,
    paymentRepository,
    deliveryRepository,
    actorId: 'dns-logistics',
    occurredAt: '2026-10-02T17:20:00Z',
  });
  equal(createdDelivery.status, 'PENDING', 'S52 delivery starts PENDING');
  equal(createdDelivery.lines.length, 1, 'S52 only selected order material included');
  equal(
    createdDelivery.lines[0].confirmedQuantity,
    500,
    'S52 delivery quantity from invoiced confirmed quantity',
  );
  results.push('S52');

  const persistedPartialDelivery = await recordDeliveredQuantity({
    deliveryId: createdDelivery.id,
    catalogItemId: '2026-27-wristband-14-yellow',
    deliveredQuantity: 300,
    deliveryRepository,
    actorId: 'dns-logistics',
    occurredAt: '2026-10-02T17:25:00Z',
  });
  equal(persistedPartialDelivery.status, 'PARTIAL', 'S53 delivery becomes PARTIAL');
  equal(persistedPartialDelivery.lines[0].remainingQuantity, 200, 'S53 remaining quantity');
  results.push('S53');

  const persistedCompletedDelivery = await recordDeliveredQuantity({
    deliveryId: createdDelivery.id,
    catalogItemId: '2026-27-wristband-14-yellow',
    deliveredQuantity: 500,
    deliveryRepository,
    actorId: 'dns-logistics',
    occurredAt: '2026-10-02T17:30:00Z',
  });
  equal(persistedCompletedDelivery.status, 'DELIVERED', 'S54 delivery becomes DELIVERED');
  equal(persistedCompletedDelivery.lines[0].remainingQuantity, 0, 'S54 no remaining quantity');
  results.push('S54');

  let overdeliveryBlocked = false;
  try {
    await recordDeliveredQuantity({
      deliveryId: createdDelivery.id,
      catalogItemId: '2026-27-wristband-14-yellow',
      deliveredQuantity: 501,
      deliveryRepository,
      actorId: 'dns-logistics',
      occurredAt: '2026-10-02T17:31:00Z',
    });
  } catch (error) {
    overdeliveryBlocked =
      error instanceof Error && error.message === 'INVALID_DELIVERED_QUANTITY';
  }
  equal(overdeliveryBlocked, true, 'S55 overdelivery blocked');
  results.push('S55');

  const multiOrderBilling: BillingSheet = {
    ...invoicedBundle.billingSheet,
    id: 'billing-multi-order',
    lines: [
      ...invoicedBundle.billingSheet.lines,
      {
        id: 'confirmation-other:line-other',
        sourceType: 'ORDER_CONFIRMATION',
        sourceId: 'confirmation-other',
        sourceRevision: 1,
        catalogItemId: '2026-27-wk-area',
        orderId: 'other-order',
        description: 'Weekly ticket area',
        quantity: 1000,
        unit: 'piece',
        unitPrice: 0.09,
        amount: 90,
        rateId: 'rate-other',
        rateRevision: 1,
        prepaymentRequired: true,
      },
    ],
  };
  const scopedDelivery = createDeliveryFromBilling({
    id: 'delivery-scoped',
    orderId: order.id,
    confirmationIds: [orchestratedConfirmation.id],
    billingSheet: multiOrderBilling,
    payment: {
      billingSheetId: multiOrderBilling.id,
      required: true,
      status: 'PAID',
    },
  });
  equal(scopedDelivery.lines.length, 1, 'S56 delivery excludes other orders');
  equal(
    scopedDelivery.lines[0].catalogItemId,
    '2026-27-wristband-14-yellow',
    'S56 correct order-scoped material retained',
  );
  results.push('S56');

  const mixedResponseDraft = createConfirmationDraft({
    id: 'confirmation-mixed-response',
    order,
    selectedOrderLineIds: ['line-wristband', 'line-ticket'],
    acceptanceTextVersion: 'v1',
  });
  const mixedResponse = receiveConfirmationResponse({
    confirmation: markConfirmationSent(
      mixedResponseDraft,
      '2026-10-02T18:00:00Z',
    ),
    requestedQuantities: {
      'line-wristband': 450,
      'line-ticket': 1000,
    },
    actorName: 'Area Contact',
    respondedAt: '2026-10-02T18:05:00Z',
  });
  equal(mixedResponse.status, 'CHANGE_REQUESTED', 'S57 mixed response requests change');
  equal(
    mixedResponse.lines[0].requestedQuantity,
    450,
    'S57 changed line request preserved',
  );
  equal(
    mixedResponse.lines[1].requestedQuantity,
    1000,
    'S57 unchanged line request also preserved consistently',
  );
  assert(
    mixedResponse.lines.every((line) => line.confirmedQuantity === undefined),
    'S57 no line is confirmed while batch awaits approval',
  );
  results.push('S57');

  let publicConfirmation: ConfirmationRecord = {
    ...createConfirmationDraft({
      id: 'confirmation-public',
      order,
      selectedOrderLineIds: ['line-wristband'],
      acceptanceTextVersion: 'v1',
    }),
    createdAt: '2026-10-02T18:10:00Z',
    createdBy: 'dns-admin',
    updatedAt: '2026-10-02T18:10:00Z',
    updatedBy: 'dns-admin',
  };
  let publicToken: PublicConfirmationTokenRecord | null = null;

  const publicRepository: ConfirmationDispatchRepository = {
      async dispatchWithTokenTransaction(input) {
        if (publicConfirmation.status !== 'DRAFT') {
          throw new Error('INVALID_CONFIRMATION_STATE');
        }
        publicToken = { ...input.token };
        publicConfirmation = {
          ...markConfirmationSent(publicConfirmation, input.occurredAt),
          createdAt: publicConfirmation.createdAt,
          createdBy: publicConfirmation.createdBy,
          updatedAt: input.occurredAt,
          updatedBy: input.actorId,
        };
        return publicConfirmation;
      },
    };

  const dispatched = await dispatchConfirmationWithPublicToken({
    confirmationId: publicConfirmation.id,
    repository: publicRepository,
    actorId: 'dns-admin',
    occurredAt: '2026-10-02T18:15:00Z',
    tokenId: 'token-public-1',
    rawToken: 'test-token-raw-1234567890',
  });
  equal(dispatched.confirmation.status, 'SENT', 'S58 dispatch moves confirmation to SENT');
  assert(
    dispatched.token.tokenHash !== dispatched.rawToken,
    'S58 raw token is never stored as tokenHash',
  );
  equal(
    dispatched.token.tokenHash,
    await hashConfirmationToken(dispatched.rawToken),
    'S58 SHA-256 token hash deterministic',
  );
  results.push('S58');

  const fakeApiBase = 'https://example.test';
  const resolvedViaHttp = await resolvePublicConfirmation({
    apiBaseUrl: fakeApiBase,
    rawToken: dispatched.rawToken,
    fetchImpl: async (url, init) => {
      equal(
        url,
        'https://example.test/resolvePublicConfirmation',
        'S59 resolve uses server endpoint',
      );
      const body = JSON.parse(String(init?.body));
      equal(body.token, dispatched.rawToken, 'S59 raw token sent only to server boundary');
      return new Response(
        JSON.stringify({
          confirmationId: publicConfirmation.id,
          acceptanceTextVersion: publicConfirmation.acceptanceTextVersion,
          lines: publicConfirmation.lines.map((line) => ({
            orderLineId: line.orderLineId,
            catalogItemId: line.catalogItemId,
            proposedQuantity: line.proposedQuantity,
            unit: line.unit,
          })),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
  });
  equal(
    resolvedViaHttp.confirmationId,
    publicConfirmation.id,
    'S59 public resolve is HTTP-boundary based',
  );
  results.push('S59');

  const submittedViaHttp = await submitPublicConfirmation({
    apiBaseUrl: fakeApiBase,
    rawToken: dispatched.rawToken,
    requestedQuantities: { 'line-wristband': 500 },
    actorLabel: 'Area Contact',
    fetchImpl: async (url, init) => {
      equal(
        url,
        'https://example.test/submitPublicConfirmation',
        'S60 submit uses server endpoint',
      );
      const body = JSON.parse(String(init?.body));
      equal(body.token, dispatched.rawToken, 'S60 token sent to server boundary');
      equal(body.actorLabel, 'Area Contact', 'S60 actor label sent to server');
      return new Response(
        JSON.stringify({
          confirmationId: publicConfirmation.id,
          status: 'CONFIRMED',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
  });
  equal(submittedViaHttp.status, 'CONFIRMED', 'S60 HTTP submit result mapped');
  results.push('S60');

  let serverErrorMapped = false;
  try {
    await submitPublicConfirmation({
      apiBaseUrl: fakeApiBase,
      rawToken: dispatched.rawToken,
      requestedQuantities: { 'line-wristband': 500 },
      actorLabel: 'Area Contact',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ error: 'TOKEN_NOT_ACTIVE' }),
          { status: 410, headers: { 'content-type': 'application/json' } },
        ),
    });
  } catch (error) {
    serverErrorMapped =
      error instanceof Error && error.message === 'TOKEN_NOT_ACTIVE';
  }
  equal(serverErrorMapped, true, 'S61 server token errors propagate without Firestore access');
  results.push('S61');

  const liveReady = await evaluateLiveBillingReadiness({
    assembly: assembled,
    sources: liveReadinessSources,
    requiredSourceTypes: ['FAIR', 'IDM', 'ORDER_CONFIRMATION'],
  });
  equal(liveReady.ready, true, 'S62 live sources keep billing ready');
  results.push('S62');

  const liveFairStale = await evaluateLiveBillingReadiness({
    assembly: assembled,
    sources: {
      ...liveReadinessSources,
      fair: {
        async loadContribution() {
          return {
            sourceId: 'fair:2026-27:drei-zinnen',
            sourceRevision: 5,
            amount: 105,
            documentLabel: 'DNS FAIR updated',
          };
        },
      },
    },
    requiredSourceTypes: ['FAIR', 'IDM', 'ORDER_CONFIRMATION'],
  });
  equal(liveFairStale.ready, false, 'S63 newer FAIR revision blocks READY');
  assert(
    liveFairStale.issues.some(
      (issue) =>
        issue.code === 'STALE_SOURCE' &&
        issue.sourceType === 'FAIR',
    ),
    'S63 FAIR staleness exposed',
  );
  results.push('S63');

  const liveConfirmationChanged = await evaluateLiveBillingReadiness({
    assembly: assembled,
    sources: {
      ...liveReadinessSources,
      confirmations: {
        ...liveReadinessSources.confirmations,
        async getById(id: string) {
          if (id !== orchestratedConfirmation.id) return null;
          return {
            ...orchestratedConfirmation,
            revision: 2,
            createdAt: '2026-10-02T16:00:00Z',
            createdBy: 'dns-admin',
            updatedAt: '2026-10-02T16:20:00Z',
            updatedBy: 'dns-admin',
          };
        },
      },
    },
    requiredSourceTypes: ['FAIR', 'IDM', 'ORDER_CONFIRMATION'],
  });
  equal(
    liveConfirmationChanged.ready,
    false,
    'S64 changed Confirmation revision blocks READY',
  );
  assert(
    liveConfirmationChanged.issues.some(
      (issue) => issue.code === 'CONFIRMATION_REVISION_MISMATCH',
    ),
    'S64 Confirmation revision mismatch exposed',
  );
  results.push('S64');

  const liveIdmValueMismatch = await evaluateLiveBillingReadiness({
    assembly: assembled,
    sources: {
      ...liveReadinessSources,
      idm: {
        async loadCharge() {
          return {
            sourceId: 'idm:2026-27:drei-zinnen',
            sourceRevision: 2,
            amount: 55,
            documentLabel: 'IDM Premiumpartner',
          };
        },
      },
    },
    requiredSourceTypes: ['FAIR', 'IDM', 'ORDER_CONFIRMATION'],
  });
  equal(
    liveIdmValueMismatch.ready,
    false,
    'S65 same-revision IDM amount mutation blocks READY',
  );
  assert(
    liveIdmValueMismatch.issues.some(
      (issue) =>
        issue.code === 'SOURCE_VALUE_MISMATCH' &&
        issue.sourceType === 'IDM',
    ),
    'S65 source value mismatch exposed',
  );
  results.push('S65');

  const advancedSourceOrder = adaptedOrders.find(
    (candidate) => candidate.id === 'confirmed-source-order',
  );
  equal(
    advancedSourceOrder?.status,
    'SUBMITTED',
    'S66 advanced Data Entry status remains a submitted source order in v2',
  );
  equal(
    advancedSourceOrder?.lines[0].orderedQuantity,
    250,
    'S66 original ordered quantity preserved',
  );
  results.push('S66');

  const selfContainedManual = createBillingSheet({
    id: 'billing-manual-self-contained',
    seasonId: '2026-27',
    organizationId: 'drei-zinnen',
    revision: 1,
    lines: [
      createManualServiceLine({
        id: 'manual-self-contained',
        sourceId: 'manual:drei-zinnen:graphic-service',
        description: 'Grafikleistung',
        quantity: 2,
        unit: 'hour',
        unitPrice: 65,
      }),
    ],
  });
  const manualReadiness = evaluateBillingReadiness({
    sheet: selfContainedManual,
    sources: [],
    confirmations: [],
  });
  equal(
    manualReadiness.ready,
    true,
    'S67 self-contained MANUAL_SERVICE does not require an external source snapshot',
  );
  results.push('S67');

  return results;
}


