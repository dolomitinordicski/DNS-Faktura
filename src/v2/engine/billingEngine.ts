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
      catalogItemId: line.catalogItemId,
      orderId: input.confirmation.orderId,
      sourceRevision: input.confirmation.revision,
      rateId: rate.rateId,
      rateRevision: rate.rateRevision,
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

function recalculateDraftTotal(sheet: BillingSheet): BillingSheet {
  return {
    ...sheet,
    totalAmount: roundMoney(
      sheet.lines.reduce((sum, line) => sum + line.amount, 0),
    ),
  };
}

export function addManualServiceToDraft(input: {
  sheet: BillingSheet;
  line: BillingLine;
}): BillingSheet {
  if (input.sheet.status !== 'DRAFT') {
    throw new Error('BILLING_SHEET_FROZEN');
  }
  if (input.line.sourceType !== 'MANUAL_SERVICE') {
    throw new Error('MANUAL_SERVICE_LINE_REQUIRED');
  }
  if (input.sheet.lines.some((line) => line.id === input.line.id)) {
    throw new Error('BILLING_LINE_ALREADY_EXISTS');
  }

  return recalculateDraftTotal({
    ...input.sheet,
    lines: [...input.sheet.lines, input.line],
  });
}

export function updateManualServiceInDraft(input: {
  sheet: BillingSheet;
  lineId: string;
  line: BillingLine;
}): BillingSheet {
  if (input.sheet.status !== 'DRAFT') {
    throw new Error('BILLING_SHEET_FROZEN');
  }
  if (input.line.sourceType !== 'MANUAL_SERVICE') {
    throw new Error('MANUAL_SERVICE_LINE_REQUIRED');
  }
  if (input.line.id !== input.lineId) {
    throw new Error('BILLING_LINE_ID_MISMATCH');
  }

  const existing = input.sheet.lines.find((line) => line.id === input.lineId);
  if (!existing) throw new Error('BILLING_LINE_NOT_FOUND');
  if (existing.sourceType !== 'MANUAL_SERVICE') {
    throw new Error('NON_MANUAL_LINE_IMMUTABLE');
  }

  return recalculateDraftTotal({
    ...input.sheet,
    lines: input.sheet.lines.map((line) =>
      line.id === input.lineId ? input.line : line,
    ),
  });
}

export function removeManualServiceFromDraft(input: {
  sheet: BillingSheet;
  lineId: string;
}): BillingSheet {
  if (input.sheet.status !== 'DRAFT') {
    throw new Error('BILLING_SHEET_FROZEN');
  }

  const existing = input.sheet.lines.find((line) => line.id === input.lineId);
  if (!existing) throw new Error('BILLING_LINE_NOT_FOUND');
  if (existing.sourceType !== 'MANUAL_SERVICE') {
    throw new Error('NON_MANUAL_LINE_IMMUTABLE');
  }

  return recalculateDraftTotal({
    ...input.sheet,
    lines: input.sheet.lines.filter((line) => line.id !== input.lineId),
  });
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
  if (
    input.line.sourceType === 'MANUAL_SERVICE' &&
    input.line.sourceRevision === undefined
  ) {
    return {
      lineId: input.line.id,
      state: 'FRESH',
      sourceType: input.line.sourceType,
      sourceId: input.line.sourceId,
      usedRevision: input.line.sourceRevision,
    };
  }

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


export type BillingReadinessCode =
  | 'EMPTY_SHEET'
  | 'MISSING_REQUIRED_SOURCE_TYPE'
  | 'STALE_SOURCE'
  | 'MISSING_SOURCE'
  | 'INVALID_QUANTITY'
  | 'INVALID_UNIT_PRICE'
  | 'INVALID_AMOUNT'
  | 'MISSING_CONFIRMATION'
  | 'CONFIRMATION_NOT_CONFIRMED'
  | 'CONFIRMATION_REVISION_MISMATCH';

export interface BillingReadinessIssue {
  code: BillingReadinessCode;
  lineId?: string;
  sourceType?: BillingLine['sourceType'];
  sourceId?: string;
  detail?: string;
}

export interface BillingReadinessResult {
  ready: boolean;
  issues: BillingReadinessIssue[];
}

export interface ConfirmationReadinessSnapshot {
  id: string;
  revision: number;
  status: Confirmation['status'];
}

export function evaluateBillingReadiness(input: {
  sheet: BillingSheet;
  sources: SourceRevisionSnapshot[];
  confirmations: ConfirmationReadinessSnapshot[];
  requiredSourceTypes?: BillingLine['sourceType'][];
}): BillingReadinessResult {
  const issues: BillingReadinessIssue[] = [];

  if (!input.sheet.lines.length) {
    issues.push({ code: 'EMPTY_SHEET' });
  }

  for (const required of input.requiredSourceTypes ?? []) {
    if (!input.sheet.lines.some((line) => line.sourceType === required)) {
      issues.push({
        code: 'MISSING_REQUIRED_SOURCE_TYPE',
        sourceType: required,
      });
    }
  }

  for (const line of input.sheet.lines) {
    if (!Number.isFinite(line.quantity) || line.quantity < 0) {
      issues.push({ code: 'INVALID_QUANTITY', lineId: line.id });
    }
    if (!Number.isFinite(line.unitPrice) || line.unitPrice < 0) {
      issues.push({ code: 'INVALID_UNIT_PRICE', lineId: line.id });
    }
    if (!Number.isFinite(line.amount) || line.amount < 0) {
      issues.push({ code: 'INVALID_AMOUNT', lineId: line.id });
    }

    if (line.sourceType === 'ORDER_CONFIRMATION') {
      const confirmation = input.confirmations.find(
        (candidate) => candidate.id === line.sourceId,
      );
      if (!confirmation) {
        issues.push({
          code: 'MISSING_CONFIRMATION',
          lineId: line.id,
          sourceId: line.sourceId,
        });
      } else {
        if (confirmation.status !== 'CONFIRMED') {
          issues.push({
            code: 'CONFIRMATION_NOT_CONFIRMED',
            lineId: line.id,
            sourceId: line.sourceId,
            detail: confirmation.status,
          });
        }
        if (
          line.sourceRevision !== undefined &&
          confirmation.revision !== line.sourceRevision
        ) {
          issues.push({
            code: 'CONFIRMATION_REVISION_MISMATCH',
            lineId: line.id,
            sourceId: line.sourceId,
            detail: `${String(line.sourceRevision)}->${String(confirmation.revision)}`,
          });
        }
      }
    }
  }

  for (const freshness of checkBillingSheetFreshness({
    sheet: input.sheet,
    sources: input.sources,
  })) {
    if (freshness.state === 'STALE') {
      issues.push({
        code: 'STALE_SOURCE',
        lineId: freshness.lineId,
        sourceType: freshness.sourceType,
        sourceId: freshness.sourceId,
      });
    } else if (freshness.state === 'MISSING_SOURCE') {
      issues.push({
        code: 'MISSING_SOURCE',
        lineId: freshness.lineId,
        sourceType: freshness.sourceType,
        sourceId: freshness.sourceId,
      });
    }
  }

  return { ready: issues.length === 0, issues };
}

export function markBillingSheetReadyWhenValid(input: {
  sheet: BillingSheet;
  sources: SourceRevisionSnapshot[];
  confirmations: ConfirmationReadinessSnapshot[];
  requiredSourceTypes?: BillingLine['sourceType'][];
  readyAt?: string;
}): BillingSheet {
  if (input.sheet.status !== 'DRAFT') {
    throw new Error('INVALID_BILLING_STATE');
  }

  const result = evaluateBillingReadiness(input);
  if (!result.ready) {
    throw new Error(
      `BILLING_NOT_READY:${result.issues.map((issue) => issue.code).join(',')}`,
    );
  }

  return markBillingSheetReady(input.sheet, input.readyAt);
}
