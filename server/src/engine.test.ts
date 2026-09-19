/** 引擎自测：node --import tsx src/engine.test.ts（通过 npm run test:engine 运行） */
import assert from 'assert';
import {
  autoAliasFor,
  buildPreview,
  exportResult,
  normalizeEntity,
  plainText,
} from './engine';
import { PRESETS, SAMPLE_VTT } from './presets';
import type { AliasEntry, MaskRule } from './types';

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

function presetRule(name: string, override: Partial<MaskRule> = {}): MaskRule {
  const p = PRESETS.find((x) => x.rule.name === name)!;
  return { id: 'r-' + name, ...p.rule, ...override };
}

test('内联标签剥离与偏移映射', () => {
  const { text, map } = plainText('你好<00:00:01.000>世界<c.yellow>!</c>');
  assert.strictEqual(text, '你好世界!');
  assert.deepStrictEqual(map, [0, 1, 16, 17, 28]);
});

test('基础命中：手机号/邮箱/姓名', () => {
  const rules = [presetRule('手机号'), presetRule('邮箱'), presetRule('姓名')];
  const v = buildPreview({ vtt: SAMPLE_VTT, rules });
  assert.ok(v.totalHits >= 4, `应至少 4 个命中，实际 ${v.totalHits}`);
  const phone = v.cues[0].hits.find((h) => h.ruleName === '手机号')!;
  assert.strictEqual(phone.match, '13812345678');
  assert.strictEqual(phone.replacement, '138****5678');
  const name = v.cues[0].hits.find((h) => h.ruleName === '姓名')!;
  assert.strictEqual(name.match, '张伟');
  assert.strictEqual(name.replacement, '张*');
});

test('优先级合并：身份证(80) 吞并重叠的银行卡(75)', () => {
  const rules = [presetRule('身份证'), presetRule('银行卡')];
  const v = buildPreview({ vtt: SAMPLE_VTT, rules });
  // 18 位身份证数字同时落在银行卡 [16,19] 区间，两条规则在同一区间重叠
  const idCue = v.cues.find((c) => c.text.includes('110101'))!;
  assert.ok(idCue.suppressed.length >= 1, '应有被抑制命中');
  const sup = idCue.suppressed.find((s) => s.ruleName === '银行卡');
  assert.ok(sup, '银行卡应被身份证抑制（18 位重叠区间）');
  assert.strictEqual(sup!.winnerRuleName, '身份证');
});

test('19 位卡号不与身份证冲突，走银行卡规则', () => {
  const rules = [presetRule('身份证'), presetRule('银行卡')];
  const v = buildPreview({ vtt: SAMPLE_VTT, rules });
  const cardCue = v.cues.find((c) => c.text.includes('6222'))!;
  const bank = cardCue.hits.find((h) => h.ruleName === '银行卡');
  assert.ok(bank, '19 位卡号应由银行卡规则命中');
  assert.strictEqual(bank!.match, '6222021234567890123');
  assert.strictEqual(bank!.replacement, '6222********0123');
});

test('逐条撤销：key 稳定且导出恢复原文', () => {
  const rules = [presetRule('手机号')];
  const v1 = buildPreview({ vtt: SAMPLE_VTT, rules });
  const key = v1.cues[0].hits[0].key;
  const v2 = buildPreview({ vtt: SAMPLE_VTT, rules, revertedKeys: [key] });
  assert.strictEqual(v2.appliedHits, 1);
  assert.strictEqual(v2.revertedHits, 1);
  const ex = exportResult({ vtt: SAMPLE_VTT, rules, revertedKeys: [key] });
  assert.ok(!ex.vtt.includes('138****5678'), '撤销号码应保持原文');
  assert.ok(ex.vtt.includes('13812345678'));
  assert.ok(ex.vtt.includes('139****4321'), '未撤销号码应脱敏');
  assert.ok(ex.audit.records.some((r) => r.status === 'reverted'));
  assert.ok(ex.audit.records.some((r) => r.status === 'applied'));
});

test('时间轴/头部完整保留', () => {
  const vtt = 'WEBVTT\n\nNOTE\n这是备注\n\n00:00:01,000 --> 00:00:02,000  align:start\n电话 13812345678\n';
  const rules = [presetRule('手机号')];
  const ex = exportResult({ vtt, rules });
  assert.ok(ex.vtt.includes('NOTE'));
  assert.ok(ex.vtt.includes('00:00:01,000 --> 00:00:02,000  align:start'));
  assert.ok(ex.vtt.includes('电话 138****5678'));
  assert.strictEqual(ex.audit.source.cueCount, 1);
});

test('审计包含规则、原文区间与替换结果', () => {
  const rules = [presetRule('邮箱')];
  const ex = exportResult({ vtt: SAMPLE_VTT, rules });
  const rec = ex.audit.records.find((r) => r.rule.name === '邮箱')!;
  assert.strictEqual(rec.source.text, 'zhang.wei@example.com');
  assert.strictEqual(rec.replacement, '****@example.com');
  assert.strictEqual(typeof rec.source.start, 'number');
  assert.ok(rec.time.start && rec.time.end);
  assert.strictEqual(ex.audit.rules.length, 1);
  assert.ok(/^[a-f0-9]{64}$/.test(ex.audit.source.sha256));
});

test('非法正则在预览中报错而不崩溃', () => {
  const bad = { ...presetRule('手机号'), id: 'bad', pattern: '([0-9]+' };
  const v = buildPreview({ vtt: SAMPLE_VTT, rules: [bad] });
  assert.ok(v.parseErrors.some((e) => e.includes('bad')));
});

/* ---------------------------- 稳定化名 ---------------------------- */

const ALIAS_VTT = `WEBVTT

00:00:00.000 --> 00:00:02.000
张伟先生到了。

00:00:02.500 --> 00:00:05.000
张伟先生和李娜女士一起。

00:00:05.500 --> 00:00:08.000
张伟先生先走，王芳女士留下。
`;

/** 稳定化名：同一实体跨 cue 使用同一编号化名 */
test('稳定化名：同一实体跨 cue 同一编号，不同实体依次编号', () => {
  const rule: MaskRule = { id: 'al', ...PRESETS.find((p) => p.rule.name === '姓名-稳定化名')!.rule, enabled: true };
  const v = buildPreview({ vtt: ALIAS_VTT, rules: [rule] });
  const all = v.cues.flatMap((c) => c.hits);
  const zhang = all.filter((h) => h.match === '张伟');
  const li = all.find((h) => h.match === '李娜')!;
  const wang = all.find((h) => h.match === '王芳')!;
  assert.strictEqual(zhang.length, 3);
  for (const h of zhang) {
    assert.strictEqual(h.alias, '人物1');
    assert.strictEqual(h.replacement, '人物1');
    assert.strictEqual(h.entityKey, '张伟');
  }
  assert.strictEqual(li.alias, '人物2');
  assert.strictEqual(wang.alias, '人物3');
  assert.deepStrictEqual(
    v.aliases.map((a) => [a.entityKey, a.seq, a.alias, a.auto]),
    [
      ['张伟', 1, '人物1', true],
      ['李娜', 2, '人物2', true],
      ['王芳', 3, '人物3', true],
    ],
  );
});

/** 持久化：把化名表回传后，增删其他字幕不会重排已有编号 */
test('稳定化名：回传映射后删减字幕，已有编号不重排', () => {
  const rule: MaskRule = { id: 'al', ...PRESETS.find((p) => p.rule.name === '姓名-稳定化名')!.rule, enabled: true };
  const v1 = buildPreview({ vtt: ALIAS_VTT, rules: [rule] });

  // 删除含李娜的整条 cue，张伟仍为人物1，王芳仍为人物3（不回收 2）
  const lines = ALIAS_VTT.split('\n');
  const cut = lines.filter((l) => !l.includes('李娜')).join('\n');
  const v2 = buildPreview({ vtt: cut, rules: [rule], aliases: v1.aliases });
  const names = v2.cues.flatMap((c) => c.hits.map((h) => [h.match, h.alias]));
  assert.deepStrictEqual(names, [
    ['张伟', '人物1'],
    ['张伟', '人物1'],
    ['王芳', '人物3'],
  ]);
  // 新实体拿到下一个编号 4
  const withNew = cut.replace('王芳女士', '赵敏女士');
  const v3 = buildPreview({ vtt: withNew, rules: [rule], aliases: v1.aliases });
  const zhao = v3.cues.flatMap((c) => c.hits).find((h) => h.match === '赵敏')!;
  assert.strictEqual(zhao.alias, '人物4');
});

/** 实体键规范化：NFKC（全角→半角等）+ trim，跨 cue 收敛同一实体 */
test('稳定化名：NFKC 与首尾空白规范化实体键', () => {
  assert.strictEqual(normalizeEntity(' ＡＢＣ '), 'ABC');
  const rule: MaskRule = {
    id: 'code',
    name: '代号',
    pattern: '[A-Za-z0-9Ａ-ｚ０-９]{2,}',
    flags: 'g',
    replacement: '',
    priority: 10,
    enabled: true,
    mode: 'alias',
    aliasPrefix: '代号',
  };
  const vtt = `WEBVTT

00:00:00.000 --> 00:00:01.000
代号 abc12

00:00:02.000 --> 00:00:03.000
代号 ａｂｃ１２
`;
  const v = buildPreview({ vtt, rules: [rule] });
  const hits = v.cues.flatMap((c) => c.hits);
  assert.strictEqual(hits.length, 2);
  assert.strictEqual(hits[0].entityKey, 'abc12');
  assert.strictEqual(hits[1].entityKey, 'abc12');
  assert.strictEqual(hits[0].alias, hits[1].alias);
  assert.strictEqual(hits[0].alias, '代号1');
});

/** 手动改名：回传自定义化名后，所有未撤销命中立即联动 */
test('稳定化名：手动改名联动全部未撤销命中，撤销处恢复原文', () => {
  const rule: MaskRule = { id: 'al', ...PRESETS.find((p) => p.rule.name === '姓名-稳定化名')!.rule, enabled: true };
  const v1 = buildPreview({ vtt: ALIAS_VTT, rules: [rule] });
  const renamed: AliasEntry[] = v1.aliases.map((a) =>
    a.entityKey === '张伟' ? { ...a, alias: '客户甲', auto: false } : a,
  );
  const zhangKey = v1.cues[0].hits.find((h) => h.match === '张伟')!.key;
  const v2 = buildPreview({
    vtt: ALIAS_VTT,
    rules: [rule],
    aliases: renamed,
    revertedKeys: [zhangKey],
  });
  const zhang = v2.cues.flatMap((c) => c.hits).filter((h) => h.match === '张伟');
  assert.strictEqual(zhang[0].reverted, true);
  assert.strictEqual(zhang[0].replacement, '客户甲'); // 改名仍联动，撤销只控制是否替换
  assert.ok(zhang.slice(1).every((h) => h.replacement === '客户甲'));
  assert.strictEqual(v2.revertedHits, 1);
  assert.strictEqual(v2.appliedHits, zhang.length - 1 + 2);

  const ex = exportResult({ vtt: ALIAS_VTT, rules: [rule], aliases: renamed, revertedKeys: [zhangKey] });
  assert.ok(ex.vtt.includes('张伟先生到了'), '撤销处保留原文');
  assert.ok(!ex.vtt.includes('人物1'));
  assert.ok(ex.vtt.includes('客户甲先生和'));
  // 审计记录实体键、最终化名、状态
  const recs = ex.audit.records.filter((r) => r.entityKey === '张伟');
  assert.ok(recs.some((r) => r.status === 'reverted' && r.alias === '客户甲'));
  assert.ok(recs.some((r) => r.status === 'applied' && r.alias === '客户甲'));
  assert.ok(ex.audit.aliases!.some((a) => a.entityKey === '张伟' && a.alias === '客户甲'));
});

/** 前缀变更：自动化名跟随新前缀，手动改名保持不变 */
test('稳定化名：前缀调整联动自动条目，自定义条目不受影响', () => {
  const base: MaskRule = { id: 'al', ...PRESETS.find((p) => p.rule.name === '姓名-稳定化名')!.rule, enabled: true };
  const v1 = buildPreview({ vtt: ALIAS_VTT, rules: [base] });
  const aliases: AliasEntry[] = v1.aliases.map((a) =>
    a.entityKey === '李娜' ? { ...a, alias: '当事人', auto: false } : a,
  );
  const renamedRule = { ...base, aliasPrefix: '受访者' };
  const v2 = buildPreview({ vtt: ALIAS_VTT, rules: [renamedRule], aliases });
  const byKey = new Map(v2.aliases.map((a) => [a.entityKey, a.alias]));
  assert.strictEqual(byKey.get('张伟'), '受访者1');
  assert.strictEqual(byKey.get('李娜'), '当事人');
  assert.strictEqual(byKey.get('王芳'), '受访者3');
  assert.strictEqual(autoAliasFor('受访者', 3), '受访者3');
});

/** 模板规则与化名规则并存，重叠抑制语义不变 */
test('稳定化名：与模板规则并存，优先级抑制照常', () => {
  const tpl: MaskRule = {
    id: 'tpl',
    name: '姓名打码',
    pattern: '张伟',
    flags: 'g',
    replacement: '张*',
    priority: 40,
    enabled: true,
    mode: 'template',
    aliasPrefix: '人物',
  };
  const alias: MaskRule = {
    id: 'al',
    ...PRESETS.find((p) => p.rule.name === '姓名-稳定化名')!.rule,
    enabled: true,
    priority: 10,
  };
  const v = buildPreview({ vtt: ALIAS_VTT, rules: [tpl, alias] });
  const firstCue = v.cues[0];
  assert.strictEqual(firstCue.hits[0].replacement, '张*');
  assert.ok(firstCue.suppressed.some((s) => s.ruleName === '姓名-稳定化名' && s.entityKey === '张伟'));
});

/* ---------------------------- 实体决策 ---------------------------- */

const NUM_RULE: MaskRule = {
  id: 'num',
  name: '长号码',
  pattern: '(?<!\\d)1[3-9]\\d{9}(?!\\d)',
  flags: 'g',
  replacement: '$MASKALL',
  priority: 50,
  enabled: true,
  mode: 'template',
  aliasPrefix: '',
};

const NUM_VTT = `WEBVTT

00:00:00.000 --> 00:00:02.000
联系电话 13812345678 备用。

00:00:02.500 --> 00:00:05.000
还是 13812345678，或 13900001111。

00:00:05.500 --> 00:00:08.000
最后确认 13812345678。
`;

/** 实体决定「始终保留」：同实体全部保留，新出现的同实体命中自动继承 */
test('实体决策：始终保留作用于全部同实体命中，新命中自动继承', () => {
  const decisions = [{ ruleId: 'num', entityKey: '13812345678', action: 'keep' as const }];
  const v = buildPreview({ vtt: NUM_VTT, rules: [NUM_RULE], entityDecisions: decisions });
  const all = v.cues.flatMap((c) => c.hits);
  const kept = all.filter((h) => h.match === '13812345678');
  assert.strictEqual(kept.length, 3);
  for (const h of kept) {
    assert.strictEqual(h.reverted, true);
    assert.strictEqual(h.decisionSource, 'entity-keep');
  }
  const other = all.find((h) => h.match === '13900001111')!;
  assert.strictEqual(other.reverted, false);
  assert.strictEqual(other.decisionSource, 'default');
  assert.strictEqual(v.revertedHits, 3);
  assert.strictEqual(v.appliedHits, 1);

  // 实体列表：决定与计数
  const e138 = v.entities.find((e) => e.entityKey === '13812345678')!;
  assert.strictEqual(e138.decision, 'keep');
  assert.strictEqual(e138.totalHits, 3);
  assert.strictEqual(e138.revertedHits, 3);
  const e139 = v.entities.find((e) => e.entityKey === '13900001111')!;
  assert.strictEqual(e139.decision, null);
  assert.strictEqual(e139.appliedHits, 1);

  // 新增含同实体的 cue：自动继承保留决定
  const extended = NUM_VTT + '\n00:00:09.000 --> 00:00:11.000\n补充 13812345678  again。\n';
  const v2 = buildPreview({ vtt: extended, rules: [NUM_RULE], entityDecisions: decisions });
  const inherited = v2.cues.flatMap((c) => c.hits).filter((h) => h.match === '13812345678');
  assert.strictEqual(inherited.length, 4);
  assert.ok(inherited.every((h) => h.reverted && h.decisionSource === 'entity-keep'));

  // 导出与预览同一最终状态：保留原文，审计记录决策来源
  const ex = exportResult({ vtt: NUM_VTT, rules: [NUM_RULE], entityDecisions: decisions });
  assert.ok(ex.vtt.includes('13812345678'), '保留实体应保持原文');
  assert.ok(!ex.vtt.includes('13900001111'), '未决定实体应脱敏');
  assert.strictEqual(ex.audit.stats.revertedHits, 3);
  assert.strictEqual(ex.audit.stats.appliedHits, 1);
  const recs = ex.audit.records.filter((r) => r.source.text === '13812345678');
  assert.ok(recs.every((r) => r.status === 'reverted' && r.decisionSource === 'entity-keep'));
  assert.deepStrictEqual(ex.audit.entityDecisions, decisions);
});

/** 实体决定「始终应用」+ 逐条撤销例外：例外优先，清除例外恢复继承 */
test('实体决策：逐条撤销例外优先于始终应用，清除后恢复继承', () => {
  const decisions = [{ ruleId: 'num', entityKey: '13812345678', action: 'apply' as const }];
  const v1 = buildPreview({ vtt: NUM_VTT, rules: [NUM_RULE], entityDecisions: decisions });
  const first = v1.cues[0].hits.find((h) => h.match === '13812345678')!;
  assert.strictEqual(first.decisionSource, 'entity-apply');

  // 逐条撤销 = 显式例外，优先于实体决定
  const v2 = buildPreview({
    vtt: NUM_VTT,
    rules: [NUM_RULE],
    entityDecisions: decisions,
    revertedKeys: [first.key],
  });
  const hit2 = v2.cues[0].hits.find((h) => h.key === first.key)!;
  assert.strictEqual(hit2.reverted, true);
  assert.strictEqual(hit2.decisionSource, 'hit-exception');
  assert.strictEqual(v2.exceptionHits, 1);
  // 同实体其余命中仍继承「始终应用」
  const others = v2.cues.flatMap((c) => c.hits).filter((h) => h.match === '13812345678' && h.key !== first.key);
  assert.ok(others.every((h) => !h.reverted && h.decisionSource === 'entity-apply'));
  // 实体列表反映例外计数
  const e138 = v2.entities.find((e) => e.entityKey === '13812345678')!;
  assert.strictEqual(e138.exceptionHits, 1);

  // 清除例外（不再传 revertedKeys）→ 恢复继承实体决定
  const v3 = buildPreview({ vtt: NUM_VTT, rules: [NUM_RULE], entityDecisions: decisions });
  assert.ok(v3.cues.flatMap((c) => c.hits).every((h) => !h.reverted));
  assert.strictEqual(v3.exceptionHits, 0);
});

/** 实体决定「始终保留」+ 逐条应用例外：例外优先，导出一致 */
test('实体决策：逐条应用例外覆盖始终保留，导出与审计一致', () => {
  const decisions = [{ ruleId: 'num', entityKey: '13812345678', action: 'keep' as const }];
  const v1 = buildPreview({ vtt: NUM_VTT, rules: [NUM_RULE], entityDecisions: decisions });
  const target = v1.cues[1].hits.find((h) => h.match === '13812345678')!;

  const input = {
    vtt: NUM_VTT,
    rules: [NUM_RULE],
    entityDecisions: decisions,
    appliedKeys: [target.key],
  };
  const v2 = buildPreview(input);
  const hit = v2.cues[1].hits.find((h) => h.key === target.key)!;
  assert.strictEqual(hit.reverted, false);
  assert.strictEqual(hit.decisionSource, 'hit-exception');
  assert.strictEqual(v2.appliedHits, 2); // 例外 + 13900001111
  assert.strictEqual(v2.revertedHits, 2);

  const ex = exportResult(input);
  const rec = ex.audit.records.find((r) => r.source.start === target.start && r.cueIndex === 1)!;
  assert.strictEqual(rec.status, 'applied');
  assert.strictEqual(rec.decisionSource, 'hit-exception');
  assert.strictEqual(ex.audit.stats.exceptionHits, 1);
  // 该处替换为打码，其余同实体保留原文
  assert.ok(ex.vtt.includes('***********'), '例外处应应用替换');
  assert.ok(ex.vtt.includes('13812345678'), '其余同实体命中仍保留原文');
});

/** 实体键 NFKC 归一：全角数字命中继承半角实体的决定 */
test('实体决策：NFKC 归一后跨全半角继承同一决定', () => {
  const fullWidth = NUM_VTT.replace(/13812345678/g, '１３８１２３４５６７８');
  const wideRule: MaskRule = { ...NUM_RULE, pattern: '(?<!\\d)[0-9０-９]{11}(?!\\d)' };
  const decisions = [{ ruleId: 'num', entityKey: '13812345678', action: 'keep' as const }];
  const v = buildPreview({ vtt: fullWidth, rules: [wideRule], entityDecisions: decisions });
  const hits = v.cues.flatMap((c) => c.hits).filter((h) => h.entityKey === '13812345678');
  assert.strictEqual(hits.length, 3);
  assert.ok(hits.every((h) => h.reverted && h.decisionSource === 'entity-keep'));
});

/** 重叠合并后只对胜出命中生效：被抑制项不继承决定、不生成例外 */
test('实体决策：重叠抑制项不受决定影响且不生成例外', () => {
  const rules = [presetRule('身份证'), presetRule('银行卡')];
  // 对银行卡实体（18 位重叠数字）设「始终应用」，对身份证实体设「始终保留」
  const decisions = [
    { ruleId: 'r-银行卡', entityKey: '110101199003071234', action: 'apply' as const },
    { ruleId: 'r-身份证', entityKey: '110101199003071234', action: 'keep' as const },
  ];
  const v = buildPreview({ vtt: SAMPLE_VTT, rules, entityDecisions: decisions });
  const idCue = v.cues.find((c) => c.text.includes('110101'))!;
  // 胜出的身份证命中继承「始终保留」
  const winner = idCue.hits.find((h) => h.ruleName === '身份证')!;
  assert.strictEqual(winner.reverted, true);
  assert.strictEqual(winner.decisionSource, 'entity-keep');
  // 被抑制的银行卡命中仍是 suppressed，决定不生效、不产生例外
  const sup = idCue.suppressed.find((s) => s.ruleName === '银行卡')!;
  assert.strictEqual(sup.entityKey, '110101199003071234');
  assert.strictEqual(v.exceptionHits, 0);
  const bankEntity = v.entities.find((e) => e.ruleId === 'r-银行卡' && e.entityKey === '110101199003071234');
  assert.ok(!bankEntity || bankEntity.totalHits === 0, '被抑制命中不计入实体命中数');

  const ex = exportResult({ vtt: SAMPLE_VTT, rules, entityDecisions: decisions });
  const supRec = ex.audit.records.find((r) => r.status === 'suppressed' && r.rule.name === '银行卡')!;
  assert.strictEqual(supRec.decisionSource, 'overlap');
  const winRec = ex.audit.records.find((r) => r.rule.name === '身份证')!;
  assert.strictEqual(winRec.status, 'reverted');
  assert.strictEqual(winRec.decisionSource, 'entity-keep');
});

/** 已持久决定但当前无命中的实体：保留在决策列表中（0 命中） */
test('实体决策：无命中实体的决定持久可见，规则删除后标记', () => {
  const decisions = [
    { ruleId: 'num', entityKey: '13812345678', action: 'keep' as const },
    { ruleId: 'gone', entityKey: '不存在实体', action: 'apply' as const },
  ];
  const v = buildPreview({ vtt: NUM_VTT, rules: [NUM_RULE], entityDecisions: decisions });
  const ghost = v.entities.find((e) => e.entityKey === '不存在实体')!;
  assert.strictEqual(ghost.decision, 'apply');
  assert.strictEqual(ghost.totalHits, 0);
  assert.strictEqual(ghost.ruleName, '已删除规则');
});

/** 同一实体重复决定：后写覆盖先写（保存 / 预览 / 导出一致） */
test('实体决策：同实体决定去重，后写覆盖', () => {
  const decisions = [
    { ruleId: 'num', entityKey: '13812345678', action: 'keep' as const },
    { ruleId: 'num', entityKey: '13812345678', action: 'apply' as const },
  ];
  const v = buildPreview({ vtt: NUM_VTT, rules: [NUM_RULE], entityDecisions: decisions });
  const hits = v.cues.flatMap((c) => c.hits).filter((h) => h.match === '13812345678');
  assert.ok(hits.every((h) => !h.reverted && h.decisionSource === 'entity-apply'));
  const ex = exportResult({ vtt: NUM_VTT, rules: [NUM_RULE], entityDecisions: decisions });
  assert.strictEqual(ex.audit.entityDecisions!.length, 1);
  assert.strictEqual(ex.audit.entityDecisions![0].action, 'apply');
});

console.log(`\n引擎自测全部通过（${passed} 项）`);
