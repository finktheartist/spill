import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { createServer, request, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { Agent, getGlobalDispatcher, type Dispatcher } from 'undici';
import { geminiProxy } from './gemini-proxy';

const scopedAgents = vi.hoisted(() => ({ created: [] as { options: import('undici').Agent.Options | undefined; agent: import('undici').Agent }[] }));
vi.mock('undici', async importOriginal => {
  const actual = await importOriginal<typeof import('undici')>();
  return { ...actual, Agent: class extends actual.Agent {
    constructor(options?: import('undici').Agent.Options) { super(options); scopedAgents.created.push({ options, agent: this }); }
  } };
});

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  scopedAgents.created.length = 0;
});

const valid = { contents: [{ role: 'user', parts: [{ text: '{"plate-2x4-tan":2,"curve-1x2-red":3}' }] }] };
async function listen(env: Record<string, string | undefined>) {
  const proxy = geminiProxy({ BRICK_MODEL: "gemini-test-model", ...env });
  const server = createServer((req, res) => { void proxy(req, res, () => { res.statusCode = 404; res.end('Not found'); }); });
  servers.push(server);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Expected a local TCP listener');
  return { server, port: address.port };
}
async function wire(payload: string, env: Record<string, string | undefined> = { GEMINI_API_KEY: 'test-only' }, path = '/api/gemini', method = 'POST') {
  const { port } = await listen(env);
  return await new Promise<{ status: number; headers: IncomingMessage['headers']; text: string }>((resolve, reject) => {
    const client = request({ host: '127.0.0.1', port, path, method, headers: { 'Content-Type': 'application/json', Connection: 'close' } }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    client.on('error', reject);
    client.setTimeout(5000, () => client.destroy(Error('Local proxy test timed out')));
    // Actual incoming HTTP chunks, not a pure transformation-function test.
    client.write(payload.slice(0, Math.floor(payload.length / 2)));
    client.end(payload.slice(Math.floor(payload.length / 2)));
  });
}
function upstream() {
  const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response('{"candidates":[]}', { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

it('forwards the native continuation token, higher total ceiling and original signed parts unchanged',async()=>{
  const fetch=upstream();
  const contents=[{role:'user',parts:[{text:'Exact stock and edit contract'}]},{role:'model',parts:[{thought:true,text:'test signed part',thoughtSignature:'test-only-signature'},{text:'{"action":"inspect"}'}]}];
  const result=await wire(JSON.stringify({contents,continuationToken:'opaque-test-only-token',generationConfig:{maxOutputTokens:98304,thinkingConfig:{thinkingLevel:'high'},responseMimeType:'application/json'}}));
  expect(result.status).toBe(200);expect(fetch).toHaveBeenCalledOnce();
  const forwarded=JSON.parse(fetch.mock.calls[0][1].body as string);
  expect(forwarded.contents).toEqual(contents);expect(forwarded.continuationToken).toBe('opaque-test-only-token');expect(forwarded.generationConfig.maxOutputTokens).toBe(98304);expect(forwarded.generationConfig.thinkingConfig.thinkingLevel).toBe('high');
});

it('reports the actual default policy without exposing credentials', async () => {
  const fetch = upstream();
  const result = await wire('', { GEMINI_API_KEY: 'private-test-key' }, '/api/model', 'GET');
  expect(result.status).toBe(200);
  expect(JSON.parse(result.text)).toEqual({ model: 'gemini-test-model', hasKey: true, thinkingLevel: 'high', minimumOutputTokens: 32768, requestTimeoutMs: 900000 });
  expect(result.text).not.toContain('private-test-key');
  expect(fetch).not.toHaveBeenCalled();
  expect(scopedAgents.created).toHaveLength(0);
});

it('keeps generation local when a key exists but no model is configured', async () => {
  const fetch = upstream();
  const result = await wire(JSON.stringify(valid), { GEMINI_API_KEY: 'test-only', BRICK_MODEL: undefined });
  expect(result.status).toBe(503);
  expect(JSON.parse(result.text).error.message).toContain('Set BRICK_MODEL');
  expect(fetch).not.toHaveBeenCalled();
});

it('uses the explicitly configured model without selecting a fallback', async () => {
  const fetch = upstream();
  const result = await wire(JSON.stringify(valid), { GEMINI_API_KEY: 'test-only', BRICK_MODEL: 'gemini-another-test-model' });
  expect(result.status).toBe(200);
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0][0]).toContain('/models/gemini-another-test-model:generateContent');
});

it('passes distinct request-scoped dispatchers with explicit transport/connect deadlines and a finite900s overall signal, without changing the global dispatcher', async () => {
  const fetch = upstream(), originalGlobal = getGlobalDispatcher(), timeout = vi.spyOn(AbortSignal, 'timeout');
  await wire(JSON.stringify(valid)); await wire(JSON.stringify(valid));
  expect(timeout.mock.calls).toEqual([[900000], [900000]]);
  expect(scopedAgents.created).toHaveLength(2);
  const [first, second] = scopedAgents.created;
  expect(first.agent).not.toBe(second.agent);
  for (const [i, created] of scopedAgents.created.entries()) {
    expect(created.options).toEqual({ headersTimeout: 960000, bodyTimeout: 960000, connect: { timeout: 10000 } });
    expect((fetch.mock.calls[i][1] as RequestInit & { dispatcher: Dispatcher }).dispatcher).toBe(created.agent);
    await vi.waitFor(() => expect(created.agent.destroyed).toBe(true));
    expect(fetch.mock.calls[i][1].signal?.aborted).toBe(false);
  }
  expect(getGlobalDispatcher()).toBe(originalGlobal);
});

it('forces both effective per-dispatch timeouts AFTER incoming fetch options rather than relying on constructor options', async () => {
  const dispatch = vi.spyOn(Agent.prototype, 'dispatch').mockImplementation(() => true);
  const fetch = vi.fn(async (_url: string, init: RequestInit & { dispatcher: Dispatcher }) => {
    init.dispatcher.dispatch({ origin: 'http://127.0.0.1:1', path: '/', method: 'POST', headersTimeout: 300000, bodyTimeout: 40000 }, {} as Dispatcher.DispatchHandler);
    return new Response('{"ok":true}');
  });
  vi.stubGlobal('fetch', fetch);
  const result = await wire(JSON.stringify(valid));
  expect(result.status).toBe(200); expect(dispatch).toHaveBeenCalledTimes(1);
  expect(dispatch.mock.calls[0][0]).toMatchObject({ headersTimeout: 960000, bodyTimeout: 960000, path: '/', method: 'POST' });
});

it('uses the real scoped dispatcher for locally delayed headers AND body despite deliberately short incoming dispatch timeouts', async () => {
  const nativeFetch = globalThis.fetch, originalGlobal = getGlobalDispatcher();
  const delayed = createServer((req, res) => {
    req.resume(); let bodyTimer: ReturnType<typeof setTimeout> | undefined;
    const headerTimer = setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.flushHeaders();
      bodyTimer = setTimeout(() => res.end('{"delayed":true}'), 1400);
    }, 1400);
    res.on('close', () => { clearTimeout(headerTimer); clearTimeout(bodyTimer); });
  });
  servers.push(delayed);
  await new Promise<void>(resolve => delayed.listen(0, '127.0.0.1', resolve));
  const address = delayed.address(); if (!address || typeof address === 'string') throw Error('Expected a local port');
  const baseDispatch = vi.spyOn(Agent.prototype, 'dispatch');
  const fetch = vi.fn((_url: string, init: RequestInit & { dispatcher: Dispatcher }) => {
    const incoming: Dispatcher = Object.create(init.dispatcher);
    incoming.dispatch = (options, handler) => init.dispatcher.dispatch({ ...options, headersTimeout: 40, bodyTimeout: 40 }, handler);
    return nativeFetch(`http://127.0.0.1:${address.port}/`, { ...init, dispatcher: incoming } as RequestInit);
  });
  vi.stubGlobal('fetch', fetch);
  const result = await wire(JSON.stringify(valid));
  expect(result.status).toBe(200); expect(result.text).toBe('{"delayed":true}'); expect(fetch).toHaveBeenCalledTimes(1);
  expect(baseDispatch.mock.calls[0][0]).toMatchObject({ headersTimeout: 960000, bodyTimeout: 960000 });
  expect(getGlobalDispatcher()).toBe(originalGlobal);
  await vi.waitFor(() => expect(scopedAgents.created[0].agent.destroyed).toBe(true));
}, 10000);

it('aborts through the finite overall deadline and destroys the scoped dispatcher without fallback', async () => {
  const deadline = new AbortController(); vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
  let began!: () => void; const started = new Promise<void>(resolve => { began = resolve; });
  const fetch = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true }); began();
  }));
  vi.stubGlobal('fetch', fetch);
  const pending = wire(JSON.stringify(valid)); await started;
  deadline.abort(new DOMException('Overall deadline reached', 'TimeoutError'));
  const result = await pending;
  expect(result.status).toBe(504); expect(result.text).toContain('Overall deadline reached'); expect(fetch).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => expect(scopedAgents.created[0].agent.destroyed).toBe(true));
});

it.each(['low', 'medium', 'high'])('enforces high on the actual wire when a caller requests %s and removes the budget and Gemini sampling controls', async thinkingLevel => {
  const fetch = upstream();
  const result = await wire(JSON.stringify({ ...valid, generationConfig: { thinkingConfig: { thinkingLevel, thinkingBudget: 1024, includeThoughts: true }, maxOutputTokens: 8192, temperature: 1, topP: .9, topK: 40 } }));
  expect(result.status).toBe(200); expect(fetch).toHaveBeenCalledTimes(1);
  const [url, init] = fetch.mock.calls[0];
  expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-test-model:generateContent');
  expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'x-goog-api-key': 'test-only' });
  const sent = JSON.parse(init.body as string);
  expect(sent.generationConfig).toEqual({ thinkingConfig: { thinkingLevel: 'high', includeThoughts: true }, maxOutputTokens: 32768 });
  expect(sent.contents).toEqual(valid.contents); expect(init.signal).toBeInstanceOf(AbortSignal);
});

it.each([undefined, 1, 32767, 32768, 65536])('floors a valid %s token cap while preserving larger explicit caps', async cap => {
  const fetch = upstream();
  const result = await wire(JSON.stringify({ ...valid, generationConfig: cap === undefined ? {} : { maxOutputTokens: cap } }));
  expect(result.status).toBe(200);
  expect(JSON.parse(fetch.mock.calls[0][1].body as string).generationConfig.maxOutputTokens).toBe(Math.max(32768, cap ?? 32768));
});

it('preserves stock JSON, history, schema, media and unrelated request/config fields exactly as JSON values', async () => {
  const fetch = upstream();
  const payload = {
    contents: [...valid.contents, { role: 'model', parts: [{ text: '{"ack":true}', thoughtSignature: 'opaque-signature' }] }, { role: 'user', parts: [{ inlineData: { mimeType: 'image/png', data: 'AQID' } }, { text: 'Keep this stock and schema unchanged.' }] }],
    systemInstruction: { parts: [{ text: 'Use only the actual stock.' }] },
    safetySettings: [{ category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: { type: 'OBJECT', required: ['stock'], properties: { stock: { type: 'OBJECT', properties: { 'plate-2x4-tan': { type: 'INTEGER' } } } } }, mediaResolution: 'MEDIA_RESOLUTION_HIGH', candidateCount: 1, thinkingConfig: { thinkingLevel: 'low' } },
  };
  const saved = JSON.stringify(payload), result = await wire(saved);
  expect(result.status).toBe(200);
  expect(JSON.parse(fetch.mock.calls[0][1].body as string)).toEqual({ ...payload, generationConfig: { ...payload.generationConfig, thinkingConfig: { thinkingLevel: 'high' }, maxOutputTokens: 32768 } });
  expect(JSON.stringify(payload)).toBe(saved);
});

it('accepts an explicit matching Gemini setting with the enforced high/token and sampling policy', async () => {
  const fetch = upstream(), env = { GEMINI_API_KEY: 'test-only', BRICK_MODEL: 'gemini-test-model' };
  const result = await wire(JSON.stringify({ ...valid, generationConfig: { temperature: .5, topP: .8, topK: 20, thinkingConfig: { thinkingLevel: 'medium', thinkingBudget: -1 }, maxOutputTokens: 65536 } }), env);
  expect(result.status).toBe(200);
  expect(fetch.mock.calls[0][0]).toContain('/models/gemini-test-model:generateContent');
  expect(JSON.parse(fetch.mock.calls[0][1].body as string).generationConfig).toEqual({ thinkingConfig: { thinkingLevel: 'high' }, maxOutputTokens: 65536 });
  const model = await wire('', env, '/api/model', 'GET');
  expect(JSON.parse(model.text)).toMatchObject({ model: 'gemini-test-model', thinkingLevel: 'high', minimumOutputTokens: 32768 });
});

it.each(['invalid-model', 'https://example.com/model', 'gemini-model/path', '', ' gemini-test-model'])('fails closed at configuration time for conflicting BRICK_MODEL=%j without a fallback call', model => {
  const fetch = upstream();
  expect(() => geminiProxy({ GEMINI_API_KEY: 'test-only', BRICK_MODEL: model })).toThrow(/Invalid BRICK_MODEL configuration/);
  expect(fetch).not.toHaveBeenCalled();
});

it('adds the server policy when generationConfig is omitted', async () => {
  const fetch = upstream(); await wire(JSON.stringify(valid));
  expect(JSON.parse(fetch.mock.calls[0][1].body as string)).toEqual({ ...valid, generationConfig: { thinkingConfig: { thinkingLevel: 'high' }, maxOutputTokens: 32768 } });
});

it.each([
  '{', 'null', '[]', '42', '{}', '{"contents":[]}', '{"contents":"text"}', '{"contents":[null]}',
  '{"contents":[{"parts":[]}]}', '{"contents":[{"parts":[null]}]}', '{"contents":[{"parts":[{}]}]}',
  '{"contents":[{"parts":[{"text":42}]}]}', '{"contents":[{"role":"system","parts":[{"text":"x"}]}]}',
  '{"contents":[{"parts":[{"inlineData":{"mimeType":"image/png","data":12}}]}]}',
  ...[null, [], 'bad'].map(generationConfig => JSON.stringify({ ...valid, generationConfig })),
  ...[null, [], 'bad'].map(thinkingConfig => JSON.stringify({ ...valid, generationConfig: { thinkingConfig } })),
  ...[0, -1, 1.5, '32768', null, Number.MAX_SAFE_INTEGER + 1].map(maxOutputTokens => JSON.stringify({ ...valid, generationConfig: { maxOutputTokens } })),
  JSON.stringify({ ...valid, generationConfig: { thinkingConfig: { thinkingLevel: 'xhigh' } } }),
  JSON.stringify({ ...valid, generationConfig: { thinkingConfig: { thinkingBudget: '1024' } } }),
  JSON.stringify({ ...valid, generationConfig: { responseSchema: [] } }),
  '{"contents":[{"parts":[{"text":"x"}]}],"generationConfig":{"maxOutputTokens":1e400}}',
])('rejects malformed payload/config locally without an upstream call: %s', async body => {
  const fetch = upstream(), result = await wire(body);
  expect(result.status).toBe(400); expect(result.headers['content-type']).toContain('application/json');
  expect(JSON.parse(result.text).error.message).toContain('Invalid Gemini request');
  expect(fetch).not.toHaveBeenCalled();
});

it.each([400, 429, 503])('preserves upstream HTTP%s, response text and retry-after without retrying or falling back', async status => {
  const text = '{"error":{"message":"Actual upstream rejection"}}';
  const fetch = vi.fn(async () => new Response(text, { status, headers: { 'retry-after': '17' } })); vi.stubGlobal('fetch', fetch);
  const result = await wire(JSON.stringify(valid));
  expect(result.status).toBe(status); expect(result.text).toBe(text); expect(result.headers['retry-after']).toBe('17'); expect(fetch).toHaveBeenCalledTimes(1);
});

it('retains network-error504 behavior with the actual model and makes no fallback request', async () => {
  const fetch = vi.fn(async () => { throw Error('mock connection failed'); }); vi.stubGlobal('fetch', fetch);
  const result = await wire(JSON.stringify(valid));
  expect(result.status).toBe(504); expect(JSON.parse(result.text).error.message).toContain('Could not reach gemini-test-model: mock connection failed'); expect(fetch).toHaveBeenCalledTimes(1);
});

it('keeps missing-key behavior local and lets unrelated paths/methods pass through', async () => {
  const fetch = upstream();
  expect((await wire(JSON.stringify(valid), {})).status).toBe(500);
  expect((await wire('', {}, '/api/gemini', 'GET')).status).toBe(404);
  const model = await wire('', {}, '/api/model', 'GET'); expect(JSON.parse(model.text).hasKey).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});

it('cancels a real local client connection upstream without retrying', async () => {
  let signal: AbortSignal | undefined, began!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; });
  const fetch = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    signal = init.signal!; signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true }); began();
  }));
  vi.stubGlobal('fetch', fetch);
  const { port } = await listen({ GEMINI_API_KEY: 'test-only' });
  const client = request({ host: '127.0.0.1', port, path: '/api/gemini', method: 'POST' });
  client.on('error', () => {}); client.end(JSON.stringify(valid));
  await started; client.destroy();
  await vi.waitFor(() => expect(signal?.aborted).toBe(true)); expect(fetch).toHaveBeenCalledTimes(1);
});

it('cancels generation upstream when a stopped candidate closes its connection', async () => {
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(valid))]), { url: '/api/gemini', method: 'POST' });
  const res = Object.assign(new EventEmitter(), { destroyed: false, writableEnded: false, statusCode: 200, setHeader: vi.fn(), end: vi.fn() });
  let signal: AbortSignal | undefined;
  vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => {
    signal = init.signal;
    signal!.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true });
    res.destroyed = true;
    res.emit('close');
  })));
  await geminiProxy({ GEMINI_API_KEY: 'test-only', BRICK_MODEL: 'gemini-test-model' })(req as unknown as IncomingMessage, res as unknown as ServerResponse, () => {});
  expect(signal?.aborted).toBe(true);
  expect(res.end).not.toHaveBeenCalled();
  expect(res.listenerCount('close')).toBe(0);
});
