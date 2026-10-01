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
import {
  ORDER_BILLING_STATUSES,
  type OrganizationOrderBilling,
} from './orderBilling';

export type BillingRunStatus = 'draft' | 'ready';

export interface BillingRunRecord {
  id: string;
  seasonId: string;
  organizationId: string;
  reportingAreaId: string;
  status: BillingRunStatus;
  revision: number;
  lineCount: number;
  billedQuantity: number;
  unpricedQuantity: number;
  totalAmount: number;
}

function validRunStatus(value: unknown): value is BillingRunStatus {
  return value === 'draft' || value === 'ready';
}

export async function loadBillingRuns(
  seasonId: string,
): Promise<BillingRunRecord[]> {
  const snapshot = await getDocs(
    query(collection(db, 'billingRuns'), where('seasonId', '==', seasonId)),
  );

  return snapshot.docs.flatMap((item) => {
    const data = item.data() as Record<string, unknown>;
    if (
      typeof data.seasonId !== 'string' ||
      typeof data.organizationId !== 'string' ||
      typeof data.reportingAreaId !== 'string' ||
      !validRunStatus(data.status) ||
      typeof data.revision !== 'number' ||
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
      lineCount: data.lineCount,
      billedQuantity: data.billedQuantity,
      unpricedQuantity: data.unpricedQuantity,
      totalAmount: data.totalAmount,
    }];
  });
}

export async function saveOrderBillingRun({
  seasonId,
  organizationId,
  reportingAreaId,
  billing,
  status,
}: {
  seasonId: string;
  organizationId: string;
  reportingAreaId: string;
  billing: OrganizationOrderBilling;
  status: BillingRunStatus;
}): Promise<BillingRunRecord> {
  if (!auth.currentUser) throw new Error('LOGIN_REQUIRED');
  if (!reportingAreaId) throw new Error('AREA_REQUIRED');
  if (status === 'ready' && billing.unpricedQuantity > 0) {
    throw new Error('UNPRICED_BLOCKS_READY');
  }

  const runId = `${seasonId}__${organizationId}`;
  const runRef = doc(db, 'billingRuns', runId);

  return runTransaction(db, async (transaction) => {
    const existing = await transaction.get(runRef);
    const existingData = existing.exists()
      ? (existing.data() as Record<string, unknown>)
      : null;

    if (existingData?.status === 'ready') {
      throw new Error('READY_LOCKED');
    }

    const currentRevision =
      typeof existingData?.revision === 'number' ? existingData.revision : 0;
    const revision = currentRevision + 1;

    const runData = {
      id: runId,
      seasonId,
      organizationId,
      reportingAreaId,
      status,
      revision,
      sourceTypes: ['order'],
      sourceOrderStatuses: [...ORDER_BILLING_STATUSES],
      lineCount: billing.lines.length,
      billedQuantity: billing.billedQuantity,
      unpricedQuantity: billing.unpricedQuantity,
      totalAmount: billing.amount,
      generatedBy: auth.currentUser!.uid,
      generatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    transaction.set(runRef, runData);

    for (const line of billing.lines) {
      const safeCatalogItemId = encodeURIComponent(line.catalogItemId);
      const lineId =
        `${runId}__r${revision}__order__${safeCatalogItemId}`;
      const lineRef = doc(db, 'billingLines', lineId);
      transaction.set(lineRef, {
        id: lineId,
        runId,
        runRevision: revision,
        seasonId,
        organizationId,
        reportingAreaId,
        source: {
          type: 'order',
          sourceId: line.rateId,
          sourceLabel: line.sourceDocumentLabel,
        },
        catalogItemId: line.catalogItemId,
        description: line.description,
        quantity: line.quantity,
        unitAmount: line.unitAmount,
        amount: line.amount,
        included: true,
        rateId: line.rateId,
        rateRevision: line.rateRevision,
        sourceDocumentLabel: line.sourceDocumentLabel,
        createdBy: auth.currentUser!.uid,
        createdAt: serverTimestamp(),
      });
    }

    return {
      id: runId,
      seasonId,
      organizationId,
      reportingAreaId,
      status,
      revision,
      lineCount: billing.lines.length,
      billedQuantity: billing.billedQuantity,
      unpricedQuantity: billing.unpricedQuantity,
      totalAmount: billing.amount,
    };
  });
}

export function billingRunMessage(
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
    UNPRICED_BLOCKS_READY: [
      'READY ist erst möglich, wenn alle aktiven Mengen einen Tarif haben.',
      'READY è possibile solo quando tutte le quantità attive hanno una tariffa.',
    ],
    READY_LOCKED: [
      'Dieser Snapshot ist READY und kann nicht mehr geändert werden.',
      'Questo snapshot è READY e non può più essere modificato.',
    ],
  };
  return (
    messages[code]?.[language === 'de' ? 0 : 1] ??
    (language === 'de'
      ? 'Snapshot konnte nicht gespeichert werden.'
      : 'Impossibile salvare lo snapshot.')
  );
}
