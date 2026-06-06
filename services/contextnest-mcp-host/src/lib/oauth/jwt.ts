// Sign + verify the OAuth 2.1 access tokens issued by /oauth/token.
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { getKid, getPrivateKey, getPublicKey } from './keys.js';
import { ACCESS_TOKEN_TTL_SECONDS, AUTH_CODE_TTL_SECONDS, OAUTH_ALGORITHM } from './config.js';

export interface AccessTokenClaims extends JWTPayload {
  sub: string; // user id
  client_id: string; // OAuthClient.clientId
  scope: string; // space-separated scopes
}

export interface AccessTokenExtra {
  userToken: string; // GitHub OAuth access token with repo scope
  userLogin: string; // GitHub username
}

export async function signAccessToken(opts: {
  userId: string;
  clientId: string;
  scope: string;
  issuer: string;
  audience: string;
  extra: AccessTokenExtra;
}): Promise<{ token: string; expiresIn: number }> {
  const privateKey = await getPrivateKey();
  const kid = getKid();
  const token = await new SignJWT({
    client_id: opts.clientId,
    scope: opts.scope,
    userToken: opts.extra.userToken,
    userLogin: opts.extra.userLogin,
  })
    .setProtectedHeader({ alg: OAUTH_ALGORITHM, kid, typ: 'at+jwt' })
    .setSubject(opts.userId)
    .setIssuer(opts.issuer)
    .setAudience(opts.audience)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(privateKey);
  return { token, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

export async function verifyAccessToken(
  token: string,
  expectedAudience: string,
): Promise<AccessTokenClaims> {
  const publicKey = await getPublicKey();
  const { payload } = await jwtVerify(token, publicKey, {
    algorithms: [OAUTH_ALGORITHM],
    audience: expectedAudience,
  });
  if (typeof payload.sub !== 'string' || typeof payload.client_id !== 'string') {
    throw new Error('Invalid token payload');
  }
  return payload as AccessTokenClaims;
}

interface AuthCodeClaims {
  sub: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  githubAccessToken: string;
  githubLogin: string;
}

export async function signAuthCode(claims: AuthCodeClaims): Promise<string> {
  const key = await getPrivateKey();
  return new SignJWT({ ...claims, type: 'auth_code' })
    .setProtectedHeader({ alg: OAUTH_ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(`${AUTH_CODE_TTL_SECONDS}s`)
    .sign(key);
}

export async function verifyAuthCode(code: string): Promise<AuthCodeClaims> {
  const key = await getPublicKey();
  const { payload } = await jwtVerify(code, key);
  if (payload['type'] !== 'auth_code') throw new Error('invalid token type');
  return payload as unknown as AuthCodeClaims;
}
