/** 替换模式：固定模板 / 稳定化名 */
export type RuleMode = 'template' | 'alias';

/** 脱敏规则 */
export interface MaskRule {
  id: string;
  name: string;
  /** JS 正则表达式源码（不含首尾 /） */
  pattern: string;
  /** 正则标志，如 g / i；u 默认补齐 */
  flags: string;
  /**
   * 替换模板（mode = 'template' 时生效），支持：
   *  $& 整体命中、$1..$n 捕获组、$name 命名组、
   *  $RULE、$KEEP:n、$MASK:n、$MASKALL
   */
  replacement: string;
  /** 数值越大优先级越高；同值按规则名排序 */
  priority: number;
  enabled: boolean;
  /** 替换模式：template 固定模板；alias 稳定化名（编号持久、跨 cue 一致） */
  mode: RuleMode;
  /** 化名模式前缀，如「人物」→ 人物1 / 人物2；为空时使用「化名」 */
  aliasPrefix: string;
}

/**
 * 稳定化名映射条目。
 * 实体键 = 规则 id + 经 Unicode NFKC 归一化并去首尾空白后的原文；
 * 序号在规则内只增不复用，增删其他字幕 / 命中不会重排已有编号。
 */
export interface AliasEntry {
  ruleId: string;
  /** 实体键：NFKC + trim 后的规范原文 */
  entityKey: string;
  /** 规则内稳定编号（1 起） */
  seq: number;
  /** 最终化名（手动改名后为自定义值） */
  alias: string;
  /** true = 前缀+序号自动生成（跟随前缀变化）；false = 用户手动改名 */
  auto: boolean;
  /** 最近一次命中的原始文本（展示辅助，可空） */
  sourceText?: string;
}

/** 合并后落到某条字幕上的命中 */
export interface Hit {
  /** 稳定标识：cue 序号 + 原文区间 + 规则 id，撤销状态据此恢复 */
  key: string;
  ruleId: string;
  ruleName: string;
  priority: number;
  /** 在 cue 纯文本中的起止偏移（含） */
  start: number;
  end: number;
  /** 原文区间 */
  match: string;
  replacement: string;
  /** true 表示用户已撤销，导出时恢复原文 */
  reverted: boolean;
  /** 化名模式：实体键（NFKC + trim 后的原文）；模板模式为空 */
  entityKey?: string;
  /** 化名模式：最终化名 */
  alias?: string;
}

/** 被更高优先级 / 更长命中吞并的重叠命中，仅用于审计 */
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
  /** 化名规则的被抑制命中也记录实体键（不参与编号分配） */
  entityKey?: string;
}

export interface CueHit {
  index: number;
  id: string;
  start: string;
  end: string;
  payload: string;
  /** 纯文本 -> 原文 payload 的偏移映射 */
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
  /** 计算后完整的化名表（已持久条目 + 本次首次命中新建条目） */
  aliases: AliasEntry[];
}

export interface PreviewInput {
  vtt: string;
  rules: MaskRule[];
  revertedKeys?: string[];
  aliases?: AliasEntry[];
}

export interface AuditRecord {
  cueIndex: number;
  cueId: string;
  time: { start: string; end: string };
  rule: { id: string; name: string; priority: number };
  /** 原文区间（含纯文本偏移） */
  source: { start: number; end: number; text: string };
  /** 替换结果 */
  replacement: string;
  status: 'applied' | 'reverted' | 'suppressed';
  /** 被抑制时的胜出规则 */
  suppressedBy?: { id: string; name: string };
  /** 化名模式：实体键（NFKC + trim 后的原文） */
  entityKey?: string;
  /** 化名模式：最终化名（含手动改名结果） */
  alias?: string;
}

export interface AuditReport {
  app: string;
  version: number;
  generatedAt: string;
  source: {
    sha256: string;
    length: number;
    cueCount: number;
  };
  rules: MaskRule[];
  stats: {
    totalHits: number;
    appliedHits: number;
    revertedHits: number;
    suppressedHits: number;
  };
  records: AuditRecord[];
  /** 稳定化名表（实体键、最终化名、编号、是否自动生成） */
  aliases?: AliasEntry[];
}

export interface JobState {
  jobId: string;
  vtt: string;
  rules: MaskRule[];
  /** 已撤销命中的 key 列表 */
  revertedKeys: string[];
  /** 稳定化名映射（持久化，编号不复用） */
  aliases: AliasEntry[];
  updatedAt: string;
}

export interface ExportResult {
  vtt: string;
  audit: AuditReport;
  jobId: string;
}
