import { useEffect, useState } from 'react';
import {
  resolvePublicConfirmation,
  submitPublicConfirmation,
  type PublicConfirmationSubmitResult,
  type PublicConfirmationView,
} from '../v2/application/publicConfirmationApi';
import type { Language } from '../types';

const API_BASE = 'https://europe-west1-dns-core.cloudfunctions.net';
const DNS_LOGO_URL =
  'https://dolomitinordicski.github.io/dns-shared-data/brand/logo-web.png';

function lineLabel(
  line: PublicConfirmationView['lines'][number],
  language: Language,
) {
  return (
    line.label?.[language] ??
    line.label?.de ??
    line.label?.it ??
    line.label?.en ??
    line.catalogItemId
  );
}

export function PublicConfirmationPage({
  rawToken,
}: {
  rawToken: string;
}) {
  const [language, setLanguage] = useState<Language>('de');
  const [view, setView] = useState<PublicConfirmationView | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [actorLabel, setActorLabel] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'error' | 'done'>('loading');
  const [error, setError] = useState('');
  const [result, setResult] = useState<PublicConfirmationSubmitResult | null>(null);

  const copy =
    language === 'de'
      ? {
          title: 'Bestellung bestätigen',
          intro:
            'Bitte prüfen Sie die vorgeschlagenen Mengen. Sie können die Mengen unverändert bestätigen oder Änderungen anfordern.',
          quantity: 'Menge',
          name: 'Name / Ansprechpartner',
          submit: 'Bestätigung absenden',
          loading: 'Bestätigung wird geladen…',
          error: 'Die Bestätigung konnte nicht geladen werden.',
          confirmed: 'Bestellung bestätigt.',
          changed:
            'Änderungswunsch übermittelt. Dolomiti NordicSki prüft die geänderten Mengen.',
          acceptance:
            'Mit dem Absenden bestätige ich die angezeigten bzw. angepassten Mengen.',
        }
      : {
          title: 'Conferma ordine',
          intro:
            'Controlla le quantità proposte. Puoi confermarle senza modifiche oppure richiedere quantità diverse.',
          quantity: 'Quantità',
          name: 'Nome / Referente',
          submit: 'Invia conferma',
          loading: 'Caricamento conferma…',
          error: 'Impossibile caricare la conferma.',
          confirmed: 'Ordine confermato.',
          changed:
            'Richiesta di modifica inviata. Dolomiti NordicSki verificherà le quantità modificate.',
          acceptance:
            'Con l’invio confermo le quantità visualizzate o modificate.',
        };

  useEffect(() => {
    let active = true;
    setState('loading');
    void resolvePublicConfirmation({
      apiBaseUrl: API_BASE,
      rawToken,
    })
      .then((resolved) => {
        if (!active) return;
        setView(resolved);
        setQuantities(
          Object.fromEntries(
            resolved.lines.map((line) => [
              line.orderLineId,
              String(line.proposedQuantity),
            ]),
          ),
        );
        setState('ready');
      })
      .catch((reason) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setState('error');
      });

    return () => {
      active = false;
    };
  }, [rawToken]);

  async function submit() {
    if (!view || !actorLabel.trim()) return;
    setState('saving');
    setError('');
    try {
      const requestedQuantities = Object.fromEntries(
        view.lines.map((line) => {
          const value = Number(
            (quantities[line.orderLineId] ?? String(line.proposedQuantity)).replace(
              ',',
              '.',
            ),
          );
          if (!Number.isFinite(value) || value < 0) {
            throw new Error('INVALID_REQUESTED_QUANTITY');
          }
          return [line.orderLineId, value];
        }),
      );

      const next = await submitPublicConfirmation({
        apiBaseUrl: API_BASE,
        rawToken,
        requestedQuantities,
        actorLabel: actorLabel.trim(),
      });
      setResult(next);
      setState('done');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setState('ready');
    }
  }

  return (
    <div className="min-h-screen bg-dns-bg text-dns-deep">
      <header className="bg-dns-deep text-white">
        <div className="dns-shell flex items-center justify-between gap-4 py-5">
          <div className="flex items-center gap-4">
            <img src={DNS_LOGO_URL} alt="Dolomiti NordicSki" className="h-8" />
            <div>
              <div className="font-semibold">DNS FAKTURA</div>
              <div className="font-alt text-[10px] text-white/70">
                Order Confirmation
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            {(['de', 'it'] as const).map((candidate) => (
              <button
                key={candidate}
                type="button"
                className={[
                  'border-b-2 px-1 py-1 text-[11px]',
                  language === candidate
                    ? 'border-white'
                    : 'border-transparent opacity-60',
                ].join(' ')}
                onClick={() => setLanguage(candidate)}
              >
                {candidate.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="dns-shell py-8 md:py-12">
        <section className="mx-auto max-w-3xl dns-card overflow-hidden">
          <div className="border-b border-dns-mid/10 p-5 md:p-7">
            <div className="dns-kicker">DOLOMITI NORDICSKI</div>
            <h1 className="mt-1 text-[26px] font-semibold">{copy.title}</h1>
            <p className="mt-2 font-alt text-[12px] leading-relaxed text-dns-muted">
              {copy.intro}
            </p>
          </div>

          {state === 'loading' && (
            <div className="p-6 font-alt text-[12px] text-dns-muted">
              {copy.loading}
            </div>
          )}

          {state === 'error' && (
            <div className="p-6">
              <div className="dns-status is-error">{copy.error}</div>
              <div className="mt-2 font-mono text-[10px] text-dns-muted">
                {error}
              </div>
            </div>
          )}

          {state === 'done' && result && (
            <div className="p-6">
              <div className="dns-status is-connected">
                {result.status === 'CONFIRMED'
                  ? copy.confirmed
                  : copy.changed}
              </div>
            </div>
          )}

          {(state === 'ready' || state === 'saving') && view && (
            <div className="p-5 md:p-7">
              <div className="grid gap-2">
                {view.lines.map((line) => (
                  <label
                    key={line.orderLineId}
                    className="grid items-center gap-3 rounded-md bg-dns-bg px-3 py-3 sm:grid-cols-[1fr_120px]"
                  >
                    <div>
                      <div className="font-medium">
                        {lineLabel(line, language)}
                      </div>
                      <div className="mt-0.5 font-mono text-[9px] text-dns-muted">
                        {line.catalogItemId}
                      </div>
                    </div>
                    <div>
                      <div className="mb-1 font-alt text-[9px] uppercase tracking-[.04em] text-dns-muted">
                        {copy.quantity}
                      </div>
                      <input
                        className="dns-input !w-full text-right font-semibold"
                        inputMode="decimal"
                        value={
                          quantities[line.orderLineId] ??
                          String(line.proposedQuantity)
                        }
                        onChange={(event) =>
                          setQuantities((current) => ({
                            ...current,
                            [line.orderLineId]: event.target.value,
                          }))
                        }
                      />
                    </div>
                  </label>
                ))}
              </div>

              <label className="mt-5 block font-alt text-[10px]">
                {copy.name}
                <input
                  className="dns-input mt-1 !w-full"
                  value={actorLabel}
                  onChange={(event) => setActorLabel(event.target.value)}
                />
              </label>

              <p className="mt-4 font-alt text-[10px] leading-relaxed text-dns-muted">
                {copy.acceptance}
              </p>

              {error && (
                <div className="mt-3 dns-status is-error">{error}</div>
              )}

              <button
                type="button"
                className="dns-primary-button mt-5"
                disabled={state === 'saving' || !actorLabel.trim()}
                onClick={() => void submit()}
              >
                {copy.submit}
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
