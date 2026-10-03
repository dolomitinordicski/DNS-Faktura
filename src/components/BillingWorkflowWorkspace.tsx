import { useState } from 'react';
import type {
  BillingSheetRecord,
  ConfirmationRecord,
} from '../v2/contracts/persistence';
import type { Language } from '../types';
import { buildOrRefreshBillingDraft } from '../v2/application/billingWorkspaceService';
import { addManualService } from '../v2/application/manualServiceService';
import { FirestoreBillingSheetRepository } from '../v2/persistence/firestoreBillingSheetRepository';
import { OrganizationIdentity } from './OrganizationIdentity';

type Row = {
  organizationId: string;
  organizationName: string;
  confirmations: ConfirmationRecord[];
  billingSheets: BillingSheetRecord[];
};

type ManualDraft = {
  description: string;
  quantity: string;
  unitPrice: string;
  unit: 'piece' | 'hour' | 'flat' | 'km' | 'custom';
};

function money(value: number, language: Language) {
  return new Intl.NumberFormat(language === 'de' ? 'de-DE' : 'it-IT', {
    style: 'currency',
    currency: 'EUR',
  }).format(value);
}

function latestSheet(sheets: BillingSheetRecord[]) {
  return [...sheets].sort((a, b) => b.revision - a.revision)[0];
}

export function BillingWorkflowWorkspace({
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
  const [busyOrg, setBusyOrg] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [readiness, setReadiness] = useState<Record<string, string[]>>({});
  const [manual, setManual] = useState<Record<string, ManualDraft>>({});

  const copy =
    language === 'de'
      ? {
          title: 'Fakturavorbereitung',
          intro:
            'Der Billing Draft aggregiert FAIR, IDM, bestätigte Order-Mengen, gültige Tarife und manuelle Leistungen. Nur DRAFT ist editierbar; READY und INVOICED bleiben eingefroren.',
          build: 'Billing Draft erzeugen',
          refresh: 'Draft aktualisieren',
          revisionBlocked: 'Neue Revision benötigt Begründung',
          sources: 'Positionen / Quellen',
          noSheet: 'Noch kein Billing Sheet.',
          manual: 'Manuelle Leistung',
          description: 'Beschreibung',
          quantity: 'Menge',
          unit: 'Einheit',
          unitPrice: 'Preis / Einheit',
          add: 'Hinzufügen',
          readiness: 'Readiness',
          ready: 'bereit',
          blocked: 'blockiert',
        }
      : {
          title: 'Preparazione fatturazione',
          intro:
            'Il Billing Draft aggrega FAIR, IDM, quantità confermate, tariffe valide e prestazioni manuali. Solo DRAFT è modificabile; READY e INVOICED restano congelati.',
          build: 'Crea Billing Draft',
          refresh: 'Aggiorna Draft',
          revisionBlocked: 'Una nuova revisione richiede una motivazione',
          sources: 'Voci / Fonti',
          noSheet: 'Nessun Billing Sheet.',
          manual: 'Prestazione manuale',
          description: 'Descrizione',
          quantity: 'Quantità',
          unit: 'Unità',
          unitPrice: 'Prezzo / unità',
          add: 'Aggiungi',
          readiness: 'Readiness',
          ready: 'pronto',
          blocked: 'bloccato',
        };

  const repository = new FirestoreBillingSheetRepository();

  function manualDraftFor(sheetId: string): ManualDraft {
    return (
      manual[sheetId] ?? {
        description: '',
        quantity: '1',
        unitPrice: '',
        unit: 'piece',
      }
    );
  }

  function patchManual(sheetId: string, patch: Partial<ManualDraft>) {
    setManual((current) => ({
      ...current,
      [sheetId]: { ...manualDraftFor(sheetId), ...patch },
    }));
  }

  async function build(row: Row) {
    setBusyOrg(row.organizationId);
    setMessages((current) => ({ ...current, [row.organizationId]: '' }));
    try {
      const result = await buildOrRefreshBillingDraft({
        seasonId:
          row.billingSheets[0]?.seasonId ??
          row.confirmations[0]?.seasonId ??
          '2026-27',
        organizationId: row.organizationId,
        confirmations: row.confirmations,
        existingSheets: row.billingSheets,
        actorId,
        repository,
      });

      setReadiness((current) => ({
        ...current,
        [row.organizationId]: result.readiness.issues.map((issue) => issue.code),
      }));
      setMessages((current) => ({
        ...current,
        [row.organizationId]: result.readiness.ready ? copy.ready : copy.blocked,
      }));
      onChanged();
    } catch (error) {
      setMessages((current) => ({
        ...current,
        [row.organizationId]:
          error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setBusyOrg(null);
    }
  }

  async function addManual(sheet: BillingSheetRecord) {
    const draft = manualDraftFor(sheet.id);
    const quantity = Number(draft.quantity.replace(',', '.'));
    const unitPrice = Number(draft.unitPrice.replace(',', '.'));
    if (!sheet.updatedAt) return;

    setBusyOrg(sheet.organizationId);
    try {
      await addManualService({
        billingSheetId: sheet.id,
        lineId: crypto.randomUUID(),
        values: {
          description: draft.description,
          quantity,
          unit: draft.unit,
          unitPrice,
        },
        repository,
        actorId,
        occurredAt: new Date().toISOString(),
        expectedUpdatedAt: sheet.updatedAt,
      });
      setManual((current) => ({ ...current, [sheet.id]: {
        description: '',
        quantity: '1',
        unitPrice: '',
        unit: 'piece',
      }}));
      onChanged();
    } catch (error) {
      setMessages((current) => ({
        ...current,
        [sheet.organizationId]:
          error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setBusyOrg(null);
    }
  }

  return (
    <section className="mt-6 dns-card overflow-hidden">
      <div className="border-b border-dns-mid/10 px-5 py-4">
        <div className="dns-kicker">CONFIRMATION → BILLING SHEET</div>
        <h2 className="mt-1 text-lg font-semibold">{copy.title}</h2>
        <p className="mt-2 max-w-5xl font-alt text-[11px] leading-relaxed text-dns-muted">
          {copy.intro}
        </p>
      </div>

      <div className="divide-y divide-dns-mid/10">
        {rows.map((row) => {
          const sheet = latestSheet(row.billingSheets);
          const canBuild = !sheet || sheet.status === 'DRAFT';
          const manualDraft = sheet ? manualDraftFor(sheet.id) : null;
          const issueCodes = readiness[row.organizationId] ?? [];

          return (
            <article
              key={row.organizationId}
              className="grid gap-5 p-5 xl:grid-cols-[260px_1fr]"
            >
              <OrganizationIdentity
                organizationId={row.organizationId}
                organizationName={row.organizationName}
                logoUrl={organizationLogos[row.organizationId]}
              />

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  {sheet ? (
                    <>
                      <span className="font-mono text-[10px] text-dns-muted">
                        {sheet.id}
                      </span>
                      <span
                        className={[
                          'dns-status',
                          sheet.status === 'DRAFT' ? 'is-draft' : 'is-connected',
                        ].join(' ')}
                      >
                        {sheet.status} · r{sheet.revision}
                      </span>
                      <strong>{money(sheet.totalAmount, language)}</strong>
                    </>
                  ) : (
                    <span className="font-alt text-[11px] text-dns-muted">
                      {copy.noSheet}
                    </span>
                  )}

                  <button
                    type="button"
                    className="dns-primary-button"
                    disabled={!canBuild || busyOrg === row.organizationId}
                    onClick={() => void build(row)}
                  >
                    {!sheet ? copy.build : sheet.status === 'DRAFT' ? copy.refresh : copy.revisionBlocked}
                  </button>
                </div>

                {messages[row.organizationId] && (
                  <div className="mt-2 font-mono text-[10px] text-dns-mid">
                    {messages[row.organizationId]}
                  </div>
                )}

                {issueCodes.length > 0 && (
                  <div className="mt-3">
                    <div className="dns-kicker">{copy.readiness}</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {issueCodes.map((code) => (
                        <span
                          key={code}
                          className="dns-status is-error"
                        >
                          {code}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {sheet && (
                  <>
                    <div className="mt-4">
                      <div className="dns-kicker">{copy.sources}</div>
                      <div className="mt-2 grid gap-2">
                        {sheet.lines.length === 0 ? (
                          <span className="font-alt text-[11px] text-dns-muted">—</span>
                        ) : (
                          sheet.lines.map((line) => (
                            <div
                              key={line.id}
                              className="grid gap-2 rounded-md bg-dns-bg px-3 py-2 md:grid-cols-[120px_1fr_90px_110px]"
                            >
                              <span className="font-mono text-[9px] text-dns-mid">
                                {line.sourceType}
                              </span>
                              <span>{line.description}</span>
                              <span className="text-right">
                                {line.quantity} × {money(line.unitPrice, language)}
                              </span>
                              <strong className="text-right">
                                {money(line.amount, language)}
                              </strong>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    {sheet.status === 'DRAFT' && manualDraft && (
                      <div className="mt-4 rounded-md border border-dns-mid/15 p-3">
                        <div className="dns-kicker">{copy.manual}</div>
                        <div className="mt-3 grid gap-2 md:grid-cols-[1fr_90px_100px_130px_auto]">
                          <input
                            className="dns-input !w-full"
                            placeholder={copy.description}
                            value={manualDraft.description}
                            onChange={(event) =>
                              patchManual(sheet.id, {
                                description: event.target.value,
                              })
                            }
                          />
                          <input
                            className="dns-input !w-full"
                            inputMode="decimal"
                            placeholder={copy.quantity}
                            value={manualDraft.quantity}
                            onChange={(event) =>
                              patchManual(sheet.id, {
                                quantity: event.target.value,
                              })
                            }
                          />
                          <select
                            className="dns-input !w-full"
                            value={manualDraft.unit}
                            onChange={(event) =>
                              patchManual(sheet.id, {
                                unit: event.target.value as ManualDraft['unit'],
                              })
                            }
                          >
                            <option value="piece">piece</option>
                            <option value="hour">hour</option>
                            <option value="flat">flat</option>
                            <option value="km">km</option>
                            <option value="custom">custom</option>
                          </select>
                          <input
                            className="dns-input !w-full"
                            inputMode="decimal"
                            placeholder={copy.unitPrice}
                            value={manualDraft.unitPrice}
                            onChange={(event) =>
                              patchManual(sheet.id, {
                                unitPrice: event.target.value,
                              })
                            }
                          />
                          <button
                            type="button"
                            className="dns-btn-secondary"
                            disabled={
                              busyOrg === row.organizationId ||
                              !manualDraft.description.trim() ||
                              !manualDraft.unitPrice.trim()
                            }
                            onClick={() => void addManual(sheet)}
                          >
                            {copy.add}
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
