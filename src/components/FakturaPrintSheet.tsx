import { createPortal } from 'react-dom';
import { DNS_SHARED_PRINT_LOGO_URL } from '../services/designSystem';
import type { Language, OrganizationBillingRow } from '../types';

function formatCurrency(value: number, language: Language) {
  return new Intl.NumberFormat(language === 'de' ? 'de-DE' : 'it-IT', {
    style: 'currency',
    currency: 'EUR',
  }).format(value);
}

function formatNumber(value: number, language: Language) {
  return new Intl.NumberFormat(language === 'de' ? 'de-DE' : 'it-IT').format(value);
}

export function FakturaPrintSheet({
  language,
  seasonId,
  organizations,
}: {
  language: Language;
  seasonId: string;
  organizations: OrganizationBillingRow[];
}) {
  const date = new Date().toLocaleDateString(language === 'de' ? 'de-DE' : 'it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  const t = language === 'de'
    ? {
        title: 'Interner Faktura-Überblick',
        organization: 'Organisation',
        area: 'Gebiet',
        fair: 'FAIR / Mitgliedsbeitrag',
        idm: 'IDM Premiumpartner',
        orders: 'Orders',
        extras: 'Saisonale Extras',
        total: 'Gesamtsumme',
        quantity: 'Menge',
        note: 'Interne Fakturavorbereitung · keine offizielle Rechnung · keine Buchhaltung · keine Zahlungsverwaltung',
      }
    : {
        title: 'Riepilogo interno Faktura',
        organization: 'Organizzazione',
        area: 'Area',
        fair: 'FAIR / Quota associativa',
        idm: 'IDM Premiumpartner',
        orders: 'Ordini',
        extras: 'Extra stagionali',
        total: 'Totale',
        quantity: 'Quantità',
        note: 'Preparazione interna fatturazione · nessuna fattura ufficiale · nessuna contabilità · nessuna gestione pagamenti',
      };

  return createPortal(
    <section className="dns-print-sheet" aria-hidden="true">
      <header className="dns-print-document-header">
        <img
          className="dns-print-logo"
          src={DNS_SHARED_PRINT_LOGO_URL}
          alt="Dolomiti NordicSki"
        />
        <div>
          <h1 className="dns-print-title">{t.title}</h1>
          <div className="dns-print-meta">
            Dolomiti NordicSki · WS {seasonId} · {date}
          </div>
        </div>
      </header>

      <table className="dns-print-table">
        <thead>
          <tr>
            <th>{t.organization}</th>
            <th>{t.area}</th>
            <th className="dns-print-number">{t.fair}</th>
            <th className="dns-print-number">{t.idm}</th>
            <th className="dns-print-number">{t.orders}</th>
            <th className="dns-print-number">{t.extras}</th>
            <th className="dns-print-number">{t.total}</th>
          </tr>
        </thead>
        <tbody>
          {organizations.map((row) => (
            <tr key={row.organizationId}>
              <td>{row.organizationName}</td>
              <td>{row.reportingAreaName ?? '—'}</td>
              <td className="dns-print-number">{row.fair > 0 ? formatCurrency(row.fair, language) : '—'}</td>
              <td className="dns-print-number">{row.idm > 0 ? formatCurrency(row.idm, language) : '—'}</td>
              <td className="dns-print-number">
                {row.orders > 0
                  ? formatCurrency(row.orders, language)
                  : row.orderCount > 0
                    ? `${formatNumber(row.orderQuantityActive, language)} ${t.quantity.toLowerCase()}`
                    : '—'}
              </td>
              <td className="dns-print-number">{row.extras > 0 ? formatCurrency(row.extras, language) : '—'}</td>
              <td className="dns-print-number">{formatCurrency(row.fair + row.idm + row.orders + row.extras, language)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="dns-print-meta">{t.note}</div>
    </section>,
    document.body,
  );
}
