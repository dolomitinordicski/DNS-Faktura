export function OrganizationIdentity({
  organizationId,
  organizationName,
  logoUrl,
}: {
  organizationId: string;
  organizationName: string;
  logoUrl?: string;
}) {
  return (
    <div className="flex min-w-[210px] items-center gap-3">
      <div className="flex h-11 w-24 shrink-0 items-center justify-center rounded-md bg-white p-1.5">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt=""
            aria-hidden="true"
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <span className="font-mono text-[9px] text-dns-muted">
            {organizationId}
          </span>
        )}
      </div>
      <span className="font-medium">{organizationName}</span>
    </div>
  );
}
