import { env } from '../../config/env.js';

/**
 * DTII Signer (certificate-based signing; the signer signs with their DSC / USB token in the DTII Signer app).
 * Server-to-server with X-API-Key. Requests are created here and completed asynchronously; the signature-sync job
 * polls pending requests and downloads the signed PDF. Same API as used by the DTII CA Ecosystem.
 */
class SignerError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function call(method, p, { json, form, binary } = {}) {
  let res;
  try {
    res = await fetch(`${env.SIGNER_BASE_URL.replace(/\/+$/, '')}${p}`, {
      method,
      headers: { 'X-API-Key': env.SIGNER_API_KEY, Accept: binary ? 'application/pdf' : 'application/json', ...(json ? { 'Content-Type': 'application/json' } : {}) },
      body: json ? JSON.stringify(json) : form,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new SignerError(0, `Signing service unavailable (${e.name === 'TimeoutError' ? 'timeout' : 'connection failed'})`);
  }
  if (!res.ok) {
    let detail;
    try {
      detail = (await res.json()).detail;
    } catch {
      /* not JSON */
    }
    throw new SignerError(res.status, typeof detail === 'string' ? detail : `Signing service responded ${res.status}`);
  }
  if (binary) return Buffer.from(await res.arrayBuffer());
  return res.status === 204 ? null : res.json();
}

const safeName = (n) => `${String(n).replace(/\.pdf$/i, '').replace(/[^A-Za-z0-9 ._()-]/g, '_').replace(/^[^A-Za-z0-9]+/, '').slice(0, 120) || 'Document'}.pdf`;

/** Uploads the PDF and creates a signing request for the signer's email. @returns {{ providerRef: string }} */
async function startRequest({ pdf, fileName, signerEmail, signerName, requesterEmail, message }) {
  const form = new FormData();
  const name = safeName(fileName);
  form.append('file', new Blob([pdf], { type: 'application/pdf' }), name);
  form.append('file_name', name);
  const doc = await call('POST', '/api/v1/signature/documents', { form });
  const r = await call('POST', '/api/v1/requests', {
    json: { document_id: doc.document_id, signer_email: signerEmail, signer_name: signerName.slice(0, 100), requester_email: requesterEmail, ...(message ? { message: message.slice(0, 1000) } : {}) },
  });
  return { providerRef: String(r.id ?? r.request_id) };
}

/**
 * Polls a request.
 * @returns {Promise<{ status: 'PENDING'|'SIGNED'|'FAILED'|'CANCELLED'|'EXPIRED', signedPdf?: Buffer, cert?: object, error?: string }>}
 */
async function poll(providerRef) {
  const r = await call('GET', `/api/v1/requests/${encodeURIComponent(providerRef)}`);
  const s = String(r.status).toUpperCase();
  if (s === 'SIGNED' && r.signed_document_id) {
    const signedPdf = await call('GET', `/api/v1/signature/signed/${encodeURIComponent(r.signed_document_id)}`, { binary: true });
    return {
      status: 'SIGNED',
      signedPdf,
      cert: { subject: r.certificate?.subject ?? r.signer_name ?? null, issuer: r.certificate?.issuer ?? null, serial: r.certificate?.serial_number ?? null, validFrom: r.certificate?.not_before ?? null, validTo: r.certificate?.not_after ?? null, signedAt: r.signed_at ?? null },
    };
  }
  if (['REJECTED', 'DECLINED'].includes(s)) return { status: 'FAILED', error: r.reject_reason ?? 'Declined by signer' };
  if (s === 'CANCELLED' || s === 'EXPIRED') return { status: s };
  return { status: 'PENDING' };
}

export const dtiiSignerProvider = { name: 'DTII_SIGNER', synchronous: false, legallyValid: true, startRequest, poll, SignerError };
