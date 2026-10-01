import { useEffect, useMemo, useState } from 'react';
import {
  DNS_BILLING_BOUNDARY,
  DNS_BILLING_SOURCE_TYPES,
  ORGANIZATIONS,
  REPORTING_AREAS,
  SEASONS,
} from '@dolomitinordicski/dns-shared-data';
import { AccessibilityMount } from './components/AccessibilityMount';
import { NavigationRuntimeMount } from './components/NavigationRuntimeMount';
import { RegionLogos } from './components/RegionLogos';
import { probeDNSCore, type DNSCoreProbe } from './services/dnsCore';
import type { Language, OrganizationBillingRow, SourceStatus } from './types';

const DNS_LOGO_URL =
  'https://dolomitinordicski.github.io/dns-shared-data/brand/logo-web.png';

type CanonicalOrganization = {
  id: string;
  canonicalName: string;
  reportingAreaIds: readonly string[];
  relationshipTypes: readonly string[];
  active: boolean;
};

type CanonicalReportingArea = {
  id: string;
  canonicalName: string;
};

const reportingAreaById = Object.fromEntries(
  (REPORTING_AREAS as readonly CanonicalReportingArea[]).map((area) => [
    area.id,
    area,
  ]),
);

const copy = {
  de: {
    app: 'Faktura',
    subtitle: 'Interne Fakturavorbereitung',
    overview: 'Übersicht',
    organizations: 'Organisationen',
    sources: 'Quellen',
    print: 'Druck / Export',
    season: 'Saison',
    total: 'Gesamtsumme',
    billableOrganizations: 'Organisationen',
    ready: 'Bereit',
    draft: 'Entwurf',
    fair: 'FAIR / Mitgliedsbeitrag',
    idm: 'IDM Premiumpartner',
    orders: 'Orders',
    extras: 'Saisonale Extras',
    organization: 'Organisation',
    area: 'Gebiet',
    status: 'Status',
    sourceControl: 'Quellenkontrolle',
    sourceIntro:
      'Faktura berechnet keine Quelldaten neu. Jede Position bleibt auf ihren fachlichen Ursprung rückführbar.',
    noAmounts:
      'F.1 Foundation Shell: Die Quellen sind noch nicht an Faktura angebunden. Deshalb werden bewusst keine Beträge erfunden oder lokal nachgebaut.',
    boundary: 'Systemgrenze',
    boundaryText:
      'DNS Faktura bereitet fakturierbare Beträge intern vor. Offizielle Rechnungen, Buchhaltung und Zahlungen bleiben außerhalb dieses Tools.',
    printTitle: 'Interner Faktura-Überblick',
    printButton: 'Interne Übersicht drucken',
    core: 'DNS_Core',
    connected: 'verbunden',
    connecting: 'verbinden…',
    unavailable: 'nicht verfügbar',
    sharedFoundation: 'Foundation',
    sourceDefined: 'definiert',
    sourcePending: 'noch nicht angebunden',
    amount: 'Betrag',
  },
  it: {
    app: 'Faktura',
    subtitle: 'Preparazione interna fatturazione',
    overview: 'Panoramica',
    organizations: 'Organizzazioni',
    sources: 'Fonti',
    print: 'Stampa / Export',
    season: 'Stagione',
    total: 'Totale',
    billableOrganizations: 'Organizzazioni',
    ready: 'Pronto',
    draft: 'Bozza',
    fair: 'FAIR / Quota associativa',
    idm: 'IDM Premiumpartner',
    orders: 'Ordini',
    extras: 'Extra stagionali',
    organization: 'Organizzazione',
    area: 'Area',
    status: 'Stato',
    sourceControl: 'Controllo fonti',
    sourceIntro:
      'Faktura non ricalcola i dati sorgente. Ogni voce resta riconducibile al proprio dominio operativo.',
    noAmounts:
      'F.1 Foundation Shell: le fonti non sono ancora collegate a Faktura. Per questo non vengono inventati importi né duplicati calcoli locali.',
    boundary: 'Confine del sistema',
    boundaryText:
      'DNS Faktura prepara internamente gli importi da fatturare. Fatture ufficiali, contabilità e pagamenti restano fuori da questo tool.',
    printTitle: 'Riepilogo interno Faktura',
    printButton: 'Stampa riepilogo interno',
    core: 'DNS_Core',
    connected: 'collegato',
    connecting: 'connessione…',
    unavailable: 'non disponibile',
    sharedFoundation: 'Foundation',
    sourceDefined: 'definita',
    sourcePending: 'non ancora collegata',
    amount: 'Importo',
  },
} as const;

function money(value: number, language: Language) {
  return new Intl.NumberFormat(language === 'de' ? 'de-DE' : 'it-IT', {
    style: 'currency',
    currency: 'EUR',
  }).format(value);
}

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function App() {
  const [language, setLanguage] = useState<Language>('de');
  const [seasonId, setSeasonId] = useState('2026-27');
  const [core, setCore] = useState<DNSCoreProbe>({
    state: 'loading',
    organizations: 0,
    reportingAreas: 0,
    seasons: 0,
  });

  const t = copy[language];

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    let active = true;
    void probeDNSCore().then((result) => {
      if (active) setCore(result);
    });
    return () => {
      active = false;
    };
  }, []);

  const organizations = useMemo<OrganizationBillingRow[]>(() => {
    return (ORGANIZATIONS as readonly CanonicalOrganization[])
      .filter(
        (organization) =>
          organization.active &&
          organization.relationshipTypes.includes('fair-contributor'),
      )
      .map((organization) => {
        const reportingAreaId = organization.reportingAreaIds[0];
        return {
          organizationId: organization.id,
          organizationName: organization.canonicalName,
          reportingAreaId,
          reportingAreaName: reportingAreaId
            ? reportingAreaById[reportingAreaId]?.canonicalName ?? reportingAreaId
            : undefined,
          fair: 0,
          idm: 0,
          orders: 0,
          extras: 0,
          status: 'draft' as const,
        };
      })
      .sort((a, b) =>
        `${a.reportingAreaName ?? ''}|${a.organizationName}`.localeCompare(
          `${b.reportingAreaName ?? ''}|${b.organizationName}`,
          language,
        ),
      );
  }, [language]);

  const totals = useMemo(
    () =>
      organizations.reduce(
        (sum, row) => ({
          fair: sum.fair + row.fair,
          idm: sum.idm + row.idm,
          orders: sum.orders + row.orders,
          extras: sum.extras + row.extras,
        }),
        { fair: 0, idm: 0, orders: 0, extras: 0 },
      ),
    [organizations],
  );

  const grandTotal = totals.fair + totals.idm + totals.orders + totals.extras;
  const readyCount = organizations.filter((row) => row.status === 'ready').length;

  const sourceStatuses: SourceStatus[] = [
    {
      id: 'fair',
      label: t.fair,
      state: 'defined',
      detail:
        language === 'de'
          ? 'Vertrag definiert · genehmigtes FAIR-Ergebnis wird in F.2 angebunden.'
          : 'Contratto definito · il risultato FAIR approvato sarà collegato in F.2.',
    },
    {
      id: 'idm',
      label: t.idm,
      state: 'defined',
      detail:
        language === 'de'
          ? 'Saisonale DNS-Commercial-Konfiguration vorgesehen.'
          : 'Prevista configurazione stagionale DNS Commercial.',
    },
    {
      id: 'orders',
      label: t.orders,
      state: 'defined',
      detail:
        language === 'de'
          ? 'Quelle ist DNS Data Entry / Orders; Mengen bleiben dort unverändert.'
          : 'La fonte è DNS Data Entry / Orders; le quantità restano immutate alla fonte.',
    },
    {
      id: 'extras',
      label: t.extras,
      state: 'pending',
      detail:
        language === 'de'
          ? 'Kontrollierte Zusatzpositionen; erster geplanter Fall: Jacken 2026.'
          : 'Voci extra controllate; primo caso previsto: giacche 2026.',
    },
  ];

  return (
    <div className="min-h-screen">
      <header id="dns-faktura-header" className="dns-header">
        <div className="dns-shell flex items-center justify-between gap-5 py-3">
          <div className="flex min-w-0 items-center gap-4">
            <img src={DNS_LOGO_URL} alt="Dolomiti NordicSki" className="h-9 w-auto" />
            <div className="min-w-0 border-l border-white/25 pl-4">
              <div className="truncate text-[18px] leading-none text-white">
                <strong className="font-bold">DNS</strong>{' '}
                <span className="font-normal">{t.app}</span>
              </div>
              <div className="mt-1 truncate font-alt text-[9px] uppercase tracking-[.08em] text-white/65">
                {t.subtitle}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 text-[9px] font-semibold uppercase tracking-[.06em] text-white/70 lg:flex">
              <span
                className={[
                  'h-2 w-2 rounded-full',
                  core.state === 'ready'
                    ? 'bg-emerald-300'
                    : core.state === 'error'
                      ? 'bg-orange-300'
                      : 'bg-dns-light',
                ].join(' ')}
              />
              {t.core} ·{' '}
              {core.state === 'ready'
                ? `${t.connected} · ${core.reportingAreas}/${core.organizations}`
                : core.state === 'error'
                  ? t.unavailable
                  : t.connecting}
            </div>

            <div className="flex rounded-md border border-white/25 p-0.5">
              {(['de', 'it'] as const).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => setLanguage(lang)}
                  className={[
                    'rounded px-2 py-1 text-[9px] font-bold uppercase tracking-[.06em]',
                    language === lang
                      ? 'bg-white text-dns-deep'
                      : 'text-white/65 hover:text-white',
                  ].join(' ')}
                >
                  {lang}
                </button>
              ))}
            </div>

            <AccessibilityMount language={language} />
          </div>
        </div>
      </header>

      <nav id="dns-faktura-nav" className="dns-tab-nav" aria-label="DNS Faktura">
        <div
          id="dns-scroll-progress"
          className="dns-scroll-progress-track"
          role="progressbar"
          aria-label="Scroll progress"
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span id="dns-scroll-progress-bar" className="dns-scroll-progress-bar" />
        </div>
        <div className="dns-tab-nav-inner">
          <div className="dns-season-wrap">
            <span className="dns-season-label">{t.season}</span>
            <select
              value={seasonId}
              onChange={(event) => setSeasonId(event.target.value)}
              className="dns-season-select"
              aria-label={t.season}
            >
              {SEASONS.slice()
                .reverse()
                .map((season) => (
                  <option key={season.id} value={season.id}>
                    {season.label[language]}
                  </option>
                ))}
            </select>
          </div>

          {[
            ['overview', t.overview],
            ['organizations', t.organizations],
            ['sources', t.sources],
            ['print', t.print],
          ].map(([id, label], index) => (
            <button
              key={id}
              type="button"
              data-section={id}
              onClick={() => scrollTo(id)}
              className={['dns-tab', index === 0 ? 'dns-tab-active' : ''].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>
      </nav>

      <NavigationRuntimeMount />

      <main className="dns-shell space-y-5 py-5">
        <section id="overview" className="section-anchor space-y-5">
          <div className="dns-card p-5 md:p-6">
            <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
              <div>
                <div className="dns-kicker">DNS Commercial · Billing Preparation v0.1</div>
                <h1 className="mt-1 text-[27px] font-semibold tracking-[-.02em] text-dns-deep">
                  {t.subtitle}
                </h1>
                <p className="mt-2 max-w-3xl font-alt text-[12px] leading-relaxed text-dns-mid">
                  {t.noAmounts}
                </p>
              </div>
              <span className="dns-pill">{seasonId}</span>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <article className="dns-metric">
              <div className="dns-kicker">{t.total}</div>
              <div className="dns-metric-value">{money(grandTotal, language)}</div>
            </article>
            <article className="dns-metric">
              <div className="dns-kicker">{t.billableOrganizations}</div>
              <div className="dns-metric-value">{organizations.length}</div>
            </article>
            <article className="dns-metric">
              <div className="dns-kicker">{t.ready}</div>
              <div className="dns-metric-value">{readyCount}</div>
            </article>
            <article className="dns-metric">
              <div className="dns-kicker">{t.draft}</div>
              <div className="dns-metric-value">{organizations.length - readyCount}</div>
            </article>
          </div>

          <div className="grid gap-4 lg:grid-cols-4">
            {[
              [t.fair, totals.fair],
              [t.idm, totals.idm],
              [t.orders, totals.orders],
              [t.extras, totals.extras],
            ].map(([label, value]) => (
              <article key={String(label)} className="dns-source-total">
                <span>{label}</span>
                <strong>{money(Number(value), language)}</strong>
              </article>
            ))}
          </div>
        </section>

        <section id="organizations" className="section-anchor">
          <div className="dns-card overflow-hidden">
            <div className="border-b border-dns-mid/10 px-5 py-4">
              <div className="dns-kicker">02 · {t.organizations}</div>
              <h2 className="mt-1 text-[20px] font-semibold text-dns-deep">
                {t.organizations} · {seasonId}
              </h2>
            </div>

            <div className="overflow-x-auto">
              <table className="dns-table">
                <thead>
                  <tr>
                    <th>{t.organization}</th>
                    <th>{t.area}</th>
                    <th className="num">{t.fair}</th>
                    <th className="num">{t.idm}</th>
                    <th className="num">{t.orders}</th>
                    <th className="num">{t.extras}</th>
                    <th className="num">{t.total}</th>
                    <th>{t.status}</th>
                  </tr>
                </thead>
                <tbody>
                  {organizations.map((row) => {
                    const total = row.fair + row.idm + row.orders + row.extras;
                    return (
                      <tr key={row.organizationId}>
                        <td>
                          <div className="dns-entity-label">
                            <RegionLogos
                              entityType="organization"
                              entityId={row.organizationId}
                            />
                            <span className="font-semibold">{row.organizationName}</span>
                          </div>
                        </td>
                        <td>
                          <div className="dns-entity-label">
                            {row.reportingAreaId ? (
                              <RegionLogos
                                entityType="reportingArea"
                                entityId={row.reportingAreaId}
                              />
                            ) : null}
                            <span>{row.reportingAreaName ?? '—'}</span>
                          </div>
                        </td>
                        <td className="num">{money(row.fair, language)}</td>
                        <td className="num">{money(row.idm, language)}</td>
                        <td className="num">{money(row.orders, language)}</td>
                        <td className="num">{money(row.extras, language)}</td>
                        <td className="num font-bold">{money(total, language)}</td>
                        <td>
                          <span className="dns-status is-draft">{t.draft}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <th colSpan={2}>{t.total}</th>
                    <th className="num">{money(totals.fair, language)}</th>
                    <th className="num">{money(totals.idm, language)}</th>
                    <th className="num">{money(totals.orders, language)}</th>
                    <th className="num">{money(totals.extras, language)}</th>
                    <th className="num">{money(grandTotal, language)}</th>
                    <th />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </section>

        <section id="sources" className="section-anchor space-y-5">
          <div className="dns-card p-5 md:p-6">
            <div className="dns-kicker">03 · {t.sourceControl}</div>
            <h2 className="mt-1 text-[20px] font-semibold text-dns-deep">
              {t.sourceControl}
            </h2>
            <p className="mt-2 max-w-3xl font-alt text-[12px] leading-relaxed text-dns-mid">
              {t.sourceIntro}
            </p>

            <div className="mt-5 grid gap-3 lg:grid-cols-2">
              {sourceStatuses.map((source) => (
                <article key={source.id} className="dns-source-card">
                  <div className="flex items-center justify-between gap-3">
                    <strong className="text-[13px]">{source.label}</strong>
                    <span className={['dns-status', `is-${source.state}`].join(' ')}>
                      {source.state === 'defined' ? t.sourceDefined : t.sourcePending}
                    </span>
                  </div>
                  <p className="mt-2 font-alt text-[11px] leading-relaxed text-dns-muted">
                    {source.detail}
                  </p>
                </article>
              ))}
            </div>

            <div className="mt-5 rounded-lg border border-dns-light bg-dns-light/20 p-4">
              <div className="dns-kicker">{t.sharedFoundation}</div>
              <div className="mt-1 font-alt text-[11px] leading-relaxed text-dns-deep">
                {DNS_BILLING_SOURCE_TYPES.map((source) => source.label).join(' · ')}
              </div>
            </div>
          </div>

          <div className="dns-card p-5 md:p-6">
            <div className="dns-kicker">{t.boundary}</div>
            <h2 className="mt-1 text-[18px] font-semibold text-dns-deep">
              {t.boundaryText}
            </h2>
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <div className="dns-boundary-item">
                <strong>Official invoice</strong>
                <span>{DNS_BILLING_BOUNDARY.createsOfficialInvoice ? 'IN' : 'OUT'}</span>
              </div>
              <div className="dns-boundary-item">
                <strong>Payments</strong>
                <span>{DNS_BILLING_BOUNDARY.tracksPayment ? 'IN' : 'OUT'}</span>
              </div>
              <div className="dns-boundary-item">
                <strong>Accounting integration</strong>
                <span>{DNS_BILLING_BOUNDARY.integratesAccountingSoftware ? 'IN' : 'OUT'}</span>
              </div>
              <div className="dns-boundary-item">
                <strong>Accounting records</strong>
                <span>{DNS_BILLING_BOUNDARY.ownsAccountingRecords ? 'IN' : 'OUT'}</span>
              </div>
            </div>
          </div>
        </section>

        <section id="print" className="section-anchor">
          <div className="dns-card p-5 md:p-6">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
              <div>
                <div className="dns-kicker">04 · {t.print}</div>
                <h2 className="mt-1 text-[20px] font-semibold text-dns-deep">
                  {t.printTitle}
                </h2>
                <p className="mt-2 max-w-2xl font-alt text-[11px] leading-relaxed text-dns-muted">
                  {t.boundaryText}
                </p>
              </div>
              <button
                type="button"
                onClick={() => window.print()}
                className="dns-primary-button"
              >
                {t.printButton}
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer className="dns-footer">
        <div className="dns-shell flex flex-col gap-1 py-5 md:flex-row md:items-center md:justify-between">
          <span>Dolomiti NordicSki · DNS Faktura</span>
          <span>Billing Preparation v0.1 · {seasonId}</span>
        </div>
      </footer>

      <div className="dns-print-sheet">
        <div className="dns-print-document-header">
          <img src={DNS_LOGO_URL} alt="Dolomiti NordicSki" className="dns-print-logo" />
          <div>
            <h1 className="dns-print-title">{t.printTitle}</h1>
            <div className="dns-print-meta">
              {seasonId} · Billing Preparation v0.1 · {t.total}: {money(grandTotal, language)}
            </div>
          </div>
        </div>
        <table className="dns-print-table">
          <thead>
            <tr>
              <th>{t.organization}</th>
              <th>{t.area}</th>
              <th className="num">{t.fair}</th>
              <th className="num">{t.idm}</th>
              <th className="num">{t.orders}</th>
              <th className="num">{t.extras}</th>
              <th className="num">{t.total}</th>
            </tr>
          </thead>
          <tbody>
            {organizations.map((row) => (
              <tr key={row.organizationId}>
                <td>{row.organizationName}</td>
                <td>{row.reportingAreaName ?? '—'}</td>
                <td className="num">{money(row.fair, language)}</td>
                <td className="num">{money(row.idm, language)}</td>
                <td className="num">{money(row.orders, language)}</td>
                <td className="num">{money(row.extras, language)}</td>
                <td className="num">
                  {money(row.fair + row.idm + row.orders + row.extras, language)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={6}>{t.total}</th>
              <th className="num">{money(grandTotal, language)}</th>
            </tr>
          </tfoot>
        </table>
        <p className="dns-print-note">{t.boundaryText}</p>
      </div>
    </div>
  );
}

export default App;
