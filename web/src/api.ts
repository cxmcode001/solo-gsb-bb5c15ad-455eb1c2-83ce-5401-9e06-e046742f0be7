import type {
  AliasEntry,
  AuditReport,
  ExportResult,
  JobState,
  MaskRule,
  Preset,
  PreviewResult,
} from './types';

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const body = await res.json();
      msg = body.error ?? msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  presets: () => req<{ presets: Preset[] }>('/api/presets'),
  getJob: () => req<{ job: JobState | null }>('/api/job'),
  saveJob: (vtt: string, rules: MaskRule[], revertedKeys: string[], aliases: AliasEntry[]) =>
    req<{ job: JobState }>('/api/job', {
      method: 'PUT',
      body: JSON.stringify({ vtt, rules, revertedKeys, aliases }),
    }),
  preview: (
    vtt: string,
    rules: MaskRule[],
    revertedKeys: string[],
    aliases: AliasEntry[],
  ) =>
    req<PreviewResult>('/api/preview', {
      method: 'POST',
      body: JSON.stringify({ vtt, rules, revertedKeys, aliases }),
    }),
  export: (
    vtt: string,
    rules: MaskRule[],
    revertedKeys: string[],
    aliases: AliasEntry[],
  ) =>
    req<ExportResult>('/api/export', {
      method: 'POST',
      body: JSON.stringify({ vtt, rules, revertedKeys, aliases }),
    }),
};

export type { AliasEntry, AuditReport };
