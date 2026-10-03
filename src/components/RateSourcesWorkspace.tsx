import { useEffect, useMemo, useState } from 'react';
import { ORGANIZATIONS } from '@dolomitinordicski/dns-shared-data';
import {
  loadRateConfiguration,
  roundUpToCent,
  saveRateConfiguration,
  type RateCatalogItem,
  type RateConfigRecord,
} from '../v2/adapters/rateConfigs';
import {
  loadSeasonalExtras,
  saveSeasonalExtra,
  type BillingUnitType,
  type SeasonalExtraRecord,
} from '../v2/adapters/seasonalExtras';
import { firebaseOrdersSource } from '../v2/adapters/liveSources';
import type { Order } from '../v2/domain/types';
import type { Language } from '../types';

type CanonicalOrganization = {
  id: string;
  canonicalName: string;
  active: boolean;
  reportingAreaIds: string[];
};

type OrderRateDraft = {
  unitPrice: string;
  documentLabel: string;
  supplier: string;
  documentDate: string;
  totalQuantity: string;
  totalAmount: string;
  packSize: string;
  packPriceNet: string;
  prepaymentRequired: boolean;
};

type ExtraMasterDraft = {
  description: string;
  kind: 'article' | 'service';
  billingUnit: BillingUnitType;
  billingUnitLabel: string;
  unitPrice: string;
  defaultQuantity: string;
  documentLabel: string;
  supplier: string;
  documentDate: string;
  notes: string;
};

type SelectedSource =
  | { type: 'order'; id: string }
  | { type: 'extra'; key: string }
  | null;

type ExtraGroup = {
  key: string;
  rows: SeasonalExtraRecord[];
  representative: SeasonalExtraRecord;
};

function parseOptional(value: string) {
  if (!value.trim()) return undefined;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseNumber(value: string) {
  return parseOptional(value) ?? 0;
}

function money(value: number | undefined, language: Language) {
  if (value === undefined) return '—';
  return new Intl.NumberFormat(language === 'de' ? 'de-DE' : 'it-IT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function labelFor(item: RateCatalogItem, language: Language) {
  return (
    item.label?.[language] ??
    item.label?.de ??
    item.label?.it ??
    item.label?.en ??
    item.code
  );
}

function slug(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

function extraGroupKey(extra: SeasonalExtraRecord) {
  return (
    extra.chargeCategory ||
    `legacy:${slug(extra.description)}:${extra.billingUnit}:${extra.unitAmount}`
  );
}

function orderDraft(rate?: RateConfigRecord): OrderRateDraft {
  return {
    unitPrice:
      rate?.billingUnitPrice !== undefined ? String(rate.billingUnitPrice) : '',
    documentLabel: rate?.source.documentLabel ?? '',
    supplier: rate?.source.supplier ?? '',
    documentDate: rate?.source.documentDate ?? '',
    totalQuantity:
      rate?.source.totalQuantity !== undefined
        ? String(rate.source.totalQuantity)
        : '',
    totalAmount:
      rate?.source.totalAmount !== undefined
        ? String(rate.source.totalAmount)
        : '',
    packSize:
      rate?.source.packSize !== undefined ? String(rate.source.packSize) : '',
    packPriceNet:
      rate?.source.packPriceNet !== undefined
        ? String(rate.source.packPriceNet)
        : '',
    prepaymentRequired: rate?.prepaymentRequired ?? true,
  };
}

function extraDraft(group: ExtraGroup): ExtraMasterDraft {
  const row = group.representative;
  const prefix = row.chargeCategory?.split(':')[0];
  return {
    description: row.description,
    kind: prefix === 'article' ? 'article' : 'service',
    billingUnit: row.billingUnit,
    billingUnitLabel: row.billingUnitLabel ?? '',
    unitPrice: String(row.unitAmount),
    defaultQuantity: '0',
    documentLabel: row.source.documentLabel,
    supplier: row.source.supplier ?? '',
    documentDate: row.source.documentDate ?? '',
    notes: row.notes ?? '',
  };
}

const EMPTY_EXTRA: ExtraMasterDraft = {
  description: '',
  kind: 'service',
  billingUnit: 'hour',
  billingUnitLabel: '',
  unitPrice: '',
  defaultQuantity: '0',
  documentLabel: '',
  supplier: '',
  documentDate: '',
  notes: '',
};

function quantitiesFor(
  orders: Order[],
  organizationId: string,
  catalogItemId: string,
) {
  let draft = 0;
  let submitted = 0;
  for (const order of orders) {
    if (order.organizationId !== organizationId) continue;
    const quantity = order.lines
      .filter((line) => line.catalogItemId === catalogItemId)
      .reduce((sum, line) => sum + line.orderedQuantity, 0);
    if (order.status === 'DRAFT') draft += quantity;
    else submitted += quantity;
  }
  return { draft, submitted, total: draft + submitted };
}

function totalQuantities(orders: Order[], catalogItemId: string) {
  return orders.reduce(
    (result, order) => {
      const quantity = order.lines
        .filter((line) => line.catalogItemId === catalogItemId)
        .reduce((sum, line) => sum + line.orderedQuantity, 0);
      if (order.status === 'DRAFT') result.draft += quantity;
      else result.submitted += quantity;
      result.total += quantity;
      return result;
    },
    { draft: 0, submitted: 0, total: 0 },
  );
}

export function RateSourcesWorkspace({
  seasonId,
  language,
  actorId,
}: {
  seasonId: string;
  language: Language;
  actorId: string;
}) {
  const [catalog, setCatalog] = useState<RateCatalogItem[]>([]);
  const [rates, setRates] = useState<RateConfigRecord[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [extras, setExtras] = useState<SeasonalExtraRecord[]>([]);
  const [orderDrafts, setOrderDrafts] = useState<Record<string, OrderRateDraft>>({});
  const [extraDrafts, setExtraDrafts] = useState<Record<string, ExtraMasterDraft>>({});
  const [extraQuantities, setExtraQuantities] = useState<Record<string, string>>({});
  const [newExtra, setNewExtra] = useState<ExtraMasterDraft>(EMPTY_EXTRA);
  const [selected, setSelected] = useState<SelectedSource>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  const copy =
    language === 'de'
      ? {
          title: 'Preisquellen',
          intro:
            'Eine Preisdefinition oben, Verteilung darunter. Bestellmengen kommen ausschließlich live aus DNS Data Entry. Zusätzliche Leistungen werden in DNS Core als billingSeasonalExtras geführt.',
          orderItems: 'Bestellartikel',
          extras: 'Zusätzliche Artikel / Leistungen',
          item: 'Artikel / Leistung',
          dataEntryQty: 'Data Entry Menge',
          draftQty: 'Entwurf',
          submittedQty: 'Eingereicht',
          unitPrice: 'Einzelpreis',
          source: 'Quelle / Angebot',
          apply: 'Anwenden',
          details: 'Quelldetails',
          organizations: 'Organisationen',
          organization: 'Organisation',
          amount: 'Betrag',
          quantity: 'Menge',
          origin: 'Mengenquelle',
          dataEntry: 'DNS Data Entry',
          coreExtra: 'DNS Core Extra',
          noSelection: 'Oben eine Position auswählen oder anwenden.',
          supplier: 'Lieferant',
          documentDate: 'Belegdatum',
          sourceQuantity: 'Belegmenge',
          sourceTotal: 'Beleg gesamt',
          packSize: 'Stk. / Pack',
          packPrice: 'Pack netto',
          calculated: 'Berechneter EK / Stk.',
          prepay: 'Vorauszahlung',
          add: 'Neue Position anwenden',
          type: 'Typ',
          article: 'Artikel',
          service: 'Leistung',
          unit: 'Einheit',
          defaultQty: 'Standardmenge',
          graphics: 'Grafikarbeiten',
          maps: 'Kartenarbeiten',
          presets: 'Vorlagen',
          saveQty: 'Menge speichern',
          saved: 'Gespeichert.',
          loading: 'Preisquellen werden geladen…',
          error: 'Preisquellen konnten nicht geladen werden.',
          noArea: 'Keine Reporting Area — nicht als Extra abrechenbar',
        }
      : {
          title: 'Fonti prezzo',
          intro:
            'Una definizione prezzo sopra, distribuzione sotto. Le quantità degli ordini arrivano esclusivamente live da DNS Data Entry. Le prestazioni aggiuntive restano in DNS Core come billingSeasonalExtras.',
          orderItems: 'Articoli da ordine',
          extras: 'Articoli / prestazioni aggiuntive',
          item: 'Articolo / Prestazione',
          dataEntryQty: 'Quantità Data Entry',
          draftQty: 'Bozza',
          submittedQty: 'Inviata',
          unitPrice: 'Costo unitario',
          source: 'Fonte / Offerta',
          apply: 'Applica',
          details: 'Dettagli fonte',
          organizations: 'Organizzazioni',
          organization: 'Organizzazione',
          amount: 'Importo',
          quantity: 'Quantità',
          origin: 'Fonte quantità',
          dataEntry: 'DNS Data Entry',
          coreExtra: 'DNS Core Extra',
          noSelection: 'Seleziona o applica una voce sopra.',
          supplier: 'Fornitore',
          documentDate: 'Data documento',
          sourceQuantity: 'Quantità documento',
          sourceTotal: 'Totale documento',
          packSize: 'Pz. / conf.',
          packPrice: 'Conf. netto',
          calculated: 'Costo calcolato / pz.',
          prepay: 'Prepagamento',
          add: 'Applica nuova voce',
          type: 'Tipo',
          article: 'Articolo',
          service: 'Prestazione',
          unit: 'Unità',
          defaultQty: 'Quantità standard',
          graphics: 'Lavori grafici',
          maps: 'Lavori mappe',
          presets: 'Preset',
          saveQty: 'Salva quantità',
          saved: 'Salvato.',
          loading: 'Caricamento fonti prezzo…',
          error: 'Impossibile caricare le fonti prezzo.',
          noArea: 'Nessuna Reporting Area — non fatturabile come extra',
        };

  const organizations = useMemo(
    () =>
      (ORGANIZATIONS as readonly CanonicalOrganization[])
        .filter((organization) => organization.active)
        .map((organization) => ({
          id: organization.id,
          name: organization.canonicalName,
          reportingAreaId: organization.reportingAreaIds[0],
        })),
    [],
  );

  const billableExtraOrganizations = useMemo(
    () => organizations.filter((organization) => organization.reportingAreaId),
    [organizations],
  );

  const rateByItem = useMemo(
    () => new Map(rates.map((rate) => [rate.catalogItemId, rate])),
    [rates],
  );

  const extraGroups = useMemo(() => {
    const grouped = new Map<string, SeasonalExtraRecord[]>();
    for (const extra of extras) {
      const key = extraGroupKey(extra);
      const rows = grouped.get(key) ?? [];
      rows.push(extra);
      grouped.set(key, rows);
    }
    return [...grouped.entries()]
      .map(([key, rows]): ExtraGroup => ({
        key,
        rows,
        representative: rows[0],
      }))
      .sort((a, b) =>
        a.representative.description.localeCompare(
          b.representative.description,
          'de',
        ),
      );
  }, [extras]);

  const extraGroupByKey = useMemo(
    () => new Map(extraGroups.map((group) => [group.key, group])),
    [extraGroups],
  );

  async function reload() {
    setState('loading');
    setMessage('');
    try {
      const [rateData, loadedOrders, loadedExtras] = await Promise.all([
        loadRateConfiguration(seasonId),
        firebaseOrdersSource.loadOrders(seasonId),
        loadSeasonalExtras(seasonId),
      ]);
      setCatalog(rateData.catalog);
      setRates(rateData.rates);
      setOrders(loadedOrders);
      setExtras(loadedExtras);
      setOrderDrafts(
        Object.fromEntries(
          rateData.catalog.map((item) => [
            item.id,
            orderDraft(
              rateData.rates.find((rate) => rate.catalogItemId === item.id),
            ),
          ]),
        ),
      );

      const groups = new Map<string, SeasonalExtraRecord[]>();
      for (const extra of loadedExtras) {
        const key = extraGroupKey(extra);
        groups.set(key, [...(groups.get(key) ?? []), extra]);
      }
      const grouped = [...groups.entries()].map(
        ([key, rows]): ExtraGroup => ({
          key,
          rows,
          representative: rows[0],
        }),
      );
      setExtraDrafts(
        Object.fromEntries(grouped.map((group) => [group.key, extraDraft(group)])),
      );
      setExtraQuantities(
        Object.fromEntries(
          loadedExtras.map((extra) => [extra.id, String(extra.quantity)]),
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

  function patchOrder(itemId: string, patch: Partial<OrderRateDraft>) {
    setOrderDrafts((current) => ({
      ...current,
      [itemId]: { ...current[itemId], ...patch },
    }));
  }

  function patchExtra(key: string, patch: Partial<ExtraMasterDraft>) {
    setExtraDrafts((current) => ({
      ...current,
      [key]: { ...current[key], ...patch },
    }));
  }

  async function applyOrder(item: RateCatalogItem) {
    const draft = orderDrafts[item.id] ?? orderDraft(rateByItem.get(item.id));
    const unitPrice = parseOptional(draft.unitPrice);
    if (unitPrice === undefined) {
      setMessage('INVALID_BILLING_UNIT_PRICE');
      return;
    }

    setBusy(`order:${item.id}`);
    setMessage('');
    try {
      await saveRateConfiguration({
        seasonId,
        catalogItemId: item.id,
        billingUnitPrice: roundUpToCent(unitPrice),
        documentLabel: draft.documentLabel,
        supplier: draft.supplier,
        documentDate: draft.documentDate,
        totalQuantity: parseOptional(draft.totalQuantity),
        totalAmount: parseOptional(draft.totalAmount),
        packSize: parseOptional(draft.packSize),
        packPriceNet: parseOptional(draft.packPriceNet),
        active: true,
        prepaymentRequired: draft.prepaymentRequired,
        actorId,
      });
      setSelected({ type: 'order', id: item.id });
      await reload();
      setMessage(copy.saved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('');
    }
  }

  async function applyExtraGroup(group: ExtraGroup) {
    const draft = extraDrafts[group.key] ?? extraDraft(group);
    const unitPrice = parseOptional(draft.unitPrice);
    if (unitPrice === undefined) {
      setMessage('INVALID_UNIT_PRICE');
      return;
    }

    setBusy(`extra:${group.key}`);
    setMessage('');
    try {
      const existingByOrg = new Map(
        group.rows.map((row) => [row.organizationId, row]),
      );

      await Promise.all(
        billableExtraOrganizations.map((organization) => {
          const existing = existingByOrg.get(organization.id);
          const quantity =
            existing?.quantity ?? parseNumber(draft.defaultQuantity);
          return saveSeasonalExtra({
            id:
              existing?.id ??
              `${seasonId}__extra__${group.key.replace(/[^a-zA-Z0-9_-]/g, '-') }__${organization.id}`,
            seasonId,
            organizationId: organization.id,
            reportingAreaId: organization.reportingAreaId!,
            description: draft.description,
            chargeCategory: group.key,
            billingUnit: draft.billingUnit,
            billingUnitLabel: draft.billingUnitLabel,
            quantity,
            unitAmount: roundUpToCent(unitPrice),
            documentLabel: draft.documentLabel,
            supplier: draft.supplier,
            documentDate: draft.documentDate,
            notes: draft.notes,
            expectedRevision: existing?.revision ?? 0,
            actorId,
          });
        }),
      );

      setSelected({ type: 'extra', key: group.key });
      await reload();
      setMessage(copy.saved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('');
    }
  }

  async function createExtra() {
    const unitPrice = parseOptional(newExtra.unitPrice);
    if (
      !newExtra.description.trim() ||
      !newExtra.documentLabel.trim() ||
      unitPrice === undefined
    ) {
      setMessage('DESCRIPTION_SOURCE_RATE_REQUIRED');
      return;
    }

    const key = `${newExtra.kind}:${slug(newExtra.description)}`;
    const defaultQuantity =
      newExtra.billingUnit === 'flat'
        ? 1
        : parseNumber(newExtra.defaultQuantity);

    setBusy('new-extra');
    setMessage('');
    try {
      await Promise.all(
        billableExtraOrganizations.map((organization) =>
          saveSeasonalExtra({
            id: `${seasonId}__extra__${key.replace(/[^a-zA-Z0-9_-]/g, '-') }__${organization.id}`,
            seasonId,
            organizationId: organization.id,
            reportingAreaId: organization.reportingAreaId!,
            description: newExtra.description,
            chargeCategory: key,
            billingUnit: newExtra.billingUnit,
            billingUnitLabel: newExtra.billingUnitLabel,
            quantity: defaultQuantity,
            unitAmount: roundUpToCent(unitPrice),
            documentLabel: newExtra.documentLabel,
            supplier: newExtra.supplier,
            documentDate: newExtra.documentDate,
            notes: newExtra.notes,
            expectedRevision: 0,
            actorId,
          }),
        ),
      );
      setNewExtra(EMPTY_EXTRA);
      setSelected({ type: 'extra', key });
      await reload();
      setMessage(copy.saved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('');
    }
  }

  async function saveExtraQuantity(extra: SeasonalExtraRecord) {
    const value = extraQuantities[extra.id] ?? String(extra.quantity);
    setBusy(`qty:${extra.id}`);
    setMessage('');
    try {
      await saveSeasonalExtra({
        id: extra.id,
        seasonId: extra.seasonId,
        organizationId: extra.organizationId,
        reportingAreaId: extra.reportingAreaId,
        description: extra.description,
        chargeCategory: extra.chargeCategory ?? extraGroupKey(extra),
        relatedCatalogItemId: extra.relatedCatalogItemId,
        billingUnit: extra.billingUnit,
        billingUnitLabel: extra.billingUnitLabel,
        quantity: parseNumber(value),
        unitAmount: extra.unitAmount,
        documentLabel: extra.source.documentLabel,
        supplier: extra.source.supplier,
        documentDate: extra.source.documentDate,
        notes: extra.notes,
        expectedRevision: extra.revision,
        actorId,
      });
      await reload();
      setMessage(copy.saved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('');
    }
  }

  if (state === 'loading') {
    return <section className="mt-6 dns-card p-5">{copy.loading}</section>;
  }

  if (state === 'error') {
    return (
      <section className="mt-6 dns-card p-5">
        <div className="dns-status is-error">{copy.error}</div>
        <div className="mt-2 font-mono text-[11px] text-dns-muted">{message}</div>
      </section>
    );
  }

  const selectedOrder =
    selected?.type === 'order'
      ? catalog.find((item) => item.id === selected.id)
      : undefined;
  const selectedRate = selectedOrder
    ? rateByItem.get(selectedOrder.id)
    : undefined;
  const selectedExtra =
    selected?.type === 'extra' ? extraGroupByKey.get(selected.key) : undefined;

  return (
    <div className="mt-6 grid gap-6">
      <section className="dns-card overflow-hidden">
        <div className="border-b border-dns-mid/10 px-5 py-4">
          <div className="dns-kicker">DNS FAKTURA · CORE SOURCES</div>
          <h2 className="mt-1 text-lg font-semibold">{copy.title}</h2>
          <p className="mt-2 max-w-5xl font-alt text-[11px] leading-relaxed text-dns-muted">
            {copy.intro}
          </p>
          {message && (
            <div className="mt-3 font-mono text-[10px] text-dns-mid">
              {message}
            </div>
          )}
        </div>

        <div className="p-5">
          <h3 className="text-[14px] font-semibold">{copy.orderItems}</h3>
          <div className="mt-3 overflow-x-auto">
            <table className="dns-table w-full">
              <thead>
                <tr>
                  <th>{copy.item}</th>
                  <th>{copy.dataEntryQty}</th>
                  <th>{copy.unitPrice}</th>
                  <th>{copy.source}</th>
                  <th>{copy.apply}</th>
                </tr>
              </thead>
              <tbody>
                {catalog.map((item) => {
                  const totals = totalQuantities(orders, item.id);
                  const draft =
                    orderDrafts[item.id] ?? orderDraft(rateByItem.get(item.id));
                  return (
                    <tr key={item.id}>
                      <td>
                        <button
                          type="button"
                          className="text-left font-semibold text-dns-deep hover:underline"
                          onClick={() => setSelected({ type: 'order', id: item.id })}
                        >
                          {labelFor(item, language)}
                        </button>
                        <div className="mt-0.5 font-mono text-[9px] text-dns-muted">
                          {item.category} · {item.code}
                        </div>
                      </td>
                      <td>
                        <strong>{totals.total}</strong>
                        <div className="font-alt text-[9px] text-dns-muted">
                          {copy.draftQty}: {totals.draft} · {copy.submittedQty}: {totals.submitted}
                        </div>
                      </td>
                      <td>
                        <input
                          className="dns-input !w-[100px] font-semibold"
                          inputMode="decimal"
                          value={draft.unitPrice}
                          onChange={(event) =>
                            patchOrder(item.id, { unitPrice: event.target.value })
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="dns-input !w-[230px]"
                          value={draft.documentLabel}
                          onChange={(event) =>
                            patchOrder(item.id, {
                              documentLabel: event.target.value,
                            })
                          }
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="dns-primary-button"
                          disabled={busy === `order:${item.id}`}
                          onClick={() => void applyOrder(item)}
                        >
                          {copy.apply}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-[14px] font-semibold">{copy.extras}</h3>
            <div className="flex items-center gap-2">
              <span className="dns-kicker">{copy.presets}</span>
              <button
                type="button"
                className="dns-btn-secondary"
                onClick={() =>
                  setNewExtra({
                    ...EMPTY_EXTRA,
                    description: 'Grafikarbeiten',
                    kind: 'service',
                    billingUnit: 'hour',
                  })
                }
              >
                {copy.graphics}
              </button>
              <button
                type="button"
                className="dns-btn-secondary"
                onClick={() =>
                  setNewExtra({
                    ...EMPTY_EXTRA,
                    description: 'Kartenarbeiten',
                    kind: 'service',
                    billingUnit: 'hour',
                  })
                }
              >
                {copy.maps}
              </button>
            </div>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="dns-table w-full">
              <thead>
                <tr>
                  <th>{copy.item}</th>
                  <th>{copy.type}</th>
                  <th>{copy.unit}</th>
                  <th>{copy.unitPrice}</th>
                  <th>{copy.source}</th>
                  <th>{copy.apply}</th>
                </tr>
              </thead>
              <tbody>
                {extraGroups.map((group) => {
                  const draft =
                    extraDrafts[group.key] ?? extraDraft(group);
                  return (
                    <tr key={group.key}>
                      <td>
                        <button
                          type="button"
                          className="text-left font-semibold text-dns-deep hover:underline"
                          onClick={() =>
                            setSelected({ type: 'extra', key: group.key })
                          }
                        >
                          {draft.description}
                        </button>
                      </td>
                      <td>{draft.kind === 'article' ? copy.article : copy.service}</td>
                      <td>{draft.billingUnit}</td>
                      <td>
                        <input
                          className="dns-input !w-[100px] font-semibold"
                          inputMode="decimal"
                          value={draft.unitPrice}
                          onChange={(event) =>
                            patchExtra(group.key, {
                              unitPrice: event.target.value,
                            })
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="dns-input !w-[230px]"
                          value={draft.documentLabel}
                          onChange={(event) =>
                            patchExtra(group.key, {
                              documentLabel: event.target.value,
                            })
                          }
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="dns-primary-button"
                          disabled={busy === `extra:${group.key}`}
                          onClick={() => void applyExtraGroup(group)}
                        >
                          {copy.apply}
                        </button>
                      </td>
                    </tr>
                  );
                })}

                <tr className="bg-dns-bg/50">
                  <td>
                    <input
                      className="dns-input !w-[220px]"
                      value={newExtra.description}
                      placeholder={copy.item}
                      onChange={(event) =>
                        setNewExtra((current) => ({
                          ...current,
                          description: event.target.value,
                        }))
                      }
                    />
                  </td>
                  <td>
                    <select
                      className="dns-input !w-[110px]"
                      value={newExtra.kind}
                      onChange={(event) =>
                        setNewExtra((current) => ({
                          ...current,
                          kind: event.target.value as 'article' | 'service',
                        }))
                      }
                    >
                      <option value="article">{copy.article}</option>
                      <option value="service">{copy.service}</option>
                    </select>
                  </td>
                  <td>
                    <select
                      className="dns-input !w-[100px]"
                      value={newExtra.billingUnit}
                      onChange={(event) =>
                        setNewExtra((current) => ({
                          ...current,
                          billingUnit: event.target.value as BillingUnitType,
                        }))
                      }
                    >
                      <option value="piece">piece</option>
                      <option value="hour">hour</option>
                      <option value="flat">flat</option>
                      <option value="km">km</option>
                      <option value="other">other</option>
                    </select>
                  </td>
                  <td>
                    <input
                      className="dns-input !w-[100px]"
                      inputMode="decimal"
                      value={newExtra.unitPrice}
                      onChange={(event) =>
                        setNewExtra((current) => ({
                          ...current,
                          unitPrice: event.target.value,
                        }))
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="dns-input !w-[230px]"
                      value={newExtra.documentLabel}
                      onChange={(event) =>
                        setNewExtra((current) => ({
                          ...current,
                          documentLabel: event.target.value,
                        }))
                      }
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="dns-primary-button"
                      disabled={busy === 'new-extra'}
                      onClick={() => void createExtra()}
                    >
                      {copy.add}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {selectedOrder && (
        <section className="dns-card overflow-hidden">
          <div className="border-b border-dns-mid/10 px-5 py-4">
            <div className="dns-kicker">{copy.details}</div>
            <h3 className="mt-1 text-lg font-semibold">
              {labelFor(selectedOrder, language)}
            </h3>
          </div>

          <div className="grid gap-4 border-b border-dns-mid/10 p-5 md:grid-cols-3 xl:grid-cols-6">
            {(() => {
              const draft =
                orderDrafts[selectedOrder.id] ?? orderDraft(selectedRate);
              const sourceQuantity = parseOptional(draft.totalQuantity);
              const sourceTotal = parseOptional(draft.totalAmount);
              const packSize = parseOptional(draft.packSize);
              const packPrice = parseOptional(draft.packPriceNet);
              const calculated =
                packSize && packPrice !== undefined
                  ? roundUpToCent(packPrice / packSize)
                  : sourceQuantity && sourceTotal !== undefined
                    ? roundUpToCent(sourceTotal / sourceQuantity)
                    : selectedRate?.source.calculatedPurchaseUnitPrice;
              return (
                <>
                  <label className="font-alt text-[10px]">
                    {copy.supplier}
                    <input
                      className="dns-input mt-1 !w-full"
                      value={draft.supplier}
                      onChange={(event) =>
                        patchOrder(selectedOrder.id, {
                          supplier: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="font-alt text-[10px]">
                    {copy.documentDate}
                    <input
                      type="date"
                      className="dns-input mt-1 !w-full"
                      value={draft.documentDate}
                      onChange={(event) =>
                        patchOrder(selectedOrder.id, {
                          documentDate: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="font-alt text-[10px]">
                    {copy.sourceQuantity}
                    <input
                      className="dns-input mt-1 !w-full"
                      inputMode="decimal"
                      value={draft.totalQuantity}
                      onChange={(event) =>
                        patchOrder(selectedOrder.id, {
                          totalQuantity: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="font-alt text-[10px]">
                    {copy.sourceTotal}
                    <input
                      className="dns-input mt-1 !w-full"
                      inputMode="decimal"
                      value={draft.totalAmount}
                      onChange={(event) =>
                        patchOrder(selectedOrder.id, {
                          totalAmount: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="font-alt text-[10px]">
                    {copy.packSize} / {copy.packPrice}
                    <div className="mt-1 flex gap-1">
                      <input
                        className="dns-input !w-1/2"
                        inputMode="decimal"
                        value={draft.packSize}
                        onChange={(event) =>
                          patchOrder(selectedOrder.id, {
                            packSize: event.target.value,
                          })
                        }
                      />
                      <input
                        className="dns-input !w-1/2"
                        inputMode="decimal"
                        value={draft.packPriceNet}
                        onChange={(event) =>
                          patchOrder(selectedOrder.id, {
                            packPriceNet: event.target.value,
                          })
                        }
                      />
                    </div>
                  </label>
                  <div className="font-alt text-[10px]">
                    {copy.calculated}
                    <div className="mt-2 text-[20px] font-semibold text-dns-deep">
                      {money(calculated, language)}
                    </div>
                    <label className="mt-2 flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={draft.prepaymentRequired}
                        onChange={(event) =>
                          patchOrder(selectedOrder.id, {
                            prepaymentRequired: event.target.checked,
                          })
                        }
                      />
                      {copy.prepay}
                    </label>
                  </div>
                </>
              );
            })()}
          </div>

          <div className="overflow-x-auto">
            <table className="dns-table w-full">
              <thead>
                <tr>
                  <th>{copy.organization}</th>
                  <th>{copy.draftQty}</th>
                  <th>{copy.submittedQty}</th>
                  <th>{copy.quantity}</th>
                  <th>{copy.unitPrice}</th>
                  <th>{copy.amount}</th>
                  <th>{copy.origin}</th>
                </tr>
              </thead>
              <tbody>
                {organizations.map((organization) => {
                  const quantities = quantitiesFor(
                    orders,
                    organization.id,
                    selectedOrder.id,
                  );
                  const unitPrice = parseOptional(
                    orderDrafts[selectedOrder.id]?.unitPrice ??
                      String(selectedRate?.billingUnitPrice ?? ''),
                  );
                  return (
                    <tr key={organization.id}>
                      <td>{organization.name}</td>
                      <td>{quantities.draft}</td>
                      <td>{quantities.submitted}</td>
                      <td className="font-semibold">{quantities.total}</td>
                      <td>{money(unitPrice, language)}</td>
                      <td>
                        {money(
                          unitPrice !== undefined
                            ? quantities.total * unitPrice
                            : undefined,
                          language,
                        )}
                      </td>
                      <td>
                        <span className="dns-status is-connected">
                          {copy.dataEntry}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {selectedExtra && (
        <section className="dns-card overflow-hidden">
          <div className="border-b border-dns-mid/10 px-5 py-4">
            <div className="dns-kicker">{copy.organizations}</div>
            <h3 className="mt-1 text-lg font-semibold">
              {selectedExtra.representative.description}
            </h3>
          </div>

          <div className="overflow-x-auto">
            <table className="dns-table w-full">
              <thead>
                <tr>
                  <th>{copy.organization}</th>
                  <th>{copy.quantity}</th>
                  <th>{copy.unit}</th>
                  <th>{copy.unitPrice}</th>
                  <th>{copy.amount}</th>
                  <th>{copy.origin}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {organizations.map((organization) => {
                  const extra = selectedExtra.rows.find(
                    (row) => row.organizationId === organization.id,
                  );
                  if (!organization.reportingAreaId) {
                    return (
                      <tr key={organization.id}>
                        <td>{organization.name}</td>
                        <td colSpan={6} className="font-alt text-[10px] text-dns-muted">
                          {copy.noArea}
                        </td>
                      </tr>
                    );
                  }
                  if (!extra) return null;
                  const quantity =
                    extraQuantities[extra.id] ?? String(extra.quantity);
                  return (
                    <tr key={organization.id}>
                      <td>{organization.name}</td>
                      <td>
                        <input
                          className="dns-input !w-[100px]"
                          inputMode="decimal"
                          value={quantity}
                          onChange={(event) =>
                            setExtraQuantities((current) => ({
                              ...current,
                              [extra.id]: event.target.value,
                            }))
                          }
                        />
                      </td>
                      <td>
                        {extra.billingUnit === 'other'
                          ? extra.billingUnitLabel
                          : extra.billingUnit}
                      </td>
                      <td>{money(extra.unitAmount, language)}</td>
                      <td>
                        {money(
                          parseNumber(quantity) * extra.unitAmount,
                          language,
                        )}
                      </td>
                      <td>
                        <span className="dns-status is-connected">
                          {copy.coreExtra}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="dns-btn-secondary"
                          disabled={busy === `qty:${extra.id}`}
                          onClick={() => void saveExtraQuantity(extra)}
                        >
                          {copy.saveQty}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!selected && (
        <section className="dns-card p-5 font-alt text-[11px] text-dns-muted">
          {copy.noSelection}
        </section>
      )}
    </div>
  );
}
