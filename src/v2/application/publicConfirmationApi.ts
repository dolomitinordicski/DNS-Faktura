export interface PublicConfirmationView {
  confirmationId: string;
  acceptanceTextVersion: string;
  lines: Array<{
    orderLineId: string;
    catalogItemId: string;
    label?: { de?: string; it?: string; en?: string };
    proposedQuantity: number;
    unit: string;
  }>;
}

export interface PublicConfirmationSubmitResult {
  confirmationId: string;
  status: 'CONFIRMED' | 'CHANGE_REQUESTED';
}

async function postJson<T>(input: {
  url: string;
  body: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}): Promise<T> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(input.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input.body),
  });

  const payload = (await response.json().catch(() => null)) as
    | { error?: string }
    | T
    | null;

  if (!response.ok) {
    const code =
      payload && typeof payload === 'object' && 'error' in payload
        ? payload.error
        : undefined;
    throw new Error(code || `PUBLIC_CONFIRMATION_HTTP_${response.status}`);
  }

  return payload as T;
}

export async function resolvePublicConfirmation(input: {
  apiBaseUrl: string;
  rawToken: string;
  fetchImpl?: typeof fetch;
}): Promise<PublicConfirmationView> {
  return postJson<PublicConfirmationView>({
    url: `${input.apiBaseUrl.replace(/\/$/, '')}/resolvePublicConfirmation`,
    body: { token: input.rawToken },
    fetchImpl: input.fetchImpl,
  });
}

export async function submitPublicConfirmation(input: {
  apiBaseUrl: string;
  rawToken: string;
  requestedQuantities: Record<string, number>;
  actorLabel: string;
  fetchImpl?: typeof fetch;
}): Promise<PublicConfirmationSubmitResult> {
  return postJson<PublicConfirmationSubmitResult>({
    url: `${input.apiBaseUrl.replace(/\/$/, '')}/submitPublicConfirmation`,
    body: {
      token: input.rawToken,
      requestedQuantities: input.requestedQuantities,
      actorLabel: input.actorLabel,
    },
    fetchImpl: input.fetchImpl,
  });
}
