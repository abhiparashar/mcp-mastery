#!/usr/bin/env node
'use strict';

/**
 * S04 - Bare-Metal JSON-RPC.
 *
 * An MCP server for protocol revision 2026-07-28 over stdio, with zero
 * dependencies (no MCP SDK, no validator, no framework). The point is that
 * every byte on the wire is visible in this file.
 *
 * Invariants:
 *   - stdout carries newline-delimited JSON-RPC frames and nothing else;
 *   - stderr carries all logs;
 *   - no state is inferred from earlier requests on this process (the protocol
 *     is stateless: a stdio process is not a session). The only cross-request
 *     state is the signed `requestState` blob the client echoes back.
 */

const crypto = require('node:crypto');

// ---------------------------------------------------------------------------
// Protocol constants
// ---------------------------------------------------------------------------

const PROTOCOL_VERSION = '2026-07-28';
const SUPPORTED_VERSIONS = [PROTOCOL_VERSION];
const SERVER_INFO = { name: 'io.github.local/s04-bare-metal', version: '0.1.0' };

const NS = 'io.modelcontextprotocol/';
const META_VERSION = NS + 'protocolVersion';
const META_CAPABILITIES = NS + 'clientCapabilities';
const META_CLIENT_INFO = NS + 'clientInfo';
const META_SERVER_INFO = NS + 'serverInfo';

// Standard JSON-RPC codes plus the three codes the MCP spec defines in the
// reserved -32020..-32099 sub-range. Nothing else from that range may be sent.
const CODE = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  headerMismatch: -32020,
  missingRequiredClientCapability: -32021,
  unsupportedProtocolVersion: -32022,
};

// Cache hints. Required on every `resultType: "complete"` result for
// server/discover, tools/list, prompts/list, resources/list,
// resources/templates/list and resources/read.
const DISCOVER_CACHE = { ttlMs: 3_600_000, cacheScope: 'public' };
const TOOLS_LIST_CACHE = { ttlMs: 600_000, cacheScope: 'public' };

// `requestState` is attacker-controlled input. It is HMAC-signed, bound to the
// principal + method + a digest of the arguments, and expires. On stdio the
// principal comes from the environment; over HTTP it would be the token subject.
const STATE_TTL_MS = 5 * 60 * 1000;
const STATE_KEY = process.env.S04_STATE_KEY || null;
const PRINCIPAL = `stdio:${process.env.USER || process.env.LOGNAME || 'local'}`;

// ---------------------------------------------------------------------------
// Tools. Order is fixed and the objects are never mutated, so `tools/list` is
// byte-identical across calls (clients cache it and diff it).
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'text_stats',
    title: 'Text statistics',
    description:
      'Count characters, words and lines in a block of text, and list its most frequent words. ' +
      'Use for quick corpus sizing before deciding whether to summarise.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', minLength: 1, maxLength: 20000, description: 'The text to measure.' },
        topWords: { type: 'integer', minimum: 0, maximum: 10, description: 'How many frequent words to return (default 3).' },
        simulateWorkMs: {
          type: 'integer',
          minimum: 0,
          maximum: 10000,
          description: 'Artificial delay per chunk. Exists only so progress notifications and cancellation are observable.',
        },
      },
      required: ['text'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        characters: { type: 'integer' },
        words: { type: 'integer' },
        lines: { type: 'integer' },
        top: {
          type: 'array',
          items: {
            type: 'object',
            properties: { word: { type: 'string' }, count: { type: 'integer' } },
            required: ['word', 'count'],
            additionalProperties: false,
          },
        },
      },
      required: ['characters', 'words', 'lines', 'top'],
      additionalProperties: false,
    },
  },
  {
    name: 'purge_cache',
    title: 'Purge cached entries',
    description:
      'Delete cached entries. Destructive, so it always asks the user to confirm through elicitation before doing anything.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['stale', 'all'], description: '"stale" drops expired entries, "all" empties the cache.' },
      },
      required: ['scope'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['stale', 'all'] },
        purgedEntries: { type: 'integer' },
        confirmed: { type: 'boolean' },
      },
      required: ['scope', 'purgedEntries', 'confirmed'],
      additionalProperties: false,
    },
  },
];

// Capabilities a tool cannot work without. Declared here, enforced once, in
// one place: a server must never quietly degrade when a capability is missing.
const REQUIRED_CAPABILITIES = { purge_cache: ['elicitation'] };

const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

// ---------------------------------------------------------------------------
// Frame I/O
// ---------------------------------------------------------------------------

function log(...parts) {
  process.stderr.write(`[s04] ${parts.join(' ')}\n`);
}

function writeFrame(message) {
  // JSON.stringify escapes newlines, so one frame is always exactly one line.
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendResult(id, result) {
  writeFrame({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  writeFrame({ jsonrpc: '2.0', id: id === undefined ? null : id, error });
}

function sendNotification(method, params) {
  writeFrame({ jsonrpc: '2.0', method, params });
}

/** Every complete result carries `resultType` and server identity. */
function complete(body) {
  return {
    resultType: 'complete',
    ...body,
    _meta: { [META_SERVER_INFO]: SERVER_INFO },
  };
}

// ---------------------------------------------------------------------------
// Minimal JSON Schema 2020-12 validator, for the subset the tool schemas use.
// Hand-rolled on purpose: knowing which keywords actually guard your tools is
// the difference between "schema present" and "arguments validated".
// ---------------------------------------------------------------------------

function validate(schema, value, path, errors) {
  switch (schema.type) {
    case 'object': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        errors.push(`${path}: expected object`);
        return;
      }
      for (const key of schema.required || []) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${path}.${key}: required`);
      }
      for (const [key, sub] of Object.entries(value)) {
        const subSchema = schema.properties && schema.properties[key];
        if (!subSchema) {
          if (schema.additionalProperties === false) errors.push(`${path}.${key}: unknown property`);
          continue;
        }
        validate(subSchema, sub, `${path}.${key}`, errors);
      }
      return;
    }
    case 'array': {
      if (!Array.isArray(value)) {
        errors.push(`${path}: expected array`);
        return;
      }
      if (schema.items) value.forEach((item, i) => validate(schema.items, item, `${path}[${i}]`, errors));
      return;
    }
    case 'string': {
      if (typeof value !== 'string') {
        errors.push(`${path}: expected string`);
        return;
      }
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        errors.push(`${path}: shorter than minLength ${schema.minLength}`);
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        errors.push(`${path}: longer than maxLength ${schema.maxLength}`);
      }
      if (schema.enum && !schema.enum.includes(value)) {
        errors.push(`${path}: must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`);
      }
      return;
    }
    case 'integer': {
      if (!Number.isInteger(value)) {
        errors.push(`${path}: expected integer`);
        return;
      }
      if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: below minimum ${schema.minimum}`);
      if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: above maximum ${schema.maximum}`);
      return;
    }
    case 'boolean': {
      if (typeof value !== 'boolean') errors.push(`${path}: expected boolean`);
      return;
    }
    default:
      return;
  }
}

function schemaErrors(schema, value) {
  const errors = [];
  validate(schema, value, '$', errors);
  return errors;
}

// ---------------------------------------------------------------------------
// requestState: signed, principal-bound, expiring, request-bound
// ---------------------------------------------------------------------------

function stateKey() {
  if (STATE_KEY) return STATE_KEY;
  // A real deployment must share a key across replicas, or a retry that lands
  // on another replica fails verification. Loud about it rather than silent.
  log('warning: S04_STATE_KEY unset, using a development key; do not ship this');
  return 'development-key-do-not-ship';
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function argumentsDigest(method, name, args) {
  return crypto.createHash('sha256').update(JSON.stringify([method, name, canonical(args)])).digest('base64url');
}

/** Stable key order, so the digest does not depend on JSON member order. */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .map((k) => [k, canonical(value[k])]);
  }
  return value === undefined ? null : value;
}

function signState(payload) {
  const body = b64url(JSON.stringify(payload));
  const mac = b64url(crypto.createHmac('sha256', stateKey()).update(body).digest());
  return `${body}.${mac}`;
}

/** Returns the payload, or throws an Error whose message is client-safe. */
function verifyState(blob, expectedDigest) {
  if (typeof blob !== 'string' || !blob.includes('.')) throw new Error('requestState is malformed');
  const [body, mac] = blob.split('.', 2);
  const expected = b64url(crypto.createHmac('sha256', stateKey()).update(body).digest());
  const got = Buffer.from(mac);
  const want = Buffer.from(expected);
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) throw new Error('requestState failed integrity check');

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw new Error('requestState is malformed');
  }
  if (payload.principal !== PRINCIPAL) throw new Error('requestState belongs to a different principal');
  if (typeof payload.exp !== 'number' || payload.exp < Date.now()) throw new Error('requestState has expired');
  if (payload.digest !== expectedDigest) throw new Error('requestState was issued for a different request');
  return payload;
}

// ---------------------------------------------------------------------------
// Progress and cancellation
// ---------------------------------------------------------------------------

/** id -> { cancelled } for requests currently being processed. */
const inflight = new Map();

class Cancelled extends Error {}

function progressReporter(token, requestId) {
  let last = 0;
  return (progress, total, message) => {
    if (token === undefined) return; // No token: the client did not opt in.
    if (progress <= last) return; // `progress` MUST increase monotonically.
    last = progress;
    if (!inflight.has(String(requestId))) return; // Progress MUST stop at completion.
    sendNotification('notifications/progress', { progressToken: token, progress, total, message });
  };
}

function checkCancelled(requestId) {
  const entry = inflight.get(String(requestId));
  if (entry && entry.cancelled) throw new Cancelled('cancelled by client');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function runTextStats(args, ctx) {
  const topWords = args.topWords ?? 3;
  const delay = args.simulateWorkMs ?? 0;
  const lines = args.text.split('\n');
  const chunkCount = Math.min(4, lines.length);
  const counts = new Map();
  let words = 0;

  for (let chunk = 0; chunk < chunkCount; chunk += 1) {
    checkCancelled(ctx.requestId);
    if (delay > 0) await sleep(delay);
    checkCancelled(ctx.requestId);

    const from = Math.floor((chunk * lines.length) / chunkCount);
    const to = Math.floor(((chunk + 1) * lines.length) / chunkCount);
    for (const line of lines.slice(from, to)) {
      for (const raw of line.split(/\s+/)) {
        const word = raw.replace(/[^\p{L}\p{N}'-]/gu, '').toLowerCase();
        if (!word) continue;
        words += 1;
        counts.set(word, (counts.get(word) || 0) + 1);
      }
    }
    ctx.progress(chunk + 1, chunkCount, `counted lines ${from + 1}-${to} of ${lines.length}`);
  }

  if (words === 0) {
    // Business failure, not a protocol failure: the request was well-formed.
    return { content: [{ type: 'text', text: 'No words found: the text contains no word characters.' }], isError: true };
  }

  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topWords)
    .map(([word, count]) => ({ word, count }));

  const structuredContent = { characters: args.text.length, words, lines: lines.length, top };
  return {
    // Mirror the structured payload as text for clients that predate outputSchema.
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
    isError: false,
  };
}

const PURGE_COUNTS = { stale: 3, all: 7 };

async function runPurgeCache(args, ctx) {
  const digest = argumentsDigest('tools/call', 'purge_cache', args);
  const answer = ctx.inputResponses && ctx.inputResponses.confirm_purge;

  if (!answer) {
    // First round trip: ask the user, hand back state that proves what we asked.
    return {
      resultType: 'input_required',
      inputRequests: {
        confirm_purge: {
          method: 'elicitation/create',
          params: {
            mode: 'form',
            message: `Purge ${args.scope === 'all' ? 'the entire cache' : 'stale cache entries'}? This cannot be undone.`,
            requestedSchema: {
              type: 'object',
              properties: {
                confirm: { type: 'boolean', description: 'Confirm the purge.' },
                reason: { type: 'string', description: 'Optional audit note.' },
              },
              required: ['confirm'],
            },
          },
        },
      },
      requestState: signState({ v: 1, principal: PRINCIPAL, digest, exp: Date.now() + STATE_TTL_MS }),
      _meta: { [META_SERVER_INFO]: SERVER_INFO },
    };
  }

  // Retry round trip. State must be present, intact, ours, fresh and for
  // exactly this request. Any failure is a protocol error, not a tool error.
  verifyState(ctx.requestState, digest);

  if (answer.action !== 'accept' || answer.content == null || answer.content.confirm !== true) {
    return { content: [{ type: 'text', text: 'Purge declined by the user; nothing was deleted.' }], isError: false };
  }

  const structuredContent = { scope: args.scope, purgedEntries: PURGE_COUNTS[args.scope], confirmed: true };
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
    isError: false,
  };
}

const IMPLEMENTATIONS = { text_stats: runTextStats, purge_cache: runPurgeCache };

// ---------------------------------------------------------------------------
// Method handlers
// ---------------------------------------------------------------------------

function handleDiscover() {
  return complete({
    supportedVersions: SUPPORTED_VERSIONS,
    capabilities: { tools: {} },
    instructions:
      'Call text_stats before summarising large text so you know its size. purge_cache is destructive and will ask the user to confirm; only call it when the user asked for a purge.',
    ...DISCOVER_CACHE,
  });
}

function handleToolsList(params) {
  if (params.cursor !== undefined && params.cursor !== null) {
    // One page only; an unknown cursor is an invalid parameter, not an empty page.
    throw new RpcError(CODE.invalidParams, 'Unknown cursor', { cursor: params.cursor });
  }
  return complete({ tools: TOOLS, ...TOOLS_LIST_CACHE });
}

async function handleToolsCall(params, meta, requestId) {
  const name = params.name;
  if (typeof name !== 'string') throw new RpcError(CODE.invalidParams, 'params.name must be a string');

  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) throw new RpcError(CODE.invalidParams, `Unknown tool: ${name}`, { available: TOOLS.map((t) => t.name) });

  const needed = (REQUIRED_CAPABILITIES[name] || []).filter((cap) => !(cap in meta.capabilities));
  if (needed.length > 0) {
    throw new RpcError(
      CODE.missingRequiredClientCapability,
      `Tool ${name} requires client capabilities this request did not declare: ${needed.join(', ')}`,
      { requiredCapabilities: needed },
    );
  }

  const args = params.arguments === undefined ? {} : params.arguments;
  const errors = schemaErrors(tool.inputSchema, args);
  if (errors.length > 0) throw new RpcError(CODE.invalidParams, `Invalid arguments for ${name}`, { errors });

  if (params.requestState !== undefined && typeof params.requestState !== 'string') {
    throw new RpcError(CODE.invalidParams, 'params.requestState must be a string');
  }
  if (params.inputResponses !== undefined && (params.inputResponses === null || typeof params.inputResponses !== 'object')) {
    throw new RpcError(CODE.invalidParams, 'params.inputResponses must be an object');
  }

  const ctx = {
    requestId,
    progress: progressReporter(meta.progressToken, requestId),
    inputResponses: params.inputResponses,
    requestState: params.requestState,
  };

  let outcome;
  try {
    outcome = await IMPLEMENTATIONS[name](args, ctx);
  } catch (err) {
    if (err instanceof Cancelled || err instanceof RpcError) throw err;
    throw new RpcError(CODE.invalidParams, err.message);
  }

  if (outcome.resultType === 'input_required') return outcome; // MRTR: never cacheable.

  if (tool.outputSchema && outcome.structuredContent !== undefined) {
    const outErrors = schemaErrors(tool.outputSchema, outcome.structuredContent);
    if (outErrors.length > 0) throw new RpcError(CODE.internalError, `${name} produced output violating its outputSchema`, { errors: outErrors });
  }
  return complete(outcome);
}

class RpcError extends Error {
  constructor(code, message, data) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

// ---------------------------------------------------------------------------
// Envelope validation and dispatch
// ---------------------------------------------------------------------------

function readMeta(params) {
  const meta = params._meta;
  if (meta === null || typeof meta !== 'object') {
    throw new RpcError(CODE.invalidParams, `Missing params._meta; ${META_VERSION} and ${META_CAPABILITIES} are required on every request`, {
      missing: [META_VERSION, META_CAPABILITIES],
    });
  }
  const missing = [];
  if (typeof meta[META_VERSION] !== 'string') missing.push(META_VERSION);
  if (meta[META_CAPABILITIES] === null || typeof meta[META_CAPABILITIES] !== 'object') missing.push(META_CAPABILITIES);
  if (missing.length > 0) {
    throw new RpcError(CODE.invalidParams, `Missing or malformed required _meta fields: ${missing.join(', ')}`, { missing });
  }

  const version = meta[META_VERSION];
  if (!SUPPORTED_VERSIONS.includes(version)) {
    throw new RpcError(CODE.unsupportedProtocolVersion, `Unsupported protocol version: ${version}`, {
      supportedVersions: SUPPORTED_VERSIONS,
      requestedVersion: version,
    });
  }

  const progressToken = meta.progressToken;
  if (progressToken !== undefined && typeof progressToken !== 'string' && typeof progressToken !== 'number') {
    throw new RpcError(CODE.invalidParams, '_meta.progressToken must be a string or integer');
  }

  return { version, capabilities: meta[META_CAPABILITIES], clientInfo: meta[META_CLIENT_INFO], progressToken };
}

async function dispatch(method, params, meta, requestId) {
  switch (method) {
    case 'server/discover':
      return handleDiscover();
    case 'tools/list':
      return handleToolsList(params);
    case 'tools/call':
      return handleToolsCall(params, meta, requestId);
    default:
      throw new RpcError(CODE.methodNotFound, `Unknown method: ${method}`);
  }
}

function handleNotification(method, params) {
  if (method !== 'notifications/cancelled') {
    log(`ignoring unknown notification ${method}`);
    return;
  }
  const id = params && params.requestId;
  const entry = id === undefined ? undefined : inflight.get(String(id));
  if (!entry) {
    // Unknown or already-finished request: ignore, per the cancellation rules.
    log(`cancellation for unknown//finished request ${JSON.stringify(id)} ignored`);
    return;
  }
  entry.cancelled = true;
  log(`cancelling request ${JSON.stringify(id)}: ${(params && params.reason) || 'no reason given'}`);
}

async function handleFrame(message) {
  if (message === null || typeof message !== 'object' || Array.isArray(message)) {
    sendError(null, CODE.invalidRequest, 'Request must be a JSON object');
    return;
  }
  if (message.jsonrpc !== '2.0') {
    sendError(typeof message.id === 'string' || typeof message.id === 'number' ? message.id : null, CODE.invalidRequest, 'jsonrpc must be "2.0"');
    return;
  }
  if (typeof message.method !== 'string') {
    sendError(typeof message.id === 'string' || typeof message.id === 'number' ? message.id : null, CODE.invalidRequest, 'method must be a string');
    return;
  }
  if (message.id === null) {
    sendError(null, CODE.invalidRequest, 'Request id MUST NOT be null');
    return;
  }

  const params = message.params === undefined ? {} : message.params;
  if (params === null || typeof params !== 'object' || Array.isArray(params)) {
    sendError(message.id === undefined ? null : message.id, CODE.invalidRequest, 'params must be an object');
    return;
  }

  if (message.id === undefined) {
    handleNotification(message.method, params);
    return; // Notifications never get a response.
  }
  if (typeof message.id !== 'string' && typeof message.id !== 'number') {
    sendError(null, CODE.invalidRequest, 'Request id must be a string or integer');
    return;
  }

  const key = String(message.id);
  inflight.set(key, { cancelled: false });
  try {
    const meta = readMeta(params);
    const result = await dispatch(message.method, params, meta, message.id);
    if (inflight.get(key).cancelled) {
      log(`request ${key} finished after cancellation; dropping response`);
      return;
    }
    sendResult(message.id, result);
  } catch (err) {
    if (err instanceof Cancelled) {
      log(`request ${key} aborted; no response sent`);
      return;
    }
    if (err instanceof RpcError) {
      sendError(message.id, err.code, err.message, err.data);
      return;
    }
    log(`internal error on ${key}: ${err && err.stack ? err.stack : err}`);
    sendError(message.id, CODE.internalError, 'Internal error');
  } finally {
    inflight.delete(key);
  }
}

// ---------------------------------------------------------------------------
// stdio transport: newline-delimited JSON in, newline-delimited JSON out
// ---------------------------------------------------------------------------

function main() {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.trim() === '') continue;

      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        sendError(null, CODE.parseError, 'Parse error: line is not valid JSON');
        continue;
      }
      // Frames are handled concurrently: a slow tools/call must not block the
      // cancellation notification that follows it.
      handleFrame(parsed).catch((err) => log(`unhandled: ${err && err.stack ? err.stack : err}`));
    }
  });
  process.stdin.on('end', () => {
    log('stdin closed, exiting');
    process.exit(0);
  });
  log(`ready: ${SERVER_INFO.name} ${SERVER_INFO.version}, protocol ${SUPPORTED_VERSIONS.join(', ')}`);
}

if (require.main === module) main();

module.exports = { TOOLS, SUPPORTED_VERSIONS, SERVER_INFO, CODE };
