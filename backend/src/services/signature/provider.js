import { env } from '../../config/env.js';
import { dtiiSignerProvider } from './dtii-signer.adapter.js';
import { sandboxProvider } from './sandbox.adapter.js';

/**
 * Signature provider selection (SIGNATURE_PROVIDER). Providers implement either
 *   synchronous: signNow(payload) / verifyRecord(record)         (sandbox)
 *   asynchronous: startRequest(...) / poll(providerRef)          (DTII Signer; Aadhaar eSign ESPs can be added here)
 */
const getSignatureProvider = () => (env.SIGNATURE_PROVIDER === 'dtii-signer' ? dtiiSignerProvider : sandboxProvider);

export { getSignatureProvider };
