// /api/book: the guest's booking (signed intent + Square's one-time card token, never a card number), handed to Uni's
// chat Worker through the UNI service binding (see src/lib/uni-proxy.mjs). /api/book/* is in functions/api/book/.
import { proxyToUni } from '../../src/lib/uni-proxy.mjs';

export const onRequest = (context) => proxyToUni(context);
