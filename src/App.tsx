import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import type { BillingCommercialRate, BillingSeasonalExtra } from '@dolomitinordicski/dns-shared-data';
import { formatDNSCoreHeaderStatus } from '@dolomitinordicski/dns-shared-data/ui/header-status';
import {
  DNS_BILLING_BOUNDARY,
  DNS_BILLING_SOURCE_TYPES,
  ORGANIZATIONS,
  REPORTING_AREAS,
  SEASONS,
} from '@dolomitinordicski/dns-shared-data';
import { AccessibilityMount } from './components/AccessibilityMount';
import { BillingRunsPanel } from './components/BillingRunsPanel';
import { CommercialRatesPanel } from './components/CommercialRatesPanel';
import { SeasonalExtrasPanel } from './components/SeasonalExtrasPanel';
import { FakturaPrintSheet } from './components/FakturaPrintSheet';
import { LoginScreen } from './components/LoginScreen';
import { SeasonSelector } from './components/SeasonSelector';
import { RegionLogos } from './components/RegionLogos';
import { isDNSAdmin, signOut, subscribeToAuth } from './services/auth';
import { probeDNSCore, type DNSCoreProbe } from './services/dnsCore';
import { printDNSDocument } from './services/designSystem';
import { loadFairBillingSource, type FairBillingSnapshot } from './services/fairSource';
import { allocationShareForOrganization, loadAreaAllocationKeys, type AreaAllocationRecord } from './services/allocationKeys';
import { IDM_PREMIUM_2026, idmPremiumOrganizationAmount, idmPremiumTotal } from './services/idmPremium';
import { loadSeasonalExtras, seasonalExtrasTotal } from './services/seasonalExtras';
import { calculateOrderBilling } from './services/orderBilling';
import {
  loadOrdersSource,
  type OrdersSourceSnapshot,
} from './services/orders';
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

type AuthState =
  | { state: 'loading'; user: null }
  | { state: 'signed-out'; user: null }
  | { state: 'admin'; user: User }
  | { state: 'denied'; user: User };

type FairState =
  | { state: 'idle' | 'loading'; snapshot: null; error: null }
  | { state: 'ready'; snapshot: FairBillingSnapshot; error: null }
  | { state: 'error'; snapshot: null; error: string };

type OrdersState =
  | { state: 'idle' | 'loading'; snapshot: null; error: null }
  | { state: 'ready'; snapshot: OrdersSourceSnapshot; error: null }
  | { state: 'error'; snapshot: null; error: string };

type AllocationState =
  | { state: 'idle' | 'loading'; snapshot: AreaAllocationRecord[]; error: null }
  | { state: 'ready'; snapshot: AreaAllocationRecord[]; error: null }
  | { state: 'error'; snapshot: AreaAllocationRecord[]; error: string };

type ExtrasState =
  | { state: 'idle' | 'loading'; snapshot: null; error: null }
  | { state: 'ready'; snapshot: BillingSeasonalExtra[]; error: null }
  | { state: 'error'; snapshot: null; error: string };

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
    phase:
      'F.4 Seasonal Extras: FAIR, IDM und Orders bleiben unverändert; zusätzliche saisonale DNS-Commercial-Positionen werden mit Quelle und Revision pro Organisation geführt.',
    configuredRates: 'Tarife mit Quelle',
    boundary: 'Systemgrenze',
    boundaryText:
      'DNS Faktura bereitet fakturierbare Beträge intern vor. Offizielle Rechnungen, Buchhaltung und Zahlungen bleiben außerhalb dieses Tools.',
    printTitle: 'Interner Faktura-Überblick',
    printButton: 'Interne Übersicht drucken',
    core: 'DNS_Core',
    connected: 'DNS_Core verbunden',
    connecting: 'DNS_Core verbindet…',
    unavailable: 'DNS_Core nicht erreichbar',
    sharedFoundation: 'Foundation',
    sourceDefined: 'definiert',
    sourceConnected: 'verbunden',
    sourcePending: 'noch nicht angebunden',
    sourceError: 'Fehler',
    amount: 'Betrag',
    quantity: 'Menge',
    activeOrders: 'aktive Bestellungen',
    draftOrders: 'Entwurf',
    rateMissing: 'Tarif fehlt',
    signOut: 'Abmelden',
    adminOnly: 'Nur DNS Admin',
    admin: 'DNS Admin',
    adminDenied: 'Dieser Zugang ist nicht als DNS-Admin freigeschaltet.',
    ordersLive: 'Live aus ticketOrders / ticketOrderLines',
    ordersLoading: 'Orders werden geladen…',
    ordersError: 'Orders konnten nicht gelesen werden.',
    noFinancialTotal: 'noch nicht vollständig berechenbar',
    pricedQuantity: 'bewertete Menge',
    unpricedQuantity: 'Menge ohne Tarif',
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
    phase:
      'F.4 Seasonal Extras: FAIR, IDM e Orders restano invariati; le voci DNS Commercial extra stagionali vengono gestite per organizzazione con fonte e revisione.',
    configuredRates: 'Tariffe con fonte',
    boundary: 'Confine del sistema',
    boundaryText:
      'DNS Faktura prepara internamente gli importi da fatturare. Fatture ufficiali, contabilità e pagamenti restano fuori da questo tool.',
    printTitle: 'Riepilogo interno Faktura',
    printButton: 'Stampa riepilogo interno',
    core: 'DNS_Core',
    connected: 'DNS_Core connesso',
    connecting: 'Connessione a DNS_Core…',
    unavailable: 'DNS_Core non raggiungibile',
    sharedFoundation: 'Foundation',
    sourceDefined: 'definita',
    sourceConnected: 'collegata',
    sourcePending: 'non ancora collegata',
    sourceError: 'Errore',
    amount: 'Importo',
    quantity: 'Quantità',
    activeOrders: 'ordini attivi',
    draftOrders: 'bozza',
    rateMissing: 'tariffa mancante',
    signOut: 'Esci',
    adminOnly: 'Solo DNS Admin',
    admin: 'DNS Admin',
    adminDenied: 'Questo accesso non è abilitato come DNS Admin.',
    ordersLive: 'Live da ticketOrders / ticketOrderLines',
    ordersLoading: 'Caricamento ordini…',
    ordersError: 'Impossibile leggere gli ordini.',
    noFinancialTotal: 'non ancora completamente calcolabile',
    pricedQuantity: 'quantità valorizzata',
    unpricedQuantity: 'quantità senza tariffa',
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

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function App() {
  const [language, setLanguage] = useState<Language>('de');
  const [seasonId, setSeasonId] = useState('2026-27');
  const [authState, setAuthState] = useState<AuthState>({
    state: 'loading',
    user: null,
  });
  const [core, setCore] = useState<DNSCoreProbe>({
    state: 'loading',
    organizations: 0,
    reportingAreas: 0,
    seasons: 0,
  });
  const [orders, setOrders] = useState<OrdersState>({
    state: 'idle',
    snapshot: null,
    error: null,
  });
  const [configuredRates, setConfiguredRates] = useState(0);
  const [fair, setFair] = useState<FairState>({ state: 'idle', snapshot: null, error: null });
  const [commercialRates, setCommercialRates] = useState<BillingCommercialRate[]>([]);
  const [allocationKeys, setAllocationKeys] = useState<AllocationState>({ state: 'idle', snapshot: [], error: null });

  const [seasonalExtras, setSeasonalExtras] = useState<ExtrasState>({
    state: 'idle',
    snapshot: null,
    error: null,
  });

  const t = copy[language];
  const coreHeader = formatDNSCoreHeaderStatus(
    core.state === 'ready'
      ? { state: 'ready', reportingAreas: core.reportingAreas, organizations: core.organizations }
      : core.state === 'error'
        ? { state: 'error' }
        : { state: 'loading' },
    language,
  );

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(
    () =>
      subscribeToAuth((user) => {
        if (!user) {
          setAuthState({ state: 'signed-out', user: null });
          return;
        }
        setAuthState({ state: 'loading', user: null });
        void isDNSAdmin(user.uid)
          .then((admin) =>
            setAuthState(
              admin
                ? { state: 'admin', user }
                : { state: 'denied', user },
            ),
          )
          .catch(() => setAuthState({ state: 'denied', user }));
      }),
    [],
  );

  useEffect(() => {
    if (authState.state !== 'admin') return;
    let active = true;
    void probeDNSCore().then((result) => {
      if (active) setCore(result);
    });
    return () => {
      active = false;
    };
  }, [authState.state]);

  useEffect(() => {
    if (authState.state !== 'admin') return;
    let active = true;
    setAllocationKeys({ state: 'loading', snapshot: [], error: null });
    void loadAreaAllocationKeys(seasonId)
      .then((snapshot) => {
        if (active) setAllocationKeys({ state: 'ready', snapshot, error: null });
      })
      .catch((error) => {
        if (active) setAllocationKeys({ state: 'error', snapshot: [], error: error instanceof Error ? error.message : String(error) });
      });
    return () => { active = false; };
  }, [authState.state, seasonId]);

  useEffect(() => {
    if (authState.state !== 'admin') return;
    let active = true;
    setFair({ state: 'loading', snapshot: null, error: null });
    void loadFairBillingSource(seasonId)
      .then((snapshot) => {
        if (active) setFair({ state: 'ready', snapshot, error: null });
      })
      .catch((error) => {
        if (active) setFair({ state: 'error', snapshot: null, error: error instanceof Error ? error.message : String(error) });
      });
    return () => { active = false; };
  }, [authState.state, seasonId]);

  useEffect(() => {
    if (authState.state !== 'admin') return;
    let active = true;
    setOrders({ state: 'loading', snapshot: null, error: null });
    setCommercialRates([]);
    void loadOrdersSource(seasonId)
      .then((snapshot) => {
        if (active) setOrders({ state: 'ready', snapshot, error: null });
      })
      .catch((error) => {
        console.error('DNS Faktura Orders source failed', error);
        if (active) {
          setOrders({
            state: 'error',
            snapshot: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      active = false;
    };
  }, [authState.state, seasonId]);

  async function refreshSeasonalExtras() {
    setSeasonalExtras({ state: 'loading', snapshot: null, error: null });
    try {
      const snapshot = await loadSeasonalExtras(seasonId);
      setSeasonalExtras({ state: 'ready', snapshot, error: null });
    } catch (error) {
      setSeasonalExtras({
        state: 'error',
        snapshot: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  useEffect(() => {
    if (authState.state !== 'admin') return;
    void refreshSeasonalExtras();
  }, [authState.state, seasonId]);

  const orderBilling = useMemo(
    () =>
      orders.state === 'ready'
        ? calculateOrderBilling(orders.snapshot, commercialRates)
        : null,
    [orders, commercialRates],
  );

  const organizations = useMemo<OrganizationBillingRow[]>(() => {
    return (ORGANIZATIONS as readonly CanonicalOrganization[])
      .filter(
        (organization) =>
          organization.active &&
          organization.relationshipTypes.includes('fair-contributor'),
      )
      .map((organization) => {
        const reportingAreaId = organization.reportingAreaIds[0];
        const orderSummary =
          orders.state === 'ready'
            ? orders.snapshot.byOrganization[organization.id]
            : undefined;
        const orderBillingSummary = orderBilling?.byOrganization[organization.id];
        const fairSummary = fair.state === 'ready'
          ? fair.snapshot.organizations.find((item) => item.organizationId === organization.id)
          : undefined;
        const idmAmount = idmPremiumOrganizationAmount({
          seasonId,
          reportingAreaId,
          distributionKey: allocationShareForOrganization(allocationKeys.snapshot, reportingAreaId, organization.id),
        });
        const extrasAmount =
          seasonalExtras.state === 'ready'
            ? seasonalExtras.snapshot
                .filter(
                  (extra) =>
                    extra.active &&
                    extra.organizationId === organization.id,
                )
                .reduce((sum, extra) => sum + extra.amount, 0)
            : 0;
        return {
          organizationId: organization.id,
          organizationName: organization.canonicalName,
          reportingAreaId,
          reportingAreaName: reportingAreaId
            ? reportingAreaById[reportingAreaId]?.canonicalName ?? reportingAreaId
            : undefined,
          fair: fairSummary?.totalAmount ?? 0,
          idm: idmAmount,
          orders: orderBillingSummary?.amount ?? 0,
          extras: Math.round((extrasAmount + Number.EPSILON) * 100) / 100,
          status: 'draft' as const,
          orderQuantityActive: orderSummary?.activeQuantity ?? 0,
          orderQuantityDraft: orderSummary?.draftQuantity ?? 0,
          orderCount: orderSummary?.orderCount ?? 0,
        };
      })
      .sort((a, b) =>
        `${a.reportingAreaName ?? ''}|${a.organizationName}`.localeCompare(
          `${b.reportingAreaName ?? ''}|${b.organizationName}`,
          language,
        ),
      );
  }, [language, orders, orderBilling, fair, seasonId, seasonalExtras, allocationKeys]);

  const sourceStatuses: SourceStatus[] = [
    {
      id: 'fair',
      label: t.fair,
      state: fair.state === 'ready' ? 'connected' : fair.state === 'error' ? 'error' : 'defined',
      detail:
        fair.state === 'ready'
          ? `${language === 'de' ? 'Live aus DNS FAIR' : 'Live da DNS FAIR'} · ${formatCurrency(fair.snapshot.totalAmount, language)}`
          : fair.state === 'error'
            ? (language === 'de' ? 'FAIR-Billingquelle noch nicht veröffentlicht.' : 'Fonte billing FAIR non ancora pubblicata.')
            : (language === 'de' ? 'FAIR-Billingquelle wird geladen…' : 'Caricamento fonte FAIR…'),
    },
    {
      id: 'idm',
      label: t.idm,
      state: seasonId === '2026-27' ? 'connected' : 'defined',
      detail:
        seasonId === '2026-27'
          ? `${language === 'de' ? '4 Regionen' : '4 aree'} · ${formatCurrency(IDM_PREMIUM_2026.amountPerReportingArea, language)} / ${language === 'de' ? 'Gebiet' : 'area'} · ${formatCurrency(idmPremiumTotal(seasonId), language)} ${language === 'de' ? 'gesamt · Schlüssel live aus DNS_Core' : 'totale · chiavi live da DNS_Core'}`
          : (language === 'de' ? 'Keine saisonale IDM-Konfiguration.' : 'Nessuna configurazione IDM per la stagione.'),
    },
    {
      id: 'orders',
      label: t.orders,
      state:
        orders.state === 'ready'
          ? 'connected'
          : orders.state === 'error'
            ? 'error'
            : 'defined',
      detail:
        orders.state === 'ready'
          ? `${t.ordersLive} · ${formatNumber(orders.snapshot.activeQuantity, language)} ${t.quantity.toLowerCase()} · ${orderBilling ? `${formatNumber(orderBilling.billedQuantity, language)} ${t.pricedQuantity.toLowerCase()} · ${formatNumber(orderBilling.unpricedQuantity, language)} ${t.unpricedQuantity.toLowerCase()} · ` : ''}${t.configuredRates}: ${configuredRates}/${orders.snapshot.catalog.length}`
          : orders.state === 'error'
            ? t.ordersError
            : t.ordersLoading,
    },
    {
      id: 'extras',
      label: t.extras,
      state:
        seasonalExtras.state === 'ready'
          ? 'connected'
          : seasonalExtras.state === 'error'
            ? 'error'
            : 'defined',
      detail:
        seasonalExtras.state === 'ready'
          ? `${seasonalExtras.snapshot.filter((extra) => extra.active).length} ${language === 'de' ? 'aktive Positionen' : 'voci attive'} · ${formatCurrency(seasonalExtrasTotal(seasonalExtras.snapshot), language)}`
          : seasonalExtras.state === 'error'
            ? (language === 'de' ? 'Saisonale Zusatzpositionen konnten nicht geladen werden.' : 'Impossibile caricare le voci extra stagionali.')
            : (language === 'de' ? 'Saisonale Zusatzpositionen werden geladen…' : 'Caricamento voci extra stagionali…'),
    },
  ];

  if (authState.state === 'loading') {
    return (
      <div className="min-h-screen bg-dns-bg">
        <div className="dns-shell py-16">
          <div className="dns-card p-6">
            <div className="dns-kicker">{t.adminOnly}</div>
            <div className="mt-2 font-alt text-[12px] text-dns-muted">{t.connecting}</div>
          </div>
        </div>
      </div>
    );
  }

  if (authState.state === 'signed-out') {
    return <LoginScreen language={language} onLanguageChange={setLanguage} />;
  }

  if (authState.state === 'denied') {
    return (
      <div className="min-h-screen bg-dns-bg">
        <header className="bg-dns-deep text-white">
          <div className="dns-header-inner">
            <div className="flex items-center gap-4">
              <img src={DNS_LOGO_URL} alt="Dolomiti NordicSki" className="dns-header-logo" />
              <div className="dns-header-title">
                <strong className="font-bold">DNS</strong>{' '}
                <span className="font-normal">FAKTURA</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void signOut()}
              data-dns-press
              className="border-0 border-b border-white/50 bg-transparent px-1 py-1 text-[10px] font-bold uppercase tracking-[.06em] text-white/80"
            >
              {t.signOut}
            </button>
          </div>
        </header>
        <main className="dns-shell py-14">
          <section className="dns-card p-6">
            <div className="dns-kicker">{t.adminOnly}</div>
            <h1 className="mt-2 text-[22px] font-semibold">{t.adminDenied}</h1>
          </section>
        </main>
      </div>
    );
  }

  const ordersReady = orders.state === 'ready';

  return (
    <div className="min-h-screen">
      <header data-dns-tool-header id="dns-faktura-header" className="bg-dns-deep text-white shadow-[0_1px_0_rgba(255,255,255,.08)]">
        <div className="dns-tool-header-shell">
          <div className="dns-tool-header-brand">
            <img
              src={DNS_LOGO_URL}
              alt="Dolomiti NordicSki"
              className="dns-tool-header-logo"
            />
            <div className="dns-tool-header-identity">
              <div className="dns-tool-header-title"><strong>DNS</strong> <span>FAKTURA</span></div>
              <div className="dns-tool-header-subtitle">{t.subtitle}</div>
            </div>
          </div>

          <div className="dns-tool-header-actions">
            <div className="dns-tool-header-account">
              <div className="font-alt text-[10px] text-white/75">
                {authState.user.email ?? authState.user.uid}
              </div>
              <div className="mt-0.5 text-[9px] font-bold uppercase tracking-[.06em] text-dns-light">
                {t.admin}
              </div>
            </div>

            <div className="dns-tool-header-controls">
              <AccessibilityMount language={language} />
              <div className="dns-tool-header-language">
                {(['de', 'it'] as const).map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => setLanguage(lang)}
                    data-dns-press
                    aria-pressed={language === lang}
                    className={[
                      'border-0 border-b-2 bg-transparent px-1 py-1 text-white',
                      language === lang ? 'border-white' : 'border-transparent opacity-60',
                    ].join(' ')}
                  >
                    {lang.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={() => void signOut()}
              data-dns-press
              data-dns-hover
              className="dns-tool-header-session-action hover:text-white"
            >
              {t.signOut}
            </button>

            <div className="dns-tool-header-status" data-state={coreHeader.state} aria-live="polite">
              <span className="dns-tool-header-status-dot" />
              {coreHeader.text}
            </div>
          </div>
        </div>
      </header>

      <nav data-dns-tool-nav id="dns-faktura-nav" className="dns-tab-nav" aria-label="DNS Faktura">
        <div className="dns-tab-nav-inner">
          <SeasonSelector
            seasons={SEASONS.slice().reverse()}
            selectedSeasonId={seasonId}
            language={language}
            onChange={setSeasonId}
          />

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


      <main className="dns-shell space-y-5 py-5">
        <section id="overview" className="section-anchor space-y-5">
          <div className="dns-card p-5 md:p-6">
            <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
              <div>
                <div className="dns-kicker">DNS Commercial · Billing Preparation v0.5 · F.4</div>
                <h1 className="mt-1 text-[27px] font-semibold tracking-[-.02em] text-dns-deep">
                  {t.subtitle}
                </h1>
                <p className="mt-2 max-w-3xl font-alt text-[12px] leading-relaxed text-dns-mid">
                  {t.phase}
                </p>
              </div>
              <span className="dns-pill">{seasonId}</span>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <article className="dns-metric">
              <div className="dns-kicker">{t.total}</div>
              <div className="dns-metric-value">{formatCurrency((fair.state === 'ready' ? fair.snapshot.totalAmount : 0) + (orderBilling?.totalAmount ?? 0) + idmPremiumTotal(seasonId) + (seasonalExtras.state === 'ready' ? seasonalExtrasTotal(seasonalExtras.snapshot) : 0), language)}</div>
              <div className="mt-1 font-alt text-[9px] text-dns-muted">{t.noFinancialTotal}</div>
            </article>
            <article className="dns-metric">
              <div className="dns-kicker">{t.billableOrganizations}</div>
              <div className="dns-metric-value">{organizations.length}</div>
            </article>
            <article className="dns-metric">
              <div className="dns-kicker">{t.orders} · {t.quantity}</div>
              <div className="dns-metric-value">
                {ordersReady ? formatNumber(orders.snapshot.activeQuantity, language) : '—'}
              </div>
              <div className="mt-1 font-alt text-[9px] text-dns-muted">
                {t.activeOrders}
              </div>
            </article>
            <article className="dns-metric">
              <div className="dns-kicker">{t.orders} · {t.draft}</div>
              <div className="dns-metric-value">
                {ordersReady ? formatNumber(orders.snapshot.draftQuantity, language) : '—'}
              </div>
              <div className="mt-1 font-alt text-[9px] text-dns-muted">
                {t.draftOrders}
              </div>
            </article>
          </div>

          <div className="grid gap-4 lg:grid-cols-4">
            {[t.fair, t.idm, t.orders, t.extras].map((label) => (
              <article key={label} className="dns-source-total">
                <span>{label}</span>
                <strong>
                  {label === t.orders && orderBilling
                    ? formatCurrency(orderBilling.totalAmount, language)
                    : label === t.fair && fair.state === 'ready'
                      ? formatCurrency(fair.snapshot.totalAmount, language)
                      : label === t.idm && seasonId === '2026-27'
                        ? formatCurrency(idmPremiumTotal(seasonId), language)
                        : label === t.extras && seasonalExtras.state === 'ready'
                          ? formatCurrency(seasonalExtrasTotal(seasonalExtras.snapshot), language)
                          : '—'}
                </strong>
              </article>
            ))}
          </div>
        </section>

        <section id="organizations" className="section-anchor space-y-5">
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
                  {organizations.map((row) => (
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
                      <td className="num">{row.fair > 0 ? formatCurrency(row.fair, language) : '—'}</td>
                      <td className="num">
                        {row.idm > 0 ? formatCurrency(row.idm, language) : '—'}
                      </td>
                      <td className="num">
                        <div className="font-semibold">
                          {row.orderQuantityActive > 0
                            ? formatCurrency(row.orders, language)
                            : '—'}
                        </div>
                        {ordersReady && row.orderCount > 0 ? (
                          <div className="mt-1 font-alt text-[8px] text-dns-muted">
                            {formatNumber(row.orderQuantityActive, language)} {t.quantity.toLowerCase()}
                            {row.orderQuantityDraft > 0
                              ? ` · +${formatNumber(row.orderQuantityDraft, language)} ${t.draft.toLowerCase()}`
                              : ''}
                            {orderBilling?.byOrganization[row.organizationId]?.unpricedQuantity
                              ? ` · ${formatNumber(orderBilling.byOrganization[row.organizationId].unpricedQuantity, language)} ${t.unpricedQuantity.toLowerCase()}`
                              : ''}
                          </div>
                        ) : null}
                      </td>
                      <td className="num">
                        {row.extras > 0 ? formatCurrency(row.extras, language) : '—'}
                      </td>
                      <td className="num font-bold">{formatCurrency(row.fair + row.idm + row.orders + row.extras, language)}</td>
                      <td>
                        <span className="dns-status is-draft">{t.draft}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {orderBilling && (
            <BillingRunsPanel
              language={language}
              seasonId={seasonId}
              organizations={organizations}
              orderBilling={orderBilling}
            />
          )}
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
                      {source.state === 'connected'
                        ? t.sourceConnected
                        : source.state === 'defined'
                          ? t.sourceDefined
                          : source.state === 'error'
                            ? t.sourceError
                            : t.sourcePending}
                    </span>
                  </div>
                  <p className="mt-2 font-alt text-[11px] leading-relaxed text-dns-muted">
                    {source.detail}
                  </p>
                  {source.id === 'orders' && orders.state === 'error' && (
                    <p className="mt-2 break-all font-alt text-[9px] text-red-700">
                      {orders.error}
                    </p>
                  )}
                </article>
              ))}
            </div>

            {orders.state === 'ready' && (
              <div className="mt-5">
                <CommercialRatesPanel
                  language={language}
                  seasonId={seasonId}
                  orders={orders.snapshot}
                  onConfiguredChange={setConfiguredRates}
                  onRatesChange={setCommercialRates}
                />
              </div>
            )}

            {seasonalExtras.state === 'ready' && (
              <div className="mt-5">
                <SeasonalExtrasPanel
                  language={language}
                  seasonId={seasonId}
                  organizations={organizations}
                  extras={seasonalExtras.snapshot}
                  onChanged={refreshSeasonalExtras}
                />
              </div>
            )}

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
              <button type="button" onClick={printDNSDocument} data-dns-press className="dns-primary-button">
                {t.printButton}
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer className="dns-footer">
        <div className="dns-shell flex flex-col gap-1 py-5 md:flex-row md:items-center md:justify-between">
          <span>Dolomiti NordicSki · DNS Faktura</span>
          <span>Billing Preparation v0.5 · F.4 Seasonal Extras · {seasonId}</span>
        </div>
      </footer>

      <FakturaPrintSheet
        language={language}
        seasonId={seasonId}
        organizations={organizations}
      />
    </div>
  );
}

export default App;
