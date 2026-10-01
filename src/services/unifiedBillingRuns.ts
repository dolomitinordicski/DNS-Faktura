import {
  collection,
  doc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { auth } from './auth';
import { db } from './dnsCore';
import { ORDER_BILLING_STATUSES } from './orderBilling';
import {
  UNIFIED_BILLING_SOURCE_TYPES,
  type OrganizationUnifiedBilling,
} from './unifiedBilling';

export type UnifiedBillingRunStatus = 'draft' | 'ready';

export interface UnifiedBillingRunRecord {
  id: string;
  seasonId: string;
  organizationId: string;
  reportingAreaId: string;
  status: UnifiedBillingRunStatus;
  revision: number;
  sourceState: 'complete' | 'incomplete';
  sourceBlockingReasons: string[];
  lineCount: number;
  billedQuantity: number;
  unpricedQuantity: number;
  totalAmount: number;
}

function validStatus(value: unknown): value is UnifiedBillingRunStatus {
  return value === 'draft' || value === 'ready';
}

export async function loadUnifiedBillingRuns(
  seasonId: string,
): Promise<UnifiedBillingRunRecord[]> {
  const snapshot = await getDocs(
    query(collection(db, 'billingRuns'), where('seasonId', '==', seasonId)),
  );

  return snapshot.docs.flatMap((item) => {
    const data = item.data() as Record<string, unknown>;
    if (
      data.snapshotType !== 'unified' ||
      typeof data.seasonId !== 'string' ||
      typeof data.organizationId !== 'string' ||
      typeof data.reportingAreaId !== 'string' ||
      !validStatus(data.status) ||
      typeof data.revision !== 'number' ||
      (data.sourceState !== 'complete' && data.sourceState !== 'incomplete') ||
      !Array.isArray(data.sourceBlockingReasons) ||
      typeof data.lineCount !== 'number' ||
      typeof data.billedQuantity !== 'number' ||
      typeof data.unpricedQuantity !== 'number' ||
      typeof data.totalAmount !== 'number'
    ) {
      return [];
    }

    return [{
      id: item.id,
      seasonId: data.seasonId,
      organizationId: data.organizationId,
      reportingAreaId: data.reportingAreaId,
      status: data.status,
      revision: data.revision,
      sourceState: data.sourceState,
      sourceBlockingReasons: data.sourceBlockingReasons.filter(
        (value): value is string => typeof value === 'string',
      ),
      lineCount: data.lineCount,
      billedQuantity: data.billedQuantity,
      unpricedQuantity: data.unpricedQuantity,
      totalAmount: data.totalAmount,
    }];
  });
}

export async function saveUnifiedBillingRun({
  seasonId,
  organizationId,
  reportingAreaId,
  billing,
  status,
}: {
  seasonId: string;
  organizationId: string;
  reportingAreaId: string;
  billing: OrganizationUnifiedBilling;
  status: UnifiedBillingRunStatus;
}): Promise<UnifiedBillingRunRecord> {
  if (!auth.currentUser) throw new Error('LOGIN_REQUIRED');
  if (!reportingAreaId) throw new Error('AREA_REQUIRED');
  if (status === 'ready' && !billing.readyEligible) {
    throw new Error('SOURCE_INCOMPLETE');
  }

  const runId = `${seasonId}__${organizationId}__unified`;
  const runRef = doc(db, 'billingRuns', runId);

  return runTransaction(db, async (transaction) => {
    const existing = await transaction.get(runRef);
    const existingData = existing.exists()
      ? (existing.data() as Record<string, unknown>)
      : null;

    if (existingData?.status === 'ready') {
      throw new Error('READY_LOCKED');
    }

    const revision =
      (typeof existingData?.revision === 'number'
        ? existingData.revision
        : 0) + 1;

    const runData = {
      id: runId,
      seasonId,
      organizationId,
      reportingAreaId,
      status,
      revision,
      snapshotType: 'unified',
      sourceState: billing.sourceState,
      sourceBlockingReasons: billing.blockingReasons,
      sourceTypes: [...UNIFIED_BILLING_SOURCE_TYPES],
      sourceOrderStatuses: [...ORDER_BILLING_STATUSES],
      lineCount: billing.lines.length,
      billedQuantity: billing.billedQuantity,
      unpricedQuantity: billing.unpricedQuantity,
      totalAmount: billing.totalAmount,
      generatedBy: auth.currentUser!.uid,
      generatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    transaction.set(runRef, runData);

    for (const line of billing.lines) {
      const safeKey = encodeURIComponent(line.key);
      const lineId = `${runId}__r${revision}__${safeKey}`;
      const lineRef = doc(db, 'billingLines', lineId);
      const source: Record<string, unknown> = {
        type: line.sourceType,
        sourceId: line.sourceId,
        sourceLabel: line.sourceLabel,
      };
      if (line.sourceRevision !== undefined) {
        source.sourceRevision = line.sourceRevision;
      }

      const payload: Record<string, unknown> = {
        id: lineId,
        runId,
        runRevision: revision,
        seasonId,
        organizationId,
        reportingAreaId,
        source,
        description: line.description,
        quantity: line.quantity,
        unitAmount: line.unitAmount,
        amount: line.amount,
        included: true,
        createdBy: auth.currentUser!.uid,
        createdAt: serverTimestamp(),
      };

      if (line.catalogItemId) payload.catalogItemId = line.catalogItemId;
      if (line.rateId) payload.rateId = line.rateId;
      if (line.rateRevision !== undefined) {
        payload.rateRevision = line.rateRevision;
      }
      if (line.sourceDocumentLabel) {
        payload.sourceDocumentLabel = line.sourceDocumentLabel;
      }
      if (line.notes) payload.notes = line.notes;

      transaction.set(lineRef, payload);
    }

    return {
      id: runId,
      seasonId,
      organizationId,
      reportingAreaId,
      status,
      revision,
      sourceState: billing.sourceState,
      sourceBlockingReasons: billing.blockingReasons,
      lineCount: billing.lines.length,
      billedQuantity: billing.billedQuantity,
      unpricedQuantity: billing.unpricedQuantity,
      totalAmount: billing.totalAmount,
    };
  });
}

export function unifiedBillingRunMessage(
  error: unknown,
  language: 'de' | 'it',
) {
  const code = error instanceof Error ? error.message : String(error);
  const messages: Record<string, [string, string]> = {
    LOGIN_REQUIRED: ['Bitte erneut anmelden.', 'Accedi nuovamente.'],
    AREA_REQUIRED: [
      'Für diese Organisation fehlt das DNS-Gebiet.',
      'Per questa organizzazione manca la relativa area DNS.',
    ],
    SOURCE_INCOMPLETE: [
      'READY ist erst möglich, wenn alle vier Quellen vollständig und freigegeben sind.',
      'READY è possibile solo quando tutte e quattro le fonti sono complete e approvate.',
    ],
    READY_LOCKED: [
      'Dieser Unified Snapshot ist READY und kann nicht mehr geändert werden.',
      'Questo snapshot unificato è READY e non può più essere modificato.',
    ],
  };
  return (
    messages[code]?.[language === 'de' ? 0 : 1] ??
    (language === 'de'
      ? 'Unified Snapshot konnte nicht gespeichert werden.'
      : 'Impossibile salvare lo snapshot unificato.')
  );
}
