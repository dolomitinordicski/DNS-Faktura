import type { BillingSeasonalExtra } from '@dolomitinordicski/dns-shared-data';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import type { SeasonalExtraSource } from '../contracts/externalSources';
import { fakturaV2CoreDb } from './firebaseBackends';
import { roundUpToCent } from '../domain/money';

function mapExtra(
  id: string,
  data: Record<string, unknown>,
): BillingSeasonalExtra | null {
  const source =
    data.source && typeof data.source === 'object' && !Array.isArray(data.source)
      ? (data.source as Record<string, unknown>)
      : null;

  if (
    data.id !== id ||
    typeof data.seasonId !== 'string' ||
    data.sourceType !== 'seasonal-extra' ||
    typeof data.organizationId !== 'string' ||
    typeof data.reportingAreaId !== 'string' ||
    typeof data.description !== 'string' ||
    typeof data.quantity !== 'number' ||
    typeof data.unitAmount !== 'number' ||
    typeof data.amount !== 'number' ||
    data.currency !== 'EUR' ||
    !source ||
    typeof source.documentLabel !== 'string' ||
    typeof data.active !== 'boolean' ||
    typeof data.revision !== 'number'
  ) {
    return null;
  }

  return {
    id,
    seasonId: data.seasonId,
    sourceType: 'seasonal-extra',
    organizationId: data.organizationId,
    reportingAreaId: data.reportingAreaId,
    description: data.description,
    quantity: data.quantity,
    unitAmount: data.unitAmount,
    amount: data.amount,
    currency: 'EUR',
    source: {
      documentLabel: source.documentLabel,
      supplier: typeof source.supplier === 'string' ? source.supplier : undefined,
      documentDate:
        typeof source.documentDate === 'string' ? source.documentDate : undefined,
    },
    active: data.active,
    revision: data.revision,
    notes: typeof data.notes === 'string' ? data.notes : undefined,
  };
}

export async function loadSeasonalExtras(
  seasonId: string,
): Promise<BillingSeasonalExtra[]> {
  const snapshot = await getDocs(
    query(
      collection(fakturaV2CoreDb, 'billingSeasonalExtras'),
      where('seasonId', '==', seasonId),
    ),
  );

  return snapshot.docs
    .map((entry) => mapExtra(entry.id, entry.data() as Record<string, unknown>))
    .filter((entry): entry is BillingSeasonalExtra => Boolean(entry))
    .filter((entry) => entry.active);
}

function amount(quantity: number, unitAmount: number) {
  return Math.round((quantity * unitAmount + Number.EPSILON) * 100) / 100;
}

function clean(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}

export async function upsertSeasonalExtra(input: {
  id: string;
  seasonId: string;
  organizationId: string;
  reportingAreaId: string;
  description: string;
  quantity: number;
  unitAmount: number;
  documentLabel: string;
  supplier?: string;
  documentDate?: string;
  notes?: string;
  actorId: string;
}): Promise<BillingSeasonalExtra> {
  if (!input.description.trim()) throw new Error('SEASONAL_EXTRA_DESCRIPTION_REQUIRED');
  if (!input.documentLabel.trim()) throw new Error('SEASONAL_EXTRA_SOURCE_REQUIRED');
  if (!Number.isFinite(input.quantity) || input.quantity < 0) {
    throw new Error('INVALID_QUANTITY');
  }

  const unitAmount = roundUpToCent(input.unitAmount);
  const ref = doc(fakturaV2CoreDb, 'billingSeasonalExtras', input.id);
  const existing = await getDoc(ref);
  const current = existing.exists()
    ? mapExtra(existing.id, existing.data() as Record<string, unknown>)
    : null;

  if (existing.exists() && !current) throw new Error('INVALID_SEASONAL_EXTRA');

  const revision = current ? current.revision + 1 : 1;
  const record: BillingSeasonalExtra = {
    id: input.id,
    seasonId: input.seasonId,
    sourceType: 'seasonal-extra',
    organizationId: input.organizationId,
    reportingAreaId: input.reportingAreaId,
    description: input.description.trim(),
    quantity: input.quantity,
    unitAmount,
    amount: amount(input.quantity, unitAmount),
    currency: 'EUR',
    source: {
      documentLabel: input.documentLabel.trim(),
      supplier: input.supplier?.trim() || undefined,
      documentDate: input.documentDate || undefined,
    },
    active: true,
    revision,
    notes: input.notes?.trim() || undefined,
  };

  await setDoc(
    ref,
    clean({
      ...record,
      updatedBy: input.actorId,
      updatedAt: serverTimestamp(),
    }),
  );

  return record;
}


export class CoreSeasonalExtraSource implements SeasonalExtraSource {
  async loadExtras(input: {
    seasonId: string;
    organizationId: string;
  }) {
    const extras = await loadSeasonalExtras(input.seasonId);
    return extras
      .filter((extra) => extra.organizationId === input.organizationId)
      .map((extra) => ({
        sourceId: extra.id,
        sourceRevision: extra.revision,
        description: extra.description,
        quantity: extra.quantity,
        unitAmount: extra.unitAmount,
        amount: extra.amount,
        documentLabel: extra.source.documentLabel,
        supplier: extra.source.supplier,
      }));
  }
}
