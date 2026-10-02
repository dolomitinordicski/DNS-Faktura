import type { BillingSourceType } from '../domain/types';
import type {
  BillingSheetRecord,
  BillingSheetRepository,
} from '../contracts/persistence';
import type { CatalogPriceSource } from '../contracts/externalSources';
import type { BillingAssemblyResult } from './billingOrchestrator';
import {
  evaluateAssembledBillingReadiness,
} from './billingReadiness';

export function billingRecordFromAssembly(input: {
  assembly: BillingAssemblyResult;
  actorId: string;
  occurredAt: string;
}): BillingSheetRecord {
  if (input.assembly.sheet.status !== 'DRAFT') {
    throw new Error('ONLY_DRAFT_CAN_BE_PERSISTED');
  }

  return {
    ...input.assembly.sheet,
    createdAt: input.assembly.sheet.createdAt ?? input.occurredAt,
    createdBy: input.actorId,
    updatedAt: input.occurredAt,
    updatedBy: input.actorId,
  };
}

export async function persistBillingDraft(input: {
  assembly: BillingAssemblyResult;
  repository: BillingSheetRepository;
  actorId: string;
  occurredAt: string;
}): Promise<BillingSheetRecord> {
  const record = billingRecordFromAssembly(input);
  await input.repository.saveDraft(record);
  return record;
}

export async function persistBillingReady(input: {
  assembly: BillingAssemblyResult;
  repository: BillingSheetRepository;
  catalogPrices: CatalogPriceSource;
  actorId: string;
  occurredAt: string;
  expectedUpdatedAt: string;
  requiredSourceTypes?: BillingSourceType[];
}): Promise<BillingSheetRecord> {
  const readiness = await evaluateAssembledBillingReadiness({
    assembly: input.assembly,
    catalogPrices: input.catalogPrices,
    requiredSourceTypes: input.requiredSourceTypes,
  });

  if (!readiness.ready) {
    throw new Error(
      `BILLING_NOT_READY:${readiness.issues
        .map((issue) => issue.code)
        .join(',')}`,
    );
  }

  return input.repository.markReadyTransaction({
    billingSheetId: input.assembly.sheet.id,
    actorId: input.actorId,
    occurredAt: input.occurredAt,
    expectedUpdatedAt: input.expectedUpdatedAt,
  });
}
