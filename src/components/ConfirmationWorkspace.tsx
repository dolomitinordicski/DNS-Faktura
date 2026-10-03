import { useMemo, useState } from 'react';
import type { ConfirmationRecord } from '../v2/contracts/persistence';
import type { Order } from '../v2/domain/types';
import type { Language } from '../types';
import { createConfirmationBatch } from '../v2/application/confirmationWorkspaceService';
import { OrganizationIdentity } from './OrganizationIdentity';

type Row = {
  organizationId: string;
  organizationName: string;
  orders: Order[];
  confirmations: ConfirmationRecord[];
};

export function ConfirmationWorkspace({
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
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const copy =
    language === 'de'
      ? {
          title: 'Bestätigungen',
          intro:
            'Confirmation Batches werden aus eingereichten Bestellungen erzeugt. Entwürfe in DNS Data Entry bleiben sichtbar, können aber noch nicht bestätigt werden.',
          draft: 'Noch nicht eingereicht',
          create: 'Bestätigung vorbereiten',
          noLines: 'Keine offenen Positionen',
          current: 'Bestehende Bestätigungen',
          proposed: 'Vorgeschlagene Menge',
        }
      : {
          title: 'Conferme',
          intro:
            'I batch di conferma vengono creati dagli ordini inviati. Le bozze di DNS Data Entry restano visibili, ma non possono ancora entrare nel processo di conferma.',
          draft: 'Non ancora inviato',
          create: 'Prepara conferma',
          noLines: 'Nessuna voce aperta',
          current: 'Conferme esistenti',
          proposed: 'Quantità proposta',
        };

  const submittedOrders = useMemo(
    () =>
      rows.flatMap((row) =>
        row.orders.map((order) => ({
          row,
          order,
          confirmations: row.confirmations.filter(
            (confirmation) => confirmation.orderId === order.id,
          ),
        })),
      ),
    [rows],
  );

  function selectionFor(order: Order) {
    return selected[order.id] ?? new Set(order.lines.map((line) => line.id));
  }

  function toggle(order: Order, lineId: string) {
    const next = new Set(selectionFor(order));
    if (next.has(lineId)) next.delete(lineId);
    else next.add(lineId);
    setSelected((current) => ({ ...current, [order.id]: next }));
  }

  async function create(input: {
    order: Order;
    confirmations: ConfirmationRecord[];
  }) {
    const lineIds = [...selectionFor(input.order)];
    if (!lineIds.length) return;
    setBusyOrderId(input.order.id);
    setMessage('');
    try {
      await createConfirmationBatch({
        order: input.order,
        selectedOrderLineIds: lineIds,
        priorConfirmations: input.confirmations,
        actorId,
      });
      setMessage('OK');
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyOrderId(null);
    }
  }

  return (
    <section className="mt-6 dns-card overflow-hidden">
      <div className="border-b border-dns-mid/10 px-5 py-4">
        <div className="dns-kicker">ORDER → CONFIRMATION</div>
        <h2 className="mt-1 text-lg font-semibold">{copy.title}</h2>
        <p className="mt-2 max-w-5xl font-alt text-[11px] leading-relaxed text-dns-muted">
          {copy.intro}
        </p>
        {message && (
          <div className="mt-3 font-mono text-[10px] text-dns-mid">{message}</div>
        )}
      </div>

      <div className="divide-y divide-dns-mid/10">
        {submittedOrders.map(({ row, order, confirmations }) => (
          <article key={order.id} className="grid gap-4 p-5 lg:grid-cols-[260px_1fr]">
            <OrganizationIdentity
              organizationId={row.organizationId}
              organizationName={row.organizationName}
              logoUrl={organizationLogos[row.organizationId]}
            />

            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[10px] text-dns-muted">{order.id}</span>
                <span
                  className={[
                    'dns-status',
                    order.status === 'SUBMITTED' ? 'is-connected' : 'is-draft',
                  ].join(' ')}
                >
                  {order.status}
                </span>
                {order.status === 'DRAFT' && (
                  <span className="font-alt text-[10px] text-dns-muted">
                    {copy.draft}
                  </span>
                )}
              </div>

              <div className="mt-3 grid gap-2">
                {order.lines.map((line) => {
                  const checked = selectionFor(order).has(line.id);
                  return (
                    <label
                      key={line.id}
                      className="flex items-center justify-between gap-4 rounded-md bg-dns-bg px-3 py-2"
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={order.status !== 'SUBMITTED'}
                          onChange={() => toggle(order, line.id)}
                        />
                        <span>{line.label}</span>
                      </span>
                      <strong>{line.orderedQuantity}</strong>
                    </label>
                  );
                })}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="dns-primary-button"
                  disabled={
                    order.status !== 'SUBMITTED' ||
                    busyOrderId === order.id ||
                    selectionFor(order).size === 0
                  }
                  onClick={() => void create({ order, confirmations })}
                >
                  {copy.create}
                </button>
                <span className="font-alt text-[10px] text-dns-muted">
                  {copy.current}: {confirmations.length}
                </span>
              </div>

              {confirmations.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {confirmations.map((confirmation) => (
                    <span
                      key={confirmation.id}
                      className="rounded-md border border-dns-mid/15 bg-white px-2 py-1 font-alt text-[10px]"
                    >
                      r{confirmation.revision} · {confirmation.status}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
