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

export interface SeasonalExtraDraft {
  id: string;
  organizationId: string;
  reportingAreaId: string;
  description: string;
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

    const extra: BillingSeasonalExtra = {
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
    return [extra];
  });
}

export function newSeasonalExtraDraft(): SeasonalExtraDraft {
  return {
    id: '',
    organizationId: '',
    reportingAreaId: '',
    description: '',
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
  extra: BillingSeasonalExtra,
): SeasonalExtraDraft {
  return {
    id: extra.id,
    organizationId: extra.organizationId,
    reportingAreaId: extra.reportingAreaId,
    description: extra.description,
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

    const payload = {
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
