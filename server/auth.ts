import { OAuth2Client } from 'google-auth-library';

// Resolves a Google ID token to the account's stable subject id. Rejects an invalid token.
export type Verifier = (credential: string) => Promise<string>;

export function googleVerifier(clientId: string): Verifier {
  const client = new OAuth2Client();
  return async (credential) => {
    const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
    const sub = ticket.getPayload()?.sub;
    if (!sub) throw new Error('Google ID token has no subject');
    return sub;
  };
}
