'use strict';

/**
 * Conformance probes for the S04 server. Each test asserts one wire rule from
 * the 2026-07-28 spec, so a regression names the rule it broke.
 *
 * Run: node --test builds/s04-bare-metal/
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./frames');

/** Runs `body` against a fresh server, then asserts stdout purity. */
async function withServer(body, options) {
  const server = startServer(options);
  try {
    await body(server);
  } finally {
    assert.deepEqual(server.violations, [], 'server wrote non-JSON to stdout');
    await server.close();
  }
}

test('server/discover advertises versions, capabilities, serverInfo and cache hints', async () => {
  await withServer(async (server) => {
    const { result } = await server.request('server/discover').response;
    assert.equal(result.resultType, 'complete');
    assert.deepEqual(result.supportedVersions, ['2026-07-28']);
    assert.deepEqual(result.capabilities, { tools: {} });
    assert.ok(result._meta['io.modelcontextprotocol/serverInfo'].name);
    assert.equal(typeof result.instructions, 'string');
    assert.equal(result.ttlMs, 3_600_000);
    assert.equal(result.cacheScope, 'public');
  });
});

test('tools/list is byte-identical across calls and carries cache hints', async () => {
  await withServer(async (server) => {
    const first = await server.request('tools/list').response;
    const second = await server.request('tools/list').response;
    assert.equal(JSON.stringify(first.result.tools), JSON.stringify(second.result.tools));
    assert.deepEqual(
      first.result.tools.map((t) => t.name),
      ['text_stats', 'purge_cache'],
    );
    assert.equal(first.result.cacheScope, 'public');
    assert.equal(typeof first.result.ttlMs, 'number');
    for (const tool of first.result.tools) {
      assert.equal(tool.inputSchema.type, 'object', `${tool.name} inputSchema must be an object schema`);
    }
  });
});

test('tools/call returns structuredContent mirrored as text, and validates it against outputSchema', async () => {
  await withServer(async (server) => {
    const { result } = await server.request('tools/call', {
      name: 'text_stats',
      arguments: { text: 'alpha beta beta\ngamma beta', topWords: 2 },
    }).response;
    assert.equal(result.resultType, 'complete');
    assert.equal(result.isError, false);
    assert.deepEqual(result.structuredContent, {
      characters: 26,
      words: 5,
      lines: 2,
      top: [
        { word: 'beta', count: 3 },
        { word: 'alpha', count: 1 },
      ],
    });
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  });
});

test('a business failure is isError: true, not a JSON-RPC error', async () => {
  await withServer(async (server) => {
    const response = await server.request('tools/call', { name: 'text_stats', arguments: { text: '!!! ???' } }).response;
    assert.equal(response.error, undefined);
    assert.equal(response.result.resultType, 'complete');
    assert.equal(response.result.isError, true);
  });
});

test('missing _meta is -32602 and names the missing keys', async () => {
  await withServer(async (server) => {
    const { error } = await server.request('tools/list', {}, { noMeta: true }).response;
    assert.equal(error.code, -32602);
    assert.deepEqual(error.data.missing, [
      'io.modelcontextprotocol/protocolVersion',
      'io.modelcontextprotocol/clientCapabilities',
    ]);
  });
});

test('each individually missing required _meta key is -32602', async () => {
  await withServer(async (server) => {
    for (const key of ['io.modelcontextprotocol/protocolVersion', 'io.modelcontextprotocol/clientCapabilities']) {
      const { error } = await server.request('tools/list', {}, { omit: [key] }).response;
      assert.equal(error.code, -32602, `omitting ${key}`);
      assert.deepEqual(error.data.missing, [key]);
    }
  });
});

test('clientInfo is only SHOULD: omitting it still succeeds', async () => {
  await withServer(async (server) => {
    const { result } = await server.request('tools/list', {}, { omit: ['io.modelcontextprotocol/clientInfo'] }).response;
    assert.equal(result.resultType, 'complete');
  });
});

test('unknown method is -32601', async () => {
  await withServer(async (server) => {
    const { error } = await server.request('tools/frobnicate').response;
    assert.equal(error.code, -32601);
  });
});

test('unsupported protocol version is -32022 and lists supported versions', async () => {
  await withServer(async (server) => {
    const { error } = await server.request('tools/list', {}, { version: '1999-01-01' }).response;
    assert.equal(error.code, -32022);
    assert.deepEqual(error.data.supportedVersions, ['2026-07-28']);
  });
});

test('a tool needing an undeclared capability is -32021 with requiredCapabilities', async () => {
  await withServer(async (server) => {
    const { error } = await server.request('tools/call', { name: 'purge_cache', arguments: { scope: 'stale' } }).response;
    assert.equal(error.code, -32021);
    assert.deepEqual(error.data.requiredCapabilities, ['elicitation']);
  });
});

test('unknown tool and invalid arguments are -32602', async () => {
  await withServer(async (server) => {
    const unknown = await server.request('tools/call', { name: 'nope', arguments: {} }).response;
    assert.equal(unknown.error.code, -32602);

    const badType = await server.request('tools/call', { name: 'text_stats', arguments: { text: 7 } }).response;
    assert.equal(badType.error.code, -32602);

    const extra = await server.request('tools/call', { name: 'text_stats', arguments: { text: 'hi', nope: 1 } }).response;
    assert.equal(extra.error.code, -32602);

    const outOfRange = await server.request('tools/call', { name: 'text_stats', arguments: { text: 'hi', topWords: 99 } }).response;
    assert.equal(outOfRange.error.code, -32602);

    const badEnum = await server.request(
      'tools/call',
      { name: 'purge_cache', arguments: { scope: 'everything' } },
      { capabilities: { elicitation: {} } },
    ).response;
    assert.equal(badEnum.error.code, -32602);
  });
});

test('malformed frames are -32600, and broken JSON is -32700', async () => {
  await withServer(async (server) => {
    const received = [];
    server.onNotification((frame) => received.push(frame));

    server.sendRaw('{"jsonrpc":"1.0","id":1,"method":"tools/list"}');
    server.sendRaw('{"jsonrpc":"2.0","id":null,"method":"tools/list"}');
    server.sendRaw('{"jsonrpc":"2.0","id":2}');
    server.sendRaw('{not json');
    server.sendRaw('[1,2,3]');
    await server.idle(200);

    const codes = received.map((frame) => frame.error.code);
    assert.deepEqual(codes, [-32600, -32600, -32600, -32700, -32600]);
    // A wrong-version frame with a readable id must still echo that id back.
    assert.equal(received[0].id, 1);

    // One bad line must not desynchronise the stream.
    const after = await server.request('tools/list').response;
    assert.equal(after.result.resultType, 'complete');
  });
});

test('MRTR: input_required, then a signed requestState completes the call', async () => {
  await withServer(async (server) => {
    const caps = { capabilities: { elicitation: {} } };
    const first = await server.request('tools/call', { name: 'purge_cache', arguments: { scope: 'all' } }, caps).response;
    assert.equal(first.result.resultType, 'input_required');
    assert.equal(first.result.inputRequests.confirm_purge.method, 'elicitation/create');
    assert.equal(typeof first.result.requestState, 'string');
    assert.equal(first.result.ttlMs, undefined, 'input_required results are never cacheable');

    const retry = await server.request(
      'tools/call',
      {
        name: 'purge_cache',
        arguments: { scope: 'all' },
        inputResponses: { confirm_purge: { action: 'accept', content: { confirm: true } } },
        requestState: first.result.requestState,
      },
      caps,
    ).response;
    assert.notEqual(retry.id, first.id, 'the retry MUST use a new JSON-RPC id');
    assert.equal(retry.result.resultType, 'complete');
    assert.deepEqual(retry.result.structuredContent, { scope: 'all', purgedEntries: 7, confirmed: true });
  });
});

test('declining the elicitation completes without deleting anything', async () => {
  await withServer(async (server) => {
    const caps = { capabilities: { elicitation: {} } };
    const first = await server.request('tools/call', { name: 'purge_cache', arguments: { scope: 'stale' } }, caps).response;
    const retry = await server.request(
      'tools/call',
      {
        name: 'purge_cache',
        arguments: { scope: 'stale' },
        inputResponses: { confirm_purge: { action: 'decline' } },
        requestState: first.result.requestState,
      },
      caps,
    ).response;
    assert.equal(retry.result.resultType, 'complete');
    assert.equal(retry.result.isError, false);
    assert.equal(retry.result.structuredContent, undefined);
    assert.match(retry.result.content[0].text, /declined/);
  });
});

test('requestState is rejected when tampered, forged, or replayed on another request', async () => {
  await withServer(async (server) => {
    const caps = { capabilities: { elicitation: {} } };
    const issued = await server.request('tools/call', { name: 'purge_cache', arguments: { scope: 'stale' } }, caps).response;
    const state = issued.result.requestState;
    const accept = { confirm_purge: { action: 'accept', content: { confirm: true } } };

    const tampered = await server.request(
      'tools/call',
      { name: 'purge_cache', arguments: { scope: 'stale' }, inputResponses: accept, requestState: `${state.slice(0, -4)}AAAA` },
      caps,
    ).response;
    assert.equal(tampered.error.code, -32602);
    assert.match(tampered.error.message, /integrity/);

    // Same state, different arguments: bound to a digest of method + arguments.
    const crossRequest = await server.request(
      'tools/call',
      { name: 'purge_cache', arguments: { scope: 'all' }, inputResponses: accept, requestState: state },
      caps,
    ).response;
    assert.equal(crossRequest.error.code, -32602);
    assert.match(crossRequest.error.message, /different request/);

    const garbage = await server.request(
      'tools/call',
      { name: 'purge_cache', arguments: { scope: 'stale' }, inputResponses: accept, requestState: 'not-a-state' },
      caps,
    ).response;
    assert.equal(garbage.error.code, -32602);
  });
});

test('requestState signed with another key is rejected (keys are per deployment)', async () => {
  let state;
  await withServer(async (server) => {
    const first = await server.request(
      'tools/call',
      { name: 'purge_cache', arguments: { scope: 'stale' } },
      { capabilities: { elicitation: {} } },
    ).response;
    state = first.result.requestState;
  }, { env: { S04_STATE_KEY: 'key-one' } });

  await withServer(async (server) => {
    const { error } = await server.request(
      'tools/call',
      {
        name: 'purge_cache',
        arguments: { scope: 'stale' },
        inputResponses: { confirm_purge: { action: 'accept', content: { confirm: true } } },
        requestState: state,
      },
      { capabilities: { elicitation: {} } },
    ).response;
    assert.equal(error.code, -32602);
    assert.match(error.message, /integrity/);
  }, { env: { S04_STATE_KEY: 'key-two' } });
});

test('progress notifications flow only with a progressToken, and increase', async () => {
  await withServer(async (server) => {
    const args = { name: 'text_stats', arguments: { text: 'a\nb\nc\nd' } };

    const silent = server.request('tools/call', args);
    await silent.response;
    assert.deepEqual(server.notifications, [], 'no token means no progress notifications');

    const withToken = server.request('tools/call', args, { progressToken: 'tok-1' });
    await withToken.response;
    const progress = server.notifications.filter((f) => f.method === 'notifications/progress');
    assert.equal(progress.length, 4);
    assert.ok(progress.every((f) => f.params.progressToken === 'tok-1'));
    assert.deepEqual(
      progress.map((f) => f.params.progress),
      [1, 2, 3, 4],
    );
    assert.ok(progress.every((f) => f.params.total === 4 && typeof f.params.message === 'string'));
  });
});

test('notifications/cancelled aborts the work and sends no response', async () => {
  await withServer(async (server) => {
    const call = server.request(
      'tools/call',
      { name: 'text_stats', arguments: { text: 'a\nb\nc\nd', simulateWorkMs: 150 } },
      { progressToken: 'cancel-1' },
    );
    await server.idle(60);
    server.notify('notifications/cancelled', { requestId: call.id, reason: 'test' });

    const raced = await Promise.race([call.response, server.idle(800).then(() => 'silence')]);
    assert.equal(raced, 'silence', 'a cancelled request MUST NOT be answered');

    const progress = server.notifications.filter((f) => f.method === 'notifications/progress');
    assert.ok(progress.length < 4, `work continued to completion: ${progress.length} progress notifications`);

    // The transport is still usable for unrelated requests.
    const after = await server.request('tools/list').response;
    assert.equal(after.result.resultType, 'complete');
  });
});

test('cancelling an unknown request is ignored, not answered', async () => {
  await withServer(async (server) => {
    server.notify('notifications/cancelled', { requestId: 'never-issued' });
    server.notify('notifications/unknown', {});
    await server.idle(150);
    assert.deepEqual(server.notifications, []);
    const alive = await server.request('server/discover').response;
    assert.equal(alive.result.resultType, 'complete');
  });
});
