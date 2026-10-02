import { useEffect, useMemo, useState } from 'react';
import { RegionLogos } from './RegionLogos';
import type { Language, OrganizationBillingRow } from '../types';
import type { UnifiedBillingSnapshot } from '../services/unifiedBilling';
import {
  loadUnifiedBillingRuns,
  saveUnifiedBillingRun,
  unifiedBillingRunMessage,
  type UnifiedBillingRunRecord,
  type UnifiedBillingRunStatus,
} from '../services/unifiedBillingRuns';

const copy = {
  de: {
    kicker: 'F.5 · Unified Billing Snapshot',
    title: 'Vollständige Faktura-Snapshots',
    intro:
      'Kristallisiert FAIR, IDM, Orders und saisonale Extras gemeinsam. DRAFT ist jederzeit möglich; READY nur bei vollständigen Quellen und finalem FAIR.',
    organization: 'Organisation',
    fair: 'FAIR',
    idm: 'IDM',
    orders: 'Orders',
    extras: 'Extras',
    live: 'Live gesamt',
    sourceState: 'Quellen',
    saved: 'Snapshot',
    draft: 'DRAFT speichern',
    ready: 'READY setzen',
    complete: 'Vollständig',
    incomplete: 'Unvollständig',
    noSnapshot: 'Noch nicht gespeichert',
    locked: 'READY · gesperrt',
    revision: 'Rev.',
    reload: 'Neu laden',
    loading: 'Unified Snapshots werden geladen…',
  },
  it: {
    kicker: 'F.5 · Unified Billing Snapshot',
    title: 'Snapshot completi Faktura',
    intro:
      'Cristallizza insieme FAIR, IDM, Orders ed extra stagionali. DRAFT è sempre possibile; READY solo con fonti complete e FAIR definitivo.',
    organization: 'Organizzazione',
    fair: 'FAIR',
    idm: 'IDM',
    orders: 'Ordini',
    extras: 'Extra',
    live: 'Totale live',
    sourceState: 'Fonti',
    saved: 'Snapshot',
    draft: 'Salva DRAFT',
    ready: 'Imposta READY',
    complete: 'Complete',
    incomplete: 'Incomplete',
    noSnapshot: 'Non ancora salvato',
    locked: 'READY · bloccato',
    revision: 'Rev.',
    reload: 'Ricarica',
    loading: 'Caricamento snapshot unificati…',
  },
} as const;

const blockerCopy: Record<string, { de: string; it: string }> = {
  'fair-source-unavailable': {
    de: 'FAIR-Quelle nicht verfügbar',
    it: 'Fonte FAIR non disponibile',
  },
  'fair-organization-missing': {
    de: 'FAIR-Beitrag fehlt',
    it: 'Quota FAIR mancante',
  },
  'fair-not-final': {
    de: 'FAIR noch nicht final',
    it: 'FAIR non ancora definitivo',
  },
  'idm-allocation-unavailable': {
    de: 'IDM-Verteilung nicht verfügbar',
    it: 'Ripartizione IDM non disponibile',
  },
  'idm-allocation-missing': {
    de: 'IDM-Schlüssel fehlt',
    it: 'Chiave IDM mancante',
  },
  'orders-source-unavailable': {
    de: 'Orders nicht verfügbar',
    it: 'Orders non disponibili',
  },
  'orders-unpriced': {
    de: 'Orders ohne Tarif',
    it: 'Orders senza tariffa',
  },
  'extras-source-unavailable': {
    de: 'Extras nicht verfügbar',
    it: 'Extra non disponibili',
  },
};

function formatCurrency(value: number, language: Language) {
  return new Intl.NumberFormat(language === 'de' ? 'de-DE' : 'it-IT', {
    style: 'currency',
    currency: 'EUR',
  }).format(value);
}

export function UnifiedBillingPanel({
  language,
  seasonId,
  organizations,
  unifiedBilling,
}: {
  language: Language;
  seasonId: string;
  organizations: OrganizationBillingRow[];
  unifiedBilling: UnifiedBillingSnapshot;
}) {
  const t = copy[language];
  const [runs, setRuns] = useState<UnifiedBillingRunRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState('');
  const [error, setError] = useState('');

  async function reload() {
    setLoading(true);
    setError('');
    try {
      setRuns(await loadUnifiedBillingRuns(seasonId));
    } catch (reason) {
      setError(unifiedBillingRunMessage(reason, language));
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

  async function save(
    organization: OrganizationBillingRow,
    status: UnifiedBillingRunStatus,
  ) {
    const billing = unifiedBilling.byOrganization[organization.organizationId];
    if (!billing || !organization.reportingAreaId) return;

    setSavingId(organization.organizationId);
    setError('');
    try {
      const saved = await saveUnifiedBillingRun({
        seasonId,
        organizationId: organization.organizationId,
        reportingAreaId: organization.reportingAreaId,
        billing,
        status,
      });
      setRuns((current) => [
        ...current.filter(
          (run) => run.organizationId !== saved.organizationId,
        ),
        saved,
      ]);
    } catch (reason) {
      setError(unifiedBillingRunMessage(reason, language));
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
        <div className="dns-alert rounded-none border-x-0 border-t-0" data-variant="error" role="alert">
          <div className="dns-alert-body">{error}</div>
        </div>
      )}

      {loading ? (
        <div className="dns-state rounded-none border-x-0 border-b-0" data-state="loading" aria-live="polite">
          <div className="dns-state-icon" aria-hidden="true">···</div>
          <div className="dns-state-title">{t.loading}</div>
        </div>
      ) : (
        <div className="dns-table-wrap">
          <table className="dns-table min-w-[1380px]">
            <thead>
              <tr>
                <th>{t.organization}</th>
                <th className="num">{t.fair}</th>
                <th className="num">{t.idm}</th>
                <th className="num">{t.orders}</th>
                <th className="num">{t.extras}</th>
                <th className="num">{t.live}</th>
                <th>{t.sourceState}</th>
                <th>{t.saved}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {organizations.map((organization) => {
                const live =
                  unifiedBilling.byOrganization[organization.organizationId];
                const saved =
                  runByOrganization.get(organization.organizationId);
                const locked = saved?.status === 'ready';
                const busy = savingId === organization.organizationId;
                const blockers = live?.blockingReasons ?? [];

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
                    <td className="num">
                      {formatCurrency(live?.fairAmount ?? 0, language)}
                    </td>
                    <td className="num">
                      {formatCurrency(live?.idmAmount ?? 0, language)}
                    </td>
                    <td className="num">
                      {formatCurrency(live?.ordersAmount ?? 0, language)}
                    </td>
                    <td className="num">
                      {formatCurrency(live?.extrasAmount ?? 0, language)}
                    </td>
                    <td className="num font-semibold">
                      {formatCurrency(live?.totalAmount ?? 0, language)}
                    </td>
                    <td>
                      <span
                        className={[
                          'dns-status',
                          live?.sourceState === 'complete'
                            ? 'is-connected'
                            : 'is-draft',
                        ].join(' ')}
                      >
                        {live?.sourceState === 'complete'
                          ? t.complete
                          : t.incomplete}
                      </span>
                      {blockers.length > 0 && (
                        <div className="mt-1 max-w-[250px] font-alt text-[8px] leading-relaxed text-dns-muted">
                          {blockers
                            .map(
                              (code) =>
                                blockerCopy[code]?.[language] ?? code,
                            )
                            .join(' · ')}
                        </div>
                      )}
                    </td>
                    <td>
                      {saved ? (
                        <>
                          <span
                            className={[
                              'dns-status',
                              saved.status === 'ready'
                                ? 'is-connected'
                                : 'is-draft',
                            ].join(' ')}
                          >
                            {saved.status.toUpperCase()} · {t.revision}{' '}
                            {saved.revision}
                          </span>
                          <div className="mt-1 font-alt text-[9px] text-dns-muted">
                            {formatCurrency(saved.totalAmount, language)}
                          </div>
                        </>
                      ) : (
                        <span className="font-alt text-[10px] text-dns-muted">
                          {t.noSnapshot}
                        </span>
                      )}
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
                              onClick={() =>
                                void save(organization, 'draft')
                              }
                              disabled={busy || !live?.lines.length}
                              className="dns-btn-secondary"
                              data-dns-press
                            >
                              {t.draft}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void save(organization, 'ready')
                              }
                              disabled={busy || !live?.readyEligible}
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
