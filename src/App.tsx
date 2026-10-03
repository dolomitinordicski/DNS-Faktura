import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  ORGANIZATIONS,
  SEASONS,
} from '@dolomitinordicski/dns-shared-data';
import { formatDNSCoreHeaderStatus } from '@dolomitinordicski/dns-shared-data/ui/header-status';
import { initDNSFooterRuntime } from '@dolomitinordicski/dns-shared-data/ui/footer';
import { AccessibilityMount } from './components/AccessibilityMount';
import { LoginScreen } from './components/LoginScreen';
import { SeasonSelector } from './components/SeasonSelector';
import { isDNSAdmin, signOut, subscribeToAuth } from './services/auth';
import { probeDNSCore, type DNSCoreProbe } from './services/dnsCore';
import { DNS_FAKTURA_FOUNDATION_VERSION } from './services/designSystem';
import { firebaseOrdersSource } from './v2/adapters/liveSources';
import { FirestoreBillingSheetRepository } from './v2/persistence/firestoreBillingSheetRepository';
import { FirestoreConfirmationRepository } from './v2/persistence/firestoreConfirmationRepository';
import type {
  BillingSheetRecord,
  ConfirmationRecord,
} from './v2/contracts/persistence';
import type { Order } from './v2/domain/types';
import type { Language } from './types';

const DNS_LOGO_URL =
  'https://dolomitinordicski.github.io/dns-shared-data/brand/logo-web.png';

type AuthState =
  | { state: 'loading'; user: null }
  | { state: 'signed-out'; user: null }
  | { state: 'admin'; user: User }
  | { state: 'denied'; user: User };

type CanonicalOrganization = {
  id: string;
  canonicalName: string;
  active: boolean;
};

type WorkspaceState =
  | { state: 'idle' | 'loading'; rows: OrganizationRow[]; error: null }
  | { state: 'ready'; rows: OrganizationRow[]; error: null }
  | { state: 'error'; rows: OrganizationRow[]; error: string };

type OrganizationRow = {
  organizationId: string;
  organizationName: string;
  orders: Order[];
  confirmations: ConfirmationRecord[];
  billingSheets: BillingSheetRecord[];
};

type ViewId = 'overview' | 'orders' | 'confirmations' | 'billing';

const copy = {
  de: {
    subtitle: 'Order-to-Billing Workspace',
    overview: 'Übersicht',
    orders: 'Bestellungen',
    confirmations: 'Bestätigungen',
    billing: 'Fakturavorbereitung',
    season: 'Saison',
    organizations: 'Organisationen',
    submittedOrders: 'Bestellungen',
    activeConfirmations: 'Aktive Bestätigungen',
    billingSheets: 'Billing Sheets',
    invoiced: 'Fakturiert',
    total: 'Gesamtsumme',
    noData: 'Noch keine Daten vorhanden.',
    loading: 'V2-Daten werden geladen…',
    error: 'V2-Daten konnten nicht geladen werden.',
    signOut: 'Abmelden',
    denied: 'Dieser Zugang ist nicht als DNS-Admin freigeschaltet.',
    core: 'DNS_Core',
    v2: 'V2 aktiv',
    foundation: 'Foundation',
    orderId: 'Bestellung',
    organization: 'Organisation',
    quantity: 'Menge',
    status: 'Status',
    revision: 'Revision',
    amount: 'Betrag',
    source: 'Quelle',
    cutover:
      'Aktiver Kern: Confirmation → Billing → Payment → Delivery. Alte Faktura-v1-Berechnungslogik ist nicht mehr Teil der Laufzeit.',
  },
  it: {
    subtitle: 'Order-to-Billing Workspace',
    overview: 'Panoramica',
    orders: 'Ordini',
    confirmations: 'Conferme',
    billing: 'Preparazione fatturazione',
    season: 'Stagione',
    organizations: 'Organizzazioni',
    submittedOrders: 'Ordini',
    activeConfirmations: 'Conferme attive',
    billingSheets: 'Billing Sheet',
    invoiced: 'Fatturate',
    total: 'Totale',
    noData: 'Nessun dato disponibile.',
    loading: 'Caricamento dati v2…',
    error: 'Impossibile caricare i dati v2.',
    signOut: 'Esci',
    denied: 'Questo accesso non è abilitato come DNS Admin.',
    core: 'DNS_Core',
    v2: 'V2 attiva',
    foundation: 'Foundation',
    orderId: 'Ordine',
    organization: 'Organizzazione',
    quantity: 'Quantità',
    status: 'Stato',
    revision: 'Revisione',
    amount: 'Importo',
    source: 'Fonte',
    cutover:
      'Core attivo: Confirmation → Billing → Payment → Delivery. La vecchia logica di calcolo Faktura v1 non fa più parte del runtime.',
  },
} as const;

const billingRepository = new FirestoreBillingSheetRepository();
const confirmationRepository = new FirestoreConfirmationRepository();

function formatCurrency(value: number, language: Language) {
  return new Intl.NumberFormat(language === 'de' ? 'de-DE' : 'it-IT', {
    style: 'currency',
    currency: 'EUR',
  }).format(value);
}

function App() {
  useEffect(() => {
    initDNSFooterRuntime();
  }, []);

  const [language, setLanguage] = useState<Language>('de');
  const [seasonId, setSeasonId] = useState('2026-27');
  const [view, setView] = useState<ViewId>('overview');
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
  const [workspace, setWorkspace] = useState<WorkspaceState>({
    state: 'idle',
    rows: [],
    error: null,
  });

  const t = copy[language];

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

    async function loadWorkspace() {
      setWorkspace((current) => ({
        state: 'loading',
        rows: current.rows,
        error: null,
      }));

      try {
        const orders = await firebaseOrdersSource.loadOrders(seasonId);
        const organizations = (ORGANIZATIONS as readonly CanonicalOrganization[])
          .filter((organization) => organization.active)
          .map((organization) => ({
            id: organization.id,
            name: organization.canonicalName,
          }));

        const rows = await Promise.all(
          organizations.map(async (organization): Promise<OrganizationRow> => {
            const organizationOrders = orders.filter(
              (order) => order.organizationId === organization.id,
            );

            const [billingSheets, confirmationGroups] = await Promise.all([
              billingRepository.listByOrganization({
                seasonId,
                organizationId: organization.id,
              }),
              Promise.all(
                organizationOrders.map((order) =>
                  confirmationRepository.listActiveByOrder(order.id),
                ),
              ),
            ]);

            return {
              organizationId: organization.id,
              organizationName: organization.name,
              orders: organizationOrders,
              confirmations: confirmationGroups.flat(),
              billingSheets,
            };
          }),
        );

        if (active) {
          setWorkspace({ state: 'ready', rows, error: null });
        }
      } catch (error) {
        if (active) {
          setWorkspace({
            state: 'error',
            rows: [],
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    void loadWorkspace();

    return () => {
      active = false;
    };
  }, [authState.state, seasonId]);

  const totals = useMemo(() => {
    const rows = workspace.rows;
    return {
      organizations: rows.length,
      orders: rows.reduce((sum, row) => sum + row.orders.length, 0),
      confirmations: rows.reduce(
        (sum, row) => sum + row.confirmations.length,
        0,
      ),
      billingSheets: rows.reduce(
        (sum, row) => sum + row.billingSheets.length,
        0,
      ),
      invoiced: rows.reduce(
        (sum, row) =>
          sum +
          row.billingSheets.filter((sheet) => sheet.status === 'INVOICED')
            .length,
        0,
      ),
      amount: rows.reduce(
        (sum, row) =>
          sum +
          row.billingSheets
            .filter((sheet) => sheet.status === 'READY' || sheet.status === 'INVOICED')
            .reduce((rowSum, sheet) => rowSum + sheet.totalAmount, 0),
        0,
      ),
    };
  }, [workspace.rows]);

  if (authState.state === 'loading') {
    return <div className="min-h-screen bg-dns-bg" />;
  }

  if (authState.state === 'signed-out') {
    return (
      <LoginScreen
        language={language}
        onLanguageChange={setLanguage}
      />
    );
  }

  if (authState.state === 'denied') {
    return (
      <main className="dns-shell py-16">
        <section className="dns-card p-8">
          <h1 className="text-2xl font-semibold text-dns-deep">DNS FAKTURA</h1>
          <p className="mt-3 text-dns-muted">{t.denied}</p>
          <button
            type="button"
            className="dns-btn-secondary mt-6"
            onClick={() => void signOut()}
          >
            {t.signOut}
          </button>
        </section>
      </main>
    );
  }

  const coreHeader = formatDNSCoreHeaderStatus(
    core.state === 'ready'
      ? {
          state: 'ready',
          reportingAreas: core.reportingAreas,
          organizations: core.organizations,
        }
      : core.state === 'error'
        ? { state: 'error' }
        : { state: 'loading' },
    language,
  );

  const tabs: Array<{ id: ViewId; label: string }> = [
    { id: 'overview', label: t.overview },
    { id: 'orders', label: t.orders },
    { id: 'confirmations', label: t.confirmations },
    { id: 'billing', label: t.billing },
  ];

  const orderRows = workspace.rows.flatMap((row) =>
    row.orders.map((order) => ({
      ...order,
      organizationName: row.organizationName,
      quantity: order.lines.reduce(
        (sum, line) => sum + line.orderedQuantity,
        0,
      ),
    })),
  );

  const confirmationRows = workspace.rows.flatMap((row) =>
    row.confirmations.map((confirmation) => ({
      ...confirmation,
      organizationName: row.organizationName,
    })),
  );

  const billingRows = workspace.rows.flatMap((row) =>
    row.billingSheets.map((sheet) => ({
      ...sheet,
      organizationName: row.organizationName,
    })),
  );

  return (
    <div className="min-h-screen bg-dns-bg text-dns-deep">
<header data-dns-tool-header id="dns-faktura-header" className="bg-dns-deep text-white shadow-[0_1px_0_rgba(255,255,255,.08)]">
        <div className="dns-tool-header-shell">
          <div className="dns-tool-header-brand">
            <img
              src={DNS_LOGO_URL}
              alt="Dolomiti NordicSki"
              className="dns-tool-header-logo"
            />
            <div className="dns-tool-header-identity">
              <div className="dns-tool-header-title">
                <strong>DNS</strong> <span>FAKTURA</span>
              </div>
              <div className="dns-tool-header-subtitle">{t.subtitle}</div>
            </div>
          </div>

          <div className="dns-tool-header-actions">
            <div className="dns-tool-header-account">
              <div className="font-alt text-[10px] text-white/75">
                {authState.user.email ?? authState.user.uid}
              </div>
              <div className="mt-0.5 text-[9px] font-bold uppercase tracking-[.06em] text-dns-light">
                DNS Admin
              </div>
            </div>

            <div className="dns-tool-header-controls">
              <AccessibilityMount language={language} />
              <div className="dns-tool-header-language">
                {(['de', 'it'] as const).map((candidate) => (
                  <button
                    key={candidate}
                    type="button"
                    onClick={() => setLanguage(candidate)}
                    data-dns-press
                    aria-pressed={language === candidate}
                    className={[
                      'border-0 border-b-2 bg-transparent px-1 py-1 text-white',
                      language === candidate
                        ? 'border-white'
                        : 'border-transparent opacity-60',
                    ].join(' ')}
                  >
                    {candidate.toUpperCase()}
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

            <div
              className="dns-tool-header-status"
              data-state={coreHeader.state}
              aria-live="polite"
            >
              <span className="dns-tool-header-status-dot" />
              {coreHeader.text}
            </div>
          </div>
        </div>
      </header>

      <nav
        data-dns-tool-nav
        id="dns-faktura-nav"
        className="dns-tab-nav"
        aria-label="DNS Faktura"
      >
        <div className="dns-tab-nav-inner">
          <SeasonSelector
            seasons={SEASONS.slice().reverse()}
            selectedSeasonId={seasonId}
            language={language}
            onChange={setSeasonId}
          />
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              data-section={tab.id}
              className={['dns-tab', view === tab.id ? 'dns-tab-active' : '']
                .filter(Boolean)
                .join(' ')}
              aria-current={view === tab.id ? 'page' : undefined}
              onClick={() => setView(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      <main className="dns-shell py-8 md:py-10">
        <section className="dns-card p-5 md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="dns-kicker">DNS FAKTURA · V2</div>
              <h1 className="mt-1 text-[28px] font-semibold">{t.subtitle}</h1>
              <p className="mt-2 max-w-4xl font-alt text-[12px] leading-relaxed text-dns-muted">
                {t.cutover}
              </p>
            </div>
            <div className="text-right font-alt text-[11px] text-dns-muted">
              <div>{t.core}: {coreHeader.text}</div>
              <div>{t.foundation}: {DNS_FAKTURA_FOUNDATION_VERSION}</div>
            </div>
          </div>
        </section>

        {workspace.state === 'loading' && (
          <div className="mt-6 dns-card p-5 font-alt text-[12px] text-dns-muted">
            {t.loading}
          </div>
        )}

        {workspace.state === 'error' && (
          <div className="mt-6 dns-card p-5">
            <div className="dns-status is-error">{t.error}</div>
            <p className="mt-2 font-mono text-[11px] text-dns-muted">
              {workspace.error}
            </p>
          </div>
        )}

        {view === 'overview' && (
          <>
            <section className="mt-6 grid gap-4 md:grid-cols-3 xl:grid-cols-6">
              {[
                [t.organizations, totals.organizations],
                [t.submittedOrders, totals.orders],
                [t.activeConfirmations, totals.confirmations],
                [t.billingSheets, totals.billingSheets],
                [t.invoiced, totals.invoiced],
                [t.total, formatCurrency(totals.amount, language)],
              ].map(([label, value]) => (
                <article key={String(label)} className="dns-card p-4">
                  <div className="dns-kicker">{label}</div>
                  <div className="mt-2 text-[24px] font-semibold">{value}</div>
                </article>
              ))}
            </section>

            <section className="mt-6 dns-card overflow-hidden">
              <div className="border-b border-dns-mid/10 px-5 py-4">
                <h2 className="text-lg font-semibold">{t.organizations}</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="dns-table w-full">
                  <thead>
                    <tr>
                      <th>{t.organization}</th>
                      <th>{t.orders}</th>
                      <th>{t.confirmations}</th>
                      <th>{t.billingSheets}</th>
                      <th>{t.invoiced}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workspace.rows.map((row) => (
                      <tr key={row.organizationId}>
                        <td>{row.organizationName}</td>
                        <td>{row.orders.length}</td>
                        <td>{row.confirmations.length}</td>
                        <td>{row.billingSheets.length}</td>
                        <td>
                          {
                            row.billingSheets.filter(
                              (sheet) => sheet.status === 'INVOICED',
                            ).length
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {view === 'orders' && (
          <section className="mt-6 dns-card overflow-hidden">
            <div className="border-b border-dns-mid/10 px-5 py-4">
              <h2 className="text-lg font-semibold">{t.orders}</h2>
            </div>
            {orderRows.length === 0 ? (
              <p className="p-5 font-alt text-[12px] text-dns-muted">{t.noData}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="dns-table w-full">
                  <thead>
                    <tr>
                      <th>{t.orderId}</th>
                      <th>{t.organization}</th>
                      <th>{t.quantity}</th>
                      <th>{t.status}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderRows.map((order) => (
                      <tr key={order.id}>
                        <td className="font-mono text-[11px]">{order.id}</td>
                        <td>{order.organizationName}</td>
                        <td>{order.quantity}</td>
                        <td><span className="dns-status is-connected">{order.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {view === 'confirmations' && (
          <section className="mt-6 dns-card overflow-hidden">
            <div className="border-b border-dns-mid/10 px-5 py-4">
              <h2 className="text-lg font-semibold">{t.confirmations}</h2>
            </div>
            {confirmationRows.length === 0 ? (
              <p className="p-5 font-alt text-[12px] text-dns-muted">{t.noData}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="dns-table w-full">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>{t.organization}</th>
                      <th>{t.orderId}</th>
                      <th>{t.revision}</th>
                      <th>{t.status}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {confirmationRows.map((confirmation) => (
                      <tr key={confirmation.id}>
                        <td className="font-mono text-[11px]">{confirmation.id}</td>
                        <td>{confirmation.organizationName}</td>
                        <td className="font-mono text-[11px]">{confirmation.orderId}</td>
                        <td>{confirmation.revision}</td>
                        <td><span className="dns-status is-connected">{confirmation.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {view === 'billing' && (
          <section className="mt-6 dns-card overflow-hidden">
            <div className="border-b border-dns-mid/10 px-5 py-4">
              <h2 className="text-lg font-semibold">{t.billing}</h2>
            </div>
            {billingRows.length === 0 ? (
              <p className="p-5 font-alt text-[12px] text-dns-muted">{t.noData}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="dns-table w-full">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>{t.organization}</th>
                      <th>{t.revision}</th>
                      <th>{t.status}</th>
                      <th>{t.amount}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {billingRows.map((sheet) => (
                      <tr key={sheet.id}>
                        <td className="font-mono text-[11px]">{sheet.id}</td>
                        <td>{sheet.organizationName}</td>
                        <td>{sheet.revision}</td>
                        <td><span className="dns-status is-connected">{sheet.status}</span></td>
                        <td>{formatCurrency(sheet.totalAmount, language)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </main>

      <footer data-dns-tool-footer className="dns-footer">
        <div className="dns-shell flex flex-col gap-1 py-5 md:flex-row md:items-center md:justify-between">
          <span>Dolomiti NordicSki · DNS Faktura</span>
          <span>Order-to-Billing Workspace · {seasonId}</span>
        </div>
      </footer>
    </div>
  );
}

export default App;
