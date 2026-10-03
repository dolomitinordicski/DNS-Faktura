import type { AuditEventRecord } from '../v2/contracts/persistence';
import type { Language } from '../types';
import { OrganizationIdentity } from './OrganizationIdentity';

type Row = {
  organizationId: string;
  organizationName: string;
  events: AuditEventRecord[];
};

function formatTime(value: string, language: Language) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === 'de' ? 'de-DE' : 'it-IT', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function AuditWorkspace({
  rows,
  organizationLogos,
  language,
}: {
  rows: Row[];
  organizationLogos: Record<string, string>;
  language: Language;
}) {
  const copy =
    language === 'de'
      ? {
          title: 'Audit Trail',
          intro:
            'Append-only Ereignisse aus Faktura v2. Die Historie erklärt Zustandswechsel, ohne eingefrorene Confirmation- oder Billing-Snapshots umzuschreiben.',
          empty: 'Noch keine Ereignisse.',
          actor: 'Akteur',
          entity: 'Objekt',
        }
      : {
          title: 'Audit trail',
          intro:
            'Eventi append-only di Faktura v2. Lo storico spiega le transizioni senza riscrivere Confirmation o Billing snapshot congelati.',
          empty: 'Nessun evento.',
          actor: 'Attore',
          entity: 'Oggetto',
        };

  const populated = rows.filter((row) => row.events.length > 0);

  return (
    <section className="mt-6 dns-card overflow-hidden">
      <div className="border-b border-dns-mid/10 px-5 py-4">
        <div className="dns-kicker">FAKTURA V2 · EVENTS</div>
        <h2 className="mt-1 text-lg font-semibold">{copy.title}</h2>
        <p className="mt-2 max-w-5xl font-alt text-[11px] leading-relaxed text-dns-muted">
          {copy.intro}
        </p>
      </div>

      {populated.length === 0 ? (
        <p className="p-5 font-alt text-[11px] text-dns-muted">{copy.empty}</p>
      ) : (
        <div className="divide-y divide-dns-mid/10">
          {populated.map((row) => (
            <article
              key={row.organizationId}
              className="grid gap-4 p-5 xl:grid-cols-[260px_1fr]"
            >
              <OrganizationIdentity
                organizationId={row.organizationId}
                organizationName={row.organizationName}
                logoUrl={organizationLogos[row.organizationId]}
              />
              <div className="grid gap-2">
                {row.events.map((event) => (
                  <div
                    key={event.id}
                    className="grid gap-2 rounded-md bg-dns-bg px-3 py-2 md:grid-cols-[150px_190px_1fr]"
                  >
                    <span className="font-alt text-[10px] text-dns-muted">
                      {formatTime(event.occurredAt, language)}
                    </span>
                    <strong className="text-[11px]">{event.type}</strong>
                    <div className="min-w-0">
                      <div className="font-mono text-[9px] text-dns-muted">
                        {copy.entity}: {event.entityType} · {event.entityId}
                      </div>
                      <div className="mt-1 font-alt text-[9px] text-dns-muted">
                        {copy.actor}: {event.actorLabel ?? event.actorId}
                      </div>
                      {Object.keys(event.payload).length > 0 && (
                        <div className="mt-1 break-words font-mono text-[9px] text-dns-mid">
                          {JSON.stringify(event.payload)}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
