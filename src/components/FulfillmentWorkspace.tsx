import { useState } from 'react';
import type {
  BillingSheetRecord,
  DeliveryRecord,
  PaymentRecord,
} from '../v2/contracts/persistence';
import type { Language } from '../types';
import {
  FirestoreInvoicingRepository,
  FirestorePaymentRepository,
} from '../v2/persistence/firestoreInvoicingRepository';
import { FirestoreDeliveryRepository } from '../v2/persistence/firestoreDeliveryRepository';
import {
  invoiceBillingAndOpenPayment,
  markPaymentPaid,
} from '../v2/application/invoicingService';
import {
  createDeliveryCase,
  recordDeliveredQuantity,
} from '../v2/application/deliveryService';
import { OrganizationIdentity } from './OrganizationIdentity';

type Row = {
  organizationId: string;
  organizationName: string;
  billingSheets: BillingSheetRecord[];
  payments: PaymentRecord[];
  deliveries: DeliveryRecord[];
};

function money(value: number, language: Language) {
  return new Intl.NumberFormat(language === 'de' ? 'de-DE' : 'it-IT', {
    style: 'currency',
    currency: 'EUR',
  }).format(value);
}

function groupDeliverableOrders(sheet: BillingSheetRecord) {
  const grouped = new Map<string, Set<string>>();

  for (const line of sheet.lines) {
    if (
      line.sourceType !== 'ORDER_CONFIRMATION' ||
      !line.orderId ||
      line.quantity <= 0
    ) {
      continue;
    }
    const confirmations = grouped.get(line.orderId) ?? new Set<string>();
    confirmations.add(line.sourceId);
    grouped.set(line.orderId, confirmations);
  }

  return [...grouped.entries()].map(([orderId, confirmations]) => ({
    orderId,
    confirmationIds: [...confirmations],
  }));
}

export function FulfillmentWorkspace({
  rows,
  organizationLogos,
  language,
  actorId,
  onChanged,
}: {
  rows: Row[];
  organizationLogos: Record<string, string>;
  language: Language;
  actorId: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<Record<string, string>>({});
  const [deliveryValues, setDeliveryValues] = useState<Record<string, string>>({});

  const copy =
    language === 'de'
      ? {
          title: 'Zahlung / Lieferung',
          intro:
            'INVOICED öffnet den operativen Payment Case. Vorauszahlungspflichtige Positionen werden erst nach PAID für die Lieferung freigegeben.',
          invoice: 'Als fakturiert markieren',
          paid: 'Als bezahlt markieren',
          createDelivery: 'Lieferung anlegen',
          delivery: 'Lieferung',
          confirmed: 'Bestätigt',
          delivered: 'Geliefert',
          remaining: 'Offen',
          save: 'Speichern',
          noBilling: 'Keine fakturierbaren Vorgänge.',
          payment: 'Zahlung',
        }
      : {
          title: 'Pagamento / Consegna',
          intro:
            'INVOICED apre il caso di pagamento operativo. Le voci con prepagamento diventano consegnabili solo dopo lo stato PAID.',
          invoice: 'Segna come fatturato',
          paid: 'Segna come pagato',
          createDelivery: 'Crea consegna',
          delivery: 'Consegna',
          confirmed: 'Confermato',
          delivered: 'Consegnato',
          remaining: 'Residuo',
          save: 'Salva',
          noBilling: 'Nessuna pratica fatturabile.',
          payment: 'Pagamento',
        };

  const invoicingRepository = new FirestoreInvoicingRepository();
  const paymentRepository = new FirestorePaymentRepository();
  const deliveryRepository = new FirestoreDeliveryRepository();

  async function invoice(sheet: BillingSheetRecord) {
    setBusy(sheet.id);
    try {
      await invoiceBillingAndOpenPayment({
        billingSheetId: sheet.id,
        repository: invoicingRepository,
        actorId,
        occurredAt: new Date().toISOString(),
      });
      onChanged();
    } catch (error) {
      setMessage((current) => ({
        ...current,
        [sheet.id]: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setBusy(null);
    }
  }

  async function pay(sheet: BillingSheetRecord) {
    setBusy(sheet.id);
    try {
      await markPaymentPaid({
        billingSheetId: sheet.id,
        repository: paymentRepository,
        actorId,
        occurredAt: new Date().toISOString(),
      });
      onChanged();
    } catch (error) {
      setMessage((current) => ({
        ...current,
        [sheet.id]: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setBusy(null);
    }
  }

  async function createDelivery(
    sheet: BillingSheetRecord,
    orderId: string,
    confirmationIds: string[],
  ) {
    const key = `${sheet.id}:${orderId}`;
    setBusy(key);
    try {
      await createDeliveryCase({
        id: `delivery-${sheet.id}-${orderId}`,
        orderId,
        confirmationIds,
        billingSheetId: sheet.id,
        billingRepository: {
          getById: (id) => Promise.resolve(id === sheet.id ? sheet : null),
          listByOrganization: async () => [],
          saveDraft: async () => {
            throw new Error('UNSUPPORTED');
          },
          mutateManualServiceTransaction: async () => {
            throw new Error('UNSUPPORTED');
          },
          markReadyTransaction: async () => {
            throw new Error('UNSUPPORTED');
          },
        },
        paymentRepository,
        deliveryRepository,
        actorId,
        occurredAt: new Date().toISOString(),
      });
      onChanged();
    } catch (error) {
      setMessage((current) => ({
        ...current,
        [key]: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setBusy(null);
    }
  }

  async function updateDelivery(delivery: DeliveryRecord, catalogItemId: string) {
    const key = `${delivery.id}:${catalogItemId}`;
    const value = Number(
      (deliveryValues[key] ?? '').replace(',', '.'),
    );
    setBusy(key);
    try {
      await recordDeliveredQuantity({
        deliveryId: delivery.id,
        catalogItemId,
        deliveredQuantity: value,
        deliveryRepository,
        actorId,
        occurredAt: new Date().toISOString(),
      });
      onChanged();
    } catch (error) {
      setMessage((current) => ({
        ...current,
        [key]: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setBusy(null);
    }
  }

  const hasAny = rows.some(
    (row) => row.billingSheets.length || row.deliveries.length,
  );

  return (
    <section className="mt-6 dns-card overflow-hidden">
      <div className="border-b border-dns-mid/10 px-5 py-4">
        <div className="dns-kicker">BILLING → PAYMENT → DELIVERY</div>
        <h2 className="mt-1 text-lg font-semibold">{copy.title}</h2>
        <p className="mt-2 max-w-5xl font-alt text-[11px] leading-relaxed text-dns-muted">
          {copy.intro}
        </p>
      </div>

      {!hasAny ? (
        <p className="p-5 font-alt text-[12px] text-dns-muted">{copy.noBilling}</p>
      ) : (
        <div className="divide-y divide-dns-mid/10">
          {rows.map((row) => (
            <article
              key={row.organizationId}
              className="grid gap-5 p-5 xl:grid-cols-[260px_1fr]"
            >
              <OrganizationIdentity
                organizationId={row.organizationId}
                organizationName={row.organizationName}
                logoUrl={organizationLogos[row.organizationId]}
              />

              <div className="grid gap-4">
                {row.billingSheets
                  .slice()
                  .sort((a, b) => b.revision - a.revision)
                  .map((sheet) => {
                    const payment = row.payments.find(
                      (item) => item.billingSheetId === sheet.id,
                    );
                    const deliverableOrders = groupDeliverableOrders(sheet);

                    return (
                      <div
                        key={sheet.id}
                        className="rounded-md border border-dns-mid/15 p-3"
                      >
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="font-mono text-[10px] text-dns-muted">
                            {sheet.id}
                          </span>
                          <span
                            className={[
                              'dns-status',
                              sheet.status === 'DRAFT' ? 'is-draft' : 'is-connected',
                            ].join(' ')}
                          >
                            {sheet.status}
                          </span>
                          <strong>{money(sheet.totalAmount, language)}</strong>

                          {sheet.status === 'READY' && (
                            <button
                              type="button"
                              className="dns-primary-button"
                              disabled={busy === sheet.id}
                              onClick={() => void invoice(sheet)}
                            >
                              {copy.invoice}
                            </button>
                          )}

                          {payment && (
                            <>
                              <span className="font-alt text-[10px] text-dns-muted">
                                {copy.payment}:
                              </span>
                              <span
                                className={[
                                  'dns-status',
                                  payment.status === 'PAID'
                                    ? 'is-connected'
                                    : 'is-pending',
                                ].join(' ')}
                              >
                                {payment.status}
                                {payment.required ? ' · PREPAY' : ''}
                              </span>
                              {payment.status === 'OPEN' && (
                                <button
                                  type="button"
                                  className="dns-btn-secondary"
                                  disabled={busy === sheet.id}
                                  onClick={() => void pay(sheet)}
                                >
                                  {copy.paid}
                                </button>
                              )}
                            </>
                          )}
                        </div>

                        {message[sheet.id] && (
                          <div className="mt-2 font-mono text-[10px] text-dns-mid">
                            {message[sheet.id]}
                          </div>
                        )}

                        {sheet.status === 'INVOICED' &&
                          payment &&
                          deliverableOrders.map((entry) => {
                            const deliveryId = `delivery-${sheet.id}-${entry.orderId}`;
                            const delivery = row.deliveries.find(
                              (item) => item.id === deliveryId,
                            );
                            const key = `${sheet.id}:${entry.orderId}`;

                            if (!delivery) {
                              return (
                                <div
                                  key={entry.orderId}
                                  className="mt-3 flex items-center justify-between gap-3 rounded-md bg-dns-bg px-3 py-2"
                                >
                                  <span className="font-mono text-[10px]">
                                    {entry.orderId}
                                  </span>
                                  <button
                                    type="button"
                                    className="dns-btn-secondary"
                                    disabled={busy === key}
                                    onClick={() =>
                                      void createDelivery(
                                        sheet,
                                        entry.orderId,
                                        entry.confirmationIds,
                                      )
                                    }
                                  >
                                    {copy.createDelivery}
                                  </button>
                                  {message[key] && (
                                    <span className="font-mono text-[9px] text-dns-muted">
                                      {message[key]}
                                    </span>
                                  )}
                                </div>
                              );
                            }

                            return (
                              <div key={delivery.id} className="mt-3 rounded-md bg-dns-bg p-3">
                                <div className="flex items-center gap-2">
                                  <span className="dns-kicker">{copy.delivery}</span>
                                  <span className="font-mono text-[9px]">
                                    {delivery.id}
                                  </span>
                                  <span className="dns-status is-connected">
                                    {delivery.status}
                                  </span>
                                </div>
                                <div className="mt-2 grid gap-2">
                                  {delivery.lines.map((line) => {
                                    const lineKey = `${delivery.id}:${line.catalogItemId}`;
                                    return (
                                      <div
                                        key={line.catalogItemId}
                                        className="grid items-center gap-2 rounded-md bg-white px-3 py-2 md:grid-cols-[1fr_90px_90px_90px_100px_auto]"
                                      >
                                        <span className="font-mono text-[9px]">
                                          {line.catalogItemId}
                                        </span>
                                        <span>{copy.confirmed}: {line.confirmedQuantity}</span>
                                        <span>{copy.delivered}: {line.deliveredQuantity}</span>
                                        <span>{copy.remaining}: {line.remainingQuantity}</span>
                                        <input
                                          className="dns-input !w-full"
                                          inputMode="decimal"
                                          value={
                                            deliveryValues[lineKey] ??
                                            String(line.deliveredQuantity)
                                          }
                                          onChange={(event) =>
                                            setDeliveryValues((current) => ({
                                              ...current,
                                              [lineKey]: event.target.value,
                                            }))
                                          }
                                        />
                                        <button
                                          type="button"
                                          className="dns-btn-secondary"
                                          disabled={busy === lineKey}
                                          onClick={() =>
                                            void updateDelivery(
                                              delivery,
                                              line.catalogItemId,
                                            )
                                          }
                                        >
                                          {copy.save}
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    );
                  })}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
