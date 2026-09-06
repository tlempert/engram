import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { McpClient } from './mcp-client';

/**
 * Swarm workers get a server that can only read. A process that advertises
 * memory_record and memory_propose to six unattended agents is six writers on
 * one vault; `serve --read-only` removes the tools rather than trusting prompts.
 */
describe('engram serve --read-only', () => {
  let root: string;
  let client: McpClient;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'engram-mcp-ro-'));
    Bun.spawnSync(['bun', join(import.meta.dir, '../src/cli.ts'), 'init', root], {
      env: { ...process.env, ENGRAM_VAULT: root },
    });
    // qmd collections are machine-global; pin the retriever so the test never probes them.
    writeFileSync(join(root, '_system/config.yaml'), 'retriever: fts5\n');
    client = new McpClient(root, '--read-only');
    await client.initialize();
  });

  afterAll(() => {
    client.close();
    rmSync(root, { recursive: true, force: true });
  });

  test('advertises only the read tools', async () => {
    expect(await client.listTools()).toEqual(['memory_expand', 'memory_query']);
  }, 15000);

  test('refuses a write tool as an error, not a success message', async () => {
    const res = await client.call('memory_record', { task: 'anything', author: 'coder' });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('read-only');
    expect(existsSync(join(root, 'evidence/sessions')) && readdirSync(join(root, 'evidence/sessions')).length).toBeFalsy();
  }, 15000);

  test('memory_query leaves no telemetry inside the vault', async () => {
    const res = await client.call('memory_query', { task: 'retry logic for queue jobs' });
    expect(res.text).toContain('no memory returned');
    const bundles = join(root, '_generated/bundles');
    expect(existsSync(bundles) ? readdirSync(bundles) : []).toEqual([]);
  }, 15000);
});
