// /api/book, /api/book/intent, /api/book/config: Uni's booking routes, handed to the chat Worker through the UNI service
// binding (see src/lib/uni-proxy.mjs). The card number never comes here: only Square's one-time card token does.
import { proxyToUni } from '../../../src/lib/uni-proxy.mjs';

export const onRequest = (context) => proxyToUni(context);
