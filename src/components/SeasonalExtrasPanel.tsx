import { useMemo, useState } from 'react';
import type { BillingSeasonalExtra } from '@dolomitinordicski/dns-shared-data';
import { RegionLogos } from './RegionLogos';
import {
  draftFromSeasonalExtra,
  newSeasonalExtraDraft,
  saveSeasonalExtra,
  seasonalExtraMessage,
  type BillingUnitType,
  type FlexibleBillingExtra,
  type SeasonalExtraDraft,
} from '../services/seasonalExtras';
import type { Language, OrganizationBillingRow } from '../types';

const copy = {
  de: {
    kicker: 'F.6.1 · Quellen / Leistungen',
    title: 'Flexible Faktura-Positionen',
    intro:
      'Frei definierbare Leistungen und Zusatzkosten pro Organisation: Stück, Stunden, Pauschalen, Kilometer oder eigene Einheiten. Optional kann eine Position einem bestehenden Artikel wie einem Pocketfolder zugeordnet werden.',
    newItem: 'Neue Position',
    edit: 'Bearbeiten',
    organization: 'Organisation',
    category: 'Kategorie',
    description: 'Beschreibung',
    linkedItem: 'Zugeordneter Artikel',
    noLinkedItem: 'Kein Artikel',
    unit: 'Einheit',
    customUnit: 'Eigene Einheit',
    quantity: 'Menge',
    unitAmount: 'Preis / Einheit €',
    amount: 'Betrag',
    supplier: 'Lieferant',
    source: 'Quelle / Angebot',
    date: 'Datum',
    notes: 'Notiz',
    status: 'Status',
    active: 'Aktiv',
    inactive: 'Inaktiv',
    save: 'In Firebase speichern',
    saving: 'Speichern…',
    cancel: 'Zurücksetzen',
    noItems: 'Noch keine flexiblen Faktura-Positionen.',
    revision: 'Rev.',
    piece: 'Stück',
    hour: 'Stunden',
    flat: 'Pauschale',
    km: 'Kilometer',
    other: 'Andere',
    examples: 'z. B. Grafik, Kartografie, Druck, Korrekturen',
  },
  it: {
    kicker: 'F.6.1 · Fonti / Prestazioni',
    title: 'Voci di fatturazione flessibili',
    intro:
      'Prestazioni e costi aggiuntivi liberamente definibili per organizzazione: pezzi, ore, forfait, chilometri o unità personalizzate. Ogni voce può essere collegata facoltativamente a un articolo esistente, per esempio un Pocketfolder.',
    newItem: 'Nuova voce',
    edit: 'Modifica',
    organization: 'Organizzazione',
    category: 'Categoria',
    description: 'Descrizione',
    linkedItem: 'Articolo collegato',
    noLinkedItem: 'Nessun articolo',
    unit: 'Unità',
    customUnit: 'Unità personalizzata',
    quantity: 'Quantità',
    unitAmount: 'Prezzo / unità €',
    amount: 'Importo',
    supplier: 'Fornitore',
    source: 'Fonte / offerta',
    date: 'Data',
    notes: 'Nota',
    status: 'Stato',
    active: 'Attiva',
    inactive: 'Inattiva',
    save: 'Salva in Firebase',
    saving: 'Salvataggio…',
    cancel: 'Azzera',
    noItems: 'Nessuna voce di fatturazione flessibile.',
    revision: 'Rev.',
    piece: 'Pezzi',
    hour: 'Ore',
    flat: 'Forfait',
    km: 'Chilometri',
    other: 'Altro',
    examples: 'es. grafica, cartografia, stampa, correzioni',
  },
} as const;

type CatalogItem = {
  id: string;
  code: string;
  category: string;
  label?: Partial<Record<Language, string>>;
};

function formatMoney(value: number, language: Language) {
  return new Intl.NumberFormat(language === 'de' ? 'de-DE' : 'it-IT', {
    style: 'currency',
    currency: 'EUR',
  }).format(value);
}

function draftAmount(draft: SeasonalExtraDraft) {
  const quantity = Number(draft.quantity.replace(',', '.'));
  const unitAmount = Number(draft.unitAmount.replace(',', '.'));
  if (!Number.isFinite(quantity) || !Number.isFinite(unitAmount)) return 0;
  return Math.round((quantity * unitAmount + Number.EPSILON) * 100) / 100;
}

function unitLabel(extra: FlexibleBillingExtra, language: Language) {
  const unit = extra.billingUnit ?? 'piece';
  if (unit === 'other' && extra.billingUnitLabel) return extra.billingUnitLabel;
  const labels = {
    de: { piece: 'Stk.', hour: 'Std.', flat: 'Pausch.', km: 'km', other: 'Einheit' },
    it: { piece: 'pz.', hour: 'h', flat: 'forfait', km: 'km', other: 'unità' },
  } as const;
  return labels[language][unit];
}

function itemLabel(item: CatalogItem, language: Language) {
  return item.label?.[language] ?? item.label?.de ?? item.label?.it ?? item.code;
}

export function SeasonalExtrasPanel({
  language,
  seasonId,
  organizations,
  extras,
  catalogItems,
  onChanged,
}: {
  language: Language;
  seasonId: string;
  organizations: OrganizationBillingRow[];
  extras: BillingSeasonalExtra[];
  catalogItems: CatalogItem[];
  onChanged: () => Promise<void> | void;
}) {
  const t = copy[language];
  const [draft, setDraft] = useState<SeasonalExtraDraft>(newSeasonalExtraDraft());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const organizationById = useMemo(
    () => new Map(organizations.map((organization) => [organization.organizationId, organization])),
    [organizations],
  );

  const catalogById = useMemo(
    () => new Map(catalogItems.map((item) => [item.id, item])),
    [catalogItems],
  );

  function patch(values: Partial<SeasonalExtraDraft>) {
    setDraft((current) => ({ ...current, ...values }));
    setError('');
  }

  function chooseOrganization(organizationId: string) {
    const organization = organizationById.get(organizationId);
    patch({
      organizationId,
      reportingAreaId: organization?.reportingAreaId ?? '',
    });
  }

  function chooseUnit(billingUnit: BillingUnitType) {
    patch({
      billingUnit,
      quantity: billingUnit === 'flat' ? '1' : draft.quantity,
      billingUnitLabel: billingUnit === 'other' ? draft.billingUnitLabel : '',
    });
  }

  function reset() {
    setDraft(newSeasonalExtraDraft());
    setError('');
  }

  function edit(extra: BillingSeasonalExtra) {
    setDraft(draftFromSeasonalExtra(extra));
    setError('');
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      await saveSeasonalExtra({ seasonId, draft });
      reset();
      await onChanged();
    } catch (reason) {
      setError(seasonalExtraMessage(reason, language));
    } finally {
      setSaving(false);
    }
  }

  const lockedOrganization = draft.revision > 0;

  return (
    <section className="dns-card overflow-hidden">
      <div className="border-b border-dns-mid/10 px-5 py-4">
        <div className="dns-kicker">{t.kicker}</div>
        <h3 className="dns-heading mt-1">{t.title}</h3>
        <p className="mt-2 max-w-4xl font-alt text-[11px] leading-relaxed text-dns-muted">
          {t.intro}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="dns-table min-w-[1280px]">
          <thead>
            <tr>
              <th>{t.organization}</th>
              <th>{t.category}</th>
              <th>{t.description}</th>
              <th>{t.linkedItem}</th>
              <th className="num">{t.quantity}</th>
              <th>{t.unit}</th>
              <th className="num">{t.unitAmount}</th>
              <th className="num">{t.amount}</th>
              <th>{t.source}</th>
              <th>{t.status}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {extras.length ? (
              extras.map((rawExtra) => {
                const extra = rawExtra as FlexibleBillingExtra;
                const organization = organizationById.get(extra.organizationId);
                const linkedItem = extra.relatedCatalogItemId
                  ? catalogById.get(extra.relatedCatalogItemId)
                  : undefined;
                return (
                  <tr key={extra.id}>
                    <td>
                      <div className="dns-entity-label">
                        <RegionLogos
                          entityType="organization"
                          entityId={extra.organizationId}
                        />
                        <span>{organization?.organizationName ?? extra.organizationId}</span>
                      </div>
                    </td>
                    <td>{extra.chargeCategory || '—'}</td>
                    <td>{extra.description}</td>
                    <td>
                      {linkedItem ? (
                        <div>
                          <div className="font-semibold text-dns-deep">
                            {itemLabel(linkedItem, language)}
                          </div>
                          <div className="font-alt text-[9px] text-dns-muted">
                            {linkedItem.category} · {linkedItem.code}
                          </div>
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="num">{extra.quantity}</td>
                    <td>{unitLabel(extra, language)}</td>
                    <td className="num">{formatMoney(extra.unitAmount, language)}</td>
                    <td className="num font-semibold">{formatMoney(extra.amount, language)}</td>
                    <td>
                      <div>{extra.source.documentLabel}</div>
                      {extra.source.supplier && (
                        <div className="mt-0.5 font-alt text-[9px] text-dns-muted">
                          {extra.source.supplier}
                        </div>
                      )}
                    </td>
                    <td>
                      <span
                        className={[
                          'dns-status',
                          extra.active ? 'is-connected' : 'is-defined',
                        ].join(' ')}
                      >
                        {extra.active ? t.active : t.inactive} · {t.revision} {extra.revision}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => edit(extra)}
                        className="dns-btn-secondary"
                        data-dns-press
                      >
                        {t.edit}
                      </button>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={11} className="font-alt text-dns-muted">
                  {t.noItems}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="border-t border-dns-mid/10 bg-dns-bg/55 p-5">
        <div className="dns-kicker">
          {draft.id ? `${t.edit} · ${t.revision} ${draft.revision}` : t.newItem}
        </div>

        {error && (
          <div className="dns-alert mt-3" data-variant="error" role="alert">
            <div className="dns-alert-body">{error}</div>
          </div>
        )}

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="block">
            <span className="dns-kicker">{t.organization}</span>
            <select
              value={draft.organizationId}
              disabled={lockedOrganization}
              onChange={(event) => chooseOrganization(event.target.value)}
              className="dns-input mt-2 w-full text-left"
            >
              <option value="">—</option>
              {organizations.map((organization) => (
                <option key={organization.organizationId} value={organization.organizationId}>
                  {organization.organizationName}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="dns-kicker">{t.category}</span>
            <input
              value={draft.chargeCategory}
              onChange={(event) => patch({ chargeCategory: event.target.value })}
              placeholder={t.examples}
              className="dns-input mt-2 w-full text-left"
            />
          </label>

          <label className="block">
            <span className="dns-kicker">{t.description}</span>
            <input
              value={draft.description}
              onChange={(event) => patch({ description: event.target.value })}
              className="dns-input mt-2 w-full text-left"
            />
          </label>

          <label className="block">
            <span className="dns-kicker">{t.linkedItem}</span>
            <select
              value={draft.relatedCatalogItemId}
              onChange={(event) => patch({ relatedCatalogItemId: event.target.value })}
              className="dns-input mt-2 w-full text-left"
            >
              <option value="">{t.noLinkedItem}</option>
              {catalogItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {itemLabel(item, language)} · {item.category}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="dns-kicker">{t.unit}</span>
            <select
              value={draft.billingUnit}
              onChange={(event) => chooseUnit(event.target.value as BillingUnitType)}
              className="dns-input mt-2 w-full text-left"
            >
              <option value="piece">{t.piece}</option>
              <option value="hour">{t.hour}</option>
              <option value="flat">{t.flat}</option>
              <option value="km">{t.km}</option>
              <option value="other">{t.other}</option>
            </select>
          </label>

          {draft.billingUnit === 'other' && (
            <label className="block">
              <span className="dns-kicker">{t.customUnit}</span>
              <input
                value={draft.billingUnitLabel}
                onChange={(event) => patch({ billingUnitLabel: event.target.value })}
                className="dns-input mt-2 w-full text-left"
              />
            </label>
          )}

          <label className="block">
            <span className="dns-kicker">{t.quantity}</span>
            <input
              inputMode="decimal"
              value={draft.quantity}
              disabled={draft.billingUnit === 'flat'}
              onChange={(event) => patch({ quantity: event.target.value })}
              className="dns-input mt-2 w-full text-left"
            />
          </label>

          <label className="block">
            <span className="dns-kicker">{t.unitAmount}</span>
            <input
              inputMode="decimal"
              value={draft.unitAmount}
              onChange={(event) => patch({ unitAmount: event.target.value })}
              className="dns-input mt-2 w-full text-left"
            />
            <span className="mt-1 block font-alt text-[9px] text-dns-muted">
              {t.amount}: {formatMoney(draftAmount(draft), language)}
            </span>
          </label>

          <label className="block">
            <span className="dns-kicker">{t.source}</span>
            <input
              value={draft.documentLabel}
              onChange={(event) => patch({ documentLabel: event.target.value })}
              className="dns-input mt-2 w-full text-left"
            />
          </label>

          <label className="block">
            <span className="dns-kicker">{t.supplier}</span>
            <input
              value={draft.supplier}
              onChange={(event) => patch({ supplier: event.target.value })}
              className="dns-input mt-2 w-full text-left"
            />
          </label>

          <label className="block">
            <span className="dns-kicker">{t.date}</span>
            <input
              type="date"
              value={draft.documentDate}
              onChange={(event) => patch({ documentDate: event.target.value })}
              className="dns-input mt-2 w-full text-left"
            />
          </label>

          <label className="block">
            <span className="dns-kicker">{t.notes}</span>
            <input
              value={draft.notes}
              onChange={(event) => patch({ notes: event.target.value })}
              className="dns-input mt-2 w-full text-left"
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => patch({ active: !draft.active })}
            className="dns-btn-secondary"
            data-dns-press
          >
            {draft.active ? t.active : t.inactive}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="dns-primary-button"
            data-dns-press
          >
            {saving ? t.saving : t.save}
          </button>
          <button
            type="button"
            onClick={reset}
            className="dns-btn-secondary"
            data-dns-press
          >
            {t.cancel}
          </button>
        </div>
      </div>
    </section>
  );
}
