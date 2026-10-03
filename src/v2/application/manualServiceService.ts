import type { QuantityUnit } from '../domain/types';
import type {
  BillingSheetRecord,
  BillingSheetRepository,
} from '../contracts/persistence';
import { createManualServiceLine } from '../engine/billingEngine';

export interface ManualServiceInput {
  description: string;
  quantity: number;
  unit: QuantityUnit;
  customUnitLabel?: string;
  unitPrice: number;
  prepaymentRequired?: boolean;
  notes?: string;
}

function assertDescription(description: string) {
  if (!description.trim()) {
    throw new Error('MANUAL_SERVICE_DESCRIPTION_REQUIRED');
  }
}

function buildManualLine(input: {
  billingSheetId: string;
  lineId: string;
  values: ManualServiceInput;
}) {
  if (!input.lineId.trim()) {
    throw new Error('BILLING_LINE_ID_REQUIRED');
  }
  assertDescription(input.values.description);

  return createManualServiceLine({
    id: input.lineId,
    sourceId: `manual:${input.billingSheetId}:${input.lineId}`,
    description: input.values.description.trim(),
    quantity: input.values.quantity,
    unit: input.values.unit,
    customUnitLabel: input.values.customUnitLabel?.trim() || undefined,
    unitPrice: input.values.unitPrice,
    prepaymentRequired: input.values.prepaymentRequired,
    notes: input.values.notes?.trim() || undefined,
  });
}

export async function addManualService(input: {
  billingSheetId: string;
  lineId: string;
  values: ManualServiceInput;
  repository: BillingSheetRepository;
  actorId: string;
  occurredAt: string;
  expectedUpdatedAt: string;
}): Promise<BillingSheetRecord> {
  const line = buildManualLine(input);

  return input.repository.mutateManualServiceTransaction({
    billingSheetId: input.billingSheetId,
    operation: 'ADD',
    lineId: input.lineId,
    line,
    actorId: input.actorId,
    occurredAt: input.occurredAt,
    expectedUpdatedAt: input.expectedUpdatedAt,
  });
}

export async function updateManualService(input: {
  billingSheetId: string;
  lineId: string;
  values: ManualServiceInput;
  repository: BillingSheetRepository;
  actorId: string;
  occurredAt: string;
  expectedUpdatedAt: string;
}): Promise<BillingSheetRecord> {
  const line = buildManualLine(input);

  return input.repository.mutateManualServiceTransaction({
    billingSheetId: input.billingSheetId,
    operation: 'UPDATE',
    lineId: input.lineId,
    line,
    actorId: input.actorId,
    occurredAt: input.occurredAt,
    expectedUpdatedAt: input.expectedUpdatedAt,
  });
}

export async function removeManualService(input: {
  billingSheetId: string;
  lineId: string;
  repository: BillingSheetRepository;
  actorId: string;
  occurredAt: string;
  expectedUpdatedAt: string;
}): Promise<BillingSheetRecord> {
  if (!input.lineId.trim()) {
    throw new Error('BILLING_LINE_ID_REQUIRED');
  }

  return input.repository.mutateManualServiceTransaction({
    billingSheetId: input.billingSheetId,
    operation: 'REMOVE',
    lineId: input.lineId,
    actorId: input.actorId,
    occurredAt: input.occurredAt,
    expectedUpdatedAt: input.expectedUpdatedAt,
  });
}
