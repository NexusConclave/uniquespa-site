// /api/lead — handed to Uni's chat Worker through the UNI service binding (see src/lib/uni-proxy.mjs).
import { proxyToUni } from '../../src/lib/uni-proxy.mjs';

export const onRequest = (context) => proxyToUni(context);
