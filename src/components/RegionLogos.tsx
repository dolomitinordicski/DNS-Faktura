import { useEffect, useState } from 'react';
import {
  findRegionLogos,
  loadRegionLogos,
  regionLogoUrl,
  type LogoEntityType,
  type RegionLogo,
} from '../services/regionLogos';

export function RegionLogos({
  entityType,
  entityId,
}: {
  entityType: LogoEntityType;
  entityId: string;
}) {
  const [assets, setAssets] = useState<RegionLogo[]>([]);
  const [failed, setFailed] = useState<string[]>([]);

  useEffect(() => {
    let mounted = true;
    void loadRegionLogos()
      .then((logos) => {
        if (mounted) setAssets(logos);
      })
      .catch((error) => console.warn('Shared DNS logos unavailable', error));
    return () => {
      mounted = false;
    };
  }, []);

  const logos = findRegionLogos(assets, entityType, entityId).filter(
    (asset) => !failed.includes(asset.id),
  );

  if (!logos.length) return null;

  return (
    <span className="dns-region-logos" aria-hidden="true">
      {logos.map((asset) => (
        <img
          key={asset.id}
          src={regionLogoUrl(asset)}
          alt=""
          title={asset.label}
          className="dns-region-logo"
          onError={() => setFailed((current) => [...current, asset.id])}
        />
      ))}
    </span>
  );
}
