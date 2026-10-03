import type { BillingSourceType } from '../domain/types';
import type {
  BillingSheetRecord,
  BillingSheetRepository,
} from '../contracts/persistence';
import type { LiveBillingReadinessSources } from './billingReadiness';
import type { BillingAssemblyResult } from './billingOrchestrator';
import {
  evaluateLiveBillingReadiness,
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
  sources: LiveBillingReadinessSources;
  actorId: string;
  occurredAt: string;
  expectedUpdatedAt: string;
  requiredSourceTypes?: BillingSourceType[];
}): Promise<BillingSheetRecord> {
  const persisted = await input.repository.getById(
    input.assembly.sheet.id,
  );
  if (!persisted) {
    throw new Error('BILLING_SHEET_NOT_FOUND');
  }
  if (persisted.status !== 'DRAFT') {
    throw new Error('INVALID_BILLING_STATE');
  }
  if (persisted.updatedAt !== input.expectedUpdatedAt) {
    throw new Error('BILLING_DRAFT_CHANGED');
  }

  const readiness = await evaluateLiveBillingReadiness({
    assembly: {
      ...input.assembly,
      sheet: persisted,
    },
    sources: input.sources,
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
