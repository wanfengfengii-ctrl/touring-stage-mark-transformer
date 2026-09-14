import { describe, expect, it } from 'vitest';
import {
  normalizeAngle,
  parseFinite,
  solveSimilarity,
  type TransformInput,
} from '../../src/lib/geometry';

const base: TransformInput = {
  A: { x: 0, y: 0 },
  B: { x: 1000, y: 0 },
  Ap: { x: 0, y: 0 },
  Bp: { x: 1000, y: 0 },
  points: [{ name: 'P', x: 100, y: 200 }],
};

describe('parseFinite', () => {
  it('空白字符串标记为空', () => {
    expect(parseFinite('')).toEqual({ ok: false, empty: true });
    expect(parseFinite('   ')).toEqual({ ok: false, empty: true });
  });

  it('拒绝非数值与非有限数', () => {
    for (const bad of ['abc', '12a', 'NaN', 'Infinity', '-Infinity', '1e999']) {
      expect(parseFinite(bad)).toEqual({ ok: false, empty: false });
    }
  });

  it('接受合法数值（含科学计数法、负数、前后空白）', () => {
    expect(parseFinite('1.5 ')).toEqual({ ok: true, value: 1.5 });
    expect(parseFinite('-0')).toEqual({ ok: true, value: -0 });
    expect(parseFinite('1e3')).toEqual({ ok: true, value: 1000 });
  });
});

describe('normalizeAngle', () => {
  it('规范到 (-π, π]', () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(Math.PI)).toBe(Math.PI); // +180° 保留
    expect(normalizeAngle(-Math.PI)).toBe(Math.PI); // -180° 规范为 +180°
    expect(normalizeAngle((3 * Math.PI) / 2)).toBeCloseTo(-Math.PI / 2, 12);
    expect(normalizeAngle((-3 * Math.PI) / 2)).toBeCloseTo(Math.PI / 2, 12);
    expect(normalizeAngle(2 * Math.PI)).toBeCloseTo(0, 12);
    expect(normalizeAngle(10 * Math.PI)).toBeCloseTo(0, 12);
  });

  it('跨过 ±π 接缝时取短角：179° 到 -179° 应为 +2°', () => {
    const a = (179 * Math.PI) / 180;
    const b = (-179 * Math.PI) / 180;
    const m = normalizeAngle(b - a);
    expect((m * 180) / Math.PI).toBeCloseTo(2, 10);
  });
});

describe('solveSimilarity 求解', () => {
  it('恒等变换', () => {
    const r = solveSimilarity(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.scale).toBe(1);
    expect(r.value.theta).toBe(0);
    expect(r.value.rows[0].site).toEqual({ x: 100, y: 200 });
  });

  it('纯平移：基准整体偏移 30 / -40', () => {
    const r = solveSimilarity({
      ...base,
      Ap: { x: 30, y: -40 },
      Bp: { x: 1030, y: -40 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.scale).toBeCloseTo(1, 12);
    expect(r.value.thetaDeg).toBeCloseTo(0, 12);
    expect(r.value.rows[0].site.x).toBeCloseTo(130, 10);
    expect(r.value.rows[0].site.y).toBeCloseTo(160, 10);
  });

  it('统一缩放 2 倍，不旋转', () => {
    const r = solveSimilarity({
      ...base,
      Ap: { x: 0, y: 0 },
      Bp: { x: 2000, y: 0 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.scale).toBe(2);
    expect(r.value.thetaDeg).toBe(0);
    expect(r.value.rows[0].site).toEqual({ x: 200, y: 400 });
  });

  it('旋转 +90°（逆时针为正，y 向上）', () => {
    const r = solveSimilarity({
      ...base,
      Bp: { x: 0, y: 1000 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.scale).toBeCloseTo(1, 12);
    expect(r.value.thetaDeg).toBeCloseTo(90, 10);
    // (100, 200) 逆时针转 90° -> (-200, 100)
    expect(r.value.rows[0].site.x).toBeCloseTo(-200, 10);
    expect(r.value.rows[0].site.y).toBeCloseTo(100, 10);
  });

  it('旋转 -90° 方向不得写反', () => {
    const r = solveSimilarity({
      ...base,
      Bp: { x: 0, y: -1000 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.thetaDeg).toBeCloseTo(-90, 10);
    // (100, 200) 顺时针转 90° -> (200, -100)
    expect(r.value.rows[0].site.x).toBeCloseTo(200, 10);
    expect(r.value.rows[0].site.y).toBeCloseTo(-100, 10);
  });

  it('角差恰为 180° 时报告 +180° 而非 -180°', () => {
    const r = solveSimilarity({
      ...base,
      Bp: { x: -1000, y: 0 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.thetaDeg).toBe(180);
    expect(r.value.rows[0].site.x).toBeCloseTo(-100, 10);
    expect(r.value.rows[0].site.y).toBeCloseTo(-200, 10);
  });

  it('缩放 1.5 倍并旋转 120°，基准不在原点（含平移）', () => {
    const A = { x: 1200, y: -300 };
    const B = { x: 1200 + 2000, y: -300 + 600 };
    const s = 1.5;
    const th = (120 * Math.PI) / 180;
    const map = (p: { x: number; y: number }) => {
      const vx = p.x - A.x;
      const vy = p.y - A.y;
      return {
        x: 50 + s * (Math.cos(th) * vx - Math.sin(th) * vy),
        y: -80 + s * (Math.sin(th) * vx + Math.cos(th) * vy),
      };
    };
    const Ap = map(A);
    const Bp = map(B);
    const r = solveSimilarity({
      A,
      B,
      Ap,
      Bp,
      points: [{ name: 'Q', x: 345.678, y: 987.654 }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.scale).toBeCloseTo(1.5, 10);
    expect(r.value.thetaDeg).toBeCloseTo(120, 9);
    const expected = map({ x: 345.678, y: 987.654 });
    expect(r.value.rows[0].site.x).toBeCloseTo(expected.x, 8);
    expect(r.value.rows[0].site.y).toBeCloseTo(expected.y, 8);
  });

  it('两对基准恒映射到现场基准，闭合差为机器精度量级', () => {
    const r = solveSimilarity({
      ...base,
      Ap: { x: 12.5, y: 7.25 },
      Bp: { x: -99.5, y: 400 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const c of r.value.baseChecks) {
      expect(c.residual).toBeLessThan(1e-9);
    }
  });

  it('反算复核闭合差接近零，内部保留完整精度', () => {
    const r = solveSimilarity({
      ...base,
      Ap: { x: 10, y: 10 },
      Bp: { x: 13, y: 14 },
      points: [{ name: 'P', x: 100, y: 200 }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.rows[0].residual).toBeLessThan(1e-9);
    expect(r.value.rows[0].back.x).toBeCloseTo(100, 9);
    expect(r.value.rows[0].back.y).toBeCloseTo(200, 9);
  });

  it('缩放率为无理比（1/3 类）时不在内部截断', () => {
    const r = solveSimilarity({
      ...base,
      Bp: { x: 1000 / 3, y: 0 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.scale).toBeCloseTo(1 / 3, 15);
  });

  it('不会产生镜像：两点对只能给出旋转，映射行列式为正', () => {
    // 设计 A=(0,0),B=(1,0)，现场同向；第三点 (0,1) 必到 (0,1) 而非 (0,-1)
    const r = solveSimilarity({
      ...base,
      B: { x: 1, y: 0 },
      Bp: { x: 1, y: 0 },
      points: [{ name: 'C', x: 0, y: 1 }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.rows[0].site.x).toBeCloseTo(0, 12);
    expect(r.value.rows[0].site.y).toBeCloseTo(1, 12);
  });
});

describe('solveSimilarity 无效边界（整批拒绝）', () => {
  it('设计侧重合：A 与 B 相同', () => {
    const r = solveSimilarity({
      ...base,
      A: { x: 5, y: 5 },
      B: { x: 5, y: 5 },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(' ')).toContain('重合');
  });

  it('现场侧重合：A′ 与 B′ 相同', () => {
    const r = solveSimilarity({
      ...base,
      Ap: { x: 5, y: 5 },
      Bp: { x: 5, y: 5 },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(' ')).toContain('重合');
  });

  it('两侧都重合时一次给出全部错误', () => {
    const r = solveSimilarity({
      A: { x: 0, y: 0 },
      B: { x: 0, y: 0 },
      Ap: { x: 9, y: 9 },
      Bp: { x: 9, y: 9 },
      points: [],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.length).toBeGreaterThanOrEqual(2);
  });

  it('没有具名落点时拒绝', () => {
    const r = solveSimilarity({ ...base, points: [] });
    expect(r.ok).toBe(false);
  });

  it('落点名称为空时拒绝', () => {
    const r = solveSimilarity({
      ...base,
      points: [{ name: '   ', x: 1, y: 1 }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(' ')).toContain('名称');
  });

  it('落点名称重复时拒绝', () => {
    const r = solveSimilarity({
      ...base,
      points: [
        { name: '灯位', x: 1, y: 1 },
        { name: '灯位', x: 2, y: 2 },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(' ')).toContain('重复');
  });
});
