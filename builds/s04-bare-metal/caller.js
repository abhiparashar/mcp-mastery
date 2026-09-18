#!/usr/bin/env node
'use strict';

/**
 * S04 caller: drives the server through every wire case the project requires,
 * prints the exact frames in both directions, and ends with a summary table of
 * "what was sent" -> "what came back".
 *
 * No MCP SDK anywhere: see frames.js for the whole client, which is a line
 * splitter and a Map of outstanding ids.
 */

const { startServer } = require('./frames');

const rows = [];

function show(label, sent, got) {
  process.stdout.write(`\n=== ${label}\n`);
  process.stdout.write(`--> ${JSON.stringify(sent)}\n`);
  if (got === undefined) process.stdout.write('<-- (no response, by design)\n');
  else process.stdout.write(`<-- ${JSON.stringify(got)}\n`);
}

function record(label, observed) {
  rows.push({ label, observed });
}

function outcome(response) {
  if (response === undefined) return 'no response';
  if (response.error) return `error ${response.error.code}`;
  return `result ${response.result.resultType}`;
}

async function main() {
  const server = startServer();
  const progressSeen = [];
  server.onNotification((frame) => {
    if (frame.method === 'notifications/progress') progressSeen.push(frame.params);
  });

  // 1. server/discover
  {
    const { frame, response } = server.request('server/discover');
    const got = await response;
    show('1. server/discover', frame, got);
    record('server/discover', `${outcome(got)}, ttlMs=${got.result.ttlMs}, cacheScope=${got.result.cacheScope}`);
  }

  // 2. tools/list, twice, to show it is byte-identical
  {
    const first = server.request('tools/list');
    const a = await first.response;
    const b = await server.request('tools/list').response;
    show('2. tools/list', first.frame, a);
    const identical = JSON.stringify(a.result.tools) === JSON.stringify(b.result.tools);
    const bytes = Buffer.byteLength(JSON.stringify(a.result.tools));
    record('tools/list (x2)', `${outcome(a)}, ${a.result.tools.length} tools, deterministic=${identical}, ${bytes} bytes`);
  }

  // 3. tools/call with a progressToken
  {
    const { frame, response } = server.request(
      'tools/call',
      { name: 'text_stats', arguments: { text: 'alpha beta beta\ngamma beta\nalpha delta\nzeta', topWords: 2 } },
      { progressToken: 'stats-1' },
    );
    const got = await response;
    show('3. tools/call text_stats (+progressToken)', frame, got);
    record('tools/call text_stats', `${outcome(got)}, isError=${got.result.isError}, ${progressSeen.length} progress notifications`);
  }

  // 4. missing required _meta -> -32602
  {
    const { frame, response } = server.request('tools/list', {}, { noMeta: true });
    const got = await response;
    show('4. tools/list with no _meta', frame, got);
    record('no _meta', `${outcome(got)}, missing=${JSON.stringify(got.error.data.missing)}`);
  }

  // 4b. _meta present but protocolVersion missing -> -32602
  {
    const { frame, response } = server.request('tools/list', {}, { omit: ['io.modelcontextprotocol/protocolVersion'] });
    const got = await response;
    show('4b. _meta without protocolVersion', frame, got);
    record('_meta without protocolVersion', `${outcome(got)}, missing=${JSON.stringify(got.error.data.missing)}`);
  }

  // 5. unknown method -> -32601
  {
    const { frame, response } = server.request('tools/frobnicate');
    const got = await response;
    show('5. unknown method', frame, got);
    record('unknown method', outcome(got));
  }

  // 6. unsupported protocol version -> -32022 with supportedVersions
  {
    const { frame, response } = server.request('tools/list', {}, { version: '1999-01-01' });
    const got = await response;
    show('6. unsupported protocol version', frame, got);
    record('version 1999-01-01', `${outcome(got)}, supportedVersions=${JSON.stringify(got.error.data.supportedVersions)}`);
  }

  // 7. capability-gated tool without the capability -> -32021
  {
    const { frame, response } = server.request('tools/call', { name: 'purge_cache', arguments: { scope: 'stale' } });
    const got = await response;
    show('7. purge_cache without elicitation capability', frame, got);
    record('purge_cache, caps {}', `${outcome(got)}, requiredCapabilities=${JSON.stringify(got.error.data.requiredCapabilities)}`);
  }

  // 8. MRTR: input_required, then retry with inputResponses + requestState
  let requestState;
  {
    const { frame, response } = server.request(
      'tools/call',
      { name: 'purge_cache', arguments: { scope: 'all' } },
      { capabilities: { elicitation: {} } },
    );
    const got = await response;
    requestState = got.result.requestState;
    show('8. purge_cache with elicitation capability', frame, got);
    record('purge_cache, caps {elicitation}', `${outcome(got)}, inputRequests=${Object.keys(got.result.inputRequests).join(',')}`);

    const retry = server.request(
      'tools/call',
      {
        name: 'purge_cache',
        arguments: { scope: 'all' },
        inputResponses: { confirm_purge: { action: 'accept', content: { confirm: true, reason: 'demo' } } },
        requestState,
      },
      { capabilities: { elicitation: {} } },
    );
    const done = await retry.response;
    show('8b. retry with inputResponses + requestState (new id)', retry.frame, done);
    record('MRTR retry', `${outcome(done)}, purgedEntries=${done.result.structuredContent.purgedEntries}`);
  }

  // 9. tampered requestState -> -32602
  {
    const tampered = `${requestState.slice(0, -4)}AAAA`;
    const { frame, response } = server.request(
      'tools/call',
      {
        name: 'purge_cache',
        arguments: { scope: 'all' },
        inputResponses: { confirm_purge: { action: 'accept', content: { confirm: true } } },
        requestState: tampered,
      },
      { capabilities: { elicitation: {} } },
    );
    const got = await response;
    show('9. tampered requestState', frame, got);
    record('tampered requestState', `${outcome(got)}: ${got.error.message}`);
  }

  // 10. cancellation: start slow work, cancel it, expect silence
  {
    const { id, frame, response } = server.request(
      'tools/call',
      { name: 'text_stats', arguments: { text: 'one\ntwo\nthree\nfour', simulateWorkMs: 120 } },
      { progressToken: 'cancel-me' },
    );
    await server.idle(50);
    const cancel = server.notify('notifications/cancelled', { requestId: id, reason: 'user hit escape' });
    const raced = await Promise.race([response, server.idle(600).then(() => undefined)]);
    show('10. tools/call then notifications/cancelled', [frame, cancel], raced);
    record('cancelled tools/call', raced === undefined ? 'no response (work aborted)' : `LEAK: ${outcome(raced)}`);
  }

  // 11. broken JSON -> -32700
  {
    const response = new Promise((resolve) => {
      const off = server.onNotification((frame) => {
        off();
        resolve(frame);
      });
    });
    server.sendRaw('{not json');
    const got = await Promise.race([response, server.idle(500).then(() => undefined)]);
    show('11. malformed JSON line', '{not json', got);
    record('malformed JSON', got && got.error ? `error ${got.error.code}` : 'no response');
  }

  await server.close();

  process.stdout.write('\n=== Summary\n');
  const width = Math.max(...rows.map((r) => r.label.length));
  for (const row of rows) process.stdout.write(`${row.label.padEnd(width)}  ${row.observed}\n`);

  if (server.violations.length > 0) {
    process.stdout.write(`\nSTDOUT PURITY VIOLATIONS (${server.violations.length}):\n`);
    for (const line of server.violations) process.stdout.write(`  ${line}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('\nstdout purity: every line the server wrote parsed as JSON\n');
  }
  process.stdout.write(`server stderr:\n${server.stderr.join('').replace(/^/gm, '  ')}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});
