import { FormEvent, useState } from 'react';
import { signIn } from '../services/auth';
import type { Language } from '../types';

const DNS_LOGO_URL =
  'https://dolomitinordicski.github.io/dns-shared-data/brand/logo-web.png';

const copy = {
  de: {
    title: 'DNS Faktura',
    subtitle: 'Geschützter DNS-Admin-Zugang',
    email: 'E-Mail',
    password: 'Passwort',
    submit: 'Anmelden',
    pending: 'Anmeldung…',
    note: 'Faktura v2 verarbeitet interne Order-to-Billing-Daten und ist ausschließlich für DNS-Administratoren freigeschaltet.',
    error: 'Anmeldung nicht möglich. Bitte Zugangsdaten prüfen.',
  },
  it: {
    title: 'DNS Faktura',
    subtitle: 'Accesso protetto DNS Admin',
    email: 'E-mail',
    password: 'Password',
    submit: 'Accedi',
    pending: 'Accesso…',
    note: 'Faktura v2 gestisce il flusso interno Order-to-Billing ed è disponibile esclusivamente agli amministratori DNS.',
    error: 'Accesso non riuscito. Controlla le credenziali.',
  },
} as const;

export function LoginScreen({
  language,
  onLanguageChange,
}: {
  language: Language;
  onLanguageChange: (language: Language) => void;
}) {
  const t = copy[language];
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(false);
    try {
      await signIn(email, password);
    } catch (reason) {
      console.error('DNS Faktura sign-in failed', reason);
      setError(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-screen bg-dns-bg">
      <header className="bg-dns-deep text-white">
        <div className="dns-header-inner">
          <div className="flex items-center gap-4">
            <img
              src={DNS_LOGO_URL}
              alt="Dolomiti NordicSki"
              className="dns-header-logo"
            />
            <div className="dns-header-title">
              <strong className="font-bold">DNS</strong>{' '}
              <span className="font-normal">FAKTURA</span>
            </div>
          </div>
          <div className="dns-language-switch">
            {(['de', 'it'] as const).map((lang) => (
              <button
                key={lang}
                type="button"
                onClick={() => onLanguageChange(lang)}
                data-dns-press
                aria-pressed={language === lang}
                className="dns-language-button"
              >
                {lang.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="dns-shell flex justify-center py-14 md:py-20">
        <section className="dns-card w-full max-w-[460px] p-6 md:p-8">
          <div className="dns-kicker">{t.subtitle}</div>
          <h1 className="mt-1 text-[28px] font-semibold text-dns-deep">{t.title}</h1>
          <p className="mt-2 font-alt text-[12px] leading-relaxed text-dns-muted">{t.note}</p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <label className="block">
              <span className="dns-kicker">{t.email}</span>
              <input
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-2 w-full rounded-md border border-dns-mid/20 bg-white px-3 py-2.5 font-alt text-[12px] outline-none focus:border-dns-mid"
              />
            </label>
            <label className="block">
              <span className="dns-kicker">{t.password}</span>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-2 w-full rounded-md border border-dns-mid/20 bg-white px-3 py-2.5 font-alt text-[12px] outline-none focus:border-dns-mid"
              />
            </label>
            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 font-alt text-[11px] text-red-800">
                {t.error}
              </div>
            )}
            <button
              type="submit"
              disabled={pending}
              className="dns-primary-button w-full"
            >
              {pending ? t.pending : t.submit}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
