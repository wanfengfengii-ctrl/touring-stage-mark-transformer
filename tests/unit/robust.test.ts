import { describe, expect, it } from 'vitest';
import {
  robustCandidatePairName,
  solveSimilarityRobust,
  type RobustTransformInput,
} from '../../src/lib/geometry';

/** 设计侧正方形四点。 */
const SQUARE = {
  A: { x: 0, y: 0 },
  B: { x: 1000, y: 0 },
  C: { x: 0, y: 1000 },
  D: { x: 1000, y: 1000 },
};

/** 构造 s=2、θ=30°、平移 (50,-70) 的真模型映射。 */
const S = 2;
const TH = (30 * Math.PI) / 180;
function trueMap(p: { x: number; y: number }) {
  return {
    x: 50 + S * (Math.cos(TH) * p.x - Math.sin(TH) * p.y),
    y: -70 + S * (Math.sin(TH) * p.x + Math.cos(TH) * p.y),
  };
}

function input(
  sites: {
    Ap: { x: number; y: number };
    Bp: { x: number; y: number };
    Cp: { x: number; y: number };
    Dp: { x: number; y: number };
  },
  threshold = 5,
  points = [{ name: 'P', x: 500, y: 500 }],
): RobustTransformInput {
  return { ...SQUARE, ...sites, threshold, points };
}

function adoptionByKey(
  r: Awaited<ReturnType<typeof solveSimilarityRobust>>,
): Record<string, boolean> {
  if (!r.ok) throw new Error('expected ok result');
  const map: Record<string, boolean> = {};
  for (const c of r.value.baseChecks) map[c.label[0]] = c.adopted;
  return map;
}

describe('稳健校准：单个离群基准的剔除与重估', () => {
  it('D 现场测量偏移 100mm：共识 A、B、C，剔除 D，重估回 s=2、30°，落点按真模型换算', () => {
    const dTrue = trueMap(SQUARE.D);
    const r = solveSimilarityRobust(
      input({
        Ap: trueMap(SQUARE.A),
        Bp: trueMap(SQUARE.B),
        Cp: trueMap(SQUARE.C),
        Dp: { x: dTrue.x + 100, y: dTrue.y },
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.value.robust).toBeDefined();
    expect(r.value.robust!.consensus).toEqual(['A', 'B', 'C']);
    expect(r.value.robust!.rejected).toEqual(['D']);
    expect(r.value.scale).toBeCloseTo(2, 10);
    expect(r.value.thetaDeg).toBeCloseTo(30, 9);

    const adopt = adoptionByKey(r);
    expect(adopt).toEqual({ A: true, B: true, C: true, D: false });
    // 被剔除基准的闭合差大（约 100mm 量级），其余为机器精度
    const byLabel = new Map(r.value.baseChecks.map((c) => [c.label[0], c]));
    expect(byLabel.get('D')!.residual).toBeGreaterThan(90);
    expect(byLabel.get('A')!.residual).toBeLessThan(1e-6);
    expect(byLabel.get('B')!.residual).toBeLessThan(1e-6);
    expect(byLabel.get('C')!.residual).toBeLessThan(1e-6);

    // 落点消费重估模型：与真模型映射一致
    const site = r.value.rows[0].site;
    const want = trueMap({ x: 500, y: 500 });
    expect(site.x).toBeCloseTo(want.x, 8);
    expect(site.y).toBeCloseTo(want.y, 8);
  });

  it('B 离群（原双点 A、B 校准会被污染）：稳健校准剔除 B 后落点恢复真模型', () => {
    const bTrue = trueMap(SQUARE.B);
    const r = solveSimilarityRobust(
      input({
        Ap: trueMap(SQUARE.A),
        Bp: { x: bTrue.x + 100, y: bTrue.y },
        Cp: trueMap(SQUARE.C),
        Dp: trueMap(SQUARE.D),
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.robust!.consensus).toEqual(['A', 'C', 'D']);
    expect(r.value.robust!.rejected).toEqual(['B']);
    expect(r.value.scale).toBeCloseTo(2, 10);
    expect(r.value.thetaDeg).toBeCloseTo(30, 9);
    const site = r.value.rows[0].site;
    const want = trueMap({ x: 500, y: 500 });
    expect(site.x).toBeCloseTo(want.x, 8);
    expect(site.y).toBeCloseTo(want.y, 8);

    // 反证：若仍用被污染的 A、B 双点模型，落点会偏离约 50mm（不重估即错）
    expect(Math.abs(site.x - (want.x + 50))).toBeGreaterThan(1);
  });

  it('四点全部服从真模型：共识含四点、无剔除，基准复核共四行且全部采用', () => {
    const r = solveSimilarityRobust(
      input({
        Ap: trueMap(SQUARE.A),
        Bp: trueMap(SQUARE.B),
        Cp: trueMap(SQUARE.C),
        Dp: trueMap(SQUARE.D),
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.robust!.consensus).toEqual(['A', 'B', 'C', 'D']);
    expect(r.value.robust!.rejected).toEqual([]);
    expect(r.value.baseChecks).toHaveLength(4);
    expect(r.value.baseChecks.every((c) => c.adopted)).toBe(true);
    expect(r.value.scale).toBeCloseTo(2, 10);
  });

  it('阈值边界：残差恰好等于阈值也计入共识', () => {
    // identity 模型；D 沿 x 恰好偏离 5mm，阈值 5 → D 仍在共识
    const r = solveSimilarityRobust(
      input(
        {
          Ap: { x: 0, y: 0 },
          Bp: { x: 1000, y: 0 },
          Cp: { x: 0, y: 1000 },
          Dp: { x: 1005, y: 1000 },
        },
        5,
      ),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.robust!.consensus).toContain('D');
    expect(r.value.robust!.consensus).toHaveLength(4);
  });
});

describe('稳健校准：同分决胜的确定性', () => {
  it('对称冲突：AB/AC/BC 三候选共识与平方残差和完全相同，按候选索引字典序选 AB', () => {
    // identity：A、B、C 精确在模型上，D=(1100,1000) 离群 100mm，阈值 1。
    // 候选 0(AB)、1(AC)、3(BC) 都得到 identity，共识均为 {A,B,C}、SSE 均为 0，
    // 唯一决胜依据是候选索引字典序 → 索引 0（AB）。
    const r = solveSimilarityRobust(
      input(
        {
          Ap: { x: 0, y: 0 },
          Bp: { x: 1000, y: 0 },
          Cp: { x: 0, y: 1000 },
          Dp: { x: 1100, y: 1000 },
        },
        1,
      ),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.robust!.candidateIndex).toBe(0);
    expect(robustCandidatePairName(0)).toBe('AB');
    expect(r.value.robust!.consensus).toEqual(['A', 'B', 'C']);
    expect(r.value.robust!.rejected).toEqual(['D']);
    expect(r.value.robust!.sse).toBe(0);
    expect(r.value.scale).toBe(1);
    expect(r.value.thetaDeg).toBe(0);
  });

  it('共识点数相同则取集内平方残差和最小者（带噪点时 BC 胜过 AB），且落点消费闭式重估模型', () => {
    // identity 名义；C 现场带 +3mm 噪声（阈值 5 内），D 离群 100mm。
    // AB/AC/BC 共识都为 {A,B,C}，但 SSE：AB=9、AC≈9、BC≈4.5 → BC（索引 3）胜出。
    const r = solveSimilarityRobust(
      input(
        {
          Ap: { x: 0, y: 0 },
          Bp: { x: 1000, y: 0 },
          Cp: { x: 3, y: 1000 },
          Dp: { x: 1100, y: 1000 },
        },
        5,
      ),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.robust!.candidateIndex).toBe(3);
    expect(robustCandidatePairName(3)).toBe('BC');
    expect(r.value.robust!.consensus).toEqual(['A', 'B', 'C']);
    // 重估模型并非胜出候选本身：闭式最小二乘把 C 的 3mm 噪声摊薄
    expect(r.value.scale).not.toBe(1);
    expect(r.value.scale).toBeCloseTo(0.99925112584, 9);
    // 落点 (500,500)：候选 identity 会给 (500,500)，重估模型给 (~501.125, ~499.625)
    const site = r.value.rows[0].site;
    expect(site.x).toBeCloseTo(501.125, 6);
    expect(site.y).toBeCloseTo(499.625, 6);
  });
});

describe('稳健校准：确定性失败', () => {
  it('全体冲突：没有任何候选能取得三点共识，确定性失败并说明原因', () => {
    // 设计正方形；现场四点缩放/旋转/位置互相冲突，阈值 50 时
    // 六个候选的共识都恰好只有两点。
    const r = solveSimilarityRobust(
      input(
        {
          Ap: { x: 0, y: 0 },
          Bp: { x: 2000, y: 0 },
          Cp: { x: 0, y: 500 },
          Dp: { x: -3000, y: -3000 },
        },
        50,
      ),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(' ')).toContain('共识');
    expect(r.errors.join(' ')).toMatch(/至少需要 3 个|3 个可信/);
  });

  it('可用候选不足：设计侧四点全部重合时，六个候选均不可用', () => {
    const r = solveSimilarityRobust({
      A: { x: 9, y: 9 },
      B: { x: 9, y: 9 },
      C: { x: 9, y: 9 },
      D: { x: 9, y: 9 },
      Ap: { x: 0, y: 0 },
      Bp: { x: 1000, y: 0 },
      Cp: { x: 0, y: 1000 },
      Dp: { x: 1000, y: 1000 },
      threshold: 5,
      points: [{ name: 'P', x: 0, y: 0 }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(' ')).toContain('可用候选不足');
  });

  it('重估溢出：共识坐标量级使闭式分母溢出为 Infinity 时，失败并说明超出数值范围', () => {
    // 设计坐标 b=1.2e154：两点距离平方 b²=1.44e308 仍有限（候选可构造），
    // 但三点质心化分母 Σ|p−p̄|² = 4/3·b² ≈ 1.92e308 = Infinity。
    // 现场统一缩放 0.5（现场距离平方同样有限），A、B、C 精确、D 离群，
    // 共识含三点后进入闭式重估即溢出。
    const b = 1.2e154;
    const r = solveSimilarityRobust({
      A: { x: 0, y: 0 },
      B: { x: b, y: 0 },
      C: { x: 0, y: b },
      D: { x: b, y: b },
      Ap: { x: 0, y: 0 },
      Bp: { x: 0.5 * b, y: 0 },
      Cp: { x: 0, y: 0.5 * b },
      Dp: { x: 2e154, y: -2e154 },
      threshold: 1,
      points: [{ name: 'P', x: 0, y: 0 }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(' ')).toContain('超出数值范围');
  });
});

describe('稳健校准：补录字段校验', () => {
  const validSites = {
    Ap: { x: 0, y: 0 },
    Bp: { x: 1000, y: 0 },
    Cp: { x: 0, y: 1000 },
    Dp: { x: 1100, y: 1000 },
  };

  it('阈值为负数被拒绝', () => {
    const r = solveSimilarityRobust(input(validSites, -1));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(' ')).toContain('阈值');
  });

  it('阈值为 NaN/Infinity 被拒绝', () => {
    for (const threshold of [NaN, Infinity, -Infinity]) {
      const r = solveSimilarityRobust(input(validSites, threshold));
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors.join(' ')).toContain('阈值');
    }
  });

  it('补录基准坐标非有限数被拒绝', () => {
    const r = solveSimilarityRobust({
      ...input(validSites, 1),
      C: { x: NaN, y: 0 },
      Dp: { x: Infinity, y: 0 },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(' ')).toContain('C');
    expect(r.errors.join(' ')).toContain('D′');
  });

  it('阈值为 0 合法（仅残差恰为 0 的基准进入共识）', () => {
    const r = solveSimilarityRobust(input(validSites, 0));
    expect(r.ok).toBe(true);
  });

  it('仍遵守落点规则：无具名落点或空名称时整批拒绝', () => {
    const r1 = solveSimilarityRobust(input(validSites, 1, []));
    expect(r1.ok).toBe(false);
    const r2 = solveSimilarityRobust(input(validSites, 1, [{ name: '  ', x: 0, y: 0 }]));
    expect(r2.ok).toBe(false);
  });
});
