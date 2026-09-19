import { useMemo, useState } from 'react';
import type { EntitySummary } from '../types';

interface Props {
  entities: EntitySummary[];
  onSetDecision: (ruleId: string, entityKey: string, action: 'apply' | 'keep' | null) => void;
  onClearExceptions: (ruleId: string, entityKey: string) => void;
}

type Filter = 'all' | 'pending' | 'apply' | 'keep' | 'exception';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待定' },
  { key: 'apply', label: '应用' },
  { key: 'keep', label: '保留' },
  { key: 'exception', label: '有例外' },
];

function matchFilter(e: EntitySummary, f: Filter): boolean {
  switch (f) {
    case 'all':
      return true;
    case 'pending':
      return e.decision === null;
    case 'apply':
      return e.decision === 'apply';
    case 'keep':
      return e.decision === 'keep';
    case 'exception':
      return e.exceptionHits > 0;
  }
}

/**
 * 实体决策列表：按「规则 + NFKC 归一实体」聚合当前命中。
 * 一次设为「始终应用 / 始终保留」后持久化，新出现的同实体命中自动继承；
 * 逐条操作是该命中的显式例外（优先于决定），可在此或预览中清除以恢复继承。
 */
export function DecisionPanel({ entities, onSetDecision, onClearExceptions }: Props) {
  const [open, setOpen] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');

  const counts = useMemo(() => {
    const c: Record<Filter, number> = {
      all: entities.length,
      pending: 0,
      apply: 0,
      keep: 0,
      exception: 0,
    };
    for (const e of entities) {
      if (e.decision === null) c.pending++;
      else if (e.decision === 'apply') c.apply++;
      else c.keep++;
      if (e.exceptionHits > 0) c.exception++;
    }
    return c;
  }, [entities]);

  const rows = useMemo(() => entities.filter((e) => matchFilter(e, filter)), [entities, filter]);

  if (entities.length === 0) return null;

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>实体决策（{entities.length}）</h2>
        <button className="btn btn-mini btn-ghost" onClick={() => setOpen((v) => !v)}>
          {open ? '收起' : '展开'}
        </button>
      </header>
      <p className="hint">
        按「规则 + NFKC 归一实体」一次设定，持久生效：新出现的同实体命中自动继承。
        预览中的逐条撤销 / 应用是该命中的显式例外，优先于实体决定；清除例外即恢复继承。
        重叠抑制只对胜出命中生效，被抑制项不参与决策。
      </p>
      {open && (
        <>
          <div className="decision-tabs">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                className={`decision-tab ${filter === f.key ? 'active' : ''}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
                <span className="decision-count">{counts[f.key]}</span>
              </button>
            ))}
          </div>
          <ul className="decision-list">
            {rows.length === 0 && <li className="empty-tip">该筛选下没有实体。</li>}
            {rows.map((e) => (
              <li
                key={`${e.ruleId} ${e.entityKey}`}
                className={`decision-item ${
                  e.decision ? `decision-${e.decision}` : ''
                }`}
              >
                <div className="decision-main">
                  <span className="decision-rule" title={`规则：${e.ruleName}`}>
                    {e.ruleName}
                  </span>
                  <span className="decision-entity" title={`实体键：${e.entityKey}`}>
                    {e.sample && e.sample !== e.entityKey
                      ? `${e.sample}（${e.entityKey}）`
                      : e.entityKey}
                  </span>
                  <span className="decision-stats">
                    {e.totalHits > 0 ? (
                      <>
                        命中 {e.totalHits}
                        {e.appliedHits > 0 && ` · 应用 ${e.appliedHits}`}
                        {e.revertedHits > 0 && ` · 保留 ${e.revertedHits}`}
                        {e.exceptionHits > 0 && (
                          <em className="decision-exc"> · 例外 {e.exceptionHits}</em>
                        )}
                      </>
                    ) : (
                      '当前无命中（决定保留，新命中自动继承）'
                    )}
                  </span>
                </div>
                <div className="decision-actions">
                  <div className="decision-switch" role="group" aria-label="实体决定">
                    <button
                      className={`switch-opt ${e.decision === null ? 'active' : ''}`}
                      title="不设定实体决定，按默认（应用）与逐条例外处理"
                      onClick={() => onSetDecision(e.ruleId, e.entityKey, null)}
                    >
                      待定
                    </button>
                    <button
                      className={`switch-opt switch-apply ${
                        e.decision === 'apply' ? 'active' : ''
                      }`}
                      title="该实体所有命中始终应用替换（含未来新命中）"
                      onClick={() => onSetDecision(e.ruleId, e.entityKey, 'apply')}
                    >
                      始终应用
                    </button>
                    <button
                      className={`switch-opt switch-keep ${
                        e.decision === 'keep' ? 'active' : ''
                      }`}
                      title="该实体所有命中始终保留原文（含未来新命中）"
                      onClick={() => onSetDecision(e.ruleId, e.entityKey, 'keep')}
                    >
                      始终保留
                    </button>
                  </div>
                  {e.exceptionHits > 0 && (
                    <button
                      className="btn btn-mini"
                      title="清除该实体全部逐条例外，恢复继承实体决定"
                      onClick={() => onClearExceptions(e.ruleId, e.entityKey)}
                    >
                      清除例外
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
