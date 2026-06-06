// Loads the OAuth signing keypair from env and exposes JWKS for clients.
// The script `pnpm oauth:gen-keypair` prints values for OAUTH_PRIVATE_KEY,
// OAUTH_PUBLIC_KEY, and OAUTH_KID; paste those into Vercel env.
import { importPKCS8, importSPKI, exportJWK, type JWK, type KeyObject } from 'jose';
import { OAUTH_ALGORITHM } from './config';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  // Vercel UI sometimes stores multi-line values escaped; normalize \n back to newlines.
  return v.replace(/\\n/g, '\n');
}

let cachedPrivate: KeyObject | undefined;
let cachedPublic: KeyObject | undefined;
let cachedJwks: { keys: JWK[] } | undefined;

export async function getPrivateKey(): Promise<KeyObject> {
  if (cachedPrivate) return cachedPrivate;
  const pem = requireEnv('OAUTH_JWT_PRIVATE_KEY');
  cachedPrivate = (await importPKCS8(pem, OAUTH_ALGORITHM)) as KeyObject;
  return cachedPrivate;
}

export async function getPublicKey(): Promise<KeyObject> {
  if (cachedPublic) return cachedPublic;
  const pem = requireEnv('OAUTH_JWT_PUBLIC_KEY');
  cachedPublic = (await importSPKI(pem, OAUTH_ALGORITHM)) as KeyObject;
  return cachedPublic;
}

export function getKid(): string {
  return requireEnv('OAUTH_KID');
}

export async function getJwks(): Promise<{ keys: JWK[] }> {
  if (cachedJwks) return cachedJwks;
  const publicKey = await getPublicKey();
  const jwk = await exportJWK(publicKey);
  jwk.kid = getKid();
  jwk.alg = OAUTH_ALGORITHM;
  jwk.use = 'sig';
  cachedJwks = { keys: [jwk] };
  return cachedJwks;
}
