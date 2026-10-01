import { useEffect, useMemo, useState } from 'react';
import { RegionLogos } from './RegionLogos';
import {
  billingRunMessage,
  loadBillingRuns,
  saveOrderBillingRun,
  type BillingRunRecord,
  type BillingRunStatus,
} from '../services/billingRuns';
import type { OrderBillingSnapshot } from '../services/orderBilling';
import type { Language, OrganizationBillingRow } from '../types';

const copy = {
  de: {
    kicker: 'F.2.3 · Billing Runs',
    title: 'Abrechnungssnapshots',
    intro:
      'Speichert eine revisionierte Momentaufnahme der aktuellen Order-Berechnung. LIVE bleibt die Berechnung aus DNS_Core; ein Snapshot ändert sich erst durch bewusstes erneutes Speichern.',
    organization: 'Organisation',
    area: 'Gebiet',
    quantity: 'Menge',
    liveAmount: 'Live-Betrag',
    unpriced: 'Ohne Tarif',
    saved: 'Gespeichert',
    savedAmount: 'Snapshot',
    draft: 'Entwurf speichern',
    ready: 'READY setzen',
    loading: 'Snapshots werden geladen…',
    reload: 'Neu laden',
    revision: 'Rev.',
    noSnapshot: 'Noch nicht gespeichert',
    locked: 'READY · gesperrt',
  },
  it: {
    kicker: 'F.2.3 · Billing Runs',
    title: 'Snapshot di fatturazione',
    intro:
      'Salva una fotografia revisionata del calcolo Orders corrente. Il valore LIVE continua a provenire da DNS_Core; lo snapshot cambia solo con un salvataggio esplicito.',
    organization: 'Organizzazione',
    area: 'Area',
    quantity: 'Quantità',
    liveAmount: 'Importo live',
    unpriced: 'Senza tariffa',
    saved: 'Salvato',
    savedAmount: 'Snapshot',
    draft: 'Salva bozza',
    ready: 'Imposta READY',
    loading: 'Caricamento snapshot…',
    reload: 'Ricarica',
    revision: 'Rev.',
    noSnapshot: 'Non ancora salvato',
    locked: 'READY · bloccato',
  },
} as const;

function formatNumber(value: number, language: Language) {
  return new Intl.NumberFormat(language === 'de' ? 'de-DE' : 'it-IT').format(value);
}

function formatCurrency(value: number, language: Language) {
  return new Intl.NumberFormat(language === 'de' ? 'de-DE' : 'it-IT', {
    style: 'currency',
    currency: 'EUR',
  }).format(value);
}

export function BillingRunsPanel({
  language,
  seasonId,
  organizations,
  orderBilling,
}: {
  language: Language;
  seasonId: string;
  organizations: OrganizationBillingRow[];
  orderBilling: OrderBillingSnapshot;
}) {
  const t = copy[language];
  const [runs, setRuns] = useState<BillingRunRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState('');
  const [error, setError] = useState('');

  async function reload() {
    setLoading(true);
    setError('');
    try {
      setRuns(await loadBillingRuns(seasonId));
    } catch (reason) {
      setError(billingRunMessage(reason, language));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [seasonId]);

  const runByOrganization = useMemo(
    () => new Map(runs.map((run) => [run.organizationId, run])),
    [runs],
  );

  const rows = organizations.filter((organization) => {
    const live = orderBilling.byOrganization[organization.organizationId];
    return Boolean(live?.activeQuantity || runByOrganization.has(organization.organizationId));
  });

  async function save(
    organization: OrganizationBillingRow,
    status: BillingRunStatus,
  ) {
    const billing = orderBilling.byOrganization[organization.organizationId];
    if (!billing || !organization.reportingAreaId) return;

    setSavingId(organization.organizationId);
    setError('');
    try {
      const saved = await saveOrderBillingRun({
        seasonId,
        organizationId: organization.organizationId,
        reportingAreaId: organization.reportingAreaId,
        billing,
        status,
      });
      setRuns((current) => [
        ...current.filter((run) => run.organizationId !== saved.organizationId),
        saved,
      ]);
    } catch (reason) {
      setError(billingRunMessage(reason, language));
    } finally {
      setSavingId('');
    }
  }

  return (
    <section className="dns-card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-dns-mid/10 px-5 py-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="dns-kicker">{t.kicker}</div>
          <h3 className="dns-heading mt-1">{t.title}</h3>
          <p className="mt-2 max-w-4xl font-alt text-[11px] leading-relaxed text-dns-muted">
            {t.intro}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void reload()}
          className="dns-btn-secondary"
          data-dns-press
        >
          {t.reload}
        </button>
      </div>

      {error && (
        <div className="border-b border-red-200 bg-red-50 px-5 py-3 font-alt text-[11px] text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="p-5 font-alt text-[11px] text-dns-muted">{t.loading}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="dns-table min-w-[1180px]">
            <thead>
              <tr>
                <th>{t.organization}</th>
                <th>{t.area}</th>
                <th className="num">{t.quantity}</th>
                <th className="num">{t.liveAmount}</th>
                <th className="num">{t.unpriced}</th>
                <th>{t.saved}</th>
                <th className="num">{t.savedAmount}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((organization) => {
                const live = orderBilling.byOrganization[organization.organizationId];
                const saved = runByOrganization.get(organization.organizationId);
                const locked = saved?.status === 'ready';
                const busy = savingId === organization.organizationId;
                const canReady = Boolean(
                  live &&
                    live.activeQuantity > 0 &&
                    live.unpricedQuantity === 0 &&
                    !locked,
                );

                return (
                  <tr key={organization.organizationId}>
                    <td>
                      <div className="dns-entity-label">
                        <RegionLogos
                          entityType="organization"
                          entityId={organization.organizationId}
                        />
                        <span>{organization.organizationName}</span>
                      </div>
                    </td>
                    <td>{organization.reportingAreaName ?? '—'}</td>
                    <td className="num">
                      {formatNumber(live?.activeQuantity ?? 0, language)}
                    </td>
                    <td className="num font-semibold">
                      {formatCurrency(live?.amount ?? 0, language)}
                    </td>
                    <td className="num">
                      {formatNumber(live?.unpricedQuantity ?? 0, language)}
                    </td>
                    <td>
                      {saved ? (
                        <span
                          className={[
                            'dns-status',
                            saved.status === 'ready' ? 'is-connected' : 'is-draft',
                          ].join(' ')}
                        >
                          {saved.status.toUpperCase()} · {t.revision} {saved.revision}
                        </span>
                      ) : (
                        <span className="font-alt text-[10px] text-dns-muted">
                          {t.noSnapshot}
                        </span>
                      )}
                    </td>
                    <td className="num">
                      {saved ? formatCurrency(saved.totalAmount, language) : '—'}
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-2">
                        {locked ? (
                          <span className="font-alt text-[10px] font-semibold uppercase tracking-[.05em] text-dns-muted">
                            {t.locked}
                          </span>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => void save(organization, 'draft')}
                              disabled={busy || !live?.activeQuantity}
                              className="dns-btn-secondary"
                              data-dns-press
                            >
                              {t.draft}
                            </button>
                            <button
                              type="button"
                              onClick={() => void save(organization, 'ready')}
                              disabled={busy || !canReady}
                              className="dns-primary-button"
                              data-dns-press
                            >
                              {t.ready}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
