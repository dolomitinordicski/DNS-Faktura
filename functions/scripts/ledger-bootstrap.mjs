import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const seasonId = argValue('season', '2026-27');
const apply = process.argv.includes('--apply');
const projectId =
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCLOUD_PROJECT ||
  process.env.FIREBASE_PROJECT_ID ||
  'dns-core';

if (apply && process.env.ALLOW_FAKTURA_LEDGER_BOOTSTRAP !== 'YES') {
  throw new Error(
    'REFUSING_LEDGER_BOOTSTRAP: set ALLOW_FAKTURA_LEDGER_BOOTSTRAP=YES with --apply',
  );
}

initializeApp({
  credential: applicationDefault(),
  projectId,
});
const db = getFirestore();

const [confirmationSnapshot, orderLineSnapshot] = await Promise.all([
  db.collection('fakturaConfirmations').where('seasonId', '==', seasonId).get(),
  db.collection('ticketOrderLines').where('seasonId', '==', seasonId).get(),
]);

const confirmations = confirmationSnapshot.docs.map((item) => ({
  id: item.id,
  ...item.data(),
}));
const orderLines = new Map(
  orderLineSnapshot.docs.map((item) => [
    item.id,
    { id: item.id, ...item.data() },
  ]),
);

const allOrderIds = new Set(
  confirmations
    .map((confirmation) => confirmation.orderId)
    .filter((value) => typeof value === 'string'),
);

const expected = new Map();
const blockers = [];

for (const confirmation of confirmations) {
  if (confirmation.status !== 'CONFIRMED') continue;
  if (typeof confirmation.orderId !== 'string' || !Array.isArray(confirmation.lines)) {
    blockers.push({
      code: 'INVALID_CONFIRMED_CONFIRMATION',
      confirmationId: confirmation.id,
    });
    continue;
  }

  const ledger = expected.get(confirmation.orderId) || {};
  for (const line of confirmation.lines) {
    const quantity = line?.confirmedQuantity;
    if (
      typeof line?.orderLineId !== 'string' ||
      typeof quantity !== 'number' ||
      !Number.isFinite(quantity) ||
      quantity < 0
    ) {
      blockers.push({
        code: 'INVALID_CONFIRMED_QUANTITY',
        confirmationId: confirmation.id,
        orderId: confirmation.orderId,
        orderLineId: line?.orderLineId,
      });
      continue;
    }

    const orderLine = orderLines.get(line.orderLineId);
    if (!orderLine) {
      blockers.push({
        code: 'ORDER_LINE_NOT_FOUND',
        confirmationId: confirmation.id,
        orderId: confirmation.orderId,
        orderLineId: line.orderLineId,
      });
      continue;
    }

    if (orderLine.ticketOrderId !== confirmation.orderId) {
      blockers.push({
        code: 'ORDER_LINE_SCOPE_MISMATCH',
        confirmationId: confirmation.id,
        orderId: confirmation.orderId,
        orderLineId: line.orderLineId,
      });
      continue;
    }

    ledger[line.orderLineId] = (ledger[line.orderLineId] || 0) + quantity;
    expected.set(confirmation.orderId, ledger);
  }
}

for (const [orderId, ledger] of expected) {
  for (const [orderLineId, confirmedQuantity] of Object.entries(ledger)) {
    const orderLine = orderLines.get(orderLineId);
    if (
      orderLine &&
      typeof orderLine.quantity === 'number' &&
      confirmedQuantity > orderLine.quantity
    ) {
      blockers.push({
        code: 'CONFIRMED_EXCEEDS_ORDERED',
        orderId,
        orderLineId,
        confirmedQuantity,
        orderedQuantity: orderLine.quantity,
      });
    }
  }
}

if (blockers.length) {
  console.error(JSON.stringify({ seasonId, blockers }, null, 2));
  process.exitCode = 2;
} else {
  const plan = [];

  for (const orderId of [...allOrderIds].sort()) {
    const ref = db.collection('fakturaConfirmationLedgers').doc(orderId);
    const snapshot = await ref.get();
    const current = snapshot.exists
      ? snapshot.data()?.confirmedByLine || {}
      : undefined;
    const expectedConfirmedByLine = expected.get(orderId) || {};

    const normalize = (value) =>
      Object.fromEntries(
        Object.entries(value)
          .filter(([, quantity]) => quantity !== 0)
          .sort(([a], [b]) => a.localeCompare(b)),
      );

    const normalizedExpected = normalize(expectedConfirmedByLine);
    const normalizedCurrent = current ? normalize(current) : undefined;
    const action = !snapshot.exists
      ? 'CREATE'
      : JSON.stringify(normalizedExpected) === JSON.stringify(normalizedCurrent)
        ? 'UNCHANGED'
        : 'REPLACE';

    plan.push({
      orderId,
      action,
      expectedConfirmedByLine: normalizedExpected,
      currentConfirmedByLine: normalizedCurrent,
    });
  }

  console.log(JSON.stringify({ seasonId, mode: apply ? 'APPLY' : 'DRY_RUN', plan }, null, 2));

  if (apply) {
    for (const entry of plan) {
      if (entry.action === 'UNCHANGED') continue;

      await db
        .collection('fakturaConfirmationLedgers')
        .doc(entry.orderId)
        .set({
          orderId: entry.orderId,
          confirmedByLine: entry.expectedConfirmedByLine,
          seasonId,
          bootstrap: {
            method: 'faktura-v2-ledger-bootstrap',
            version: 1,
          },
          updatedAt: FieldValue.serverTimestamp(),
        });

      console.log(`✓ ${entry.action.toLowerCase()} ledger ${entry.orderId}`);
    }
  }
}
