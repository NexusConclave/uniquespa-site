/** /llms.txt: a plain-text brief for AI assistants (GEO). Body built in lib/llms.ts from the site's own data. */
import type { APIRoute } from 'astro';
import { llmsText } from '../lib/llms';

export const GET: APIRoute = () =>
  new Response(llmsText(), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
