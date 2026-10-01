export type LogoEntityType = 'reportingArea' | 'destination' | 'organization';

export interface RegionLogo {
  id: string;
  label: string;
  filename: string;
  priority?: 'primary' | 'secondary';
  entityBindings: { entityType: LogoEntityType; entityId: string }[];
}

export const REGION_LOGO_MANIFEST_URL =
  'https://raw.githubusercontent.com/dolomitinordicski/dns-shared-data/main/brand/regions/manifest.json';

let manifestPromise: Promise<RegionLogo[]> | undefined;

export function loadRegionLogos(): Promise<RegionLogo[]> {
  return manifestPromise ??= fetch(REGION_LOGO_MANIFEST_URL)
    .then(async (response) => {
      if (!response.ok) throw new Error(`Logo manifest: ${response.status}`);
      const manifest = await response.json();
      if (!Array.isArray(manifest.assets)) throw new Error('Invalid logo manifest');
      return manifest.assets.filter((asset: RegionLogo) =>
        typeof asset.id === 'string' &&
        typeof asset.label === 'string' &&
        typeof asset.filename === 'string' &&
        /^[a-z0-9-]+\.svg$/.test(asset.filename) &&
        Array.isArray(asset.entityBindings),
      );
    });
}

export function findRegionLogos(
  assets: RegionLogo[],
  entityType: LogoEntityType,
  entityId: string,
) {
  const matches = assets.filter((asset) =>
    asset.entityBindings.some(
      (binding) =>
        binding.entityType === entityType && binding.entityId === entityId,
    ),
  );
  const primary = matches.filter((asset) => asset.priority !== 'secondary');
  return primary.length ? primary : matches;
}

export function regionLogoUrl(asset: RegionLogo) {
  return new URL(asset.filename, REGION_LOGO_MANIFEST_URL).href;
}
