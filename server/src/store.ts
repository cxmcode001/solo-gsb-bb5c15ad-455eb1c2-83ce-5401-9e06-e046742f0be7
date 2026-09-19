import { promises as fs } from 'fs';
import path from 'path';
import type { JobState } from './types';

/**
 * 单机文件持久化：整个任务序列化为 data/job.json，原子替换写入。
 * 服务重启 / 浏览器刷新后均可恢复。
 */
export class JobStore {
  private filePath: string;
  private cache: JobState | null = null;
  private writeTimer: NodeJS.Timeout | null = null;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'job.json');
  }

  async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as JobState;
      // 兼容旧版本任务文件：补齐稳定化名表、逐条应用例外与实体决定
      this.cache = {
        ...parsed,
        aliases: parsed.aliases ?? [],
        revertedKeys: parsed.revertedKeys ?? [],
        appliedKeys: parsed.appliedKeys ?? [],
        entityDecisions: parsed.entityDecisions ?? [],
      };
    } catch {
      this.cache = null;
    }
  }

  get(): JobState | null {
    return this.cache;
  }

  /** 合并式保存（防抖 + 原子写） */
  save(state: JobState): void {
    this.cache = { ...state, updatedAt: new Date().toISOString() };
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => {
      const tmp = this.filePath + '.tmp';
      fs.writeFile(tmp, JSON.stringify(this.cache, null, 2), 'utf8')
        .then(() => fs.rename(tmp, this.filePath))
        .catch((e) => console.error('[store] 写入失败:', e));
    }, 300);
  }

  async flush(): Promise<void> {
    if (!this.cache) return;
    const tmp = this.filePath + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(this.cache, null, 2), 'utf8');
    await fs.rename(tmp, this.filePath);
  }
}
