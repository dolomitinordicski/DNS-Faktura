import type {
  BillingSheetRecord,
  ConfirmationRecord,
} from '../contracts/persistence';
import type { BillingAssemblyResult } from './billingOrchestrator';
import { assembleBillingDraft } from './billingOrchestrator';
import { persistBillingDraft } from './billingPersistenceService';
import {
  firebaseCatalogPriceSource,
  firebaseFairSource,
  firebaseIdmSource,
  firebaseOrdersSource,
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
    },
    createdAt: existingDraft?.createdAt,
  });

  if (existingDraft) {
    const manualLines = existingDraft.lines.filter(
      (line) => line.sourceType === 'MANUAL_SERVICE',
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
    },
  });

  return { assembly, record, readiness };
}
