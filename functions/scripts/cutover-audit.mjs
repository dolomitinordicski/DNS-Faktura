import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const seasonId = argValue('season', '2026-27');
const failOnBlockers = process.argv.includes('--fail-on-blockers');
const requireActivationReady = process.argv.includes('--require-activation-ready');
const projectId =
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCLOUD_PROJECT ||
  process.env.FIREBASE_PROJECT_ID ||
  'dns-core';

const appOptions = { projectId };
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  appOptions.credential = applicationDefault();
}
initializeApp(appOptions);
const db = getFirestore();

async function seasonDocs(collectionName) {
  const snapshot = await db
    .collection(collectionName)
    .where('seasonId', '==', seasonId)
    .get();
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

function finiteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function normalizeLedger(values = {}) {
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, quantity]) => quantity !== 0)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function equalLedger(left, right) {
  return JSON.stringify(normalizeLedger(left)) ===
    JSON.stringify(normalizeLedger(right));
}

function unitFromSeasonalExtra(extra) {
  if (extra.billingUnit === 'other') return 'custom';
  if (
    extra.billingUnit === 'piece' ||
    extra.billingUnit === 'hour' ||
    extra.billingUnit === 'flat' ||
    extra.billingUnit === 'km'
  ) {
    return extra.billingUnit;
  }
  return 'piece';
}

const [
  confirmations,
  orderLines,
  rates,
  seasonalExtras,
  billingRuns,
  billingLines,
  billingSheets,
  deliveries,
  allocationKeys,
] = await Promise.all([
  seasonDocs('fakturaConfirmations'),
  seasonDocs('ticketOrderLines'),
  seasonDocs('billingRateConfigs'),
  seasonDocs('billingSeasonalExtras'),
  seasonDocs('billingRuns'),
  seasonDocs('billingLines'),
  seasonDocs('fakturaBillingSheets'),
  seasonDocs('fakturaDeliveries'),
  seasonDocs('areaAllocationKeys'),
]);

const structuralBlockers = [];
const activationRequired = [];
const warnings = [];

const orderLineById = new Map(orderLines.map((line) => [line.id, line]));
const activeConfirmed = confirmations.filter(
  (confirmation) => confirmation.status === 'CONFIRMED',
);

const expectedLedgerByOrder = new Map();

for (const confirmation of activeConfirmed) {
  if (
    typeof confirmation.orderId !== 'string' ||
    !Array.isArray(confirmation.lines)
  ) {
    structuralBlockers.push({
      code: 'INVALID_CONFIRMED_CONFIRMATION',
      confirmationId: confirmation.id,
    });
    continue;
  }

  const ledger = expectedLedgerByOrder.get(confirmation.orderId) || {};

  for (const line of confirmation.lines) {
    const quantity = line?.confirmedQuantity;
    if (!finiteNonNegative(quantity) || typeof line?.orderLineId !== 'string') {
      structuralBlockers.push({
        code: 'INVALID_CONFIRMED_QUANTITY',
        confirmationId: confirmation.id,
        orderId: confirmation.orderId,
        orderLineId: line?.orderLineId,
      });
      continue;
    }

    const orderLine = orderLineById.get(line.orderLineId);
    if (!orderLine) {
      structuralBlockers.push({
        code: 'ORDER_LINE_NOT_FOUND',
        confirmationId: confirmation.id,
        orderId: confirmation.orderId,
        orderLineId: line.orderLineId,
      });
      continue;
    }

    if (orderLine.ticketOrderId !== confirmation.orderId) {
      structuralBlockers.push({
        code: 'ORDER_LINE_SCOPE_MISMATCH',
        confirmationId: confirmation.id,
        orderId: confirmation.orderId,
        orderLineId: line.orderLineId,
        actualOrderId: orderLine.ticketOrderId,
      });
      continue;
    }

    ledger[line.orderLineId] = (ledger[line.orderLineId] || 0) + quantity;
    expectedLedgerByOrder.set(confirmation.orderId, ledger);
  }
}

for (const [orderId, ledger] of expectedLedgerByOrder) {
  for (const [orderLineId, confirmedQuantity] of Object.entries(ledger)) {
    const orderLine = orderLineById.get(orderLineId);
    if (
      orderLine &&
      finiteNonNegative(orderLine.quantity) &&
      confirmedQuantity > orderLine.quantity
    ) {
      structuralBlockers.push({
        code: 'CONFIRMED_EXCEEDS_ORDERED',
        orderId,
        orderLineId,
        confirmedQuantity,
        orderedQuantity: orderLine.quantity,
      });
    }
  }
}

const ledgerPlan = [];
for (const [orderId, expected] of expectedLedgerByOrder) {
  const snapshot = await db
    .collection('fakturaConfirmationLedgers')
    .doc(orderId)
    .get();
  const current = snapshot.exists
    ? normalizeLedger(snapshot.data()?.confirmedByLine || {})
    : undefined;
  const normalizedExpected = normalizeLedger(expected);
  const action = !current
    ? 'CREATE'
    : equalLedger(normalizedExpected, current)
      ? 'UNCHANGED'
      : 'REPLACE';

  ledgerPlan.push({
    orderId,
    action,
    expectedConfirmedByLine: normalizedExpected,
    currentConfirmedByLine: current,
  });

  if (action !== 'UNCHANGED') {
    activationRequired.push({
      code: 'LEDGER_BOOTSTRAP_REQUIRED',
      orderId,
      action,
    });
  }
}

const activeRates = rates.filter(
  (rate) => rate.sourceType === 'order' && rate.active === true,
);

for (const rate of activeRates) {
  const source = rate.source;
  if (
    typeof rate.catalogItemId !== 'string' ||
    !finiteNonNegative(rate.billingUnitPrice) ||
    !Number.isInteger(rate.revision) ||
    rate.revision < 1 ||
    !source ||
    typeof source !== 'object' ||
    typeof source.documentLabel !== 'string' ||
    !source.documentLabel.trim()
  ) {
    structuralBlockers.push({
      code: 'INVALID_ACTIVE_RATE',
      rateId: rate.id,
    });
    continue;
  }

  if (typeof rate.prepaymentRequired !== 'boolean') {
    activationRequired.push({
      code: 'EXPLICIT_PREPAYMENT_POLICY_REQUIRED',
      rateId: rate.id,
      currentEffectivePolicy: true,
    });
  }
}

const activeExtras = seasonalExtras.filter((extra) => extra.active === true);
const manualServiceCandidates = [];

for (const extra of activeExtras) {
  const source = extra.source;
  if (
    typeof extra.organizationId !== 'string' ||
    !extra.organizationId ||
    typeof extra.description !== 'string' ||
    !extra.description.trim() ||
    !finiteNonNegative(extra.quantity) ||
    !finiteNonNegative(extra.unitAmount) ||
    !finiteNonNegative(extra.amount) ||
    !source ||
    typeof source !== 'object' ||
    typeof source.documentLabel !== 'string' ||
    !source.documentLabel.trim()
  ) {
    structuralBlockers.push({
      code: 'INVALID_ACTIVE_SEASONAL_EXTRA',
      extraId: extra.id,
    });
    continue;
  }

  manualServiceCandidates.push({
    legacyExtraId: extra.id,
    organizationId: extra.organizationId,
    reportingAreaId: extra.reportingAreaId,
    description: extra.description,
    quantity: extra.quantity,
    unit: unitFromSeasonalExtra(extra),
    customUnitLabel:
      extra.billingUnit === 'other'
        ? extra.billingUnitLabel || undefined
        : undefined,
    unitPrice: extra.unitAmount,
    amount: extra.amount,
    notes: extra.notes || undefined,
    sourceDocumentLabel: source.documentLabel,
  });
}

if (manualServiceCandidates.length) {
  activationRequired.push({
    code: 'ACTIVE_SEASONAL_EXTRAS_REQUIRE_MANUAL_SERVICE_MIGRATION',
    count: manualServiceCandidates.length,
  });
}

const programSnapshot = await db
  .collection('idmPremiumPrograms')
  .doc(`${seasonId}-idm-premium`)
  .get();

if (!programSnapshot.exists) {
  activationRequired.push({
    code: 'IDM_PROGRAM_SEED_REQUIRED',
    programId: `${seasonId}-idm-premium`,
  });
} else {
  const program = programSnapshot.data();
  if (
    program.active !== true ||
    program.seasonId !== seasonId ||
    !finiteNonNegative(program.amountPerReportingArea) ||
    !Array.isArray(program.reportingAreaIds) ||
    !program.reportingAreaIds.every((value) => typeof value === 'string') ||
    !Number.isInteger(program.revision) ||
    program.revision < 1
  ) {
    structuralBlockers.push({
      code: 'INVALID_IDM_PROGRAM',
      programId: programSnapshot.id,
    });
  } else {
    const allocationByArea = new Map(
      allocationKeys
        .filter((key) => key.active === true)
        .map((key) => [key.reportingAreaId, key]),
    );
    for (const reportingAreaId of program.reportingAreaIds) {
      if (!allocationByArea.has(reportingAreaId)) {
        structuralBlockers.push({
          code: 'IDM_ALLOCATION_KEY_MISSING',
          reportingAreaId,
        });
      }
    }
  }
}

if (billingRuns.length || billingLines.length) {
  warnings.push({
    code: 'V1_BILLING_HISTORY_PRESENT_ARCHIVE_ONLY',
    billingRuns: billingRuns.length,
    billingLines: billingLines.length,
  });
}

const readyOrInvoiced = billingSheets.filter(
  (sheet) => sheet.status === 'READY' || sheet.status === 'INVOICED',
);
if (readyOrInvoiced.length) {
  warnings.push({
    code: 'V2_FROZEN_BILLING_ALREADY_PRESENT',
    count: readyOrInvoiced.length,
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  projectId,
  emulator: Boolean(process.env.FIRESTORE_EMULATOR_HOST),
  seasonId,
  verdict: {
    structuralReady: structuralBlockers.length === 0,
    activationReady:
      structuralBlockers.length === 0 && activationRequired.length === 0,
  },
  stats: {
    confirmations: confirmations.length,
    activeConfirmedConfirmations: activeConfirmed.length,
    orderLines: orderLines.length,
    activeRates: activeRates.length,
    activeSeasonalExtras: activeExtras.length,
    v1BillingRuns: billingRuns.length,
    v1BillingLines: billingLines.length,
    v2BillingSheets: billingSheets.length,
    v2Deliveries: deliveries.length,
    allocationKeys: allocationKeys.length,
  },
  structuralBlockers,
  activationRequired,
  warnings,
  ledgerPlan,
  manualServiceCandidates,
};

console.log(JSON.stringify(report, null, 2));

if (failOnBlockers && structuralBlockers.length) {
  process.exitCode = 2;
}
if (
  requireActivationReady &&
  (structuralBlockers.length || activationRequired.length)
) {
  process.exitCode = 3;
}
