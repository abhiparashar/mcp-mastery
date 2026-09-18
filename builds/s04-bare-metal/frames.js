'use strict';

/**
 * Minimal raw-frame plumbing shared by the caller and the conformance tests.
 * No MCP SDK: it spawns the server, writes newline-delimited JSON to its stdin,
 * and splits its stdout back into frames.
 *
 * It also enforces the rule the project is about: every byte the server writes
 * to stdout must parse as JSON. Anything else is recorded as a purity
 * violation instead of being quietly tolerated.
 */

const { spawn } = require('node:child_process');
const path = require('node:path');

const SERVER_PATH = path.join(__dirname, 'server.js');
const PROTOCOL_VERSION = '2026-07-28';
const CLIENT_INFO = { name: 's04-caller', version: '0.1.0' };

function startServer({ env = {} } = {}) {
  const child = spawn(process.execPath, [SERVER_PATH], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  });

  const pending = new Map(); // id -> resolve
  const notifications = [];
  const watchers = new Set();
  const violations = [];
  const stderr = [];
  let nextId = 1;
  let buffer = '';

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line === '') continue;

      let message;
      try {
        message = JSON.parse(line);
      } catch {
        violations.push(line);
        continue;
      }
      const isResponse = message.result !== undefined || message.error !== undefined;
      const resolve = isResponse && message.id !== undefined && message.id !== null ? pending.get(String(message.id)) : undefined;
      if (resolve) {
        pending.delete(String(message.id));
        resolve(message);
        continue;
      }
      // Notifications, plus responses that carry no usable id (parse errors and
      // unreadable requests answer with `id: null`). Both are observable here.
      notifications.push(message);
      for (const watcher of watchers) watcher(message);
    }
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => stderr.push(chunk));

  const sendRaw = (text) => child.stdin.write(`${text}\n`);

  /** Build the required per-request `_meta`, overridable for the failure cases. */
  const meta = ({ version = PROTOCOL_VERSION, capabilities = {}, progressToken, omit = [] } = {}) => {
    const built = {
      'io.modelcontextprotocol/protocolVersion': version,
      'io.modelcontextprotocol/clientCapabilities': capabilities,
      'io.modelcontextprotocol/clientInfo': CLIENT_INFO,
    };
    if (progressToken !== undefined) built.progressToken = progressToken;
    for (const key of omit) delete built[key];
    return built;
  };

  /** Sends a request and resolves with the response frame. Ids are never reused. */
  function request(method, params = {}, options = {}) {
    const id = options.id === undefined ? nextId++ : options.id;
    const frame = { jsonrpc: '2.0', id, method, params: { ...params } };
    if (options.noMeta !== true) frame.params._meta = meta(options);
    const response = new Promise((resolve) => pending.set(String(id), resolve));
    sendRaw(JSON.stringify(frame));
    return { id, frame, response };
  }

  function notify(method, params = {}) {
    const frame = { jsonrpc: '2.0', method, params };
    sendRaw(JSON.stringify(frame));
    return frame;
  }

  function onNotification(watcher) {
    watchers.add(watcher);
    return () => watchers.delete(watcher);
  }

  const idle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function close() {
    child.stdin.end();
    await new Promise((resolve) => child.once('exit', resolve));
  }

  return { child, request, notify, onNotification, sendRaw, idle, close, notifications, violations, stderr };
}

module.exports = { startServer, PROTOCOL_VERSION, CLIENT_INFO, SERVER_PATH };
