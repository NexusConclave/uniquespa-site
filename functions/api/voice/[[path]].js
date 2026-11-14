// /api/voice/availability, /api/voice/prepare_booking: ElevenLabs server tools for the Uni voice agent, handed to the
// chat Worker through the UNI service binding. The Worker checks the X-Uni-Voice-Secret header (VOICE_TOOL_SECRET).
import { proxyToUni } from '../../../src/lib/uni-proxy.mjs';

export const onRequest = (context) => proxyToUni(context);
