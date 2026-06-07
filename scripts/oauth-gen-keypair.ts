// Generates an RSA keypair for the OAuth 2.1 authorization server.
// Prints PEM-encoded private/public keys + a kid (key id) ready to paste into
// Vercel env. Rotate by re-running and replacing OAUTH_JWT_PRIVATE_KEY/OAUTH_JWT_PUBLIC_KEY/OAUTH_KID.
//
// Usage: pnpm oauth:gen-keypair
import { generateKeyPairSync, randomBytes } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const kid = randomBytes(8).toString('hex');

process.stdout.write(
  [
    '# Add to Vercel env (Production + Preview + Development).',
    '# Values are multi-line PEMs; paste them as-is into Vercel\'s env UI.',
    '',
    'OAUTH_KID=' + kid,
    '',
    'OAUTH_JWT_PRIVATE_KEY="' + privateKey.trim() + '"',
    '',
    'OAUTH_JWT_PUBLIC_KEY="' + publicKey.trim() + '"',
    '',
  ].join('\n'),
);
