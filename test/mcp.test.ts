import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { McpClient } from './mcp-client';

// Protocol smoke test: drive the stdio MCP server with newline-delimited JSON-RPC.
const CLI = join(import.meta.dir, '../src/cli.ts');
let root: string;
let client: McpClient;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'engram-mcp-'));
  Bun.spawnSync(['bun', CLI, 'init', root], { env: { ...process.env, ENGRAM_VAULT: root } });
  client = new McpClient(root);
});

afterAll(() => {
  client.close();
  rmSync(root, { recursive: true, force: true });
});

describe('MCP stdio server', () => {
  test('initialize handshake', async () => {
    await client.initialize();
  }, 15000);

  test('tools/list exposes the four memory tools', async () => {
    expect(await client.listTools()).toEqual(['memory_expand', 'memory_propose', 'memory_query', 'memory_record']);
  }, 15000);

  test('memory_query returns an abstention bundle on the empty vault', async () => {
    const res = await client.call('memory_query', { task: 'anything about retries at all' });
    expect(res.text).toContain('no memory returned');
  }, 15000);

  test('memory_propose then memory_query keeps the quarantine over MCP too', async () => {
    const propose = await client.call('memory_propose', {
      kind: 'candidate', author: 'forge', title: 'Vaults need daily rebuilds',
      proposedType: 'insight', body: 'A claim only in the inbox.',
    });
    expect(propose.isError).toBe(false);
    expect(propose.text).toContain('pending user review');

    const query = await client.call('memory_query', { task: 'do vaults need daily rebuilds' });
    expect(query.text).toContain('no memory returned');
  }, 15000);
});
