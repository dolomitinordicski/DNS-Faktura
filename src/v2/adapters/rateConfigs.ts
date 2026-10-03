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
import { fakturaV2CoreDb } from './firebaseBackends';

export interface RateCatalogItem {
  id: string;
  category: string;
  code: string;
  label?: { de?: string; it?: string; en?: string };
}

export interface RateSource {
  documentLabel: string;
  supplier?: string;
  documentDate?: string;
  totalQuantity?: number;
  totalAmount?: number;
  packSize?: number;
  packPriceNet?: number;
  calculatedPurchaseUnitPrice?: number;
}

export interface RateConfigRecord {
  id: string;
  seasonId: string;
  sourceType: 'order';
  catalogItemId: string;
  billingUnitPrice: number;
  currency: 'EUR';
  source: RateSource;
  active: boolean;
  prepaymentRequired: boolean;
  revision: number;
  notes?: string;
}

function optionalNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function mapRate(id: string, data: Record<string, unknown>): RateConfigRecord | null {
  const source =
    data.source && typeof data.source === 'object' && !Array.isArray(data.source)
      ? (data.source as Record<string, unknown>)
      : null;

  if (
    typeof data.seasonId !== 'string' ||
    data.sourceType !== 'order' ||
    typeof data.catalogItemId !== 'string' ||
    typeof data.billingUnitPrice !== 'number' ||
    !Number.isFinite(data.billingUnitPrice) ||
    data.currency !== 'EUR' ||
    typeof data.active !== 'boolean' ||
    typeof data.revision !== 'number' ||
    !source ||
    typeof source.documentLabel !== 'string'
  ) {
    return null;
  }

  return {
    id,
    seasonId: data.seasonId,
    sourceType: 'order',
    catalogItemId: data.catalogItemId,
    billingUnitPrice: data.billingUnitPrice,
    currency: 'EUR',
    source: {
      documentLabel: source.documentLabel,
      supplier: typeof source.supplier === 'string' ? source.supplier : undefined,
      documentDate: typeof source.documentDate === 'string' ? source.documentDate : undefined,
      totalQuantity: optionalNumber(source.totalQuantity),
      totalAmount: optionalNumber(source.totalAmount),
      packSize: optionalNumber(source.packSize),
      packPriceNet: optionalNumber(source.packPriceNet),
      calculatedPurchaseUnitPrice: optionalNumber(source.calculatedPurchaseUnitPrice),
    },
    active: data.active,
    prepaymentRequired:
      typeof data.prepaymentRequired === 'boolean'
        ? data.prepaymentRequired
        : true,
    revision: data.revision,
    notes: typeof data.notes === 'string' ? data.notes : undefined,
  };
}

export async function loadRateConfiguration(seasonId: string): Promise<{
  catalog: RateCatalogItem[];
  rates: RateConfigRecord[];
}> {
  const [catalogSnapshot, rateSnapshot] = await Promise.all([
    getDocs(collection(fakturaV2CoreDb, 'orderCatalogItems')),
    getDocs(
      query(
        collection(fakturaV2CoreDb, 'billingRateConfigs'),
        where('seasonId', '==', seasonId),
      ),
    ),
  ]);

  const catalog = catalogSnapshot.docs
    .map((item) => {
      const data = item.data() as Record<string, unknown>;
      if (typeof data.category !== 'string' || typeof data.code !== 'string') {
        return null;
      }
      return {
        id: item.id,
        category: data.category,
        code: data.code,
        label:
          data.label && typeof data.label === 'object' && !Array.isArray(data.label)
            ? (data.label as RateCatalogItem['label'])
            : undefined,
      };
    })
    .filter((item): item is RateCatalogItem => Boolean(item))
    .filter((item) => item.id.startsWith(`${seasonId}-`));

  const rates = rateSnapshot.docs
    .map((item) => mapRate(item.id, item.data() as Record<string, unknown>))
    .filter((item): item is RateConfigRecord => Boolean(item));

  return { catalog, rates };
}

export interface SaveRateInput {
  seasonId: string;
  catalogItemId: string;
  billingUnitPrice: number;
  documentLabel: string;
  supplier?: string;
  documentDate?: string;
  totalQuantity?: number;
  totalAmount?: number;
  packSize?: number;
  packPriceNet?: number;
  active: boolean;
  prepaymentRequired: boolean;
  notes?: string;
  actorId: string;
}

function cleanRecord(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
}

export async function saveRateConfiguration(
  input: SaveRateInput,
): Promise<RateConfigRecord> {
  if (!input.documentLabel.trim()) {
    throw new Error('RATE_SOURCE_DOCUMENT_REQUIRED');
  }
  if (!Number.isFinite(input.billingUnitPrice) || input.billingUnitPrice < 0) {
    throw new Error('INVALID_BILLING_UNIT_PRICE');
  }

  const id = `${input.seasonId}__order__${input.catalogItemId}`;
  const ref = doc(fakturaV2CoreDb, 'billingRateConfigs', id);
  const existing = await getDoc(ref);
  const current = existing.exists()
    ? mapRate(existing.id, existing.data() as Record<string, unknown>)
    : null;

  if (existing.exists() && !current) {
    throw new Error('INVALID_EXISTING_RATE');
  }

  const calculatedPurchaseUnitPrice =
    input.totalQuantity !== undefined &&
    input.totalQuantity > 0 &&
    input.totalAmount !== undefined
      ? input.totalAmount / input.totalQuantity
      : input.packSize !== undefined &&
          input.packSize > 0 &&
          input.packPriceNet !== undefined
        ? input.packPriceNet / input.packSize
        : undefined;

  const source = cleanRecord({
    documentLabel: input.documentLabel.trim(),
    supplier: input.supplier?.trim() || undefined,
    documentDate: input.documentDate || undefined,
    totalQuantity: input.totalQuantity,
    totalAmount: input.totalAmount,
    packSize: input.packSize,
    packPriceNet: input.packPriceNet,
    calculatedPurchaseUnitPrice,
  });

  const revision = current ? current.revision + 1 : 1;
  const record = cleanRecord({
    id,
    seasonId: input.seasonId,
    sourceType: 'order',
    catalogItemId: input.catalogItemId,
    billingUnitPrice: input.billingUnitPrice,
    currency: 'EUR',
    source,
    active: input.active,
    prepaymentRequired: input.prepaymentRequired,
    revision,
    notes: input.notes?.trim() || undefined,
    updatedBy: input.actorId,
    updatedAt: serverTimestamp(),
  });

  await setDoc(ref, record);

  return {
    id,
    seasonId: input.seasonId,
    sourceType: 'order',
    catalogItemId: input.catalogItemId,
    billingUnitPrice: input.billingUnitPrice,
    currency: 'EUR',
    source: source as unknown as RateSource,
    active: input.active,
    prepaymentRequired: input.prepaymentRequired,
    revision,
    notes: input.notes?.trim() || undefined,
  };
}
