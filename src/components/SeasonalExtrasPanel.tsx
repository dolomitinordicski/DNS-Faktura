import { useMemo, useState } from 'react';
import type { BillingSeasonalExtra } from '@dolomitinordicski/dns-shared-data';
import { RegionLogos } from './RegionLogos';
import {
  draftFromSeasonalExtra,
  newSeasonalExtraDraft,
  saveSeasonalExtra,
  seasonalExtraMessage,
  type SeasonalExtraDraft,
} from '../services/seasonalExtras';
import type { Language, OrganizationBillingRow } from '../types';

const copy = {
  de: {
    kicker: 'F.4 · Seasonal Extras',
    title: 'Saisonale Zusatzpositionen',
    intro:
      'Kontrollierte DNS-Commercial-Positionen außerhalb von FAIR, IDM und Orders. Jede Position benötigt ein Quelldokument.',
    newItem: 'Neue Position',
    edit: 'Bearbeiten',
    organization: 'Organisation',
    description: 'Beschreibung',
    quantity: 'Menge',
    unitAmount: 'Einzelbetrag €',
    amount: 'Betrag',
    supplier: 'Lieferant',
    source: 'Quelle / Angebot',
    date: 'Datum',
    notes: 'Notiz',
    status: 'Status',
    active: 'Aktiv',
    inactive: 'Inaktiv',
    save: 'Speichern',
    saving: 'Speichern…',
    cancel: 'Zurücksetzen',
    noItems: 'Noch keine saisonalen Zusatzpositionen.',
    revision: 'Rev.',
  },
  it: {
    kicker: 'F.4 · Seasonal Extras',
    title: 'Voci extra stagionali',
    intro:
      'Voci DNS Commercial controllate, esterne a FAIR, IDM e Orders. Ogni voce richiede un documento fonte.',
    newItem: 'Nuova voce',
    edit: 'Modifica',
    organization: 'Organizzazione',
    description: 'Descrizione',
    quantity: 'Quantità',
    unitAmount: 'Importo unitario €',
    amount: 'Importo',
    supplier: 'Fornitore',
    source: 'Fonte / offerta',
    date: 'Data',
    notes: 'Nota',
    status: 'Stato',
    active: 'Attiva',
    inactive: 'Inattiva',
    save: 'Salva',
    saving: 'Salvataggio…',
    cancel: 'Azzera',
    noItems: 'Nessuna voce extra stagionale.',
    revision: 'Rev.',
  },
} as const;

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

export function SeasonalExtrasPanel({
  language,
  seasonId,
  organizations,
  extras,
  onChanged,
}: {
  language: Language;
  seasonId: string;
  organizations: OrganizationBillingRow[];
  extras: BillingSeasonalExtra[];
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
        <table className="dns-table min-w-[1040px]">
          <thead>
            <tr>
              <th>{t.organization}</th>
              <th>{t.description}</th>
              <th className="num">{t.quantity}</th>
              <th className="num">{t.unitAmount}</th>
              <th className="num">{t.amount}</th>
              <th>{t.source}</th>
              <th>{t.status}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {extras.length ? (
              extras.map((extra) => {
                const organization = organizationById.get(extra.organizationId);
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
                    <td>{extra.description}</td>
                    <td className="num">{extra.quantity}</td>
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
                <td colSpan={8} className="font-alt text-dns-muted">
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
            <span className="dns-kicker">{t.description}</span>
            <input
              value={draft.description}
              onChange={(event) => patch({ description: event.target.value })}
              className="dns-input mt-2 w-full text-left"
            />
          </label>

          <label className="block">
            <span className="dns-kicker">{t.quantity}</span>
            <input
              inputMode="decimal"
              value={draft.quantity}
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
