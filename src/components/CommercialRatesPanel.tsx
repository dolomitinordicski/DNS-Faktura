import { useEffect, useMemo, useState } from 'react';
import type { BillingCommercialRate } from '@dolomitinordicski/dns-shared-data';
import type { OrdersSourceSnapshot } from '../services/orders';
import {
  commercialRateMessage,
  draftFromRate,
  ensureKnown2026CommercialRates,
  loadCommercialRates,
  saveCommercialRate,
  type CommercialRateDraft,
} from '../services/commercialRates';
import type { Language } from '../types';

const copy = {
  de: {
    kicker: 'Orders · Commercial Rates',
    title: 'Abrechnungspreise aus Quelldokumenten',
    intro:
      'Jeder Abrechnungspreis benötigt eine nachvollziehbare Quelle. Fakturierbare Mengen stammen ausschließlich live aus DNS Data Entry / Orders; Belegmengen dienen nur der Quelldokumentation.',
    item: 'Artikel',
    active: 'Aktive Menge',
    draft: 'Entwurf',
    supplier: 'Lieferant',
    source: 'Quelle / Angebot',
    sourceQty: 'Belegmenge (nur Quelle)',
    sourceTotal: 'Beleg gesamt €',
    packSize: 'Stk. / Pack',
    packPrice: 'Pack netto €',
    purchaseUnit: 'EK / Stk.',
    billingUnit: 'Abrechnung € / Stk.',
    notes: 'Notiz',
    save: 'Speichern',
    saving: 'Speichern…',
    saved: 'Gespeichert',
    reload: 'Neu laden',
    loading: 'Tarife werden geladen…',
    noSource: 'Pflichtfeld',
    noRate: 'Noch kein Preis',
  },
  it: {
    kicker: 'Orders · Commercial Rates',
    title: 'Prezzi di fatturazione da documenti fonte',
    intro:
      'Ogni prezzo di fatturazione richiede una fonte tracciabile. Le quantità fatturabili arrivano esclusivamente live da DNS Data Entry / Orders; le quantità del documento servono solo come riferimento della fonte.',
    item: 'Articolo',
    active: 'Quantità attiva',
    draft: 'Bozza',
    supplier: 'Fornitore',
    source: 'Fonte / offerta',
    sourceQty: 'Quantità doc. (solo fonte)',
    sourceTotal: 'Totale doc. €',
    packSize: 'Pz. / conf.',
    packPrice: 'Conf. netto €',
    purchaseUnit: 'Costo / pz.',
    billingUnit: 'Fatturazione € / pz.',
    notes: 'Nota',
    save: 'Salva',
    saving: 'Salvataggio…',
    saved: 'Salvato',
    reload: 'Ricarica',
    loading: 'Caricamento tariffe…',
    noSource: 'Campo obbligatorio',
    noRate: 'Prezzo non definito',
  },
} as const;

function localizedItemLabel(
  item: OrdersSourceSnapshot['catalog'][number],
  language: Language,
) {
  return item.label?.[language] ?? item.label?.de ?? item.label?.it ?? item.code;
}

function parseOptional(value: string) {
  if (!value.trim()) return undefined;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatMoney(value: number | undefined, language: Language) {
  if (value === undefined) return '—';
  return new Intl.NumberFormat(language === 'de' ? 'de-DE' : 'it-IT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(value);
}

export function CommercialRatesPanel({
  language,
  seasonId,
  orders,
  onConfiguredChange,
  onRatesChange,
}: {
  language: Language;
  seasonId: string;
  orders: OrdersSourceSnapshot;
  onConfiguredChange?: (configured: number) => void;
  onRatesChange?: (rates: BillingCommercialRate[]) => void;
}) {
  const t = copy[language];
  const [drafts, setDrafts] = useState<Record<string, CommercialRateDraft>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState('');
  const [savedId, setSavedId] = useState('');
  const [error, setError] = useState('');

  const items = useMemo(
    () =>
      [...orders.catalog].sort((a, b) => {
        const category = a.category.localeCompare(b.category);
        if (category) return category;
        return a.code.localeCompare(b.code);
      }),
    [orders.catalog],
  );

  async function reload() {
    setLoading(true);
    setError('');
    try {
      if (seasonId === '2026-27') {
        await ensureKnown2026CommercialRates(items.map((item) => item.id));
      }
      const rates = await loadCommercialRates(seasonId);
      onRatesChange?.(rates);
      const byItem = new Map(rates.map((rate) => [rate.catalogItemId, rate]));
      const itemIds = new Set(items.map((item) => item.id));
      const next = Object.fromEntries(
        items.map((item) => [
          item.id,
          draftFromRate(item.id, byItem.get(item.id)),
        ]),
      );
      setDrafts(next);
      onConfiguredChange?.(
        rates.filter((rate) => rate.active && itemIds.has(rate.catalogItemId)).length,
      );
    } catch (reason) {
      setError(commercialRateMessage(reason, language));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [seasonId, orders.catalog]);

  function patch(id: string, values: Partial<CommercialRateDraft>) {
    setDrafts((current) => ({
      ...current,
      [id]: {
        ...(current[id] ?? draftFromRate(id)),
        ...values,
      },
    }));
    setSavedId('');
  }

  async function save(id: string) {
    const draft = drafts[id] ?? draftFromRate(id);
    setSavingId(id);
    setSavedId('');
    setError('');
    try {
      const revision = await saveCommercialRate({ seasonId, draft });
      patch(id, { revision });
      await reload();
      setSavedId(id);
    } catch (reason) {
      setError(commercialRateMessage(reason, language));
    } finally {
      setSavingId('');
    }
  }

  return (
    <section className="dns-card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-dns-mid/10 px-5 py-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="dns-kicker">{t.kicker}</div>
          <h3 className="dns-heading mt-1">
            {t.title}
          </h3>
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
          <table className="dns-table min-w-[1960px]">
            <thead>
              <tr>
                <th>{t.item}</th>
                <th className="num">{t.active}</th>
                <th className="num">{t.draft}</th>
                <th>{t.supplier}</th>
                <th>{t.source}</th>
                <th className="num">{t.sourceQty}</th>
                <th className="num">{t.sourceTotal}</th>
                <th className="num">{t.packSize}</th>
                <th className="num">{t.packPrice}</th>
                <th className="num">{t.purchaseUnit}</th>
                <th className="num">{t.billingUnit}</th>
                <th>{t.notes}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const draft = drafts[item.id] ?? draftFromRate(item.id);
                const summary = orders.byCatalogItem[item.id];
                const sourceQuantity = parseOptional(draft.totalQuantity);
                const sourceTotal = parseOptional(draft.totalAmount);
                const packSize = parseOptional(draft.packSize);
                const packPriceNet = parseOptional(draft.packPriceNet);
                const calculatedPurchaseUnitPrice =
                  packSize !== undefined && packSize > 0 && packPriceNet !== undefined
                    ? packPriceNet / packSize
                    : sourceQuantity !== undefined &&
                        sourceQuantity > 0 &&
                        sourceTotal !== undefined
                      ? sourceTotal / sourceQuantity
                      : undefined;

                return (
                  <tr key={item.id}>
                    <td>
                      <div className="font-semibold text-dns-deep">
                        {localizedItemLabel(item, language)}
                      </div>
                      <div className="mt-0.5 font-alt text-[9px] text-dns-muted">
                        {item.category} · {item.code}
                      </div>
                    </td>
                    <td className="num">{summary?.activeQuantity ?? 0}</td>
                    <td className="num">{summary?.draftQuantity ?? 0}</td>
                    <td>
                      <input
                        value={draft.supplier}
                        onChange={(event) => patch(item.id, { supplier: event.target.value })}
                        className="dns-input w-[150px] text-left"
                        aria-label={`${localizedItemLabel(item, language)} · ${t.supplier}`}
                      />
                    </td>
                    <td>
                      <input
                        required
                        value={draft.documentLabel}
                        onChange={(event) => patch(item.id, { documentLabel: event.target.value })}
                        placeholder={t.noSource}
                        className="dns-input w-[210px] text-left"
                        aria-label={`${localizedItemLabel(item, language)} · ${t.source}`}
                      />
                    </td>
                    <td>
                      <input
                        inputMode="decimal"
                        value={draft.totalQuantity}
                        onChange={(event) => patch(item.id, { totalQuantity: event.target.value })}
                        className="dns-input"
                        aria-label={`${localizedItemLabel(item, language)} · ${t.sourceQty}`}
                      />
                    </td>
                    <td>
                      <input
                        inputMode="decimal"
                        value={draft.totalAmount}
                        onChange={(event) => patch(item.id, { totalAmount: event.target.value })}
                        className="dns-input"
                        aria-label={`${localizedItemLabel(item, language)} · ${t.sourceTotal}`}
                      />
                    </td>
                    <td>
                      <input
                        inputMode="numeric"
                        value={draft.packSize}
                        onChange={(event) => patch(item.id, { packSize: event.target.value })}
                        className="dns-input"
                        aria-label={`${localizedItemLabel(item, language)} · ${t.packSize}`}
                      />
                    </td>
                    <td>
                      <input
                        inputMode="decimal"
                        value={draft.packPriceNet}
                        onChange={(event) => patch(item.id, { packPriceNet: event.target.value })}
                        className="dns-input"
                        aria-label={`${localizedItemLabel(item, language)} · ${t.packPrice}`}
                      />
                    </td>
                    <td className="num font-semibold">
                      {formatMoney(calculatedPurchaseUnitPrice, language)}
                    </td>
                    <td>
                      <input
                        required
                        inputMode="decimal"
                        value={draft.billingUnitPrice}
                        onChange={(event) => patch(item.id, { billingUnitPrice: event.target.value })}
                        placeholder={t.noRate}
                        className="dns-input"
                        aria-label={`${localizedItemLabel(item, language)} · ${t.billingUnit}`}
                      />
                    </td>
                    <td>
                      <input
                        value={draft.notes}
                        onChange={(event) => patch(item.id, { notes: event.target.value })}
                        className="dns-input w-[170px] text-left"
                        aria-label={`${localizedItemLabel(item, language)} · ${t.notes}`}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => void save(item.id)}
                        disabled={savingId === item.id}
                        className="dns-primary-button"
                        data-dns-press
                      >
                        {savingId === item.id
                          ? t.saving
                          : savedId === item.id
                            ? t.saved
                            : t.save}
                      </button>
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
