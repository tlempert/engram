import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Protocol smoke test: drive the stdio MCP server with newline-delimited JSON-RPC.
const CLI = join(import.meta.dir, '../src/cli.ts');
let root: string;
let proc: ReturnType<typeof Bun.spawn>;
let reader: ReadableStreamDefaultReader<Uint8Array>;
let buffer = '';

async function readMessage(): Promise<Record<string, unknown>> {
  while (true) {
    const nl = buffer.indexOf('\n');
    if (nl >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) return JSON.parse(line);
      continue;
    }
    const { value, done } = await reader.read();
    if (done) throw new Error('server closed stdout');
    buffer += new TextDecoder().decode(value);
  }
}

function send(msg: Record<string, unknown>): void {
  proc.stdin.write(JSON.stringify(msg) + '\n');
  proc.stdin.flush();
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'engram-mcp-'));
  Bun.spawnSync(['bun', CLI, 'init', root], { env: { ...process.env, ENGRAM_VAULT: root } });
  proc = Bun.spawn(['bun', CLI, 'serve'], {
    env: { ...process.env, ENGRAM_VAULT: root },
    stdin: 'pipe',
    stdout: 'pipe',
  });
  reader = proc.stdout.getReader();
});

afterAll(() => {
  proc.kill();
  rmSync(root, { recursive: true, force: true });
});

describe('MCP stdio server', () => {
  test('initialize handshake', async () => {
    send({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
    });
    const res = await readMessage();
    expect((res as { id: number }).id).toBe(1);
    expect((res as { result: { serverInfo: { name: string } } }).result.serverInfo.name).toBe('engram');
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  }, 15000);

  test('tools/list exposes the four memory tools', async () => {
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const res = (await readMessage()) as { result: { tools: { name: string }[] } };
    const names = res.result.tools.map((t) => t.name).sort();
    expect(names).toEqual(['memory_expand', 'memory_propose', 'memory_query', 'memory_record']);
  }, 15000);

  test('memory_query returns an abstention bundle on the empty vault', async () => {
    send({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'memory_query', arguments: { task: 'anything about retries at all' } },
    });
    const res = (await readMessage()) as { result: { content: { text: string }[] } };
    expect(res.result.content[0]!.text).toContain('no memory returned');
  }, 15000);

  test('memory_propose then memory_query keeps the quarantine over MCP too', async () => {
    send({
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: {
        name: 'memory_propose',
        arguments: {
          kind: 'candidate', author: 'forge', title: 'Vaults need daily rebuilds',
          proposedType: 'insight', body: 'A claim only in the inbox.',
        },
      },
    });
    const propose = (await readMessage()) as { result: { content: { text: string }[] } };
    expect(propose.result.content[0]!.text).toContain('pending user review');

    send({
      jsonrpc: '2.0', id: 5, method: 'tools/call',
      params: { name: 'memory_query', arguments: { task: 'do vaults need daily rebuilds' } },
    });
    const query = (await readMessage()) as { result: { content: { text: string }[] } };
    expect(query.result.content[0]!.text).toContain('no memory returned');
  }, 15000);
});
