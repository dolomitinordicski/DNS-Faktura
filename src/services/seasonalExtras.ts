import type { BillingSeasonalExtra } from '@dolomitinordicski/dns-shared-data';
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

export type BillingUnitType = 'piece' | 'hour' | 'flat' | 'km' | 'other';

export type FlexibleBillingExtra = BillingSeasonalExtra & {
  chargeCategory?: string;
  billingUnit?: BillingUnitType;
  billingUnitLabel?: string;
  relatedCatalogItemId?: string;
};

export interface SeasonalExtraDraft {
  id: string;
  organizationId: string;
  reportingAreaId: string;
  description: string;
  chargeCategory: string;
  relatedCatalogItemId: string;
  billingUnit: BillingUnitType;
  billingUnitLabel: string;
  quantity: string;
  unitAmount: string;
  documentLabel: string;
  supplier: string;
  documentDate: string;
  notes: string;
  active: boolean;
  revision: number;
}

function finiteNonNegative(value: string) {
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export async function loadSeasonalExtras(
  seasonId: string,
): Promise<BillingSeasonalExtra[]> {
  const snapshot = await getDocs(
    query(
      collection(db, 'billingSeasonalExtras'),
      where('seasonId', '==', seasonId),
    ),
  );

  return snapshot.docs.flatMap((item) => {
    const data = item.data() as Record<string, unknown>;
    if (
      data.sourceType !== 'seasonal-extra' ||
      typeof data.seasonId !== 'string' ||
      typeof data.organizationId !== 'string' ||
      typeof data.reportingAreaId !== 'string' ||
      typeof data.description !== 'string' ||
      typeof data.quantity !== 'number' ||
      typeof data.unitAmount !== 'number' ||
      typeof data.amount !== 'number' ||
      data.currency !== 'EUR' ||
      typeof data.active !== 'boolean' ||
      typeof data.revision !== 'number' ||
      !data.source ||
      typeof data.source !== 'object' ||
      Array.isArray(data.source)
    ) {
      return [];
    }

    const source = data.source as Record<string, unknown>;
    if (typeof source.documentLabel !== 'string') return [];

    const extra: FlexibleBillingExtra = {
      id: item.id,
      seasonId: data.seasonId as BillingSeasonalExtra['seasonId'],
      sourceType: 'seasonal-extra',
      organizationId: data.organizationId as BillingSeasonalExtra['organizationId'],
      reportingAreaId: data.reportingAreaId as BillingSeasonalExtra['reportingAreaId'],
      description: data.description,
      quantity: data.quantity,
      unitAmount: data.unitAmount,
      amount: data.amount,
      currency: 'EUR',
      source: { documentLabel: source.documentLabel },
      active: data.active,
      revision: data.revision,
    };

    if (typeof source.supplier === 'string') extra.source.supplier = source.supplier;
    if (typeof source.documentDate === 'string') extra.source.documentDate = source.documentDate;
    if (typeof data.notes === 'string') extra.notes = data.notes;
    if (typeof data.chargeCategory === 'string') extra.chargeCategory = data.chargeCategory;
    if (
      data.billingUnit === 'piece' ||
      data.billingUnit === 'hour' ||
      data.billingUnit === 'flat' ||
      data.billingUnit === 'km' ||
      data.billingUnit === 'other'
    ) {
      extra.billingUnit = data.billingUnit;
    }
    if (typeof data.billingUnitLabel === 'string') extra.billingUnitLabel = data.billingUnitLabel;
    if (typeof data.relatedCatalogItemId === 'string') {
      extra.relatedCatalogItemId = data.relatedCatalogItemId;
    }

    return [extra];
  });
}

export function newSeasonalExtraDraft(): SeasonalExtraDraft {
  return {
    id: '',
    organizationId: '',
    reportingAreaId: '',
    description: '',
    chargeCategory: '',
    relatedCatalogItemId: '',
    billingUnit: 'piece',
    billingUnitLabel: '',
    quantity: '1',
    unitAmount: '',
    documentLabel: '',
    supplier: '',
    documentDate: '',
    notes: '',
    active: true,
    revision: 0,
  };
}

export function draftFromSeasonalExtra(
  rawExtra: BillingSeasonalExtra,
): SeasonalExtraDraft {
  const extra = rawExtra as FlexibleBillingExtra;
  return {
    id: extra.id,
    organizationId: extra.organizationId,
    reportingAreaId: extra.reportingAreaId,
    description: extra.description,
    chargeCategory: extra.chargeCategory ?? '',
    relatedCatalogItemId: extra.relatedCatalogItemId ?? '',
    billingUnit: extra.billingUnit ?? 'piece',
    billingUnitLabel: extra.billingUnitLabel ?? '',
    quantity: String(extra.quantity),
    unitAmount: String(extra.unitAmount),
    documentLabel: extra.source.documentLabel,
    supplier: extra.source.supplier ?? '',
    documentDate: extra.source.documentDate ?? '',
    notes: extra.notes ?? '',
    active: extra.active,
    revision: extra.revision,
  };
}

export async function saveSeasonalExtra({
  seasonId,
  draft,
}: {
  seasonId: string;
  draft: SeasonalExtraDraft;
}) {
  if (!auth.currentUser) throw new Error('LOGIN_REQUIRED');
  if (!draft.organizationId || !draft.reportingAreaId) throw new Error('ORGANIZATION_REQUIRED');
  if (!draft.description.trim()) throw new Error('DESCRIPTION_REQUIRED');
  if (!draft.documentLabel.trim()) throw new Error('SOURCE_REQUIRED');

  const quantity = finiteNonNegative(draft.quantity);
  const unitAmount = finiteNonNegative(draft.unitAmount);
  if (quantity === undefined || unitAmount === undefined) {
    throw new Error('INVALID_AMOUNT');
  }
  if (draft.billingUnit === 'flat' && quantity !== 1) {
    throw new Error('FLAT_QUANTITY');
  }
  if (draft.billingUnit === 'other' && !draft.billingUnitLabel.trim()) {
    throw new Error('UNIT_LABEL_REQUIRED');
  }

  const ref = draft.id
    ? doc(db, 'billingSeasonalExtras', draft.id)
    : doc(collection(db, 'billingSeasonalExtras'));

  return runTransaction(db, async (transaction) => {
    const existing = draft.id ? await transaction.get(ref) : null;
    const existingRevision =
      existing?.exists() && typeof existing.data().revision === 'number'
        ? Number(existing.data().revision)
        : 0;

    if (existingRevision !== draft.revision) {
      throw new Error('CONFLICT_RELOAD');
    }

    const revision = existingRevision + 1;
    const source: Record<string, string> = {
      documentLabel: draft.documentLabel.trim(),
    };
    if (draft.supplier.trim()) source.supplier = draft.supplier.trim();
    if (draft.documentDate) source.documentDate = draft.documentDate;

    const payload: Record<string, unknown> = {
      id: ref.id,
      seasonId,
      sourceType: 'seasonal-extra',
      organizationId: draft.organizationId,
      reportingAreaId: draft.reportingAreaId,
      description: draft.description.trim(),
      quantity,
      unitAmount,
      amount: roundMoney(quantity * unitAmount),
      currency: 'EUR',
      source,
      active: draft.active,
      revision,
      notes: draft.notes.trim(),
      billingUnit: draft.billingUnit,
      billingUnitLabel:
        draft.billingUnit === 'other' ? draft.billingUnitLabel.trim() : '',
      chargeCategory: draft.chargeCategory.trim(),
      relatedCatalogItemId: draft.relatedCatalogItemId,
      updatedBy: auth.currentUser!.uid,
      updatedAt: serverTimestamp(),
    };

    transaction.set(ref, payload);
    return { id: ref.id, revision };
  });
}

export function seasonalExtrasTotal(extras: BillingSeasonalExtra[]) {
  return roundMoney(
    extras
      .filter((extra) => extra.active)
      .reduce((sum, extra) => sum + extra.amount, 0),
  );
}

export function seasonalExtraMessage(
  error: unknown,
  language: 'de' | 'it',
) {
  const code = error instanceof Error ? error.message : String(error);
  const messages: Record<string, [string, string]> = {
    LOGIN_REQUIRED: ['Bitte erneut anmelden.', 'Accedi nuovamente.'],
    ORGANIZATION_REQUIRED: [
      'Organisation auswählen.',
      'Seleziona un’organizzazione.',
    ],
    DESCRIPTION_REQUIRED: [
      'Beschreibung eingeben.',
      'Inserisci una descrizione.',
    ],
    SOURCE_REQUIRED: [
      'Quelldokument / Angebot ist verpflichtend.',
      'Il documento fonte / offerta è obbligatorio.',
    ],
    INVALID_AMOUNT: [
      'Menge und Einzelbetrag prüfen.',
      'Controlla quantità e importo unitario.',
    ],
    FLAT_QUANTITY: [
      'Bei Pauschale muss die Menge 1 sein.',
      'Per un forfait la quantità deve essere 1.',
    ],
    UNIT_LABEL_REQUIRED: [
      'Für eine freie Einheit eine Bezeichnung eingeben.',
      'Inserisci un nome per l’unità personalizzata.',
    ],
    CONFLICT_RELOAD: [
      'Die Position wurde inzwischen geändert. Bitte neu laden.',
      'La voce è stata modificata nel frattempo. Ricarica.',
    ],
  };
  return (
    messages[code]?.[language === 'de' ? 0 : 1] ??
    (language === 'de'
      ? 'Zusatzposition konnte nicht gespeichert werden.'
      : 'Impossibile salvare la voce extra.')
  );
}
