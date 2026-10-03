import type {
  BillingSheetRecord,
  ConfirmationRecord,
} from '../contracts/persistence';
import type { BillingAssemblyResult } from './billingOrchestrator';
import { assembleBillingDraft } from './billingOrchestrator';
import {
  persistBillingDraft,
  persistBillingReady,
} from './billingPersistenceService';
import {
  firebaseCatalogPriceSource,
  firebaseFairSource,
  firebaseIdmSource,
  firebaseOrdersSource,
  firebaseSeasonalExtraSource,
} from '../adapters/liveSources';
import { FirestoreBillingSheetRepository } from '../persistence/firestoreBillingSheetRepository';
import { FirestoreConfirmationRepository } from '../persistence/firestoreConfirmationRepository';
import { evaluateLiveBillingReadiness } from './billingReadiness';

export async function buildOrRefreshBillingDraft(input: {
  seasonId: string;
  organizationId: string;
  confirmations: ConfirmationRecord[];
  existingSheets: BillingSheetRecord[];
  actorId: string;
  repository?: FirestoreBillingSheetRepository;
}): Promise<{
  assembly: BillingAssemblyResult;
  record: BillingSheetRecord;
  readiness: Awaited<ReturnType<typeof evaluateLiveBillingReadiness>>;
}> {
  const repository = input.repository ?? new FirestoreBillingSheetRepository();
  const existingDraft = [...input.existingSheets]
    .filter((sheet) => sheet.status === 'DRAFT')
    .sort((a, b) => b.revision - a.revision)[0];

  const latestFrozen = [...input.existingSheets]
    .filter((sheet) => sheet.status !== 'DRAFT')
    .sort((a, b) => b.revision - a.revision)[0];

  if (!existingDraft && latestFrozen) {
    throw new Error('BILLING_REVISION_REASON_REQUIRED');
  }

  const revision = existingDraft?.revision ?? 1;
  const id =
    existingDraft?.id ??
    `billing-${input.seasonId}-${input.organizationId}-r${String(revision)}`;

  const assembly = await assembleBillingDraft({
    id,
    seasonId: input.seasonId,
    organizationId: input.organizationId,
    revision,
    confirmations: input.confirmations,
    sources: {
      orders: firebaseOrdersSource,
      fair: firebaseFairSource,
      idm: firebaseIdmSource,
      catalogPrices: firebaseCatalogPriceSource,
      seasonalExtras: firebaseSeasonalExtraSource,
    },
    createdAt: existingDraft?.createdAt,
  });

  if (existingDraft) {
    const manualLines = existingDraft.lines.filter(
      (line) =>
        line.sourceType === 'MANUAL_SERVICE' && line.sourceRevision === undefined,
    );
    if (manualLines.length) {
      assembly.sheet.lines.push(...manualLines);
      assembly.sheet.totalAmount =
        Math.round(
          assembly.sheet.lines.reduce((sum, line) => sum + line.amount, 0) * 100,
        ) / 100;
    }
  }

  const now = new Date().toISOString();
  const record = await persistBillingDraft({
    assembly,
    repository,
    actorId: input.actorId,
    occurredAt: now,
  });

  const readiness = await evaluateLiveBillingReadiness({
    assembly: {
      ...assembly,
      sheet: record,
    },
    sources: {
      fair: firebaseFairSource,
      idm: firebaseIdmSource,
      catalogPrices: firebaseCatalogPriceSource,
      confirmations: new FirestoreConfirmationRepository(),
      seasonalExtras: firebaseSeasonalExtraSource,
    },
  });

  return { assembly, record, readiness };
}


export async function markCurrentBillingReady(input: {
  seasonId: string;
  organizationId: string;
  confirmations: ConfirmationRecord[];
  existingSheets: BillingSheetRecord[];
  actorId: string;
  repository?: FirestoreBillingSheetRepository;
}): Promise<BillingSheetRecord> {
  const repository = input.repository ?? new FirestoreBillingSheetRepository();
  const built = await buildOrRefreshBillingDraft({
    ...input,
    repository,
  });

  if (!built.record.updatedAt) {
    throw new Error('BILLING_UPDATED_AT_MISSING');
  }

  return persistBillingReady({
    assembly: {
      ...built.assembly,
      sheet: built.record,
    },
    repository,
    sources: {
      fair: firebaseFairSource,
      idm: firebaseIdmSource,
      catalogPrices: firebaseCatalogPriceSource,
      confirmations: new FirestoreConfirmationRepository(),
    },
    actorId: input.actorId,
    occurredAt: new Date().toISOString(),
    expectedUpdatedAt: built.record.updatedAt,
  });
}


export async function createBillingRevisionDraft(input: {
  seasonId: string;
  organizationId: string;
  confirmations: ConfirmationRecord[];
  original: BillingSheetRecord;
  reason: string;
  actorId: string;
  repository?: FirestoreBillingSheetRepository;
}): Promise<BillingSheetRecord> {
  if (input.original.status !== 'READY' && input.original.status !== 'INVOICED') {
    throw new Error('ONLY_FROZEN_BILLING_CAN_BE_REVISED');
  }
  if (!input.reason.trim()) {
    throw new Error('BILLING_REVISION_REASON_REQUIRED');
  }

  const repository = input.repository ?? new FirestoreBillingSheetRepository();
  const revision = input.original.revision + 1;
  const id = `billing-${input.seasonId}-${input.organizationId}-r${String(revision)}`;

  const assembly = await assembleBillingDraft({
    id,
    seasonId: input.seasonId,
    organizationId: input.organizationId,
    revision,
    confirmations: input.confirmations,
    sources: {
      orders: firebaseOrdersSource,
      fair: firebaseFairSource,
      idm: firebaseIdmSource,
      catalogPrices: firebaseCatalogPriceSource,
      seasonalExtras: firebaseSeasonalExtraSource,
    },
  });

  const oneOffManualLines = input.original.lines.filter(
    (line) =>
      line.sourceType === 'MANUAL_SERVICE' &&
      line.sourceRevision === undefined,
  );

  assembly.sheet = {
    ...assembly.sheet,
    supersedesBillingSheetId: input.original.id,
    revisionReason: input.reason.trim(),
    lines: [...assembly.sheet.lines, ...oneOffManualLines],
  };
  assembly.sheet.totalAmount =
    Math.round(
      assembly.sheet.lines.reduce((sum, line) => sum + line.amount, 0) * 100,
    ) / 100;

  const now = new Date().toISOString();
  const record: BillingSheetRecord = {
    ...assembly.sheet,
    createdAt: now,
    createdBy: input.actorId,
    updatedAt: now,
    updatedBy: input.actorId,
  };

  return repository.createRevisionTransaction({
    originalBillingSheetId: input.original.id,
    revision: record,
    actorId: input.actorId,
    occurredAt: now,
  });
}
