/**
 * Well-known outbound auth schemes, declarable in a client spec without a
 * callback. Anything bespoke (HMAC request signing, etc.) uses the `sign` hook
 * instead. Shared by the `fetch` and `ws` clients.
 */

export interface AuthSpec {
  bearer?: string;
  basic?:  { user: string; pass: string };
  apiKey?: { header: string; value: string };
}

/** Resolve an `AuthSpec` to the headers it implies. */
export function authHeaders(auth?: AuthSpec): Record<string, string> {
  const headers: Record<string, string> = {};

  if (! auth) return headers;

  if (auth.bearer) headers['Authorization'] = `Bearer ${auth.bearer}`;

  if (auth.basic) {
    const encoded = Buffer.from(`${auth.basic.user}:${auth.basic.pass}`).toString('base64');

    headers['Authorization'] = `Basic ${encoded}`;
  }

  if (auth.apiKey) headers[auth.apiKey.header] = auth.apiKey.value;

  return headers;
}
