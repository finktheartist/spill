// Dev/preview middleware: the browser posts a Gemini request body here, and the server adds
// the model and the API key, so the key never ships to the browser (or to a phone on the LAN).
import type { Connect } from 'vite';
import { Agent, type Dispatcher } from 'undici';

const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const THINKING_LEVEL = 'high';
const MINIMUM_OUTPUT_TOKENS = 32_768;
const REQUEST_TIMEOUT_MS = 900_000;
const TRANSPORT_TIMEOUT_MS = 960_000;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

class RequestAgent extends Agent {
  override dispatch(options: Parameters<Agent['dispatch']>[0], handler: Parameters<Agent['dispatch']>[1]): boolean {
    // Apply after incoming options so a fetch implementation's shorter
    // per-dispatch defaults cannot supersede this request's transport policy.
    return super.dispatch({ ...options, headersTimeout: TRANSPORT_TIMEOUT_MS, bodyTimeout: TRANSPORT_TIMEOUT_MS }, handler);
  }
}

/** Apply one server policy to both browser generation paths, without changing
 * their contents, schemas, media settings or other request fields. */
function generationBody(raw: unknown): string {
  if (!object(raw) || !Array.isArray(raw.contents) || !raw.contents.length) throw Error('Provide a JSON object with nonempty contents.');
  for (const content of raw.contents) {
    if (!object(content) || !Array.isArray(content.parts) || !content.parts.length ||
      (content.role !== undefined && !['user', 'model'].includes(content.role as string))) throw Error('Each content needs nonempty parts and an optional user/model role.');
    for (const part of content.parts) {
      if (!object(part) || !Object.keys(part).length || (part.text !== undefined && typeof part.text !== 'string')) throw Error('Content parts must be nonempty objects with valid text when present.');
      if (part.inlineData !== undefined && (!object(part.inlineData) || typeof part.inlineData.mimeType !== 'string' || !part.inlineData.mimeType || typeof part.inlineData.data !== 'string')) throw Error('Inline media needs mimeType and data strings.');
    }
  }
  if (raw.generationConfig !== undefined && !object(raw.generationConfig)) throw Error('generationConfig must be an object.');
  const config = { ...(raw.generationConfig as Record<string, unknown> | undefined) };
  if (config.maxOutputTokens !== undefined && (!Number.isSafeInteger(config.maxOutputTokens) || (config.maxOutputTokens as number) <= 0)) throw Error('maxOutputTokens must be a positive safe integer.');
  if (config.thinkingConfig !== undefined && !object(config.thinkingConfig)) throw Error('thinkingConfig must be an object.');
  const thinking = { ...(config.thinkingConfig as Record<string, unknown> | undefined) };
  if (thinking.thinkingLevel !== undefined && !['low', 'medium', 'high'].includes(thinking.thinkingLevel as string)) throw Error('thinkingLevel must be low, medium or high; the server enforces high.');
  if (thinking.thinkingBudget !== undefined && !Number.isSafeInteger(thinking.thinkingBudget)) throw Error('thinkingBudget must be an integer when present.');
  if (config.responseSchema !== undefined && !object(config.responseSchema)) throw Error('responseSchema must be an object.');
  for (const field of ['temperature', 'topP', 'topK']) if (config[field] !== undefined && (typeof config[field] !== 'number' || !Number.isFinite(config[field]))) throw Error(`${field} must be a finite number.`);
  delete thinking.thinkingBudget;
  config.thinkingConfig = { ...thinking, thinkingLevel: THINKING_LEVEL };
  config.maxOutputTokens = Math.max(MINIMUM_OUTPUT_TOKENS, (config.maxOutputTokens as number | undefined) ?? MINIMUM_OUTPUT_TOKENS);
  delete config.temperature;
  delete config.topP;
  delete config.topK;
  return JSON.stringify({ ...raw, generationConfig: config });
}

export function geminiProxy(env: Record<string, string | undefined>): Connect.NextHandleFunction {
  const model = env.BRICK_MODEL;
  if (model !== undefined && !/^gemini-[a-z0-9][a-z0-9._-]*$/.test(model)) {
    throw Error('Invalid BRICK_MODEL configuration: use a Gemini model identifier available to your account.');
  }
  const key = env.GEMINI_API_KEY;
  return async (req, res, next) => {
    if (req.url === '/api/model' && req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ model: model ?? 'not configured', hasKey: !!key, thinkingLevel: THINKING_LEVEL, minimumOutputTokens: MINIMUM_OUTPUT_TOKENS, requestTimeoutMs: REQUEST_TIMEOUT_MS }));
      return;
    }
    if (req.url !== '/api/gemini' || req.method !== 'POST') return next();
    if (!key) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: { message: 'No GEMINI_API_KEY in the environment or .env.local' } }));
      return;
    }
    if (!model) {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: { message: 'Set BRICK_MODEL to a compatible Gemini model available to your account.' } }));
      return;
    }
    let body: string;
    try {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
      if (res.destroyed) return;
      body = generationBody(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    } catch (e) {
      if (res.destroyed) return;
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: { message: `Invalid Gemini request: ${(e as Error).message}` } }));
      return;
    }
    if (res.destroyed) return;
    const stopped = new AbortController();
    // This dispatcher belongs only to this request. Its transport deadlines
    // exceed the finite overall deadline; no global dispatcher is changed.
    const dispatcher = new RequestAgent({ headersTimeout: TRANSPORT_TIMEOUT_MS, bodyTimeout: TRANSPORT_TIMEOUT_MS, connect: { timeout: 10_000 } });
    const onClose = () => { if (!res.writableEnded) stopped.abort(); };
    res.once('close', onClose);
    try {
      const init: RequestInit & { dispatcher: Dispatcher } = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body,
        signal: AbortSignal.any([stopped.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
        dispatcher,
      };
      const upstream = await fetch(`${API}/${model}:generateContent`, init);
      if (res.destroyed) return;
      res.statusCode = upstream.status;
      res.setHeader('Content-Type', 'application/json');
      const retry = upstream.headers.get('retry-after');
      if (retry) res.setHeader('Retry-After', retry);
      res.end(await upstream.text());
    } catch (e) {
      if (res.destroyed) return;
      res.statusCode = 504;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: { message: `Could not reach ${model}: ${(e as Error).message}` } }));
    } finally {
      res.removeListener('close', onClose);
      await dispatcher.destroy();
    }
  };
}
