import { fail, getSession, json, paymentConfig, problem } from '../lib/platform.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') throw problem(405, 'method_not_allowed');
    const storageReady = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
    const googleReady = Boolean(storageReady && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
    const config = storageReady ? paymentConfig() : null;
    const session = storageReady ? await getSession(req) : null;
    return json(res, 200, { authenticated: Boolean(session), googleReady, billingReady: Boolean(config), mode: config?.mode ?? null, unitPrice: config?.unitPrice ?? null });
  } catch (error) { return fail(res, error); }
}
