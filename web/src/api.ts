import type {
  AliasEntry,
  AuditReport,
  EntityDecision,
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

/** 预览 / 导出 / 保存共用的任务载荷，保证三处最终状态一致 */
interface JobPayload {
  vtt: string;
  rules: MaskRule[];
  revertedKeys: string[];
  appliedKeys: string[];
  entityDecisions: EntityDecision[];
  aliases: AliasEntry[];
}

export const api = {
  presets: () => req<{ presets: Preset[] }>('/api/presets'),
  getJob: () => req<{ job: JobState | null }>('/api/job'),
  saveJob: (p: JobPayload) =>
    req<{ job: JobState }>('/api/job', {
      method: 'PUT',
      body: JSON.stringify(p),
    }),
  preview: (p: JobPayload) =>
    req<PreviewResult>('/api/preview', {
      method: 'POST',
      body: JSON.stringify(p),
    }),
  export: (p: JobPayload) =>
    req<ExportResult>('/api/export', {
      method: 'POST',
      body: JSON.stringify(p),
    }),
};

export type { AliasEntry, AuditReport, JobPayload };
