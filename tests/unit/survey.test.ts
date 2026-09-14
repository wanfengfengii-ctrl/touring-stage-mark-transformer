import { describe, expect, it } from 'vitest';
import {
  evaluateSurveys,
  validateTolerance,
} from '../../src/lib/geometry';
import { formatMm } from '../../src/lib/format';

/** 恒等基准：A=(0,0) B=(1000,0)，现场侧一致，期望现场即设计坐标。 */
const IDENTITY_DIR = { x: 1000, y: 0 };

function evalRows(
  expectedById: Map<number, { x: number; y: number }>,
  rows: { id: number; rawX: string; rawY: string }[],
  toleranceRaw: string,
  siteDirection = IDENTITY_DIR,
) {
  return evaluateSurveys({
    siteDirection,
    expectedById,
    toleranceRaw,
    rows,
  });
}

describe('validateTolerance 允许偏差解析', () => {
  it('空字符串标记为空并说明原因', () => {
    const r = validateTolerance('   ');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.empty).toBe(true);
    expect(r.reason).toContain('允许偏差');
  });

  it('非有限数被拒绝', () => {
    for (const bad of ['abc', 'NaN', 'Infinity', '-Infinity', '1e999']) {
      const r = validateTolerance(bad);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.empty).toBe(false);
      expect(r.reason).toContain('有限数');
    }
  });

  it('负数被拒绝', () => {
    const r = validateTolerance('-0.001');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('负数');
  });

  it('0 与正数合法（0 是有效边界）', () => {
    expect(validateTolerance('0')).toEqual({ ok: true, value: 0 });
    expect(validateTolerance(' 5.5 ')).toEqual({ ok: true, value: 5.5 });
  });
});

describe('evaluateSurveys 逐行核对', () => {
  it('每行复测坐标均为空时标记未录入，且不需要允许偏差', () => {
    const expected = new Map([
      [1, { x: 100, y: 0 }],
      [2, { x: 0, y: 100 }],
    ]);
    const r = evalRows(
      expected,
      [
        { id: 1, rawX: '', rawY: '' },
        { id: 2, rawX: '  ', rawY: '' },
      ],
      '', // 容差为空也不影响“未录入”
    );
    expect(r.rows.map((x) => x.status)).toEqual(['unentered', 'unentered']);
  });

  it('只填写一个坐标时该行输入无效，并指出缺哪一个；不影响其他行', () => {
    const expected = new Map([
      [1, { x: 100, y: 0 }],
      [2, { x: 0, y: 100 }],
    ]);
    const r = evalRows(
      expected,
      [
        { id: 1, rawX: '100', rawY: '' },
        { id: 2, rawX: '', rawY: '' },
      ],
      '5',
    );
    expect(r.rows[0].status).toBe('invalid');
    expect(r.rows[0].xInvalid).toBe(false);
    expect(r.rows[0].yInvalid).toBe(true);
    expect(r.rows[0].reason).toContain('复测 y 为空');
    expect(r.rows[1].status).toBe('unentered');
  });

  it('任一坐标非有限数时该行输入无效并标红对应控件', () => {
    const expected = new Map([[1, { x: 100, y: 0 }]]);
    const r = evalRows(
      expected,
      [{ id: 1, rawX: 'abc', rawY: 'Infinity' }],
      '5',
    );
    expect(r.rows[0].status).toBe('invalid');
    expect(r.rows[0].xInvalid).toBe(true);
    expect(r.rows[0].yInvalid).toBe(true);
    expect(r.rows[0].reason).toContain('abc');
    expect(r.rows[0].reason).toContain('Infinity');
  });

  it('允许偏差为空/非有限/负数时，成对录入的行无法核对，但未录入行保持未录入', () => {
    const expected = new Map([
      [1, { x: 100, y: 0 }],
      [2, { x: 0, y: 100 }],
    ]);
    for (const bad of ['', 'abc', '-1']) {
      const r = evalRows(
        expected,
        [
          { id: 1, rawX: '100', rawY: '0' },
          { id: 2, rawX: '', rawY: '' },
        ],
        bad,
      );
      expect(r.rows[0].status).toBe('invalid');
      expect(r.rows[0].reason).toMatch(/允许偏差/);
      expect(r.rows[1].status).toBe('unentered');
    }
  });

  it('直线偏差 ≤ 允许偏差判合格，大于判超差，并输出横向/纵向差', () => {
    // 恒等基准方向 +x：纵向差 = dx，横向差 = dy
    const expected = new Map([[1, { x: 100, y: 200 }]]);
    const ok = evalRows(
      expected,
      [{ id: 1, rawX: '103', rawY: '204' }], // (3,4) -> 直线偏差 5
      '6',
    );
    expect(ok.rows[0].status).toBe('pass');
    expect(ok.rows[0].linear).toBeCloseTo(5, 12);
    expect(ok.rows[0].longitudinal).toBeCloseTo(3, 12);
    expect(ok.rows[0].lateral).toBeCloseTo(4, 12);

    const over = evalRows(
      expected,
      [{ id: 1, rawX: '104', rawY: '204' }], // hypot(4,4) > 5.6
      '5.6',
    );
    expect(over.rows[0].status).toBe('fail');
  });

  it('恰好位于边界（直线偏差等于允许偏差）也判合格', () => {
    const expected = new Map([[1, { x: 0, y: 0 }]]);
    const r = evalRows(
      expected,
      [{ id: 1, rawX: '3', rawY: '4' }], // 3-4-5
      '5',
    );
    expect(Math.hypot(3, 4)).toBe(5);
    expect(r.rows[0].status).toBe('pass');
    expect(r.rows[0].linear).toBe(5);
  });

  it('允许偏差为 0 时仅完全重合判合格', () => {
    const expected = new Map([[1, { x: 10, y: 10 }]]);
    const exact = evalRows(expected, [{ id: 1, rawX: '10', rawY: '10' }], '0');
    expect(exact.rows[0].status).toBe('pass');
    const tiny = evalRows(
      expected,
      [{ id: 1, rawX: '10', rawY: '10.0000000001' }],
      '0',
    );
    expect(tiny.rows[0].status).toBe('fail');
  });

  it('旋转 +90° 场景：纵向沿 A′→B′(+y)，横向沿其逆时针 90°(−x)', () => {
    // 设计 (500,0) 经 +90° -> 现场 (0,500)；实测 (3,504)：dx=3, dy=4
    const r = evalRows(
      new Map([[1, { x: 0, y: 500 }]]),
      [{ id: 1, rawX: '3', rawY: '504' }],
      '5',
      { x: 0, y: 1000 },
    );
    expect(r.rows[0].longitudinal).toBeCloseTo(4, 12); // 沿 +y
    expect(r.rows[0].lateral).toBeCloseTo(-3, 12); // 横向正方向为 −x，向 +x 偏为负
    expect(r.rows[0].linear).toBeCloseTo(5, 12);
    expect(r.rows[0].status).toBe('pass');
  });

  it('旋转 −90° 场景：横向正方向随之旋转为 +x', () => {
    // 现场方向 (0,-1000)：纵向沿 −y，横向（其逆时针 90°）沿 +x
    const r = evalRows(
      new Map([[1, { x: 0, y: 0 }]]),
      [{ id: 1, rawX: '4', rawY: '3' }], // dx=4, dy=3；沿 −y 方向分量为 −3
      '5',
      { x: 0, y: -1000 },
    );
    expect(r.rows[0].longitudinal).toBeCloseTo(-3, 12);
    expect(r.rows[0].lateral).toBeCloseTo(4, 12);
    expect(r.rows[0].linear).toBeCloseTo(5, 12);
  });
});

describe('evaluateSurveys 使用全精度坐标判定（不使用两位小数舍入值）', () => {
  // 缩放 s = 3333.2/10000 = 0.33332 并旋转 +90°：
  // 设计落点 (0,-300) -> 全精度现场 E = (s·300, 0) = (99.996, 0)，
  // 但页面按毫米两位小数展示时 formatMm(99.996) = '100.00'。
  const s = 3333.2 / 10000;
  const ex = s * 300;
  const dir = { x: 0, y: 3333.2 };

  it('前置断言：全精度期望为 99.996，而两位小数展示为 100.00', () => {
    expect(ex).toBeCloseTo(99.996, 12);
    expect(formatMm(ex)).toBe('100.00');
  });

  it('全精度偏差 0.009 > 容差 0.006 判超差；若误用舍入期望 100.00 则偏差 0.005 会误判合格', () => {
    const r = evalRows(
      new Map([[1, { x: ex, y: 0 }]]),
      [{ id: 1, rawX: '100.005', rawY: '0' }],
      '0.006',
      dir,
    );
    // 全精度：|100.005 − 99.996| = 0.009… > 0.006
    expect(r.rows[0].status).toBe('fail');
    expect(Math.abs((r.rows[0].measured!.x) - ex)).toBeGreaterThan(0.006);
    // 反证：若错误地拿展示值 100.00 比较则会合格
    expect(Math.abs(100.005 - 100.0)).toBeLessThanOrEqual(0.006);
  });

  it('全精度偏差 0.005 ≤ 容差 0.006 判合格；若误用舍入期望 100.00 则偏差 0.009 会误判超差', () => {
    const r = evalRows(
      new Map([[1, { x: ex, y: 0 }]]),
      [{ id: 1, rawX: '99.991', rawY: '0' }],
      '0.006',
      dir,
    );
    expect(r.rows[0].status).toBe('pass');
    expect(Math.abs(ex - 99.991)).toBeLessThanOrEqual(0.006);
    // 反证：若错误地拿展示值 100.00 比较则会超差
    expect(Math.abs(99.991 - 100.0)).toBeGreaterThan(0.006);
  });
});

describe('evaluateSurveys 按内部标识对齐（同名落点不串）', () => {
  it('两个同名落点的期望坐标按 id 分别取，输入顺序打乱也不串', () => {
    const expected = new Map<number, { x: number; y: number }>([
      [1, { x: 100, y: 0 }],
      [2, { x: 0, y: 100 }],
    ]);
    // 故意把 id=2 排在前面
    const r = evalRows(
      expected,
      [
        { id: 2, rawX: '3', rawY: '104' }, // 相对 (0,100)：dx=3, dy=4 -> 5 合格
        { id: 1, rawX: '109', rawY: '0' }, // 相对 (100,0)：dx=9 -> 超差
      ],
      '5',
    );
    expect(r.rows[0].id).toBe(2);
    expect(r.rows[0].linear).toBeCloseTo(5, 12);
    expect(r.rows[0].status).toBe('pass');
    expect(r.rows[1].id).toBe(1);
    expect(r.rows[1].linear).toBeCloseTo(9, 12);
    expect(r.rows[1].status).toBe('fail');
  });

  it('一行无效不影响其他有效行的判定', () => {
    const expected = new Map([
      [1, { x: 100, y: 0 }],
      [2, { x: 0, y: 100 }],
      [3, { x: 200, y: 200 }],
    ]);
    const r = evalRows(
      expected,
      [
        { id: 1, rawX: '100', rawY: '' }, // 缺 y：无效
        { id: 2, rawX: '0', rawY: '100' }, // 完全重合：合格
        { id: 3, rawX: '300', rawY: '200' }, // 偏差 100：超差
      ],
      '5',
    );
    expect(r.rows.map((x) => x.status)).toEqual(['invalid', 'pass', 'fail']);
  });
});
