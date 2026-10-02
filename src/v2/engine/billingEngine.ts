import type {
  BillingLine,
  BillingSheet,
  Confirmation,
  OrganizationId,
  QuantityUnit,
  SeasonId,
} from '../domain/types';

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export interface OrderRate {
  catalogItemId: string;
  rateId: string;
  rateRevision: number;
  unitPrice: number;
  prepaymentRequired: boolean;
  sourceDocument?: string;
}

export function buildConfirmedOrderBillingLines(input: {
  confirmation: Confirmation;
  rates: OrderRate[];
}): BillingLine[] {
  if (input.confirmation.status !== 'CONFIRMED') {
    throw new Error('CONFIRMATION_NOT_CONFIRMED');
  }

  const rateByItem = new Map(
    input.rates.map((rate) => [rate.catalogItemId, rate]),
  );

  return input.confirmation.lines.map((line) => {
    const rate = rateByItem.get(line.catalogItemId);
    if (!rate) throw new Error(`MISSING_RATE:${line.catalogItemId}`);

    const quantity = line.confirmedQuantity;
    if (quantity === undefined) throw new Error('MISSING_CONFIRMED_QUANTITY');

    const amount = roundMoney(quantity * rate.unitPrice);

    return {
      id: `${input.confirmation.id}:${line.orderLineId}`,
      sourceType: 'ORDER_CONFIRMATION',
      sourceId: input.confirmation.id,
      sourceRevision: input.confirmation.revision,
      description: line.catalogItemId,
      quantity,
      unit: line.unit,
      unitPrice: rate.unitPrice,
      amount,
      prepaymentRequired: rate.prepaymentRequired,
      sourceDocument: rate.sourceDocument,
    };
  });
}

export function createManualServiceLine(input: {
  id: string;
  sourceId: string;
  description: string;
  quantity: number;
  unit: QuantityUnit;
  customUnitLabel?: string;
  unitPrice: number;
  prepaymentRequired?: boolean;
  notes?: string;
}): BillingLine {
  if (!Number.isFinite(input.quantity) || input.quantity < 0) {
    throw new Error('INVALID_QUANTITY');
  }
  if (!Number.isFinite(input.unitPrice) || input.unitPrice < 0) {
    throw new Error('INVALID_UNIT_PRICE');
  }
  if (input.unit === 'flat' && input.quantity !== 1) {
    throw new Error('FLAT_QUANTITY_MUST_BE_ONE');
  }
  if (input.unit === 'custom' && !input.customUnitLabel?.trim()) {
    throw new Error('CUSTOM_UNIT_LABEL_REQUIRED');
  }

  return {
    id: input.id,
    sourceType: 'MANUAL_SERVICE',
    sourceId: input.sourceId,
    description: input.description,
    quantity: input.quantity,
    unit: input.unit,
    customUnitLabel: input.customUnitLabel,
    unitPrice: input.unitPrice,
    amount: roundMoney(input.quantity * input.unitPrice),
    prepaymentRequired: input.prepaymentRequired ?? false,
    notes: input.notes,
  };
}

export function createBillingSheet(input: {
  id: string;
  seasonId: SeasonId;
  organizationId: OrganizationId;
  revision: number;
  lines: BillingLine[];
  createdAt?: string;
  supersedesBillingSheetId?: string;
  revisionReason?: string;
}): BillingSheet {
  return {
    id: input.id,
    seasonId: input.seasonId,
    organizationId: input.organizationId,
    revision: input.revision,
    status: 'DRAFT',
    lines: input.lines,
    totalAmount: roundMoney(
      input.lines.reduce((sum, line) => sum + line.amount, 0),
    ),
    createdAt: input.createdAt,
    supersedesBillingSheetId: input.supersedesBillingSheetId,
    revisionReason: input.revisionReason,
  };
}

export function markBillingSheetReady(
  sheet: BillingSheet,
  readyAt?: string,
): BillingSheet {
  if (sheet.status !== 'DRAFT') throw new Error('INVALID_BILLING_STATE');
  return { ...sheet, status: 'READY', readyAt };
}


export function markBillingSheetInvoiced(
  sheet: BillingSheet,
  invoicedAt?: string,
): BillingSheet {
  if (sheet.status !== 'READY') throw new Error('INVALID_BILLING_STATE');
  return { ...sheet, status: 'INVOICED', invoicedAt };
}

export function createBillingSheetRevision(input: {
  id: string;
  original: BillingSheet;
  lines: BillingLine[];
  reason: string;
  createdAt?: string;
}): BillingSheet {
  if (input.original.status === 'DRAFT') {
    throw new Error('DRAFT_SHOULD_BE_EDITED_NOT_REVISED');
  }
  if (!input.reason.trim()) {
    throw new Error('BILLING_REVISION_REASON_REQUIRED');
  }

  return createBillingSheet({
    id: input.id,
    seasonId: input.original.seasonId,
    organizationId: input.original.organizationId,
    revision: input.original.revision + 1,
    lines: input.lines,
    createdAt: input.createdAt,
    supersedesBillingSheetId: input.original.id,
    revisionReason: input.reason,
  });
}

export function assertBillingSheetRevisionLineage(input: {
  original: BillingSheet;
  revision: BillingSheet;
}) {
  if (input.revision.status !== 'DRAFT') {
    throw new Error('BILLING_REVISION_MUST_START_DRAFT');
  }
  if (input.revision.supersedesBillingSheetId !== input.original.id) {
    throw new Error('INVALID_BILLING_REVISION_LINEAGE');
  }
  if (input.revision.revision !== input.original.revision + 1) {
    throw new Error('INVALID_BILLING_REVISION_NUMBER');
  }
  if (
    input.revision.seasonId !== input.original.seasonId ||
    input.revision.organizationId !== input.original.organizationId
  ) {
    throw new Error('INVALID_BILLING_REVISION_SCOPE');
  }
}

export function assertBillingSheetImmutable(sheet: BillingSheet) {
  if (sheet.status === 'READY' || sheet.status === 'INVOICED') {
    return true;
  }
  throw new Error('BILLING_SHEET_NOT_FROZEN');
}


export type SourceFreshnessState = 'FRESH' | 'STALE' | 'MISSING_SOURCE';

export interface SourceRevisionSnapshot {
  sourceType: BillingLine['sourceType'];
  sourceId: string;
  currentRevision?: number;
}

export interface BillingLineFreshness {
  lineId: string;
  state: SourceFreshnessState;
  sourceType: BillingLine['sourceType'];
  sourceId: string;
  usedRevision?: number;
  currentRevision?: number;
}

export function checkBillingLineFreshness(input: {
  line: BillingLine;
  sources: SourceRevisionSnapshot[];
}): BillingLineFreshness {
  const source = input.sources.find(
    (candidate) =>
      candidate.sourceType === input.line.sourceType &&
      candidate.sourceId === input.line.sourceId,
  );

  if (!source) {
    return {
      lineId: input.line.id,
      state: 'MISSING_SOURCE',
      sourceType: input.line.sourceType,
      sourceId: input.line.sourceId,
      usedRevision: input.line.sourceRevision,
    };
  }

  if (
    input.line.sourceRevision !== undefined &&
    source.currentRevision !== undefined &&
    source.currentRevision > input.line.sourceRevision
  ) {
    return {
      lineId: input.line.id,
      state: 'STALE',
      sourceType: input.line.sourceType,
      sourceId: input.line.sourceId,
      usedRevision: input.line.sourceRevision,
      currentRevision: source.currentRevision,
    };
  }

  return {
    lineId: input.line.id,
    state: 'FRESH',
    sourceType: input.line.sourceType,
    sourceId: input.line.sourceId,
    usedRevision: input.line.sourceRevision,
    currentRevision: source.currentRevision,
  };
}

export function checkBillingSheetFreshness(input: {
  sheet: BillingSheet;
  sources: SourceRevisionSnapshot[];
}): BillingLineFreshness[] {
  return input.sheet.lines.map((line) =>
    checkBillingLineFreshness({ line, sources: input.sources }),
  );
}

export function assertBillingSheetSourcesFresh(input: {
  sheet: BillingSheet;
  sources: SourceRevisionSnapshot[];
}) {
  const results = checkBillingSheetFreshness(input);
  const stale = results.find((result) => result.state === 'STALE');
  if (stale) {
    throw new Error(
      `STALE_SOURCE:${stale.sourceType}:${stale.sourceId}:${String(
        stale.usedRevision,
      )}->${String(stale.currentRevision)}`,
    );
  }

  const missing = results.find((result) => result.state === 'MISSING_SOURCE');
  if (missing) {
    throw new Error(
      `MISSING_SOURCE:${missing.sourceType}:${missing.sourceId}`,
    );
  }

  return true;
}
