import type {
  ConfirmationDispatchRepository,
  ConfirmationRecord,
  PublicConfirmationResponseRepository,
  PublicConfirmationTokenRecord,
  PublicConfirmationTokenRepository,
} from '../contracts/persistence';

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(bytes).toString('base64');
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function hashConfirmationToken(rawToken: string) {
  if (!rawToken.trim()) throw new Error('TOKEN_REQUIRED');
  const encoded = new TextEncoder().encode(rawToken);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return bytesToHex(new Uint8Array(digest));
}

export function generateRawConfirmationToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export async function dispatchConfirmationWithPublicToken(input: {
  confirmationId: string;
  repository: ConfirmationDispatchRepository;
  actorId: string;
  occurredAt: string;
  expiresAt?: string;
  tokenId?: string;
  rawToken?: string;
}): Promise<{
  confirmation: ConfirmationRecord;
  rawToken: string;
  token: PublicConfirmationTokenRecord;
}> {
  const rawToken = input.rawToken ?? generateRawConfirmationToken();
  const tokenHash = await hashConfirmationToken(rawToken);
  const token: PublicConfirmationTokenRecord = {
    id: input.tokenId ?? crypto.randomUUID(),
    confirmationId: input.confirmationId,
    tokenHash,
    active: true,
    createdAt: input.occurredAt,
    expiresAt: input.expiresAt,
  };

  const confirmation = await input.repository.dispatchWithTokenTransaction({
    confirmationId: input.confirmationId,
    token,
    actorId: input.actorId,
    occurredAt: input.occurredAt,
  });

  return { confirmation, rawToken, token };
}

export async function resolvePublicConfirmationToken(input: {
  rawToken: string;
  repository: PublicConfirmationTokenRepository;
}) {
  const tokenHash = await hashConfirmationToken(input.rawToken);
  return input.repository.resolveActiveToken(tokenHash);
}

export async function submitPublicConfirmationResponse(input: {
  rawToken: string;
  requestedQuantities: Record<string, number>;
  actorLabel: string;
  occurredAt: string;
  repository: PublicConfirmationResponseRepository;
}): Promise<ConfirmationRecord> {
  const tokenHash = await hashConfirmationToken(input.rawToken);
  return input.repository.submitTokenResponseTransaction({
    tokenHash,
    requestedQuantities: input.requestedQuantities,
    actorLabel: input.actorLabel,
    occurredAt: input.occurredAt,
  });
}
