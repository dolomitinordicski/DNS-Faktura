import type { BillingCommercialRate } from '@dolomitinordicski/dns-shared-data';
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

export interface CommercialRateDraft {
  catalogItemId: string;
  billingUnitPrice: string;
  documentLabel: string;
  supplier: string;
  documentDate: string;
  totalQuantity: string;
  totalAmount: string;
  notes: string;
  revision: number;
}

function finiteNonNegative(value: string) {
  if (!value.trim()) return undefined;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export async function loadCommercialRates(
  seasonId: string,
): Promise<BillingCommercialRate[]> {
  const snapshot = await getDocs(
    query(
      collection(db, 'billingRateConfigs'),
      where('seasonId', '==', seasonId),
    ),
  );

  return snapshot.docs.flatMap((item) => {
    const data = item.data() as Record<string, unknown>;
    if (
      data.sourceType !== 'order' ||
      typeof data.catalogItemId !== 'string' ||
      typeof data.billingUnitPrice !== 'number' ||
      data.currency !== 'EUR' ||
      typeof data.revision !== 'number' ||
      typeof data.active !== 'boolean' ||
      !data.source ||
      typeof data.source !== 'object' ||
      Array.isArray(data.source)
    ) {
      return [];
    }
    const source = data.source as Record<string, unknown>;
    if (typeof source.documentLabel !== 'string') return [];

    const rate: BillingCommercialRate = {
      id: item.id,
      seasonId: seasonId as BillingCommercialRate['seasonId'],
      sourceType: 'order',
      catalogItemId: data.catalogItemId,
      billingUnitPrice: data.billingUnitPrice,
      currency: 'EUR',
      source: {
        documentLabel: source.documentLabel,
      },
      active: data.active,
      revision: data.revision,
    };

    if (typeof source.supplier === 'string') rate.source.supplier = source.supplier;
    if (typeof source.documentDate === 'string') rate.source.documentDate = source.documentDate;
    if (typeof source.totalQuantity === 'number') rate.source.totalQuantity = source.totalQuantity;
    if (typeof source.totalAmount === 'number') rate.source.totalAmount = source.totalAmount;
    if (typeof source.calculatedPurchaseUnitPrice === 'number') {
      rate.source.calculatedPurchaseUnitPrice = source.calculatedPurchaseUnitPrice;
    }
    if (typeof data.notes === 'string') rate.notes = data.notes;

    return [rate];
  });
}

export function draftFromRate(
  catalogItemId: string,
  rate?: BillingCommercialRate,
): CommercialRateDraft {
  return {
    catalogItemId,
    billingUnitPrice: rate ? String(rate.billingUnitPrice) : '',
    documentLabel: rate?.source.documentLabel ?? '',
    supplier: rate?.source.supplier ?? '',
    documentDate: rate?.source.documentDate ?? '',
    totalQuantity:
      rate?.source.totalQuantity !== undefined
        ? String(rate.source.totalQuantity)
        : '',
    totalAmount:
      rate?.source.totalAmount !== undefined
        ? String(rate.source.totalAmount)
        : '',
    notes: rate?.notes ?? '',
    revision: rate?.revision ?? 0,
  };
}

export async function saveCommercialRate({
  seasonId,
  draft,
}: {
  seasonId: string;
  draft: CommercialRateDraft;
}) {
  if (!auth.currentUser) throw new Error('LOGIN_REQUIRED');

  const billingUnitPrice = finiteNonNegative(draft.billingUnitPrice);
  if (billingUnitPrice === undefined) throw new Error('INVALID_RATE');
  const documentLabel = draft.documentLabel.trim();
  if (!documentLabel) throw new Error('SOURCE_REQUIRED');

  const totalQuantity = finiteNonNegative(draft.totalQuantity);
  const totalAmount = finiteNonNegative(draft.totalAmount);
  if (
    draft.totalQuantity.trim() &&
    (totalQuantity === undefined || totalQuantity === 0)
  ) {
    throw new Error('INVALID_SOURCE_TOTAL');
  }
  if (draft.totalAmount.trim() && totalAmount === undefined) {
    throw new Error('INVALID_SOURCE_TOTAL');
  }

  const id = `${seasonId}__order__${draft.catalogItemId}`;
  const ref = doc(db, 'billingRateConfigs', id);

  return runTransaction(db, async (transaction) => {
    const existing = await transaction.get(ref);
    const existingRevision = existing.exists()
      ? Number(existing.data().revision ?? 0)
      : 0;

    if (existingRevision !== draft.revision) {
      throw new Error('CONFLICT_RELOAD');
    }

    const source: Record<string, unknown> = { documentLabel };
    if (draft.supplier.trim()) source.supplier = draft.supplier.trim();
    if (draft.documentDate) source.documentDate = draft.documentDate;
    if (totalQuantity !== undefined) source.totalQuantity = totalQuantity;
    if (totalAmount !== undefined) source.totalAmount = totalAmount;
    if (
      totalQuantity !== undefined &&
      totalQuantity > 0 &&
      totalAmount !== undefined
    ) {
      source.calculatedPurchaseUnitPrice =
        Math.round((totalAmount / totalQuantity) * 1000000) / 1000000;
    }

    const nextRevision = existingRevision + 1;
    transaction.set(ref, {
      id,
      seasonId,
      sourceType: 'order',
      catalogItemId: draft.catalogItemId,
      billingUnitPrice,
      currency: 'EUR',
      source,
      active: true,
      revision: nextRevision,
      notes: draft.notes.trim(),
      updatedBy: auth.currentUser!.uid,
      updatedAt: serverTimestamp(),
    });

    return nextRevision;
  });
}

export function commercialRateMessage(
  error: unknown,
  language: 'de' | 'it',
) {
  const code = error instanceof Error ? error.message : String(error);
  const messages: Record<string, [string, string]> = {
    LOGIN_REQUIRED: ['Bitte erneut anmelden.', 'Accedi nuovamente.'],
    INVALID_RATE: [
      'Gültigen, nicht negativen Abrechnungspreis eingeben.',
      'Inserisci un prezzo di fatturazione valido e non negativo.',
    ],
    SOURCE_REQUIRED: [
      'Quelldokument / Angebot ist für jeden Preis verpflichtend.',
      'Il documento fonte / offerta è obbligatorio per ogni prezzo.',
    ],
    INVALID_SOURCE_TOTAL: [
      'Menge und Gesamtbetrag der Quelle prüfen.',
      'Controlla quantità e importo totale della fonte.',
    ],
    CONFLICT_RELOAD: [
      'Der Preis wurde inzwischen geändert. Bitte neu laden.',
      'La tariffa è stata modificata nel frattempo. Ricarica.',
    ],
  };
  return (
    messages[code]?.[language === 'de' ? 0 : 1] ??
    (language === 'de'
      ? 'Tarif konnte nicht gespeichert werden.'
      : 'Impossibile salvare la tariffa.')
  );
}
