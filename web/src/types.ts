export type RuleMode = 'template' | 'alias';

/** 实体决定：对「规则 + NFKC 归一实体」的一次性裁决（持久化，新命中自动继承） */
export interface EntityDecision {
  ruleId: string;
  entityKey: string;
  /** apply = 始终应用；keep = 始终保留 */
  action: 'apply' | 'keep';
}

/** 命中最终状态的决策来源 */
export type DecisionSource =
  | 'default'
  | 'entity-apply'
  | 'entity-keep'
  | 'hit-exception'
  | 'overlap';

export interface MaskRule {
  id: string;
  name: string;
  pattern: string;
  flags: string;
  replacement: string;
  priority: number;
  enabled: boolean;
  /** 替换模式：固定模板 / 稳定化名 */
  mode: RuleMode;
  /** 化名模式前缀 */
  aliasPrefix: string;
}

/** 稳定化名映射条目（持久化，编号不复用） */
export interface AliasEntry {
  ruleId: string;
  entityKey: string;
  seq: number;
  alias: string;
  auto: boolean;
  sourceText?: string;
}

export interface Hit {
  key: string;
  ruleId: string;
  ruleName: string;
  priority: number;
  start: number;
  end: number;
  match: string;
  replacement: string;
  reverted: boolean;
  /** 实体键：NFKC + trim 后的原文（所有规则都计算） */
  entityKey?: string;
  alias?: string;
  /** 最终状态的决策来源 */
  decisionSource: DecisionSource;
}

export interface SuppressedHit {
  ruleId: string;
  ruleName: string;
  priority: number;
  start: number;
  end: number;
  match: string;
  reason: 'overlap';
  winnerRuleId: string;
  winnerRuleName: string;
  entityKey?: string;
}

export interface CueHit {
  index: number;
  id: string;
  start: string;
  end: string;
  payload: string;
  map: number[];
  text: string;
  hits: Hit[];
  suppressed: SuppressedHit[];
}

export interface PreviewResult {
  cueCount: number;
  totalHits: number;
  appliedHits: number;
  revertedHits: number;
  suppressedHits: number;
  /** 逐条显式例外总数 */
  exceptionHits: number;
  cues: CueHit[];
  parseErrors: string[];
  aliases: AliasEntry[];
  /** 实体决策列表（当前命中实体 + 已持久决定的实体） */
  entities: EntitySummary[];
}

/** 实体决策列表条目：按「规则 + 实体键」聚合 */
export interface EntitySummary {
  ruleId: string;
  ruleName: string;
  entityKey: string;
  sample: string;
  totalHits: number;
  appliedHits: number;
  revertedHits: number;
  exceptionHits: number;
  /** 当前实体决定；null = 待定 */
  decision: 'apply' | 'keep' | null;
}

export interface JobState {
  jobId: string;
  vtt: string;
  rules: MaskRule[];
  revertedKeys: string[];
  appliedKeys: string[];
  entityDecisions: EntityDecision[];
  aliases: AliasEntry[];
  updatedAt: string;
}

export interface AuditRecord {
  cueIndex: number;
  cueId: string;
  time: { start: string; end: string };
  rule: { id: string; name: string; priority: number };
  source: { start: number; end: number; text: string };
  replacement: string;
  status: 'applied' | 'reverted' | 'suppressed';
  /** 最终状态的决策来源 */
  decisionSource: DecisionSource;
  suppressedBy?: { id: string; name: string };
  entityKey?: string;
  alias?: string;
}

export interface AuditReport {
  app: string;
  version: number;
  generatedAt: string;
  source: { sha256: string; length: number; cueCount: number };
  rules: MaskRule[];
  stats: {
    totalHits: number;
    appliedHits: number;
    revertedHits: number;
    suppressedHits: number;
    exceptionHits: number;
  };
  records: AuditRecord[];
  aliases?: AliasEntry[];
  entityDecisions?: EntityDecision[];
}

export interface ExportResult {
  vtt: string;
  audit: AuditReport;
  jobId: string;
}

export interface Preset {
  name: string;
  description: string;
  rule: Omit<MaskRule, 'id'>;
}
