const DNS_SHARED_REGION_MANIFEST_URL =
  'https://dolomitinordicski.github.io/dns-shared-data/brand/regions/manifest.json';
const DNS_SHARED_REGION_BASE_URL =
  'https://dolomitinordicski.github.io/dns-shared-data/brand/regions';

type LogoBinding = {
  entityType: 'reportingArea' | 'destination' | 'organization';
  entityId: string;
};

type LogoAsset = {
  filename: string;
  priority?: 'primary' | 'secondary';
  seasonIds?: string[];
  entityBindings?: LogoBinding[];
};

type LogoManifest = {
  assets?: LogoAsset[];
};

function priorityRank(asset: LogoAsset, seasonId: string) {
  const seasonRank = asset.seasonIds?.includes(seasonId) ? 0 : asset.seasonIds ? 2 : 1;
  const priority = asset.priority === 'primary' ? 0 : asset.priority === 'secondary' ? 2 : 1;
  return seasonRank * 10 + priority;
}

export async function loadOrganizationLogoUrls(
  seasonId: string,
): Promise<Record<string, string>> {
  const response = await fetch(DNS_SHARED_REGION_MANIFEST_URL, {
    cache: 'force-cache',
  });
  if (!response.ok) {
    throw new Error(`ORGANIZATION_LOGO_MANIFEST_${response.status}`);
  }

  const manifest = (await response.json()) as LogoManifest;
  const candidates = new Map<string, LogoAsset[]>();

  for (const asset of manifest.assets ?? []) {
    for (const binding of asset.entityBindings ?? []) {
      if (binding.entityType !== 'organization') continue;
      const current = candidates.get(binding.entityId) ?? [];
      current.push(asset);
      candidates.set(binding.entityId, current);
    }
  }

  return Object.fromEntries(
    [...candidates.entries()].flatMap(([organizationId, assets]) => {
      const eligible = assets
        .filter(
          (asset) =>
            !asset.seasonIds ||
            asset.seasonIds.includes(seasonId),
        )
        .sort(
          (a, b) =>
            priorityRank(a, seasonId) - priorityRank(b, seasonId),
        );

      const selected = eligible[0];
      return selected
        ? [[organizationId, `${DNS_SHARED_REGION_BASE_URL}/${selected.filename}`]]
        : [];
    }),
  );
}
