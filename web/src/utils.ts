import type { MaskRule } from './types';

export function uid(prefix = 'rule'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 兼容旧版本规则：补齐稳定化名所需字段 */
export function normalizeRule(rule: MaskRule): MaskRule {
  return {
    ...rule,
    mode: rule.mode === 'alias' ? 'alias' : 'template',
    aliasPrefix: typeof rule.aliasPrefix === 'string' ? rule.aliasPrefix : '',
  };
}

/** 校验正则源码与标志，返回错误文案或 null */
export function validateRegex(pattern: string, flags: string): string | null {
  if (!pattern) return '正则不能为空';
  try {
    new RegExp(pattern, flags);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

export function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
