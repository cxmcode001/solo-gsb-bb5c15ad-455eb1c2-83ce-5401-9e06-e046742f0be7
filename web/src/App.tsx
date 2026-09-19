import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import type {
  AliasEntry,
  ExportResult,
  MaskRule,
  Preset,
  PreviewResult,
} from './types';
import { uid, normalizeRule } from './utils';
import { SAMPLE_VTT } from './sample';
import { VttInput } from './components/VttInput';
import { RulesPanel } from './components/RulesPanel';
import { AliasPanel } from './components/AliasPanel';
import { Preview } from './components/Preview';
import { ExportModal } from './components/ExportModal';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export default function App() {
  const [vtt, setVtt] = useState('');
  const [rules, setRules] = useState<MaskRule[]>([]);
  const [revertedKeys, setRevertedKeys] = useState<string[]>([]);
  const [aliases, setAliases] = useState<AliasEntry[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [exportData, setExportData] = useState<ExportResult | null>(null);

  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 预览请求序号：只接受最新一次响应，避免防抖竞态覆盖化名改名 */
  const previewReq = useRef(0);

  /* ------------- 启动：拉预设 + 恢复上次任务 ------------- */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [{ presets: ps }, { job }] = await Promise.all([
          api.presets(),
          api.getJob(),
        ]);
        if (!alive) return;
        setPresets(ps);
        if (job && (job.vtt || job.rules.length > 0)) {
          setVtt(job.vtt);
          setRules(job.rules.map(normalizeRule));
          setRevertedKeys(job.revertedKeys ?? []);
          setAliases(job.aliases ?? []);
          setUpdatedAt(job.updatedAt);
        } else {
          // 首次使用：加载预设（全部预置，按 enabled 字段决定启用）
          setRules(ps.map((p) => ({ id: uid(), ...p.rule })));
        }
      } catch (e) {
        setError(`初始化失败：${(e as Error).message}`);
      } finally {
        if (alive) setHydrated(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /* ------------- 防抖计算预览（300ms） ------------- */
  useEffect(() => {
    if (!hydrated) return;
    if (previewTimer.current) clearTimeout(previewTimer.current);
    if (!vtt.trim()) {
      setPreview(null);
      return;
    }
    setLoading(true);
    const reqId = ++previewReq.current;
    previewTimer.current = setTimeout(async () => {
      try {
        const p = await api.preview(vtt, rules, revertedKeys, aliases);
        // 过期响应（用户已继续编辑 / 改名）直接丢弃
        if (reqId !== previewReq.current) return;
        setPreview(p);
        // 接收服务端持久化后的化名表（首次命中的新编号、前缀联动）
        setAliases((prev) => {
          const next = mergeAliases(prev, p.aliases);
          return sameAliases(prev, next) ? prev : next;
        });
        setError(null);
      } catch (e) {
        if (reqId === previewReq.current) setError((e as Error).message);
      } finally {
        if (reqId === previewReq.current) setLoading(false);
      }
    }, 300);
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    };
  }, [vtt, rules, revertedKeys, aliases, hydrated]);

  /* ------------- 防抖自动保存（800ms），刷新可恢复 ------------- */
  useEffect(() => {
    if (!hydrated) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState('saving');
    saveTimer.current = setTimeout(async () => {
      try {
        const { job } = await api.saveJob(vtt, rules, revertedKeys, aliases);
        setUpdatedAt(job.updatedAt);
        setSaveState('saved');
      } catch {
        setSaveState('error');
      }
    }, 800);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [vtt, rules, revertedKeys, aliases, hydrated]);

  /* ------------- 撤销 / 应用 ------------- */
  const toggleHit = useCallback((key: string) => {
    setRevertedKeys((keys) =>
      keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key],
    );
  }, []);
  const revertAll = useCallback(() => {
    if (!preview) return;
    setRevertedKeys(preview.cues.flatMap((c) => c.hits.map((h) => h.key)));
  }, [preview]);
  const applyAll = useCallback(() => setRevertedKeys([]), []);

  /* 规则变更后，清除已不存在的撤销项（key 由 cue 序号+区间+规则决定，天然稳定） */
  useEffect(() => {
    if (!preview) return;
    const valid = new Set(preview.cues.flatMap((c) => c.hits.map((h) => h.key)));
    setRevertedKeys((keys) => keys.filter((k) => valid.has(k)));
  }, [preview]);

  /* ------------- 化名表手动改名 / 恢复自动 ------------- */
  const renameAlias = useCallback((ruleId: string, entityKey: string, alias: string) => {
    setAliases((list) =>
      list.map((a) => {
        if (a.ruleId !== ruleId || a.entityKey !== entityKey) return a;
        // 清空输入 = 交回自动（前缀+序号），避免空化名被服务端拒绝
        if (!alias.trim()) return { ...a, auto: true };
        return { ...a, alias, auto: false };
      }),
    );
  }, []);
  const resetAlias = useCallback((ruleId: string, entityKey: string) => {
    // 交回自动：下一次预览由服务端按当前前缀 + 序号重新生成
    setAliases((list) =>
      list.map((a) =>
        a.ruleId === ruleId && a.entityKey === entityKey ? { ...a, auto: true } : a,
      ),
    );
  }, []);

  /* ------------- 导出 ------------- */
  const doExport = async () => {
    if (!vtt.trim()) return;
    try {
      const result = await api.export(vtt, rules, revertedKeys, aliases);
      setExportData(result);
    } catch (e) {
      setError(`导出失败：${(e as Error).message}`);
    }
  };

  const saveLabel = {
    idle: '',
    saving: '保存中…',
    saved: updatedAt ? `已自动保存 ${new Date(updatedAt).toLocaleTimeString()}` : '已保存',
    error: '保存失败',
  }[saveState];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">🛡</span>
          <div>
            <h1>字幕脱敏审校台</h1>
            <p>WebVTT 本机正则脱敏 · 优先级合并 · 逐条撤销 · 稳定化名 · 审计导出</p>
          </div>
        </div>
        <div className="topbar-right">
          <span className={`save-state save-${saveState}`}>{saveLabel}</span>
          <button className="btn btn-primary btn-lg" onClick={doExport} disabled={!vtt.trim()}>
            ④ 确认并导出
          </button>
        </div>
      </header>

      {error && (
        <div className="banner banner-error" onClick={() => setError(null)}>
          ✕ {error}（点击关闭）
        </div>
      )}

      {!hydrated && <div className="loading-screen">正在加载本地任务…</div>}

      <main className="layout">
        <div className="col col-left">
          <VttInput
            vtt={vtt}
            onChange={setVtt}
            onLoadSample={() => setVtt(SAMPLE_VTT)}
            onClear={() => setVtt('')}
          />
          <RulesPanel rules={rules} presets={presets} onChange={setRules} />
          <AliasPanel
            rules={rules}
            aliases={aliases}
            onRename={renameAlias}
            onReset={resetAlias}
          />
        </div>
        <div className="col col-right">
          <Preview
            preview={preview}
            loading={loading}
            onToggleHit={toggleHit}
            onRevertAll={revertAll}
            onApplyAll={applyAll}
          />
        </div>
      </main>

      <footer className="footer">
        所有数据仅在本机处理与存储（server/data/job.json），不会上传任何外部服务。
      </footer>

      {exportData && (
        <ExportModal
          vtt={exportData.vtt}
          audit={exportData.audit}
          onClose={() => setExportData(null)}
        />
      )}
    </div>
  );
}

/**
 * 用服务端返回的化名表协调本地表：
 *  - 本地已手动改名（auto=false）且与服务端不同：保留本地，避免竞态覆盖
 *  - 新增条目（首次命中）：补入
 *  - 自动条目：以服务端为准（前缀联动 / 恢复自动）
 */
function mergeAliases(local: AliasEntry[], server: AliasEntry[]): AliasEntry[] {
  const serverByKey = new Map<string, AliasEntry>(
    server.map((a) => [`${a.ruleId} ${a.entityKey}`, a]),
  );
  const out: AliasEntry[] = [];
  const seen = new Set<string>();
  for (const a of local) {
    const k = `${a.ruleId} ${a.entityKey}`;
    const s = serverByKey.get(k);
    seen.add(k);
    if (!s) {
      // 本地表中当前未命中的实体：原样保留（编号不复用、历史映射不丢）
      out.push(a);
    } else if (!a.auto && a.alias !== s.alias) {
      out.push(a); // 手动改名优先
    } else {
      out.push(s);
    }
  }
  for (const a of server) {
    const k = `${a.ruleId} ${a.entityKey}`;
    if (!seen.has(k)) out.push(a);
  }
  return out;
}

/** 结构比较，避免引用变化触发预览 / 保存的防抖循环 */
function sameAliases(a: AliasEntry[], b: AliasEntry[]): boolean {
  if (a.length !== b.length) return false;
  const keyOf = (x: AliasEntry) => `${x.ruleId} ${x.entityKey}`;
  const mapB = new Map(b.map((x) => [keyOf(x), x]));
  return a.every((x) => {
    const y = mapB.get(keyOf(x));
    return (
      !!y &&
      y.seq === x.seq &&
      y.alias === x.alias &&
      y.auto === x.auto &&
      (y.sourceText ?? '') === (x.sourceText ?? '')
    );
  });
}
