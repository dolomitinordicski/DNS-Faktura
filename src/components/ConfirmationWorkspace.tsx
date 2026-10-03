import { useMemo, useState } from 'react';
import type { ConfirmationRecord } from '../v2/contracts/persistence';
import type { Order } from '../v2/domain/types';
import type { Language } from '../types';
import {
  approveConfirmationChanges,
  createConfirmationBatch,
  createConfirmationCorrection,
} from '../v2/application/confirmationWorkspaceService';
import { dispatchConfirmationWithPublicToken } from '../v2/application/publicConfirmationService';
import { FirestorePublicConfirmationRepository } from '../v2/persistence/firestoreConfirmationRepository';
import { publicConfirmationEnabled } from './PublicConfirmationPage';
import { OrganizationIdentity } from './OrganizationIdentity';

type Row = {
  organizationId: string;
  organizationName: string;
  orders: Order[];
  confirmations: ConfirmationRecord[];
};

function buildPublicUrl(rawToken: string) {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('confirmationToken', rawToken);
  return url.toString();
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
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [revisionReasons, setRevisionReasons] = useState<Record<string, string>>({});
  const [generatedLinks, setGeneratedLinks] = useState<Record<string, string>>({});

  const copy =
    language === 'de'
      ? {
          title: 'Bestätigungen',
          intro:
            'Batches entstehen aus eingereichten Data-Entry-Bestellungen. DRAFT wird mit einem sicheren Einmal-Link versendet; Änderungen durch die Organisation landen als CHANGE_REQUESTED und müssen von DNS freigegeben werden.',
          draft: 'Noch nicht eingereicht',
          create: 'Bestätigung vorbereiten',
          current: 'Bestätigungen',
          dispatch: 'Link erzeugen & kopieren',
          publicDisabled: 'Öffentliche Confirmation noch nicht aktiviert',
          copied: 'Link kopiert.',
          approve: 'Änderung freigeben',
          correction: 'Korrekturrevision',
          correctionReason: 'Grund für Korrektur',
          createCorrection: 'Revision anlegen',
          proposed: 'Vorgeschlagen',
          requested: 'Gewünscht',
          confirmed: 'Bestätigt',
          awaiting: 'Antwort ausstehend',
        }
      : {
          title: 'Conferme',
          intro:
            'I batch nascono dagli ordini inviati in Data Entry. DRAFT viene inviato con un link sicuro monouso; le modifiche dell’organizzazione diventano CHANGE_REQUESTED e richiedono approvazione DNS.',
          draft: 'Non ancora inviato',
          create: 'Prepara conferma',
          current: 'Conferme',
          dispatch: 'Genera e copia link',
          publicDisabled: 'Conferma pubblica non ancora attiva',
          copied: 'Link copiato.',
          approve: 'Approva modifica',
          correction: 'Revisione correttiva',
          correctionReason: 'Motivo della correzione',
          createCorrection: 'Crea revisione',
          proposed: 'Proposto',
          requested: 'Richiesto',
          confirmed: 'Confermato',
          awaiting: 'In attesa di risposta',
        };

  const entries = useMemo(
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
    setBusyId(input.order.id);
    setMessage('');
    try {
      await createConfirmationBatch({
        order: input.order,
        selectedOrderLineIds: lineIds,
        priorConfirmations: input.confirmations,
        actorId,
      });
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(null);
    }
  }

  async function dispatch(confirmation: ConfirmationRecord) {
    if (!publicConfirmationEnabled()) {
      setMessage(copy.publicDisabled);
      return;
    }

    setBusyId(confirmation.id);
    setMessage('');
    try {
      const result = await dispatchConfirmationWithPublicToken({
        confirmationId: confirmation.id,
        repository: new FirestorePublicConfirmationRepository(),
        actorId,
        occurredAt: new Date().toISOString(),
      });
      const link = buildPublicUrl(result.rawToken);
      setGeneratedLinks((current) => ({ ...current, [confirmation.id]: link }));
      await navigator.clipboard.writeText(link);
      setMessage(copy.copied);
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(null);
    }
  }

  async function approve(confirmation: ConfirmationRecord) {
    setBusyId(confirmation.id);
    setMessage('');
    try {
      await approveConfirmationChanges({
        confirmationId: confirmation.id,
        actorId,
      });
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(null);
    }
  }

  async function createCorrection(confirmation: ConfirmationRecord) {
    const reason = revisionReasons[confirmation.id]?.trim() ?? '';
    if (!reason) return;

    setBusyId(confirmation.id);
    setMessage('');
    try {
      await createConfirmationCorrection({
        original: confirmation,
        reason,
        actorId,
      });
      setRevisionReasons((current) => ({ ...current, [confirmation.id]: '' }));
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(null);
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
        {entries.map(({ row, order, confirmations }) => (
          <article key={order.id} className="grid gap-4 p-5 xl:grid-cols-[260px_1fr]">
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
                    busyId === order.id ||
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
                <div className="mt-5 grid gap-3">
                  {confirmations.map((confirmation) => (
                    <div
                      key={confirmation.id}
                      className="rounded-md border border-dns-mid/15 bg-white p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[10px] text-dns-muted">
                          {confirmation.id}
                        </span>
                        <span
                          className={[
                            'dns-status',
                            confirmation.status === 'DRAFT'
                              ? 'is-draft'
                              : confirmation.status === 'CHANGE_REQUESTED'
                                ? 'is-pending'
                                : 'is-connected',
                          ].join(' ')}
                        >
                          r{confirmation.revision} · {confirmation.status}
                        </span>

                        {confirmation.status === 'DRAFT' && (
                          <button
                            type="button"
                            className="dns-btn-secondary"
                            disabled={
                              busyId === confirmation.id ||
                              !publicConfirmationEnabled()
                            }
                            onClick={() => void dispatch(confirmation)}
                          >
                            {publicConfirmationEnabled()
                              ? copy.dispatch
                              : copy.publicDisabled}
                          </button>
                        )}

                        {confirmation.status === 'CHANGE_REQUESTED' && (
                          <button
                            type="button"
                            className="dns-primary-button"
                            disabled={busyId === confirmation.id}
                            onClick={() => void approve(confirmation)}
                          >
                            {copy.approve}
                          </button>
                        )}
                      </div>

                      {generatedLinks[confirmation.id] && (
                        <div className="mt-2 break-all font-mono text-[9px] text-dns-muted">
                          {generatedLinks[confirmation.id]}
                        </div>
                      )}

                      <div className="mt-3 grid gap-1">
                        {confirmation.lines.map((line) => {
                          const orderLine = order.lines.find(
                            (candidate) => candidate.id === line.orderLineId,
                          );
                          return (
                            <div
                              key={line.orderLineId}
                              className="grid gap-2 rounded-md bg-dns-bg px-3 py-2 md:grid-cols-[1fr_110px_110px_110px]"
                            >
                              <span>{orderLine?.label ?? line.catalogItemId}</span>
                              <span className="font-alt text-[10px]">
                                {copy.proposed}: {line.proposedQuantity}
                              </span>
                              <span className="font-alt text-[10px]">
                                {copy.requested}:{' '}
                                {line.requestedQuantity ?? '—'}
                              </span>
                              <span className="font-alt text-[10px]">
                                {copy.confirmed}:{' '}
                                {line.confirmedQuantity ?? '—'}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      {confirmation.status === 'SENT' && (
                        <div className="mt-3 font-alt text-[10px] text-dns-muted">
                          {copy.awaiting}
                        </div>
                      )}

                      {confirmation.status === 'CONFIRMED' && (
                        <div className="mt-3 rounded-md bg-dns-bg/60 p-3">
                          <div className="dns-kicker">{copy.correction}</div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <input
                              className="dns-input min-w-[280px] flex-1"
                              placeholder={copy.correctionReason}
                              value={revisionReasons[confirmation.id] ?? ''}
                              onChange={(event) =>
                                setRevisionReasons((current) => ({
                                  ...current,
                                  [confirmation.id]: event.target.value,
                                }))
                              }
                            />
                            <button
                              type="button"
                              className="dns-btn-secondary"
                              disabled={
                                busyId === confirmation.id ||
                                !(revisionReasons[confirmation.id] ?? '').trim()
                              }
                              onClick={() => void createCorrection(confirmation)}
                            >
                              {copy.createCorrection}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
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
