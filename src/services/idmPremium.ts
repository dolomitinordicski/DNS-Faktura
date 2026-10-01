export const IDM_PREMIUM_2026 = {
  seasonId: '2026-27',
  amountPerReportingArea: 15000,
  currency: 'EUR',
  reportingAreaIds: [
    'ahrntal',
    'seiser-alm-dolomites-val-gardena',
    'drei-zinnen',
    'antholzertal',
  ],
  sourceLabel: 'IDM Premiumpartner WS2026/27',
  note: 'Vier teilnehmende Regionen; 15.000 EUR je Region. Die Aufteilung auf einzelne Organisationen innerhalb mehrgliedriger Regionen ist in der Quelle nicht festgelegt.',
} as const;

export function idmPremiumTotal(seasonId: string) {
  return seasonId === IDM_PREMIUM_2026.seasonId
    ? IDM_PREMIUM_2026.reportingAreaIds.length * IDM_PREMIUM_2026.amountPerReportingArea
    : 0;
}
