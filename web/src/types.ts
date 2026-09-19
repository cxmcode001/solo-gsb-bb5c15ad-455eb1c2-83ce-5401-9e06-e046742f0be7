export type RuleMode = 'template' | 'alias';

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
  entityKey?: string;
  alias?: string;
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
  cues: CueHit[];
  parseErrors: string[];
  aliases: AliasEntry[];
}

export interface JobState {
  jobId: string;
  vtt: string;
  rules: MaskRule[];
  revertedKeys: string[];
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
  };
  records: AuditRecord[];
  aliases?: AliasEntry[];
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
