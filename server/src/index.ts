import express, { type Request, type Response } from 'express';
import path from 'path';
import { randomUUID } from 'crypto';
import { buildPreview, exportResult, normalizeDecisions, normalizeRule } from './engine';
import { PRESETS } from './presets';
import { JobStore } from './store';
import type {
  AliasEntry,
  EntityDecision,
  JobState,
  MaskRule,
  PreviewInput,
} from './types';

const PORT = Number(process.env.PORT ?? 3000);
const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
const WEB_DIST =
  process.env.WEB_DIST ?? path.join(__dirname, '..', '..', 'web', 'dist');

const app = express();
app.use(express.json({ limit: '5mb' }));

const store = new JobStore(DATA_DIR);

/* ------------------------------ 校验 ------------------------------ */

function validateRules(rules: unknown): MaskRule[] | string {
  if (!Array.isArray(rules)) return 'rules 必须是数组';
  const out: MaskRule[] = [];
  for (const r of rules) {
    if (r === null || typeof r !== 'object') return '存在非法规则';
    const rule = r as Record<string, unknown>;
    if (typeof rule.id !== 'string' || !rule.id) return '规则缺少 id';
    if (typeof rule.name !== 'string') return `规则 ${rule.id} 缺少名称`;
    if (typeof rule.pattern !== 'string') return `规则 ${rule.id} 缺少正则`;
    if (typeof rule.replacement !== 'string')
      return `规则 ${rule.id} 缺少替换模板`;
    if (typeof rule.flags !== 'string') return `规则 ${rule.id} flags 必须是字符串`;
    if (typeof rule.priority !== 'number') return `规则 ${rule.id} 优先级必须是数字`;
    if (typeof rule.enabled !== 'boolean') return `规则 ${rule.id} enabled 必须是布尔值`;
    if (rule.mode !== undefined && rule.mode !== 'template' && rule.mode !== 'alias')
      return `规则 ${rule.id} 替换模式非法`;
    if (rule.aliasPrefix !== undefined && typeof rule.aliasPrefix !== 'string')
      return `规则 ${rule.id} 化名前缀必须是字符串`;
    const normalized = normalizeRule(rule as unknown as MaskRule);
    try {
      new RegExp(normalized.pattern, normalized.flags);
    } catch (e) {
      return `规则「${normalized.name}」正则无效：${(e as Error).message}`;
    }
    out.push(normalized);
  }
  return out;
}

/** 校验并净化化名表；非法时返回错误文案 */
function validateAliases(aliases: unknown): AliasEntry[] | string {
  if (aliases === undefined || aliases === null) return [];
  if (!Array.isArray(aliases)) return 'aliases 必须是数组';
  const out: AliasEntry[] = [];
  for (const a of aliases) {
    if (a === null || typeof a !== 'object') return '存在非法化名条目';
    const e = a as Record<string, unknown>;
    if (typeof e.ruleId !== 'string' || !e.ruleId) return '化名条目缺少 ruleId';
    if (typeof e.entityKey !== 'string' || !e.entityKey)
      return '化名条目缺少 entityKey';
    if (typeof e.seq !== 'number' || !Number.isInteger(e.seq) || e.seq < 1)
      return `实体 ${e.entityKey} 编号非法`;
    if (typeof e.alias !== 'string' || !e.alias.trim())
      return `实体 ${e.entityKey} 化名为空`;
    out.push({
      ruleId: e.ruleId,
      entityKey: e.entityKey,
      seq: e.seq,
      alias: e.alias,
      auto: e.auto !== false,
      sourceText: typeof e.sourceText === 'string' ? e.sourceText : undefined,
    });
  }
  return out;
}

/** 校验并净化实体决定；非法时返回错误文案 */
function validateDecisions(decisions: unknown): EntityDecision[] | string {
  if (decisions === undefined || decisions === null) return [];
  if (!Array.isArray(decisions)) return 'entityDecisions 必须是数组';
  for (const d of decisions) {
    if (d === null || typeof d !== 'object') return '存在非法实体决定';
    const e = d as Record<string, unknown>;
    if (typeof e.ruleId !== 'string' || !e.ruleId) return '实体决定缺少 ruleId';
    if (typeof e.entityKey !== 'string' || !e.entityKey)
      return '实体决定缺少 entityKey';
    if (e.action !== 'apply' && e.action !== 'keep')
      return `实体 ${e.entityKey} 的决定非法（应为 apply / keep）`;
  }
  // 引擎统一去重（同实体后写覆盖先写），保证预览 / 导出 / 保存一致
  return normalizeDecisions(decisions as EntityDecision[]);
}

function readPreviewBody(req: Request): PreviewInput {
  const { vtt, rules, revertedKeys, appliedKeys, entityDecisions, aliases } =
    req.body as Partial<PreviewInput>;
  if (typeof vtt !== 'string') {
    throw new Error('vtt 必须是字符串');
  }
  const checked = validateRules(rules);
  if (typeof checked === 'string') throw new Error(checked);
  const checkedAliases = validateAliases(aliases);
  if (typeof checkedAliases === 'string') throw new Error(checkedAliases);
  const checkedDecisions = validateDecisions(entityDecisions);
  if (typeof checkedDecisions === 'string') throw new Error(checkedDecisions);
  return {
    vtt,
    rules: checked,
    revertedKeys: Array.isArray(revertedKeys)
      ? (revertedKeys as string[]).filter((k) => typeof k === 'string')
      : [],
    appliedKeys: Array.isArray(appliedKeys)
      ? (appliedKeys as string[]).filter((k) => typeof k === 'string')
      : [],
    entityDecisions: checkedDecisions,
    aliases: checkedAliases,
  };
}

/* ------------------------------ 路由 ------------------------------ */

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.get('/api/presets', (_req, res) => {
  res.json({ presets: PRESETS });
});

/** 恢复上次任务（刷新 / 重启后） */
app.get('/api/job', (_req, res) => {
  res.json({ job: store.get() });
});

/** 自动保存编辑中的任务 */
app.put('/api/job', (req, res) => {
  const { vtt, rules, revertedKeys, appliedKeys, entityDecisions, aliases } =
    req.body as Partial<JobState>;
  if (typeof vtt !== 'string') return res.status(400).json({ error: 'vtt 必须是字符串' });
  const checked = validateRules(rules);
  if (typeof checked === 'string') return res.status(400).json({ error: checked });
  if (!Array.isArray(revertedKeys))
    return res.status(400).json({ error: 'revertedKeys 必须是数组' });
  if (!Array.isArray(appliedKeys))
    return res.status(400).json({ error: 'appliedKeys 必须是数组' });
  const checkedAliases = validateAliases(aliases);
  if (typeof checkedAliases === 'string')
    return res.status(400).json({ error: checkedAliases });
  const checkedDecisions = validateDecisions(entityDecisions);
  if (typeof checkedDecisions === 'string')
    return res.status(400).json({ error: checkedDecisions });

  const previous = store.get();
  const state: JobState = {
    jobId: previous?.jobId ?? randomUUID(),
    vtt,
    rules: checked,
    revertedKeys: revertedKeys.filter((k) => typeof k === 'string'),
    appliedKeys: appliedKeys.filter((k) => typeof k === 'string'),
    entityDecisions: checkedDecisions,
    aliases: checkedAliases,
    updatedAt: new Date().toISOString(),
  };
  store.save(state);
  res.json({ job: state });
});

/** 计算替换预览（合并优先级重叠，标记撤销态） */
app.post('/api/preview', (req, res) => {
  try {
    const input = readPreviewBody(req);
    res.json(buildPreview(input));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

/** 确认导出：新 VTT + JSON 审计报告 */
app.post('/api/export', (req, res) => {
  try {
    const input = readPreviewBody(req);
    const result = exportResult({
      ...input,
      jobId: store.get()?.jobId ?? randomUUID(),
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

/* ---------------------------- 静态资源 ---------------------------- */

app.use(express.static(WEB_DIST));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(WEB_DIST, 'index.html'), (err) => {
    if (err) next(err);
  });
});

/* ------------------------------ 启动 ------------------------------ */

async function main(): Promise<void> {
  await store.init();
  app.listen(PORT, () => {
    console.log(`字幕脱敏审校台已启动: http://localhost:${PORT}`);
    console.log(`数据目录: ${DATA_DIR}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// 退出前落盘
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    store.flush().finally(() => process.exit(0));
  });
}
