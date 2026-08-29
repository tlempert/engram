import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import { DEFAULT_POLICY } from './compile';
import type { Policy } from './compile';

export interface EngramConfig {
  retriever: 'auto' | 'fts5' | 'qmd';
}

export function defaultVaultRoot(): string {
  return process.env['ENGRAM_VAULT'] ?? join(homedir(), 'engram');
}

export function loadConfig(root: string): EngramConfig {
  const file = join(root, '_system/config.yaml');
  const config: EngramConfig = { retriever: 'auto' };
  if (existsSync(file)) {
    try {
      const parsed = parseYaml(readFileSync(file, 'utf8')) as Record<string, unknown> | null;
      const r = parsed?.['retriever'];
      if (r === 'fts5' || r === 'qmd' || r === 'auto') config.retriever = r;
    } catch {
      // malformed config falls back to defaults; doctor reports it
    }
  }
  return config;
}

/** v0: only default.yaml is honored; per-agent policies land in v1. */
export function loadPolicy(root: string, _agent?: string): Policy {
  const file = join(root, '_system/policies/default.yaml');
  const policy: Policy = { typeWeights: { ...DEFAULT_POLICY.typeWeights } };
  if (existsSync(file)) {
    try {
      const parsed = parseYaml(readFileSync(file, 'utf8')) as { typeWeights?: Record<string, number> } | null;
      if (parsed?.typeWeights) Object.assign(policy.typeWeights, parsed.typeWeights);
    } catch {
      // fall back to built-in weights
    }
  }
  return policy;
}
