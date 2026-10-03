import { useEffect, useMemo, useState } from 'react';
import { ORGANIZATIONS } from '@dolomitinordicski/dns-shared-data';
import type { Language } from '../types';
import { OrganizationIdentity } from './OrganizationIdentity';
import { firebaseOrdersSource } from '../v2/adapters/liveSources';
import {
  loadRateConfiguration,
  roundUpToCent,
  saveRateConfiguration,
  type RateCatalogItem,
  type RateConfigRecord,
} from '../v2/adapters/rateConfigs';
import {
  loadSeasonalExtras,
  upsertSeasonalExtra,
} from '../v2/adapters/seasonalExtras';

type CanonicalOrganization = {
  id: string;
  canonicalName: string;
  active: boolean;
  reportingAreaIds: string[];
};

type ArticleMaster = {
  kind: 'order';
  id: string;
  item: RateCatalogItem;
  quantity: number;
  rate?: RateConfigRecord;
};

type ServiceMaster = {
  kind: 'service';
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  supplier?: string;
  sourceDocument?: string;
};

type Master = ArticleMaster | ServiceMaster;

type NewServiceDraft = {
  description: string;
  unitPrice: string;
  defaultQuantity: string;
  supplier: string;
  sourceDocument: string;
};

function labelFor(item: RateCatalogItem, language: Language) {
  return (
    item.label?.[language] ??
    item.label?.de ??
    item.label?.it ??
    item.label?.en ??
    item.code
  );
}

function money(value: number, language: Language) {
  return new Intl.NumberFormat(language === 'de' ? 'de-DE' : 'it-IT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function parseNumber(value: string) {
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function slug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function RateSourcesWorkspace({
  seasonId,
  language,
  actorId,
  organizationLogos,
}: {
  seasonId: string;
  language: Language;
  actorId: string;
  organizationLogos: Record<string, string>;
}) {
  const [catalog, setCatalog] = useState<RateCatalogItem[]>([]);
  const [rates, setRates] = useState<RateConfigRecord[]>([]);
  const [orders, setOrders] = useState<Awaited<ReturnType<typeof firebaseOrdersSource.loadOrders>>>([]);
  const [extras, setExtras] = useState<Awaited<ReturnType<typeof loadSeasonalExtras>>>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rateDrafts, setRateDrafts] = useState<Record<string, string>>({});
  const [serviceDraft, setServiceDraft] = useState<NewServiceDraft>({
    description: '',
    unitPrice: '',
    defaultQuantity: '1',
    supplier: '',
    sourceDocument: '',
  });
  const [serviceQuantities, setServiceQuantities] = useState<Record<string, string>>({});
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const t =
    language === 'de'
      ? {
          title: 'Preisquellen / Tarife',
          intro:
            'Oben wird der gemeinsame Artikel- bzw. Leistungspreis gepflegt. Unten siehst du die daraus resultierenden Mengen und Beträge je Organisation. Mengen der Order-Artikel kommen ausschließlich aus DNS Data Entry / DNS Core.',
          article: 'Artikel / Leistung',
          quantity: 'Gesamtmenge',
          unitPrice: 'Preis / Einheit',
          source: 'Quelle',
          revision: 'Rev.',
          apply: 'Anwenden',
          organizations: 'Organisationen',
          orgQuantity: 'Menge',
          amount: 'Betrag',
          dataEntry: 'DNS Data Entry',
          addService: 'Leistung hinzufügen',
          description: 'Bezeichnung',
          defaultQty: 'Standardmenge',
          supplier: 'Lieferant',
          sourceDoc: 'Quelle / Angebot',
          createApply: 'Anlegen & anwenden',
          serviceHint:
            'Beispiel: Grafikarbeiten und Kartenarbeiten als zwei getrennte Leistungen anlegen.',
          noSource: 'Keine Quelle',
          loading: 'Preisquellen werden geladen…',
          error: 'Preisquellen konnten nicht geladen werden.',
          saved: 'Gespeichert.',
          readOnlyQty: 'aus Data Entry',
          select: 'Zeile auswählen',
        }
      : {
          title: 'Fonti prezzo / Tariffe',
          intro:
            'In alto si gestisce il prezzo comune dell’articolo o prestazione. In basso vedi quantità e importi risultanti per organizzazione. Le quantità degli articoli ordinati arrivano esclusivamente da DNS Data Entry / DNS Core.',
          article: 'Articolo / Prestazione',
          quantity: 'Quantità totale',
          unitPrice: 'Prezzo / unità',
          source: 'Fonte',
          revision: 'Rev.',
          apply: 'Applica',
          organizations: 'Organizzazioni',
          orgQuantity: 'Quantità',
          amount: 'Importo',
          dataEntry: 'DNS Data Entry',
          addService: 'Aggiungi prestazione',
          description: 'Descrizione',
          defaultQty: 'Quantità standard',
          supplier: 'Fornitore',
          sourceDoc: 'Fonte / Offerta',
          createApply: 'Crea e applica',
          serviceHint:
            'Esempio: lavori grafici e lavori cartografici come due prestazioni separate.',
          noSource: 'Nessuna fonte',
          loading: 'Caricamento fonti prezzo…',
          error: 'Impossibile caricare le fonti prezzo.',
          saved: 'Salvato.',
          readOnlyQty: 'da Data Entry',
          select: 'Seleziona riga',
        };

  const organizations = useMemo(
    () =>
      (ORGANIZATIONS as readonly CanonicalOrganization[])
        .filter((organization) => organization.active && organization.reportingAreaIds.length > 0)
        .map((organization) => ({
          id: organization.id,
          name: organization.canonicalName,
          reportingAreaId: organization.reportingAreaIds[0],
        })),
    [],
  );

  async function reload() {
    setState('loading');
    setMessage('');
    try {
      const [rateData, orderData, extraData] = await Promise.all([
        loadRateConfiguration(seasonId),
        firebaseOrdersSource.loadOrders(seasonId),
        loadSeasonalExtras(seasonId),
      ]);
      setCatalog(rateData.catalog);
      setRates(rateData.rates);
      setOrders(orderData);
      setExtras(extraData);
      setRateDrafts(
        Object.fromEntries(
          rateData.rates.map((rate) => [rate.catalogItemId, String(rate.billingUnitPrice)]),
        ),
      );
      setState('ready');
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  useEffect(() => {
    void reload();
  }, [seasonId]);

  const orderQuantityByItem = useMemo(() => {
    const result = new Map<string, number>();
    for (const order of orders) {
      for (const line of order.lines) {
        result.set(
          line.catalogItemId,
          (result.get(line.catalogItemId) ?? 0) + line.orderedQuantity,
        );
      }
    }
    return result;
  }, [orders]);

  const rateByItem = useMemo(
    () => new Map(rates.map((rate) => [rate.catalogItemId, rate])),
    [rates],
  );

  const articleMasters = useMemo<ArticleMaster[]>(
    () =>
      catalog
        .filter(
          (item) =>
            (orderQuantityByItem.get(item.id) ?? 0) > 0 || rateByItem.has(item.id),
        )
        .map((item) => ({
          kind: 'order',
          id: `order:${item.id}`,
          item,
          quantity: orderQuantityByItem.get(item.id) ?? 0,
          rate: rateByItem.get(item.id),
        }))
        .sort((a, b) => labelFor(a.item, language).localeCompare(labelFor(b.item, language), language)),
    [catalog, language, orderQuantityByItem, rateByItem],
  );

  const serviceMasters = useMemo<ServiceMaster[]>(() => {
    const groups = new Map<string, typeof extras>();
    for (const extra of extras) {
      const key = extra.description.trim().toLocaleLowerCase();
      const group = groups.get(key) ?? [];
      group.push(extra);
      groups.set(key, group);
    }

    return [...groups.entries()]
      .map(([key, group]) => ({
        kind: 'service' as const,
        id: `service:${key}`,
        description: group[0].description,
        quantity: group.reduce((sum, extra) => sum + extra.quantity, 0),
        unitPrice: group[0].unitAmount,
        supplier: group[0].source.supplier,
        sourceDocument: group[0].source.documentLabel,
      }))
      .sort((a, b) => a.description.localeCompare(b.description, language));
  }, [extras, language]);

  const masters: Master[] = [...articleMasters, ...serviceMasters];
  const selected = masters.find((master) => master.id === selectedId) ?? masters[0] ?? null;

  useEffect(() => {
    if (!selectedId && masters.length) setSelectedId(masters[0].id);
  }, [masters, selectedId]);

  const selectedArticleOrgRows = useMemo(() => {
    if (!selected || selected.kind !== 'order') return [];
    const price = selected.rate?.billingUnitPrice ?? 0;

    return organizations.map((organization) => {
      const quantity = orders
        .filter((order) => order.organizationId === organization.id)
        .flatMap((order) => order.lines)
        .filter((line) => line.catalogItemId === selected.item.id)
        .reduce((sum, line) => sum + line.orderedQuantity, 0);

      return {
        ...organization,
        quantity,
        unitPrice: price,
        amount: Math.round(quantity * price * 100) / 100,
      };
    });
  }, [orders, organizations, selected]);

  const selectedServiceOrgRows = useMemo(() => {
    if (!selected || selected.kind !== 'service') return [];

    return organizations.map((organization) => {
      const extra = extras.find(
        (candidate) =>
          candidate.organizationId === organization.id &&
          candidate.description.trim().toLocaleLowerCase() ===
            selected.description.trim().toLocaleLowerCase(),
      );
      const quantity = extra?.quantity ?? 0;
      const unitPrice = extra?.unitAmount ?? selected.unitPrice;
      return {
        ...organization,
        extra,
        quantity,
        unitPrice,
        amount: Math.round(quantity * unitPrice * 100) / 100,
      };
    });
  }, [extras, organizations, selected]);

  async function saveArticle(master: ArticleMaster) {
    const raw = parseNumber(rateDrafts[master.item.id] ?? '');
    if (raw === undefined) {
      setMessage('INVALID_BILLING_UNIT_PRICE');
      return;
    }

    const normalized = roundUpToCent(raw);
    setBusy(master.id);
    setMessage('');
    try {
      await saveRateConfiguration({
        seasonId,
        catalogItemId: master.item.id,
        billingUnitPrice: normalized,
        documentLabel:
          master.rate?.source.documentLabel ?? 'DNS Faktura · manuelle Preisfreigabe',
        supplier: master.rate?.source.supplier,
        documentDate: master.rate?.source.documentDate,
        totalQuantity: master.rate?.source.totalQuantity,
        totalAmount: master.rate?.source.totalAmount,
        packSize: master.rate?.source.packSize,
        packPriceNet: master.rate?.source.packPriceNet,
        active: true,
        prepaymentRequired: master.rate?.prepaymentRequired ?? true,
        notes: master.rate?.notes,
        actorId,
      });
      setMessage(t.saved);
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function createService() {
    const unitPriceRaw = parseNumber(serviceDraft.unitPrice);
    const quantityRaw = parseNumber(serviceDraft.defaultQuantity);
    if (
      !serviceDraft.description.trim() ||
      unitPriceRaw === undefined ||
      quantityRaw === undefined ||
      quantityRaw < 0
    ) {
      setMessage('INVALID_SEASONAL_EXTRA');
      return;
    }

    const description = serviceDraft.description.trim();
    const key = slug(description);
    const unitPrice = roundUpToCent(unitPriceRaw);
    const documentLabel =
      serviceDraft.sourceDocument.trim() || 'DNS Faktura · manuelle Leistung';

    setBusy('new-service');
    setMessage('');
    try {
      for (const organization of organizations) {
        const existing = extras.find(
          (candidate) =>
            candidate.organizationId === organization.id &&
            candidate.description.trim().toLocaleLowerCase() ===
              description.toLocaleLowerCase(),
        );

        await upsertSeasonalExtra({
          id: existing?.id ?? `${seasonId}__seasonal-extra__${key}__${organization.id}`,
          seasonId,
          organizationId: organization.id,
          reportingAreaId: organization.reportingAreaId,
          description,
          quantity: existing?.quantity ?? quantityRaw,
          unitAmount: unitPrice,
          documentLabel,
          supplier: serviceDraft.supplier,
          actorId,
        });
      }

      setServiceDraft({
        description: '',
        unitPrice: '',
        defaultQuantity: '1',
        supplier: '',
        sourceDocument: '',
      });
      setMessage(t.saved);
      await reload();
      setSelectedId(`service:${description.toLocaleLowerCase()}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function saveServiceQuantity(
    master: ServiceMaster,
    organization: (typeof organizations)[number],
    quantity: number,
  ) {
    const existing = extras.find(
      (candidate) =>
        candidate.organizationId === organization.id &&
        candidate.description.trim().toLocaleLowerCase() ===
          master.description.trim().toLocaleLowerCase(),
    );

    setBusy(`${master.id}:${organization.id}`);
    try {
      await upsertSeasonalExtra({
        id:
          existing?.id ??
          `${seasonId}__seasonal-extra__${slug(master.description)}__${organization.id}`,
        seasonId,
        organizationId: organization.id,
        reportingAreaId: organization.reportingAreaId,
        description: master.description,
        quantity,
        unitAmount: master.unitPrice,
        documentLabel: master.sourceDocument ?? 'DNS Faktura · manuelle Leistung',
        supplier: master.supplier,
        actorId,
      });
      setMessage(t.saved);
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  if (state === 'loading') {
    return <section className="mt-6 dns-card p-5">{t.loading}</section>;
  }

  if (state === 'error') {
    return (
      <section className="mt-6 dns-card p-5">
        <div className="dns-status is-error">{t.error}</div>
        <div className="mt-2 font-mono text-[11px] text-dns-muted">{message}</div>
      </section>
    );
  }

  return (
    <div className="mt-6 grid gap-6">
      <section className="dns-card overflow-hidden">
        <div className="border-b border-dns-mid/10 px-5 py-4">
          <div className="dns-kicker">DNS CORE · COMMERCIAL SOURCES</div>
          <h2 className="mt-1 text-lg font-semibold">{t.title}</h2>
          <p className="mt-2 max-w-5xl font-alt text-[11px] leading-relaxed text-dns-muted">
            {t.intro}
          </p>
          {message && (
            <div className="mt-3 font-mono text-[10px] text-dns-mid">{message}</div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="dns-table w-full">
            <thead>
              <tr>
                <th>{t.article}</th>
                <th>{t.quantity}</th>
                <th>{t.unitPrice}</th>
                <th>{t.source}</th>
                <th>{t.revision}</th>
                <th>{t.apply}</th>
              </tr>
            </thead>
            <tbody>
              {articleMasters.map((master) => {
                const draft =
                  rateDrafts[master.item.id] ??
                  (master.rate ? String(master.rate.billingUnitPrice) : '');
                return (
                  <tr
                    key={master.id}
                    className={selected?.id === master.id ? 'bg-dns-bg/70' : ''}
                    onClick={() => setSelectedId(master.id)}
                  >
                    <td>
                      <div className="font-medium">{labelFor(master.item, language)}</div>
                      <div className="mt-1 font-mono text-[9px] text-dns-muted">
                        {master.item.category} · {t.dataEntry}
                      </div>
                    </td>
                    <td className="tabular-nums">
                      {master.quantity}
                      <div className="font-alt text-[9px] text-dns-muted">{t.readOnlyQty}</div>
                    </td>
                    <td onClick={(event) => event.stopPropagation()}>
                      <input
                        className="dns-input !w-[110px]"
                        inputMode="decimal"
                        value={draft}
                        onChange={(event) =>
                          setRateDrafts((current) => ({
                            ...current,
                            [master.item.id]: event.target.value,
                          }))
                        }
                      />
                    </td>
                    <td className="max-w-[260px] font-alt text-[10px] text-dns-muted">
                      {master.rate?.source.documentLabel ?? t.noSource}
                    </td>
                    <td>{master.rate?.revision ?? '—'}</td>
                    <td onClick={(event) => event.stopPropagation()}>
                      <button
                        type="button"
                        className="dns-primary-button"
                        disabled={busy === master.id}
                        onClick={() => void saveArticle(master)}
                      >
                        {t.apply}
                      </button>
                    </td>
                  </tr>
                );
              })}

              {serviceMasters.map((master) => (
                <tr
                  key={master.id}
                  className={selected?.id === master.id ? 'bg-dns-bg/70' : ''}
                  onClick={() => setSelectedId(master.id)}
                >
                  <td>
                    <div className="font-medium">{master.description}</div>
                    <div className="mt-1 font-mono text-[9px] text-dns-muted">
                      MANUAL_SERVICE · billingSeasonalExtras
                    </div>
                  </td>
                  <td>{master.quantity}</td>
                  <td>{money(master.unitPrice, language)}</td>
                  <td className="max-w-[260px] font-alt text-[10px] text-dns-muted">
                    {master.sourceDocument ?? t.noSource}
                  </td>
                  <td>Core</td>
                  <td>
                    <button
                      type="button"
                      className="dns-btn-secondary"
                      onClick={() => setSelectedId(master.id)}
                    >
                      {t.select}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border-t border-dns-mid/10 bg-dns-bg/35 p-5">
          <div className="dns-kicker">{t.addService}</div>
          <p className="mt-1 font-alt text-[10px] text-dns-muted">{t.serviceHint}</p>
          <div className="mt-3 grid gap-2 lg:grid-cols-[1.4fr_120px_120px_1fr_1fr_auto]">
            <input
              className="dns-input !w-full"
              placeholder={t.description}
              value={serviceDraft.description}
              onChange={(event) =>
                setServiceDraft((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
            />
            <input
              className="dns-input !w-full"
              inputMode="decimal"
              placeholder={t.unitPrice}
              value={serviceDraft.unitPrice}
              onChange={(event) =>
                setServiceDraft((current) => ({
                  ...current,
                  unitPrice: event.target.value,
                }))
              }
            />
            <input
              className="dns-input !w-full"
              inputMode="decimal"
              placeholder={t.defaultQty}
              value={serviceDraft.defaultQuantity}
              onChange={(event) =>
                setServiceDraft((current) => ({
                  ...current,
                  defaultQuantity: event.target.value,
                }))
              }
            />
            <input
              className="dns-input !w-full"
              placeholder={t.supplier}
              value={serviceDraft.supplier}
              onChange={(event) =>
                setServiceDraft((current) => ({
                  ...current,
                  supplier: event.target.value,
                }))
              }
            />
            <input
              className="dns-input !w-full"
              placeholder={t.sourceDoc}
              value={serviceDraft.sourceDocument}
              onChange={(event) =>
                setServiceDraft((current) => ({
                  ...current,
                  sourceDocument: event.target.value,
                }))
              }
            />
            <button
              type="button"
              className="dns-primary-button"
              disabled={busy === 'new-service'}
              onClick={() => void createService()}
            >
              {t.createApply}
            </button>
          </div>
        </div>
      </section>

      {selected && (
        <section className="dns-card overflow-hidden">
          <div className="border-b border-dns-mid/10 px-5 py-4">
            <div className="dns-kicker">{t.organizations}</div>
            <h3 className="mt-1 text-lg font-semibold">
              {selected.kind === 'order'
                ? labelFor(selected.item, language)
                : selected.description}
            </h3>
          </div>

          <div className="overflow-x-auto">
            <table className="dns-table w-full">
              <thead>
                <tr>
                  <th>{t.organizations}</th>
                  <th>{t.orgQuantity}</th>
                  <th>{t.unitPrice}</th>
                  <th>{t.amount}</th>
                </tr>
              </thead>
              <tbody>
                {selected.kind === 'order'
                  ? selectedArticleOrgRows.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <OrganizationIdentity
                            organizationId={row.id}
                            organizationName={row.name}
                            logoUrl={organizationLogos[row.id]}
                          />
                        </td>
                        <td>
                          {row.quantity}
                          <div className="font-alt text-[9px] text-dns-muted">
                            {t.readOnlyQty}
                          </div>
                        </td>
                        <td>{money(row.unitPrice, language)}</td>
                        <td className="font-semibold">{money(row.amount, language)}</td>
                      </tr>
                    ))
                  : selectedServiceOrgRows.map((row) => {
                      const key = `${selected.id}:${row.id}`;
                      const draft = serviceQuantities[key] ?? String(row.quantity);
                      return (
                        <tr key={row.id}>
                          <td>
                            <OrganizationIdentity
                              organizationId={row.id}
                              organizationName={row.name}
                              logoUrl={organizationLogos[row.id]}
                            />
                          </td>
                          <td>
                            <input
                              className="dns-input !w-[100px]"
                              inputMode="decimal"
                              value={draft}
                              onChange={(event) =>
                                setServiceQuantities((current) => ({
                                  ...current,
                                  [key]: event.target.value,
                                }))
                              }
                              onBlur={() => {
                                const quantity = parseNumber(draft);
                                if (quantity !== undefined) {
                                  void saveServiceQuantity(selected, row, quantity);
                                }
                              }}
                            />
                          </td>
                          <td>{money(row.unitPrice, language)}</td>
                          <td className="font-semibold">
                            {money(
                              Math.round(
                                (parseNumber(draft) ?? row.quantity) *
                                  row.unitPrice *
                                  100,
                              ) / 100,
                              language,
                            )}
                          </td>
                        </tr>
                      );
                    })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
