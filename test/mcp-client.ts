import { join } from 'path';

/** Minimal newline-delimited JSON-RPC client for driving `engram serve` in tests. */
export class McpClient {
  private proc: Bun.Subprocess<'pipe', 'pipe', 'inherit'>;
  private reader: { read(): Promise<{ value?: Uint8Array; done: boolean }> };
  private buffer = '';
  private nextId = 1;

  constructor(root: string, ...serveFlags: string[]) {
    this.proc = Bun.spawn(['bun', join(import.meta.dir, '../src/cli.ts'), 'serve', ...serveFlags], {
      env: { ...process.env, ENGRAM_VAULT: root },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'inherit',
    });
    this.reader = this.proc.stdout.getReader();
  }

  async initialize(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' },
    });
    this.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  }

  async listTools(): Promise<string[]> {
    const res = (await this.request('tools/list', {})) as { result: { tools: { name: string }[] } };
    return res.result.tools.map((t) => t.name).sort();
  }

  async call(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
    const res = (await this.request('tools/call', { name, arguments: args })) as {
      result: { content: { text: string }[]; isError?: boolean };
    };
    return { text: res.result.content[0]!.text, isError: res.result.isError === true };
  }

  close(): void {
    this.proc.kill();
  }

  private async request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    this.send({ jsonrpc: '2.0', id, method, params });
    while (true) {
      const msg = await this.readMessage();
      if (msg['id'] === id) return msg;
    }
  }

  private send(msg: Record<string, unknown>): void {
    this.proc.stdin.write(JSON.stringify(msg) + '\n');
    this.proc.stdin.flush();
  }

  private async readMessage(): Promise<Record<string, unknown>> {
    while (true) {
      const nl = this.buffer.indexOf('\n');
      if (nl >= 0) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (line) return JSON.parse(line);
        continue;
      }
      const { value, done } = await this.reader.read();
      if (done) throw new Error('server closed stdout');
      this.buffer += new TextDecoder().decode(value);
    }
  }
}
