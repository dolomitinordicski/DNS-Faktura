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
  };
}

export function markBillingSheetReady(sheet: BillingSheet): BillingSheet {
  if (sheet.status !== 'DRAFT') throw new Error('INVALID_BILLING_STATE');
  return { ...sheet, status: 'READY' };
}


export function markBillingSheetInvoiced(sheet: BillingSheet): BillingSheet {
  if (sheet.status !== 'READY') throw new Error('INVALID_BILLING_STATE');
  return { ...sheet, status: 'INVOICED' };
}
