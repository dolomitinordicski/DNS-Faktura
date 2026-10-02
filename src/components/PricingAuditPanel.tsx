import type { BillingCommercialRate } from '@dolomitinordicski/dns-shared-data';
import type { OrdersSourceSnapshot } from '../services/orders';
import type { OrderBillingSnapshot } from '../services/orderBilling';
import type { Language } from '../types';

const copy = {
  de: {
    kicker: 'F.6 · Billing Setup & Pricing Audit',
    title: 'Preise vor der Fakturierung prüfen',
    intro: 'Mengen kommen live aus DNS Data Entry. Preise, Belege und Revisionen bleiben ausschließlich in Faktura.',
    configured: 'Preis definiert',
    missing: 'Preis fehlt',
    quantity: 'Aktive Menge',
    pricedQuantity: 'Bewertete Menge',
    amount: 'Berechneter Betrag',
    unitPrice: '€/Stk.',
    formula: 'Berechnung',
    openEditor: 'Preise bearbeiten',
    complete: 'vollständig',
    incomplete: 'unvollständig',
    groupWristband: 'Armbänder',
    groupTickets: 'Wochen- & Saisonkarten',
    groupPocketfolder: 'Pocketfolder',
    groupOther: 'Weitere Artikel',
    items: 'Artikel',
    missingItems: 'Fehlende Preise',
    dataEntry: 'Menge: DNS Data Entry',
    faktura: 'Preis: DNS Faktura',
    noAmount: 'Noch nicht vollständig berechenbar',
  },
  it: {
    kicker: 'F.6 · Billing Setup & Pricing Audit',
    title: 'Controllo prezzi prima della fatturazione',
    intro: 'Le quantità arrivano live da DNS Data Entry. Prezzi, documenti fonte e revisioni restano esclusivamente in Faktura.',
    configured: 'Prezzo definito',
    missing: 'Prezzo mancante',
    quantity: 'Quantità attiva',
    pricedQuantity: 'Quantità valorizzata',
    amount: 'Importo calcolato',
    unitPrice: '€/pz.',
    formula: 'Calcolo',
    openEditor: 'Modifica prezzi',
    complete: 'completo',
    incomplete: 'incompleto',
    groupWristband: 'Braccialetti',
    groupTickets: 'Settimanali & stagionali',
    groupPocketfolder: 'Pocketfolder',
    groupOther: 'Altri articoli',
    items: 'Articoli',
    missingItems: 'Prezzi mancanti',
    dataEntry: 'Quantità: DNS Data Entry',
    faktura: 'Prezzo: DNS Faktura',
    noAmount: 'Non ancora completamente calcolabile',
  },
} as const;

type GroupId = 'wristband' | 'ticket' | 'pocketfolder' | 'other';

function groupFor(category: string): GroupId {
  if (category === 'wristband') return 'wristband';
  if (category === 'ticket') return 'ticket';
  if (category === 'pocketfolder') return 'pocketfolder';
  return 'other';
}

function money(value: number, language: Language, digits = 2) {
  return new Intl.NumberFormat(language === 'de' ? 'de-DE' : 'it-IT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: digits,
    maximumFractionDigits: Math.max(digits, 6),
  }).format(value);
}

function number(value: number, language: Language) {
  return new Intl.NumberFormat(language === 'de' ? 'de-DE' : 'it-IT').format(value);
}

export function PricingAuditPanel({
  language,
  orders,
  rates,
  orderBilling,
}: {
  language: Language;
  orders: OrdersSourceSnapshot;
  rates: BillingCommercialRate[];
  orderBilling: OrderBillingSnapshot | null;
}) {
  const t = copy[language];
  const rateByItem = new Map(
    rates.filter((rate) => rate.active).map((rate) => [rate.catalogItemId, rate]),
  );
  const labels: Record<GroupId, string> = {
    wristband: t.groupWristband,
    ticket: t.groupTickets,
    pocketfolder: t.groupPocketfolder,
    other: t.groupOther,
  };

  const groups = (['wristband', 'ticket', 'pocketfolder', 'other'] as const)
    .map((groupId) => {
      const items = orders.catalog.filter((item) => groupFor(item.category) === groupId);
      if (items.length === 0) return null;

      const itemIds = new Set(items.map((item) => item.id));
      const configured = items.filter((item) => rateByItem.has(item.id));
      const missing = items.filter((item) => !rateByItem.has(item.id));
      const activeQuantity = items.reduce(
        (sum, item) => sum + (orders.byCatalogItem[item.id]?.activeQuantity ?? 0),
        0,
      );
      const draftQuantity = items.reduce(
        (sum, item) => sum + (orders.byCatalogItem[item.id]?.draftQuantity ?? 0),
        0,
      );
      const billingLines = orderBilling
        ? Object.values(orderBilling.byOrganization).flatMap((organization) =>
            organization.lines.filter((line) => itemIds.has(line.catalogItemId)),
          )
        : [];
      const pricedQuantity = billingLines.reduce((sum, line) => sum + line.quantity, 0);
      const amount = billingLines.reduce((sum, line) => sum + line.amount, 0);
      const uniqueRates = [
        ...new Set(configured.map((item) => rateByItem.get(item.id)?.billingUnitPrice)),
      ].filter((value): value is number => typeof value === 'number');

      return {
        groupId,
        items,
        configured,
        missing,
        activeQuantity,
        draftQuantity,
        pricedQuantity,
        amount,
        uniqueRates,
      };
    })
    .filter((group): group is NonNullable<typeof group> => group !== null);

  const configuredCount = orders.catalog.filter((item) => rateByItem.has(item.id)).length;
  const missingItems = orders.catalog.filter((item) => !rateByItem.has(item.id));
  const complete = missingItems.length === 0;

  return (
    <section className="dns-card overflow-hidden">
      <div className="border-b border-dns-mid/10 px-5 py-4 md:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="dns-kicker">{t.kicker}</div>
            <h3 className="dns-heading mt-1">{t.title}</h3>
            <p className="mt-2 max-w-4xl font-alt text-[11px] leading-relaxed text-dns-muted">
              {t.intro}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="dns-pill">{t.dataEntry}</span>
              <span className="dns-pill">{t.faktura}</span>
            </div>
          </div>
          <button
            type="button"
            className="dns-btn-secondary"
            data-dns-press
            onClick={() =>
              document.getElementById('commercial-rates-editor')?.scrollIntoView({
                behavior: 'smooth',
                block: 'start',
              })
            }
          >
            {t.openEditor}
          </button>
        </div>
      </div>

      <div className="grid gap-3 p-5 md:grid-cols-4 md:p-6">
        <article className="dns-metric">
          <div className="dns-kicker">{t.configured}</div>
          <div className="dns-metric-value">{configuredCount}/{orders.catalog.length}</div>
        </article>
        <article className="dns-metric">
          <div className="dns-kicker">{t.missing}</div>
          <div className="dns-metric-value">{missingItems.length}</div>
        </article>
        <article className="dns-metric">
          <div className="dns-kicker">{t.pricedQuantity}</div>
          <div className="dns-metric-value">{number(orderBilling?.billedQuantity ?? 0, language)}</div>
        </article>
        <article className="dns-metric">
          <div className="dns-kicker">{t.amount}</div>
          <div className="dns-metric-value">{money(orderBilling?.totalAmount ?? 0, language)}</div>
        </article>
      </div>

      <div className="border-t border-dns-mid/10">
        <div className="overflow-x-auto">
          <table className="dns-table min-w-[980px]">
            <thead>
              <tr>
                <th>{t.items}</th>
                <th className="num">{t.quantity}</th>
                <th className="num">{t.pricedQuantity}</th>
                <th>{t.unitPrice}</th>
                <th className="num">{t.amount}</th>
                <th>{t.formula}</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                const completeGroup = group.missing.length === 0;
                const rateText =
                  group.uniqueRates.length === 1
                    ? money(group.uniqueRates[0], language, 3)
                    : group.uniqueRates.length > 1
                      ? group.uniqueRates.map((rate) => money(rate, language, 3)).join(' · ')
                      : '—';
                const formulaText =
                  group.uniqueRates.length === 1
                    ? number(group.pricedQuantity, language) + ' × ' + money(group.uniqueRates[0], language, 3)
                    : group.uniqueRates.length === 0
                      ? t.noAmount
                      : language === 'de'
                        ? 'Mehrere Artikelpreise'
                        : 'Più prezzi articolo';

                return (
                  <tr key={group.groupId}>
                    <td>
                      <div className="font-semibold text-dns-deep">{labels[group.groupId]}</div>
                      <div className="mt-0.5 font-alt text-[9px] text-dns-muted">
                        {group.configured.length}/{group.items.length} {t.configured.toLowerCase()}
                        {group.draftQuantity > 0 ? ' · Draft ' + number(group.draftQuantity, language) : ''}
                      </div>
                    </td>
                    <td className="num">{number(group.activeQuantity, language)}</td>
                    <td className="num">{number(group.pricedQuantity, language)}</td>
                    <td className="font-alt text-[11px]">{rateText}</td>
                    <td className="num font-semibold">{money(group.amount, language)}</td>
                    <td className="font-alt text-[10px] text-dns-muted">{formulaText}</td>
                    <td>
                      <span className={['dns-status', completeGroup ? 'is-connected' : 'is-error'].join(' ')}>
                        {completeGroup ? t.complete : t.incomplete}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {!complete && (
        <div className="border-t border-amber-200 bg-amber-50 px-5 py-4 md:px-6">
          <div className="dns-kicker">{t.missingItems}</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {missingItems.map((item) => (
              <span key={item.id} className="dns-pill">
                {item.label?.[language] ?? item.label?.de ?? item.code}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
