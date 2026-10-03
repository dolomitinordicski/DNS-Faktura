import { useEffect, useState } from 'react';
import type { Language } from '../types';
import {
  resolvePublicConfirmation,
  submitPublicConfirmation,
  type PublicConfirmationView,
} from '../v2/application/publicConfirmationApi';

const apiBaseUrl = import.meta.env.VITE_FAKTURA_PUBLIC_API_BASE?.trim() ?? '';

export function publicConfirmationEnabled() {
  return Boolean(apiBaseUrl);
}

export function PublicConfirmationPage({
  rawToken,
  language,
}: {
  rawToken: string;
  language: Language;
}) {
  const [view, setView] = useState<PublicConfirmationView | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [actorLabel, setActorLabel] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'done' | 'error'>(
    'loading',
  );
  const [message, setMessage] = useState('');

  const it = language === 'it';
  const copy = it
    ? {
        title: 'Conferma ordine',
        intro: 'Controlla le quantità e conferma o proponi una modifica.',
        quantity: 'Quantità',
        name: 'Nome / referente',
        submit: 'Invia conferma',
        done: 'Risposta registrata.',
        disabled: 'La conferma pubblica non è ancora attivata.',
      }
    : {
        title: 'Auftragsbestätigung',
        intro: 'Mengen prüfen und bestätigen oder eine Änderung vorschlagen.',
        quantity: 'Menge',
        name: 'Name / Ansprechpartner',
        submit: 'Bestätigung senden',
        done: 'Antwort wurde gespeichert.',
        disabled: 'Die öffentliche Bestätigung ist noch nicht aktiviert.',
      };

  useEffect(() => {
    if (!apiBaseUrl) {
      setState('error');
      setMessage(copy.disabled);
      return;
    }

    let active = true;
    void resolvePublicConfirmation({ apiBaseUrl, rawToken })
      .then((result) => {
        if (!active) return;
        setView(result);
        setQuantities(
          Object.fromEntries(
            result.lines.map((line) => [
              line.orderLineId,
              String(line.proposedQuantity),
            ]),
          ),
        );
        setState('ready');
      })
      .catch((error) => {
        if (!active) return;
        setState('error');
        setMessage(error instanceof Error ? error.message : String(error));
      });

    return () => {
      active = false;
    };
  }, [rawToken]);

  async function submit() {
    if (!view || !actorLabel.trim()) return;
    setState('loading');
    try {
      await submitPublicConfirmation({
        apiBaseUrl,
        rawToken,
        actorLabel: actorLabel.trim(),
        requestedQuantities: Object.fromEntries(
          view.lines.map((line) => [
            line.orderLineId,
            Number((quantities[line.orderLineId] ?? '0').replace(',', '.')),
          ]),
        ),
      });
      setState('done');
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <main className="min-h-screen bg-dns-bg py-10 text-dns-deep">
      <div className="dns-shell max-w-3xl">
        <section className="dns-card p-6 md:p-8">
          <div className="dns-kicker">DOLOMITI NORDICSKI</div>
          <h1 className="mt-2 text-[28px] font-semibold">{copy.title}</h1>
          <p className="mt-2 font-alt text-[12px] text-dns-muted">{copy.intro}</p>

          {state === 'loading' && (
            <div className="mt-6 font-alt text-[12px] text-dns-muted">…</div>
          )}

          {state === 'error' && (
            <div className="mt-6 dns-status is-error">{message}</div>
          )}

          {state === 'done' && (
            <div className="mt-6 dns-status is-connected">{copy.done}</div>
          )}

          {state === 'ready' && view && (
            <>
              <div className="mt-6 grid gap-2">
                {view.lines.map((line) => (
                  <div
                    key={line.orderLineId}
                    className="grid items-center gap-3 rounded-md bg-dns-bg p-3 md:grid-cols-[1fr_140px]"
                  >
                    <div>
                      <div className="font-medium">{line.catalogItemId}</div>
                      <div className="font-alt text-[10px] text-dns-muted">
                        {line.orderLineId}
                      </div>
                    </div>
                    <label className="grid gap-1">
                      <span className="font-alt text-[9px] uppercase text-dns-muted">
                        {copy.quantity}
                      </span>
                      <input
                        className="dns-input !w-full"
                        inputMode="decimal"
                        value={quantities[line.orderLineId] ?? ''}
                        onChange={(event) =>
                          setQuantities((current) => ({
                            ...current,
                            [line.orderLineId]: event.target.value,
                          }))
                        }
                      />
                    </label>
                  </div>
                ))}
              </div>

              <label className="mt-5 grid gap-1">
                <span className="font-alt text-[9px] uppercase text-dns-muted">
                  {copy.name}
                </span>
                <input
                  className="dns-input !w-full"
                  value={actorLabel}
                  onChange={(event) => setActorLabel(event.target.value)}
                />
              </label>

              <button
                type="button"
                className="dns-primary-button mt-5"
                disabled={!actorLabel.trim()}
                onClick={() => void submit()}
              >
                {copy.submit}
              </button>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
