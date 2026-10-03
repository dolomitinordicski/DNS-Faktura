import { useMemo, useState } from 'react';
import type { ConfirmationRecord } from '../v2/contracts/persistence';
import type { Order } from '../v2/domain/types';
import type { Language } from '../types';
import {
  approveConfirmationChange,
  createConfirmationBatch,
  createConfirmationCorrection,
  dispatchConfirmation,
  voidConfirmation,
} from '../v2/application/confirmationWorkspaceService';
import { getRemainingConfirmableQuantity } from '../v2/engine/confirmationEngine';
import { OrganizationIdentity } from './OrganizationIdentity';

type Row = {
  organizationId: string;
  organizationName: string;
  orders: Order[];
  confirmations: ConfirmationRecord[];
  confirmationHistory: ConfirmationRecord[];
};

function quantityForLine(confirmation: ConfirmationRecord, orderLineId: string) {
  const line = confirmation.lines.find((candidate) => candidate.orderLineId === orderLineId);
  return (
    line?.confirmedQuantity ??
    line?.requestedQuantity ??
    line?.proposedQuantity ??
    0
  );
}

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
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [links, setLinks] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const copy =
    language === 'de'
      ? {
          title: 'Bestätigungen',
          intro:
            'Batches werden aus eingereichten Data-Entry-Bestellungen erzeugt. Jede Revision bleibt historisch sichtbar; nur CONFIRMED-Mengen werden für Billing und Restmengen verbraucht.',
          draftOrder: 'Data Entry Entwurf – noch nicht einreichbar',
          create: 'Bestätigung vorbereiten',
          remaining: 'offen',
          history: 'Bestätigungsverlauf',
          send: 'Link erzeugen',
          copy: 'Link kopieren',
          approve: 'Änderung genehmigen',
          correction: 'Korrekturrevision',
          void: 'Stornieren',
          reason: 'Begründung',
          proposed: 'Vorgeschlagen',
          requested: 'Gewünscht',
          confirmed: 'Bestätigt',
          noHistory: 'Noch keine Bestätigung.',
          linkHint:
            'Der Roh-Token wird nur jetzt angezeigt und nicht gespeichert. Link kopieren und an die Organisation senden.',
        }
      : {
          title: 'Conferme',
          intro:
            'I batch vengono creati dagli ordini inviati da Data Entry. Ogni revisione resta visibile nello storico; solo le quantità CONFIRMED consumano il residuo e diventano fatturabili.',
          draftOrder: 'Bozza Data Entry – non ancora confermabile',
          create: 'Prepara conferma',
          remaining: 'residuo',
          history: 'Storico conferme',
          send: 'Crea link',
          copy: 'Copia link',
          approve: 'Approva modifica',
          correction: 'Revisione correttiva',
          void: 'Annulla',
          reason: 'Motivazione',
          proposed: 'Proposta',
          requested: 'Richiesta',
          confirmed: 'Confermata',
          noHistory: 'Nessuna conferma.',
          linkHint:
            'Il token grezzo viene mostrato solo ora e non viene salvato. Copia il link e invialo all’organizzazione.',
        };

  const orderRows = useMemo(
    () =>
      rows.flatMap((row) =>
        row.orders.map((order) => ({
          row,
          order,
          history: row.confirmationHistory.filter(
            (confirmation) => confirmation.orderId === order.id,
          ),
        })),
      ),
    [rows],
  );

  function remainingFor(order: Order, history: ConfirmationRecord[], lineId: string) {
    const line = order.lines.find((candidate) => candidate.id === lineId);
    if (!line) return 0;
    return getRemainingConfirmableQuantity({
      orderLineQuantity: line.orderedQuantity,
      priorConfirmations: history,
      orderLineId: lineId,
    });
  }

  function selectionFor(order: Order, history: ConfirmationRecord[]) {
    return (
      selected[order.id] ??
      new Set(
        order.lines
          .filter((line) => remainingFor(order, history, line.id) > 0)
          .map((line) => line.id),
      )
    );
  }

  function toggle(order: Order, history: ConfirmationRecord[], lineId: string) {
    const next = new Set(selectionFor(order, history));
    if (next.has(lineId)) next.delete(lineId);
    else next.add(lineId);
    setSelected((current) => ({ ...current, [order.id]: next }));
  }

  async function create(order: Order, history: ConfirmationRecord[]) {
    const lineIds = [...selectionFor(order, history)];
    if (!lineIds.length) return;
    setBusy(`create:${order.id}`);
    setMessage('');
    try {
      await createConfirmationBatch({
        order,
        selectedOrderLineIds: lineIds,
        priorConfirmations: history,
        actorId,
      });
      setSelected((current) => {
        const next = { ...current };
        delete next[order.id];
        return next;
      });
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('');
    }
  }

  async function send(confirmation: ConfirmationRecord) {
    setBusy(`send:${confirmation.id}`);
    setMessage('');
    try {
      const result = await dispatchConfirmation({
        confirmationId: confirmation.id,
        actorId,
      });
      const url = new URL(window.location.href);
      url.search = '';
      url.hash = '';
      url.searchParams.set('confirmation', result.rawToken);
      setLinks((current) => ({ ...current, [confirmation.id]: url.toString() }));
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('');
    }
  }

  async function approve(confirmation: ConfirmationRecord) {
    setBusy(`approve:${confirmation.id}`);
    setMessage('');
    try {
      await approveConfirmationChange({
        confirmationId: confirmation.id,
        actorId,
      });
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('');
    }
  }

  async function correction(confirmation: ConfirmationRecord) {
    const reason = reasons[confirmation.id]?.trim() ?? '';
    if (!reason) return;
    setBusy(`correction:${confirmation.id}`);
    setMessage('');
    try {
      await createConfirmationCorrection({
        original: confirmation,
        reason,
        actorId,
      });
      setReasons((current) => ({ ...current, [confirmation.id]: '' }));
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('');
    }
  }

  async function voidConfirmed(confirmation: ConfirmationRecord) {
    const reason = reasons[confirmation.id]?.trim() ?? '';
    if (!reason) return;
    setBusy(`void:${confirmation.id}`);
    setMessage('');
    try {
      await voidConfirmation({
        confirmationId: confirmation.id,
        reason,
        actorId,
      });
      setReasons((current) => ({ ...current, [confirmation.id]: '' }));
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('');
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
          <div className="mt-3 dns-status is-error">{message}</div>
        )}
      </div>

      <div className="divide-y divide-dns-mid/10">
        {orderRows.map(({ row, order, history }) => (
          <article key={order.id} className="grid gap-5 p-5 xl:grid-cols-[260px_1fr]">
            <OrganizationIdentity
              organizationId={row.organizationId}
              organizationName={row.organizationName}
              logoUrl={organizationLogos[row.organizationId]}
            />

            <div className="min-w-0">
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
                    {copy.draftOrder}
                  </span>
                )}
              </div>

              <div className="mt-3 grid gap-2">
                {order.lines.map((line) => {
                  const remaining = remainingFor(order, history, line.id);
                  const checked = selectionFor(order, history).has(line.id);
                  return (
                    <label
                      key={line.id}
                      className="flex items-center justify-between gap-4 rounded-md bg-dns-bg px-3 py-2"
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={order.status !== 'SUBMITTED' || remaining <= 0}
                          onChange={() => toggle(order, history, line.id)}
                        />
                        <span>{line.label}</span>
                      </span>
                      <span className="text-right">
                        <strong>{line.orderedQuantity}</strong>
                        <span className="ml-2 font-alt text-[9px] text-dns-muted">
                          {copy.remaining}: {remaining}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>

              <button
                type="button"
                className="dns-primary-button mt-3"
                disabled={
                  order.status !== 'SUBMITTED' ||
                  busy === `create:${order.id}` ||
                  selectionFor(order, history).size === 0
                }
                onClick={() => void create(order, history)}
              >
                {copy.create}
              </button>

              <div className="mt-5 border-t border-dns-mid/10 pt-4">
                <div className="dns-kicker">{copy.history}</div>
                {history.length === 0 ? (
                  <p className="mt-2 font-alt text-[10px] text-dns-muted">
                    {copy.noHistory}
                  </p>
                ) : (
                  <div className="mt-3 grid gap-3">
                    {[...history]
                      .sort((a, b) => b.revision - a.revision)
                      .map((confirmation) => (
                        <div
                          key={confirmation.id}
                          className="rounded-md border border-dns-mid/15 bg-white p-3"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-[9px] text-dns-muted">
                              {confirmation.id}
                            </span>
                            <span className="dns-status is-connected">
                              {confirmation.status} · r{confirmation.revision}
                            </span>
                            {confirmation.lifecycleReason && (
                              <span className="font-alt text-[9px] text-dns-muted">
                                {confirmation.lifecycleReason}
                              </span>
                            )}
                          </div>

                          <div className="mt-2 grid gap-1">
                            {confirmation.lines.map((line) => (
                              <div
                                key={line.orderLineId}
                                className="grid gap-2 rounded bg-dns-bg px-2 py-1.5 text-[11px] sm:grid-cols-[1fr_repeat(3,90px)]"
                              >
                                <span className="font-mono text-[9px]">
                                  {line.catalogItemId}
                                </span>
                                <span>{copy.proposed}: {line.proposedQuantity}</span>
                                <span>{copy.requested}: {line.requestedQuantity ?? '—'}</span>
                                <span>{copy.confirmed}: {line.confirmedQuantity ?? '—'}</span>
                              </div>
                            ))}
                          </div>

                          {confirmation.status === 'DRAFT' && (
                            <div className="mt-3">
                              <button
                                type="button"
                                className="dns-primary-button"
                                disabled={busy === `send:${confirmation.id}`}
                                onClick={() => void send(confirmation)}
                              >
                                {copy.send}
                              </button>
                              {links[confirmation.id] && (
                                <div className="mt-2 rounded-md bg-dns-bg p-2">
                                  <div className="break-all font-mono text-[9px]">
                                    {links[confirmation.id]}
                                  </div>
                                  <div className="mt-2 flex flex-wrap items-center gap-2">
                                    <button
                                      type="button"
                                      className="dns-btn-secondary"
                                      onClick={() =>
                                        void navigator.clipboard.writeText(
                                          links[confirmation.id],
                                        )
                                      }
                                    >
                                      {copy.copy}
                                    </button>
                                    <span className="font-alt text-[9px] text-dns-muted">
                                      {copy.linkHint}
                                    </span>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          {confirmation.status === 'CHANGE_REQUESTED' && (
                            <button
                              type="button"
                              className="dns-primary-button mt-3"
                              disabled={busy === `approve:${confirmation.id}`}
                              onClick={() => void approve(confirmation)}
                            >
                              {copy.approve}
                            </button>
                          )}

                          {confirmation.status === 'CONFIRMED' && (
                            <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto_auto]">
                              <input
                                className="dns-input !w-full"
                                placeholder={copy.reason}
                                value={reasons[confirmation.id] ?? ''}
                                onChange={(event) =>
                                  setReasons((current) => ({
                                    ...current,
                                    [confirmation.id]: event.target.value,
                                  }))
                                }
                              />
                              <button
                                type="button"
                                className="dns-btn-secondary"
                                disabled={
                                  !reasons[confirmation.id]?.trim() ||
                                  busy === `correction:${confirmation.id}`
                                }
                                onClick={() => void correction(confirmation)}
                              >
                                {copy.correction}
                              </button>
                              <button
                                type="button"
                                className="dns-btn-secondary"
                                disabled={
                                  !reasons[confirmation.id]?.trim() ||
                                  busy === `void:${confirmation.id}`
                                }
                                onClick={() => void voidConfirmed(confirmation)}
                              >
                                {copy.void}
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
