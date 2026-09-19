import { useMemo, useState } from 'react';
import type { CueHit, Hit, PreviewResult } from '../types';

interface Props {
  preview: PreviewResult | null;
  loading: boolean;
  onToggleHit: (key: string) => void;
  onRevertAll: () => void;
  onApplyAll: () => void;
}

/** 将 cue 纯文本按命中切分为片段 */
function segments(cue: CueHit): { text: string; hit?: Hit }[] {
  const out: { text: string; hit?: Hit }[] = [];
  let pos = 0;
  const sorted = [...cue.hits].sort((a, b) => a.start - b.start);
  for (const h of sorted) {
    if (h.start > pos) out.push({ text: cue.text.slice(pos, h.start) });
    out.push({ text: cue.text.slice(h.start, h.end + 1), hit: h });
    pos = h.end + 1;
  }
  if (pos < cue.text.length) out.push({ text: cue.text.slice(pos) });
  return out;
}

/** 决策来源标记（实体决定 / 逐条例外） */
function sourceBadge(hit: Hit): { cls: string; label: string } | null {
  switch (hit.decisionSource) {
    case 'entity-apply':
      return { cls: 'src-entity-apply', label: '实体·应用' };
    case 'entity-keep':
      return { cls: 'src-entity-keep', label: '实体·保留' };
    case 'hit-exception':
      return { cls: 'src-exception', label: '例外' };
    default:
      return null;
  }
}

function sourceTitle(hit: Hit): string {
  switch (hit.decisionSource) {
    case 'entity-apply':
      return '来源：实体决定「始终应用」';
    case 'entity-keep':
      return '来源：实体决定「始终保留」';
    case 'hit-exception':
      return '来源：逐条显式例外（优先于实体决定）';
    default:
      return '来源：默认（无实体决定）';
  }
}

function CueCard({ cue, onToggleHit }: { cue: CueHit; onToggleHit: (k: string) => void }) {
  const segs = useMemo(() => segments(cue), [cue]);
  return (
    <article className="cue-card">
      <div className="cue-time mono">
        {cue.start}
        {' --> '}
        {cue.end}
      </div>
      <div className="cue-text">
        {segs.map((s, i) =>
          s.hit ? (
            <span
              key={i}
              className={`hit ${s.hit.reverted ? 'hit-reverted' : 'hit-applied'} ${
                s.hit.alias !== undefined ? 'hit-alias' : ''
              }`}
              title={
                (s.hit.alias !== undefined
                  ? `${s.hit.ruleName}（稳定化名，优先级 ${s.hit.priority}）\n原文：${s.hit.match}\n实体键：${s.hit.entityKey}\n化名：${s.hit.alias}`
                  : `${s.hit.ruleName}（优先级 ${s.hit.priority}）\n原文：${s.hit.match}\n实体键：${s.hit.entityKey}\n替换：${s.hit.replacement}`) +
                `\n${sourceTitle(s.hit)}`
              }
            >
              <span className="hit-label">{s.hit.ruleName}</span>
              {s.hit.reverted ? (
                <span className="hit-original">{s.text}</span>
              ) : (
                <span className="hit-replacement">{s.hit.replacement}</span>
              )}
              {sourceBadge(s.hit) && (
                <span className={`hit-src ${sourceBadge(s.hit)!.cls}`}>
                  {sourceBadge(s.hit)!.label}
                </span>
              )}
              <button
                className="hit-toggle"
                onClick={() => onToggleHit(s.hit!.key)}
                title={
                  s.hit.decisionSource === 'hit-exception'
                    ? '清除此命中的逐条例外，恢复继承实体决定 / 默认'
                    : s.hit.reverted
                      ? '应用此替换（作为逐条例外，优先于实体决定）'
                      : '撤销此替换（作为逐条例外，优先于实体决定）'
                }
              >
                {s.hit.decisionSource === 'hit-exception'
                  ? '✕ 例外'
                  : s.hit.reverted
                    ? '↩ 应用'
                    : '↶ 撤销'}
              </button>
            </span>
          ) : (
            <span key={i}>{s.text}</span>
          ),
        )}
      </div>
      {cue.suppressed.length > 0 && (
        <div className="suppressed">
          重叠抑制：
          {cue.suppressed.map((s, i) => (
            <span key={i} className="suppressed-chip" title={`原文：${s.match}`}>
              「{s.match}」被 {s.ruleName} 命中，已按优先级并入 {s.winnerRuleName}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

export function Preview({ preview, loading, onToggleHit, onRevertAll, onApplyAll }: Props) {
  const [onlyMatched, setOnlyMatched] = useState(false);

  const cues = useMemo(() => {
    if (!preview) return [];
    return onlyMatched ? preview.cues.filter((c) => c.hits.length > 0) : preview.cues;
  }, [preview, onlyMatched]);

  return (
    <section className="panel panel-grow">
      <header className="panel-header">
        <h2>③ 替换预览与逐条撤销</h2>
        <div className="panel-actions">
          <label className="filter-check">
            <input
              type="checkbox"
              checked={onlyMatched}
              onChange={(e) => setOnlyMatched(e.target.checked)}
            />
            仅看命中
          </label>
          <button
            className="btn btn-ghost"
            onClick={onApplyAll}
            disabled={!preview}
            title="应用全部命中：清除撤销例外，并为「始终保留」实体的命中补应用例外"
          >
            全部应用
          </button>
          <button
            className="btn btn-ghost"
            onClick={onRevertAll}
            disabled={!preview}
            title="撤销全部命中：为每个命中记录逐条撤销例外（优先于实体决定）"
          >
            全部撤销
          </button>
        </div>
      </header>

      {loading && <div className="status">正在计算预览…</div>}

      {preview?.parseErrors.map((e, i) => (
        <div key={i} className="banner">
          ⚠ {e}
        </div>
      ))}

      {preview && (
        <div className="stat-bar">
          <span>字幕 {preview.cueCount} 条</span>
          <span className="stat-applied">将脱敏 {preview.appliedHits}</span>
          <span className="stat-reverted">已撤销 {preview.revertedHits}</span>
          <span className="stat-suppressed">重叠抑制 {preview.suppressedHits}</span>
          {preview.exceptionHits > 0 && (
            <span className="stat-exception">逐条例外 {preview.exceptionHits}</span>
          )}
        </div>
      )}

      <div className="cue-list">
        {preview && cues.length === 0 && <div className="empty-tip">没有可显示的字幕。</div>}
        {cues.map((c) => (
          <CueCard key={c.index} cue={c} onToggleHit={onToggleHit} />
        ))}
      </div>
    </section>
  );
}
