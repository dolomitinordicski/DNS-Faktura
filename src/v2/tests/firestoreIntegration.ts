import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase/app';
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import { FirestoreConfirmationRepository } from '../persistence/firestoreConfirmationRepository';
import { FirestoreBillingSheetRepository } from '../persistence/firestoreBillingSheetRepository';
import { createManualServiceLine } from '../engine/billingEngine';

const projectId = 'demo-dns-core';
const app = initializeApp(
  {
    apiKey: 'demo-key',
    appId: 'demo-app',
    projectId,
  },
  `faktura-v2-integration-${Date.now()}`,
);

const db = getFirestore(app);
connectFirestoreEmulator(db, '127.0.0.1', 8089);

await setDoc(doc(db, 'idmPremiumPrograms', '2026-27-idm-premium'), {
  id: '2026-27-idm-premium',
  seasonId: '2026-27',
  amountPerReportingArea: 15000,
  reportingAreaIds: ['drei-zinnen'],
  sourceLabel: 'IDM Premiumpartner WS2026/27',
  active: true,
  revision: 1,
});

function messageOf(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

async function exactlyOneSucceeds<T>(
  first: Promise<T>,
  second: Promise<T>,
  expectedFailureCode: string,
) {
  const results = await Promise.allSettled([first, second]);
  const fulfilled = results.filter(
    (result) => result.status === 'fulfilled',
  );
  const rejected = results.filter(
    (result) => result.status === 'rejected',
  );

  assert.equal(fulfilled.length, 1, 'exactly one concurrent transaction succeeds');
  assert.equal(rejected.length, 1, 'exactly one concurrent transaction fails');
  assert.ok(
    messageOf(rejected[0].reason).includes(expectedFailureCode),
    `expected failure ${expectedFailureCode}, got ${messageOf(rejected[0].reason)}`,
  );

  return (
    fulfilled[0] as PromiseFulfilledResult<Awaited<T>>
  ).value;
}

async function testConcurrentConfirmationConsumption() {
  const suffix = 'concurrent-confirmations';
  const orderId = `order-${suffix}`;
  const orderLineId = `order-line-${suffix}`;

  await setDoc(doc(db, 'ticketOrderLines', orderLineId), {
    id: orderLineId,
    ticketOrderId: orderId,
    seasonId: '2026-27',
    organizationId: 'org',
    catalogItemId: 'item',
    quantity: 500,
  });

  for (const id of ['confirmation-a', 'confirmation-b']) {
    await setDoc(doc(db, 'fakturaConfirmations', `${id}-${suffix}`), {
      id: `${id}-${suffix}`,
      seasonId: '2026-27',
      organizationId: 'org',
      orderId,
      revision: 1,
      status: 'CHANGE_REQUESTED',
      acceptanceTextVersion: 'v1',
      lines: [
        {
          orderLineId,
          catalogItemId: 'item',
          proposedQuantity: 500,
          requestedQuantity: 400,
          unit: 'piece',
        },
      ],
      createdAt: '2026-10-03T00:00:00Z',
      createdBy: 'dns-admin',
      updatedAt: '2026-10-03T00:01:00Z',
      updatedBy: 'area',
    });
  }

  const repository = new FirestoreConfirmationRepository(db);

  await exactlyOneSucceeds(
    repository.confirmTransaction({
      confirmationId: `confirmation-a-${suffix}`,
      actorId: 'dns-admin',
      occurredAt: '2026-10-03T00:05:00Z',
    }),
    repository.confirmTransaction({
      confirmationId: `confirmation-b-${suffix}`,
      actorId: 'dns-admin',
      occurredAt: '2026-10-03T00:05:01Z',
    }),
    'CONFIRMATION_EXCEEDS_REMAINING',
  );

  const ledger = (
    await getDoc(doc(db, 'fakturaConfirmationLedgers', orderId))
  ).data();

  assert.equal(
    ledger?.confirmedByLine?.[orderLineId],
    400,
    'concurrent confirmation ledger consumes quantity once',
  );

  const active = await repository.listActiveByOrder(orderId);
  assert.equal(
    active.filter((item) => item.status === 'CONFIRMED').length,
    1,
    'only one concurrent confirmation becomes CONFIRMED',
  );
}

async function testAtomicReplacementAndConcurrentRetry() {
  const suffix = 'atomic-replacement';
  const orderId = `order-${suffix}`;
  const orderLineId = `order-line-${suffix}`;
  const originalId = `confirmation-original-${suffix}`;
  const replacementId = `confirmation-replacement-${suffix}`;

  await setDoc(doc(db, 'ticketOrderLines', orderLineId), {
    id: orderLineId,
    ticketOrderId: orderId,
    seasonId: '2026-27',
    organizationId: 'org',
    catalogItemId: 'item',
    quantity: 500,
  });

  await setDoc(doc(db, 'fakturaConfirmations', originalId), {
    id: originalId,
    seasonId: '2026-27',
    organizationId: 'org',
    orderId,
    revision: 1,
    status: 'CONFIRMED',
    acceptanceTextVersion: 'v1',
    lines: [
      {
        orderLineId,
        catalogItemId: 'item',
        proposedQuantity: 300,
        confirmedQuantity: 300,
        unit: 'piece',
      },
    ],
    createdAt: '2026-10-03T00:10:00Z',
    createdBy: 'dns-admin',
    updatedAt: '2026-10-03T00:11:00Z',
    updatedBy: 'dns-admin',
  });

  await setDoc(doc(db, 'fakturaConfirmations', replacementId), {
    id: replacementId,
    seasonId: '2026-27',
    organizationId: 'org',
    orderId,
    revision: 2,
    status: 'CHANGE_REQUESTED',
    acceptanceTextVersion: 'v1',
    supersedesConfirmationId: originalId,
    lines: [
      {
        orderLineId,
        catalogItemId: 'item',
        proposedQuantity: 300,
        requestedQuantity: 250,
        unit: 'piece',
      },
    ],
    createdAt: '2026-10-03T00:12:00Z',
    createdBy: 'dns-admin',
    updatedAt: '2026-10-03T00:13:00Z',
    updatedBy: 'area',
  });

  await setDoc(doc(db, 'fakturaConfirmationLedgers', orderId), {
    orderId,
    confirmedByLine: { [orderLineId]: 300 },
    updatedAt: '2026-10-03T00:11:00Z',
  });

  const repository = new FirestoreConfirmationRepository(db);

  await exactlyOneSucceeds(
    repository.confirmTransaction({
      confirmationId: replacementId,
      actorId: 'dns-admin',
      occurredAt: '2026-10-03T00:15:00Z',
    }),
    repository.confirmTransaction({
      confirmationId: replacementId,
      actorId: 'dns-admin',
      occurredAt: '2026-10-03T00:15:01Z',
    }),
    'INVALID_CONFIRMATION_STATE',
  );

  const [original, replacement, ledger] = await Promise.all([
    getDoc(doc(db, 'fakturaConfirmations', originalId)),
    getDoc(doc(db, 'fakturaConfirmations', replacementId)),
    getDoc(doc(db, 'fakturaConfirmationLedgers', orderId)),
  ]);

  assert.equal(original.data()?.status, 'SUPERSEDED');
  assert.equal(
    original.data()?.supersededByConfirmationId,
    replacementId,
    'original links to replacement atomically',
  );
  assert.equal(replacement.data()?.status, 'CONFIRMED');
  assert.equal(
    ledger.data()?.confirmedByLine?.[orderLineId],
    250,
    'replacement ledger swaps original quantity exactly once',
  );

  const confirmedEvent = await getDoc(
    doc(db, 'fakturaEvents', `confirmation-confirmed:${replacementId}:r2`),
  );
  const supersededEvent = await getDoc(
    doc(
      db,
      'fakturaEvents',
      `confirmation-superseded:${originalId}:by:${replacementId}`,
    ),
  );
  assert.equal(confirmedEvent.exists(), true);
  assert.equal(supersededEvent.exists(), true);
}

async function testConcurrentManualDraftMutation() {
  const billingSheetId = 'billing-concurrent-manual';
  const updatedAt = '2026-10-03T00:20:00Z';

  await setDoc(doc(db, 'fakturaBillingSheets', billingSheetId), {
    id: billingSheetId,
    seasonId: '2026-27',
    organizationId: 'org',
    revision: 1,
    status: 'DRAFT',
    lines: [],
    totalAmount: 0,
    createdAt: updatedAt,
    createdBy: 'dns-admin',
    updatedAt,
    updatedBy: 'dns-admin',
  });

  const repository = new FirestoreBillingSheetRepository(db);
  const lineA = createManualServiceLine({
    id: 'manual-a',
    sourceId: `manual:${billingSheetId}:manual-a`,
    description: 'Service A',
    quantity: 1,
    unit: 'hour',
    unitPrice: 50,
  });
  const lineB = createManualServiceLine({
    id: 'manual-b',
    sourceId: `manual:${billingSheetId}:manual-b`,
    description: 'Service B',
    quantity: 1,
    unit: 'hour',
    unitPrice: 60,
  });

  await exactlyOneSucceeds(
    repository.mutateManualServiceTransaction({
      billingSheetId,
      operation: 'ADD',
      lineId: lineA.id,
      line: lineA,
      actorId: 'dns-admin-a',
      occurredAt: '2026-10-03T00:21:00Z',
      expectedUpdatedAt: updatedAt,
    }),
    repository.mutateManualServiceTransaction({
      billingSheetId,
      operation: 'ADD',
      lineId: lineB.id,
      line: lineB,
      actorId: 'dns-admin-b',
      occurredAt: '2026-10-03T00:21:01Z',
      expectedUpdatedAt: updatedAt,
    }),
    'BILLING_DRAFT_CHANGED',
  );

  const snapshot = await getDoc(doc(db, 'fakturaBillingSheets', billingSheetId));
  assert.equal(snapshot.data()?.lines?.length, 1);
  assert.ok(
    snapshot.data()?.totalAmount === 50 || snapshot.data()?.totalAmount === 60,
    'only one concurrent manual mutation affects total',
  );

  const events = await getDocs(
    query(
      collection(db, 'fakturaEvents'),
      where('entityId', '==', billingSheetId),
    ),
  );
  assert.equal(events.size, 1, 'one manual audit event persisted');
}

async function testReadyTransactionSourceGuardsAndDuplicateTransition() {
  const billingSheetId = 'billing-ready-integration';
  const confirmationId = 'confirmation-ready-integration';
  const orderLineId = 'line-ready-integration';
  const rateId = 'rate-ready-integration';
  const updatedAt = '2026-10-03T00:30:00Z';

  await setDoc(doc(db, 'fakturaConfirmations', confirmationId), {
    id: confirmationId,
    seasonId: '2026-27',
    organizationId: 'org',
    orderId: 'order-ready-integration',
    revision: 1,
    status: 'CONFIRMED',
    acceptanceTextVersion: 'v1',
    lines: [
      {
        orderLineId,
        catalogItemId: 'item-ready',
        proposedQuantity: 100,
        confirmedQuantity: 100,
        unit: 'piece',
      },
    ],
    createdAt: updatedAt,
    createdBy: 'dns-admin',
    updatedAt,
    updatedBy: 'dns-admin',
  });

  await setDoc(doc(db, 'billingRateConfigs', rateId), {
    id: rateId,
    seasonId: '2026-27',
    sourceType: 'order',
    catalogItemId: 'item-ready',
    billingUnitPrice: 0.2,
    active: true,
    revision: 1,
    prepaymentRequired: true,
    source: { documentLabel: 'Integration rate' },
  });

  const billing = {
    id: billingSheetId,
    seasonId: '2026-27',
    organizationId: 'org',
    revision: 1,
    status: 'DRAFT',
    lines: [
      {
        id: `${confirmationId}:${orderLineId}`,
        sourceType: 'ORDER_CONFIRMATION',
        sourceId: confirmationId,
        sourceRevision: 1,
        orderId: 'order-ready-integration',
        catalogItemId: 'item-ready',
        rateId,
        rateRevision: 1,
        description: 'Item ready',
        quantity: 100,
        unit: 'piece',
        unitPrice: 0.2,
        amount: 20,
        prepaymentRequired: true,
      },
    ],
    totalAmount: 20,
    createdAt: updatedAt,
    createdBy: 'dns-admin',
    updatedAt,
    updatedBy: 'dns-admin',
  };

  await setDoc(doc(db, 'fakturaBillingSheets', billingSheetId), billing);

  // Prove the local source guard rejects a rate that changed after DRAFT creation.
  await setDoc(doc(db, 'billingRateConfigs', rateId), {
    id: rateId,
    seasonId: '2026-27',
    sourceType: 'order',
    catalogItemId: 'item-ready',
    billingUnitPrice: 0.25,
    active: true,
    revision: 2,
    prepaymentRequired: true,
    source: { documentLabel: 'Integration rate updated' },
  });

  const repository = new FirestoreBillingSheetRepository(db);
  await assert.rejects(
    repository.markReadyTransaction({
      billingSheetId,
      actorId: 'dns-admin',
      occurredAt: '2026-10-03T00:31:00Z',
      expectedUpdatedAt: updatedAt,
    }),
    /READY_RATE_CHANGED/,
  );

  // Restore exact frozen source and race two READY transitions.
  await setDoc(doc(db, 'billingRateConfigs', rateId), {
    id: rateId,
    seasonId: '2026-27',
    sourceType: 'order',
    catalogItemId: 'item-ready',
    billingUnitPrice: 0.2,
    active: true,
    revision: 1,
    prepaymentRequired: true,
    source: { documentLabel: 'Integration rate' },
  });

  await exactlyOneSucceeds(
    repository.markReadyTransaction({
      billingSheetId,
      actorId: 'dns-admin-a',
      occurredAt: '2026-10-03T00:32:00Z',
      expectedUpdatedAt: updatedAt,
    }),
    repository.markReadyTransaction({
      billingSheetId,
      actorId: 'dns-admin-b',
      occurredAt: '2026-10-03T00:32:01Z',
      expectedUpdatedAt: updatedAt,
    }),
    'INVALID_BILLING_STATE',
  );

  const ready = await getDoc(doc(db, 'fakturaBillingSheets', billingSheetId));
  assert.equal(ready.data()?.status, 'READY');

  const readyEvents = await getDocs(
    query(
      collection(db, 'fakturaEvents'),
      where('entityId', '==', billingSheetId),
      where('type', '==', 'BILLING_READY'),
    ),
  );
  assert.equal(readyEvents.size, 1, 'READY audit event written exactly once');
}

async function testPublicTokenOneShotConcurrency() {
  const rawToken = 'integration-public-token-0123456789abcdef-xyz';
  const tokenHash = createHash('sha256')
    .update(rawToken, 'utf8')
    .digest('hex');
  const confirmationId = 'confirmation-public-concurrent';
  const orderId = 'order-public-concurrent';
  const orderLineId = 'line-public-concurrent';
  const tokenId = 'token-public-concurrent';

  await setDoc(doc(db, 'ticketOrderLines', orderLineId), {
    id: orderLineId,
    ticketOrderId: orderId,
    seasonId: '2026-27',
    organizationId: 'org',
    catalogItemId: 'item-public',
    quantity: 500,
  });

  await setDoc(doc(db, 'fakturaConfirmations', confirmationId), {
    id: confirmationId,
    seasonId: '2026-27',
    organizationId: 'org',
    orderId,
    revision: 1,
    status: 'SENT',
    acceptanceTextVersion: 'v1',
    lines: [
      {
        orderLineId,
        catalogItemId: 'item-public',
        proposedQuantity: 500,
        unit: 'piece',
      },
    ],
    createdAt: '2026-10-03T00:40:00Z',
    createdBy: 'dns-admin',
    updatedAt: '2026-10-03T00:41:00Z',
    updatedBy: 'dns-admin',
  });

  await setDoc(doc(db, 'fakturaConfirmationTokens', tokenId), {
    id: tokenId,
    confirmationId,
    tokenHash,
    active: true,
    createdAt: '2026-10-03T00:41:00Z',
    expiresAt: '2099-01-01T00:00:00Z',
  });

  const url =
    'http://127.0.0.1:5002/demo-dns-core/europe-west1/submitPublicConfirmation';

  const submit = () =>
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: rawToken,
        requestedQuantities: { [orderLineId]: 500 },
        actorLabel: 'Integration Area Contact',
      }),
    });

  const responses = await Promise.all([submit(), submit()]);
  const statuses = responses.map((response) => response.status).sort();
  assert.deepEqual(
    statuses,
    [200, 410],
    'one concurrent public submit succeeds and token reuse is rejected',
  );

  const [token, confirmation, ledger] = await Promise.all([
    getDoc(doc(db, 'fakturaConfirmationTokens', tokenId)),
    getDoc(doc(db, 'fakturaConfirmations', confirmationId)),
    getDoc(doc(db, 'fakturaConfirmationLedgers', orderId)),
  ]);

  assert.equal(token.data()?.active, false);
  assert.equal(typeof token.data()?.usedAt, 'string');
  assert.equal(confirmation.data()?.status, 'CONFIRMED');
  assert.equal(
    ledger.data()?.confirmedByLine?.[orderLineId],
    500,
    'public concurrency consumes ledger exactly once',
  );

  const responseEvents = await getDocs(
    query(
      collection(db, 'fakturaEvents'),
      where('entityId', '==', confirmationId),
      where('type', '==', 'CONFIRMATION_CONFIRMED'),
    ),
  );
  assert.equal(responseEvents.size, 1, 'public response audit event exists once');
}

try {
  await testConcurrentConfirmationConsumption();
  await testAtomicReplacementAndConcurrentRetry();
  await testConcurrentManualDraftMutation();
  await testReadyTransactionSourceGuardsAndDuplicateTransition();
  await testPublicTokenOneShotConcurrency();
  console.log(
    'F6.5 emulator integration passed: confirmation quantity concurrency, atomic replacement, manual DRAFT concurrency, READY source guards, duplicate transitions, and public token one-shot behavior.',
  );
} finally {
  await deleteApp(app);
}
