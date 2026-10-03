import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import type {
  SeasonalExtraCharge,
  SeasonalExtraSource,
} from '../contracts/externalSources';
import type { QuantityUnit } from '../domain/types';
import { fakturaV2CoreDb } from './firebaseBackends';
import { roundUpToCent } from './rateConfigs';

export type BillingUnitType = 'piece' | 'hour' | 'flat' | 'km' | 'other';

export interface SeasonalExtraRecord {
  id: string;
  seasonId: string;
  organizationId: string;
  reportingAreaId: string;
  description: string;
  chargeCategory?: string;
  relatedCatalogItemId?: string;
  billingUnit: BillingUnitType;
  billingUnitLabel?: string;
  quantity: number;
  unitAmount: number;
  amount: number;
  currency: 'EUR';
  source: {
    documentLabel: string;
    supplier?: string;
    documentDate?: string;
  };
  active: boolean;
  revision: number;
  notes?: string;
}

function unitFromRecord(record: SeasonalExtraRecord): {
  unit: QuantityUnit;
  customUnitLabel?: string;
} {
  if (record.billingUnit === 'other') {
    return {
      unit: 'custom',
      customUnitLabel: record.billingUnitLabel || 'other',
    };
  }
  return { unit: record.billingUnit };
}

function mapRecord(
  id: string,
  data: Record<string, unknown>,
): SeasonalExtraRecord | null {
  if (
    data.sourceType !== 'seasonal-extra' ||
    typeof data.seasonId !== 'string' ||
    typeof data.organizationId !== 'string' ||
    typeof data.reportingAreaId !== 'string' ||
    typeof data.description !== 'string' ||
    typeof data.quantity !== 'number' ||
    !Number.isFinite(data.quantity) ||
    data.quantity < 0 ||
    typeof data.unitAmount !== 'number' ||
    !Number.isFinite(data.unitAmount) ||
    data.unitAmount < 0 ||
    typeof data.amount !== 'number' ||
    !Number.isFinite(data.amount) ||
    data.amount < 0 ||
    data.currency !== 'EUR' ||
    typeof data.active !== 'boolean' ||
    typeof data.revision !== 'number' ||
    !data.source ||
    typeof data.source !== 'object' ||
    Array.isArray(data.source)
  ) {
    return null;
  }

  const source = data.source as Record<string, unknown>;
  if (typeof source.documentLabel !== 'string') return null;

  const billingUnit: BillingUnitType =
    data.billingUnit === 'hour' ||
    data.billingUnit === 'flat' ||
    data.billingUnit === 'km' ||
    data.billingUnit === 'other'
      ? data.billingUnit
      : 'piece';

  return {
    id,
    seasonId: data.seasonId,
    organizationId: data.organizationId,
    reportingAreaId: data.reportingAreaId,
    description: data.description,
    chargeCategory:
      typeof data.chargeCategory === 'string' && data.chargeCategory
        ? data.chargeCategory
        : undefined,
    relatedCatalogItemId:
      typeof data.relatedCatalogItemId === 'string' &&
      data.relatedCatalogItemId
        ? data.relatedCatalogItemId
        : undefined,
    billingUnit,
    billingUnitLabel:
      typeof data.billingUnitLabel === 'string' && data.billingUnitLabel
        ? data.billingUnitLabel
        : undefined,
    quantity: data.quantity,
    unitAmount: data.unitAmount,
    amount: data.amount,
    currency: 'EUR',
    source: {
      documentLabel: source.documentLabel,
      supplier:
        typeof source.supplier === 'string' ? source.supplier : undefined,
      documentDate:
        typeof source.documentDate === 'string'
          ? source.documentDate
          : undefined,
    },
    active: data.active,
    revision: data.revision,
    notes: typeof data.notes === 'string' ? data.notes : undefined,
  };
}

function toCharge(record: SeasonalExtraRecord): SeasonalExtraCharge {
  const unit = unitFromRecord(record);
  return {
    sourceId: record.id,
    sourceRevision: record.revision,
    description: record.description,
    quantity: record.quantity,
    unit: unit.unit,
    customUnitLabel: unit.customUnitLabel,
    unitPrice: record.unitAmount,
    amount: record.amount,
    documentLabel: record.source.documentLabel,
    prepaymentRequired: false,
  };
}

export class FirebaseSeasonalExtraSource implements SeasonalExtraSource {
  async loadCharges(input: {
    seasonId: string;
    organizationId: string;
  }): Promise<SeasonalExtraCharge[]> {
    const snapshot = await getDocs(
      query(
        collection(fakturaV2CoreDb, 'billingSeasonalExtras'),
        where('seasonId', '==', input.seasonId),
      ),
    );

    return snapshot.docs
      .map((entry) =>
        mapRecord(entry.id, entry.data() as Record<string, unknown>),
      )
      .filter((entry): entry is SeasonalExtraRecord => Boolean(entry))
      .filter(
        (entry) =>
          entry.active && entry.organizationId === input.organizationId,
      )
      .map(toCharge);
  }

  async loadChargeById(sourceId: string): Promise<SeasonalExtraCharge | null> {
    const snapshot = await getDoc(
      doc(fakturaV2CoreDb, 'billingSeasonalExtras', sourceId),
    );
    if (!snapshot.exists()) return null;

    const record = mapRecord(
      snapshot.id,
      snapshot.data() as Record<string, unknown>,
    );
    if (!record || !record.active) return null;
    return toCharge(record);
  }
}

export async function loadSeasonalExtras(
  seasonId: string,
): Promise<SeasonalExtraRecord[]> {
  const snapshot = await getDocs(
    query(
      collection(fakturaV2CoreDb, 'billingSeasonalExtras'),
      where('seasonId', '==', seasonId),
    ),
  );

  return snapshot.docs
    .map((entry) =>
      mapRecord(entry.id, entry.data() as Record<string, unknown>),
    )
    .filter((entry): entry is SeasonalExtraRecord => Boolean(entry))
    .filter((entry) => entry.active);
}

function roundAmount(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export interface SeasonalExtraWriteInput {
  id?: string;
  seasonId: string;
  organizationId: string;
  reportingAreaId: string;
  description: string;
  chargeCategory: string;
  relatedCatalogItemId?: string;
  billingUnit: BillingUnitType;
  billingUnitLabel?: string;
  quantity: number;
  unitAmount: number;
  documentLabel: string;
  supplier?: string;
  documentDate?: string;
  notes?: string;
  active?: boolean;
  expectedRevision?: number;
  actorId: string;
}

export async function saveSeasonalExtra(
  input: SeasonalExtraWriteInput,
): Promise<SeasonalExtraRecord> {
  if (!input.description.trim()) throw new Error('DESCRIPTION_REQUIRED');
  if (!input.documentLabel.trim()) throw new Error('SOURCE_REQUIRED');
  if (!input.organizationId || !input.reportingAreaId) {
    throw new Error('ORGANIZATION_REQUIRED');
  }
  if (!Number.isFinite(input.quantity) || input.quantity < 0) {
    throw new Error('INVALID_QUANTITY');
  }
  if (!Number.isFinite(input.unitAmount) || input.unitAmount < 0) {
    throw new Error('INVALID_UNIT_PRICE');
  }
  if (input.billingUnit === 'flat' && input.quantity !== 1) {
    throw new Error('FLAT_QUANTITY_MUST_BE_ONE');
  }
  if (input.billingUnit === 'other' && !input.billingUnitLabel?.trim()) {
    throw new Error('CUSTOM_UNIT_LABEL_REQUIRED');
  }

  const id =
    input.id ??
    `${input.seasonId}__extra__${input.chargeCategory}__${input.organizationId}`;
  const ref = doc(fakturaV2CoreDb, 'billingSeasonalExtras', id);

  return runTransaction(fakturaV2CoreDb, async (transaction) => {
    const snapshot = await transaction.get(ref);
    const existing = snapshot.exists()
      ? mapRecord(snapshot.id, snapshot.data() as Record<string, unknown>)
      : null;

    if (snapshot.exists() && !existing) {
      throw new Error('INVALID_SEASONAL_EXTRA');
    }
    const currentRevision = existing?.revision ?? 0;
    if (
      input.expectedRevision !== undefined &&
      input.expectedRevision !== currentRevision
    ) {
      throw new Error('CONFLICT_RELOAD');
    }

    const unitAmount = roundUpToCent(input.unitAmount);
    const revision = currentRevision + 1;
    const source: Record<string, string> = {
      documentLabel: input.documentLabel.trim(),
    };
    if (input.supplier?.trim()) source.supplier = input.supplier.trim();
    if (input.documentDate) source.documentDate = input.documentDate;

    const payload: Record<string, unknown> = {
      id,
      seasonId: input.seasonId,
      sourceType: 'seasonal-extra',
      organizationId: input.organizationId,
      reportingAreaId: input.reportingAreaId,
      description: input.description.trim(),
      chargeCategory: input.chargeCategory.trim(),
      relatedCatalogItemId: input.relatedCatalogItemId ?? '',
      billingUnit: input.billingUnit,
      billingUnitLabel:
        input.billingUnit === 'other'
          ? input.billingUnitLabel?.trim() ?? ''
          : '',
      quantity: input.quantity,
      unitAmount,
      amount: roundAmount(input.quantity * unitAmount),
      currency: 'EUR',
      source,
      active: input.active ?? true,
      revision,
      notes: input.notes?.trim() ?? '',
      updatedBy: input.actorId,
      updatedAt: serverTimestamp(),
    };

    transaction.set(ref, payload);

    return mapRecord(id, payload)!;
  });
}
