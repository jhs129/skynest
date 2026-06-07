// Parameter parsing + redirect-URI matching for /oauth/authorize. Pulled into a
// helper so it can be unit-tested without a Next request context.

export interface AuthorizeParams {
  responseType: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  state: string | null;
  scope: string;
}

export type AuthorizeValidation =
  | { ok: true; params: AuthorizeParams }
  | { ok: false; error: string; errorDescription: string; httpStatus: number };

export function parseAuthorizeParams(searchParams: URLSearchParams): AuthorizeValidation {
  const responseType = searchParams.get('response_type') ?? '';
  const clientId = searchParams.get('client_id') ?? '';
  const redirectUri = searchParams.get('redirect_uri') ?? '';
  const codeChallenge = searchParams.get('code_challenge') ?? '';
  const codeChallengeMethod = searchParams.get('code_challenge_method') ?? '';
  const state = searchParams.get('state');
  const scope = searchParams.get('scope') ?? 'mcp:read mcp:write';

  if (responseType !== 'code') {
    return {
      ok: false,
      error: 'unsupported_response_type',
      errorDescription: 'Only response_type=code is supported',
      httpStatus: 400,
    };
  }
  if (!clientId) {
    return { ok: false, error: 'invalid_request', errorDescription: 'Missing client_id', httpStatus: 400 };
  }
  if (!redirectUri) {
    return { ok: false, error: 'invalid_request', errorDescription: 'Missing redirect_uri', httpStatus: 400 };
  }
  if (codeChallengeMethod !== 'S256') {
    return {
      ok: false,
      error: 'invalid_request',
      errorDescription: 'code_challenge_method must be S256',
      httpStatus: 400,
    };
  }
  if (!codeChallenge || codeChallenge.length < 43 || codeChallenge.length > 128) {
    return {
      ok: false,
      error: 'invalid_request',
      errorDescription: 'Missing or malformed code_challenge',
      httpStatus: 400,
    };
  }
  return {
    ok: true,
    params: { responseType, clientId, redirectUri, codeChallenge, codeChallengeMethod, state, scope },
  };
}

/** Strict-equal match against a list of registered redirect URIs. */
export function redirectUriIsRegistered(registeredUris: string[], redirectUri: string): boolean {
  return registeredUris.includes(redirectUri);
}

/** Appends `code` (or `error`) + `state` as query params on the redirect_uri. */
export function buildRedirectBack(
  redirectUri: string,
  params: Record<string, string | null>,
): string {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) u.searchParams.set(k, v);
  }
  return u.href;
}
