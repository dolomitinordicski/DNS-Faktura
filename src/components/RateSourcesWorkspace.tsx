import { useEffect, useMemo, useState } from 'react';
import {
  loadRateConfiguration,
  saveRateConfiguration,
  type RateCatalogItem,
  type RateConfigRecord,
} from '../v2/adapters/rateConfigs';
import type { Language } from '../types';

type Draft = {
  documentLabel: string;
  supplier: string;
  documentDate: string;
  totalQuantity: string;
  totalAmount: string;
  billingUnitPrice: string;
  active: boolean;
  prepaymentRequired: boolean;
  notes: string;
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

function toDraft(rate?: RateConfigRecord): Draft {
  return {
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
    billingUnitPrice:
      rate?.billingUnitPrice !== undefined ? String(rate.billingUnitPrice) : '',
    active: rate?.active ?? true,
    prepaymentRequired: rate?.prepaymentRequired ?? true,
    notes: rate?.notes ?? '',
  };
}

function parseOptionalNumber(value: string) {
  if (!value.trim()) return undefined;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatMoney(value: number | undefined, language: Language, digits = 4) {
  if (value === undefined) return '—';
  return new Intl.NumberFormat(language === 'de' ? 'de-DE' : 'it-IT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  }).format(value);
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
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string>('');
  const [savingId, setSavingId] = useState<string | null>(null);

  const copy =
    language === 'de'
      ? {
          title: 'Preisquellen / Tarife',
          intro:
            'Angebotswerte und Faktura-Stückpreise. Der berechnete Einkaufspreis wird aus Gesamtangebot / Gesamtmenge abgeleitet; der Faktura-Stückpreis bleibt bewusst manuell steuerbar.',
          product: 'Produkt',
          supplier: 'Lieferant',
          document: 'Angebot / Quelle',
          totalQty: 'Gesamtmenge',
          totalAmount: 'Angebot gesamt',
          calculated: 'Berechnet / Stück',
          billing: 'Faktura / Stück',
          revision: 'Rev.',
          save: 'Speichern',
          active: 'Aktiv',
          prepay: 'Vorauszahlung',
          noCatalog: 'Für diese Saison sind keine Katalogpositionen vorhanden.',
          loading: 'Tarife werden geladen…',
          error: 'Tarife konnten nicht geladen werden.',
          saved: 'Tarif gespeichert.',
        }
      : {
          title: 'Fonti prezzo / Tariffe',
          intro:
            'Valori dell’offerta e prezzi unitari Faktura. Il costo calcolato deriva da offerta totale / quantità totale; il prezzo unitario Faktura resta volutamente modificabile manualmente.',
          product: 'Prodotto',
          supplier: 'Fornitore',
          document: 'Offerta / Fonte',
          totalQty: 'Quantità totale',
          totalAmount: 'Offerta totale',
          calculated: 'Calcolato / pezzo',
          billing: 'Faktura / pezzo',
          revision: 'Rev.',
          save: 'Salva',
          active: 'Attivo',
          prepay: 'Prepagamento',
          noCatalog: 'Nessuna voce di catalogo per questa stagione.',
          loading: 'Caricamento tariffe…',
          error: 'Impossibile caricare le tariffe.',
          saved: 'Tariffa salvata.',
        };

  async function reload() {
    setState('loading');
    setMessage('');
    try {
      const result = await loadRateConfiguration(seasonId);
      setCatalog(result.catalog);
      setRates(result.rates);
      setDrafts(
        Object.fromEntries(
          result.catalog.map((item) => [
            item.id,
            toDraft(result.rates.find((rate) => rate.catalogItemId === item.id)),
          ]),
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

  const rateByItem = useMemo(
    () => new Map(rates.map((rate) => [rate.catalogItemId, rate])),
    [rates],
  );

  function patchDraft(itemId: string, patch: Partial<Draft>) {
    setDrafts((current) => ({
      ...current,
      [itemId]: { ...current[itemId], ...patch },
    }));
  }

  async function save(item: RateCatalogItem) {
    const draft = drafts[item.id];
    if (!draft) return;

    const totalQuantity = parseOptionalNumber(draft.totalQuantity);
    const totalAmount = parseOptionalNumber(draft.totalAmount);
    const calculated =
      totalQuantity !== undefined &&
      totalQuantity > 0 &&
      totalAmount !== undefined
        ? totalAmount / totalQuantity
        : undefined;
    const billing =
      parseOptionalNumber(draft.billingUnitPrice) ?? calculated;

    if (billing === undefined) {
      setMessage('INVALID_BILLING_UNIT_PRICE');
      return;
    }

    setSavingId(item.id);
    setMessage('');
    try {
      await saveRateConfiguration({
        seasonId,
        catalogItemId: item.id,
        billingUnitPrice: billing,
        documentLabel: draft.documentLabel,
        supplier: draft.supplier,
        documentDate: draft.documentDate,
        totalQuantity,
        totalAmount,
        active: draft.active,
        prepaymentRequired: draft.prepaymentRequired,
        notes: draft.notes,
        actorId,
      });
      setMessage(copy.saved);
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingId(null);
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

  return (
    <section className="mt-6 dns-card overflow-hidden">
      <div className="border-b border-dns-mid/10 px-5 py-4">
        <div className="dns-kicker">DNS FAKTURA · V2 COMMERCIAL CONFIG</div>
        <h2 className="mt-1 text-lg font-semibold">{copy.title}</h2>
        <p className="mt-2 max-w-5xl font-alt text-[11px] leading-relaxed text-dns-muted">
          {copy.intro}
        </p>
        {message && (
          <div className="mt-3 font-alt text-[11px] text-dns-mid">{message}</div>
        )}
      </div>

      {catalog.length === 0 ? (
        <p className="p-5 font-alt text-[12px] text-dns-muted">{copy.noCatalog}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="dns-table w-full">
            <thead>
              <tr>
                <th>{copy.product}</th>
                <th>{copy.supplier}</th>
                <th>{copy.document}</th>
                <th>{copy.totalQty}</th>
                <th>{copy.totalAmount}</th>
                <th>{copy.calculated}</th>
                <th>{copy.billing}</th>
                <th>{copy.revision}</th>
                <th>{copy.save}</th>
              </tr>
            </thead>
            <tbody>
              {catalog.map((item) => {
                const rate = rateByItem.get(item.id);
                const draft = drafts[item.id] ?? toDraft(rate);
                const totalQuantity = parseOptionalNumber(draft.totalQuantity);
                const totalAmount = parseOptionalNumber(draft.totalAmount);
                const calculated =
                  totalQuantity !== undefined &&
                  totalQuantity > 0 &&
                  totalAmount !== undefined
                    ? totalAmount / totalQuantity
                    : rate?.source.calculatedPurchaseUnitPrice;

                return (
                  <tr key={item.id}>
                    <td className="min-w-[220px]">
                      <div className="font-medium">{labelFor(item, language)}</div>
                      <div className="mt-1 font-mono text-[9px] text-dns-muted">
                        {item.code} · {item.category}
                      </div>
                    </td>
                    <td>
                      <input
                        className="dns-input !w-[150px]"
                        value={draft.supplier}
                        onChange={(event) =>
                          patchDraft(item.id, { supplier: event.target.value })
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="dns-input !w-[210px]"
                        value={draft.documentLabel}
                        onChange={(event) =>
                          patchDraft(item.id, { documentLabel: event.target.value })
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="dns-input !w-[100px]"
                        inputMode="decimal"
                        value={draft.totalQuantity}
                        onChange={(event) =>
                          patchDraft(item.id, { totalQuantity: event.target.value })
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="dns-input !w-[110px]"
                        inputMode="decimal"
                        value={draft.totalAmount}
                        onChange={(event) =>
                          patchDraft(item.id, { totalAmount: event.target.value })
                        }
                      />
                    </td>
                    <td className="font-alt text-[11px]">
                      {formatMoney(calculated, language, 6)}
                    </td>
                    <td>
                      <input
                        className="dns-input !w-[110px]"
                        inputMode="decimal"
                        value={draft.billingUnitPrice}
                        placeholder={
                          calculated !== undefined ? String(calculated) : ''
                        }
                        onChange={(event) =>
                          patchDraft(item.id, {
                            billingUnitPrice: event.target.value,
                          })
                        }
                      />
                      <div className="mt-2 flex gap-3 font-alt text-[9px] text-dns-muted">
                        <label className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={draft.active}
                            onChange={(event) =>
                              patchDraft(item.id, { active: event.target.checked })
                            }
                          />
                          {copy.active}
                        </label>
                        <label className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={draft.prepaymentRequired}
                            onChange={(event) =>
                              patchDraft(item.id, {
                                prepaymentRequired: event.target.checked,
                              })
                            }
                          />
                          {copy.prepay}
                        </label>
                      </div>
                    </td>
                    <td>{rate?.revision ?? '—'}</td>
                    <td>
                      <button
                        type="button"
                        className="dns-primary-button"
                        disabled={savingId === item.id}
                        onClick={() => void save(item)}
                      >
                        {copy.save}
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
