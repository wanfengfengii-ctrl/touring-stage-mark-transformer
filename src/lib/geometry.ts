/**
 * 二维相似变换核心库。
 *
 * 坐标系：x 向右、y 向上；逆时针角为正。
 * 仅允许 平移 + 统一缩放 + 旋转，不允许非等比拉伸或镜像。
 * 内部计算一律使用 number 完整精度，舍入只发生在展示层（format.ts）。
 */

export interface Point {
  x: number;
  y: number;
}

export interface NamedPoint extends Point {
  name: string;
}

export interface TransformInput {
  /** 设计侧基准点 A、B */
  A: Point;
  B: Point;
  /** 现场侧对应基准点 A′、B′ */
  Ap: Point;
  Bp: Point;
  /** 具名设计落点 */
  points: NamedPoint[];
}

export interface NamedResultRow {
  name: string;
  design: Point;
  site: Point;
  /** 把现场坐标再反算回设计侧的结果，用于复核 */
  back: Point;
  /** 反算点与原设计点之间的距离（毫米），理想为 0 */
  residual: number;
}

export interface BaseCheck {
  label: string;
  expected: Point;
  actual: Point;
  residual: number;
}

export interface SimilarityResult {
  /** 统一缩放率（正数） */
  scale: number;
  /** 旋转角（弧度），规范到 (-π, π] */
  theta: number;
  /** 旋转角（度），规范到 (-180, 180] */
  thetaDeg: number;
  /** 仿射形式 q = s·R(θ)·p + t 的平移分量（毫米） */
  tx: number;
  ty: number;
  rows: NamedResultRow[];
  baseChecks: BaseCheck[];
}

export type SolveOutcome =
  | { ok: true; value: SimilarityResult }
  | { ok: false; errors: string[] };

export type ParseOutcome =
  | { ok: true; value: number }
  | { ok: false; empty: boolean };

/**
 * 展示层会把数值放大后取固定小数位（毫米 ×100、缩放率 ×10⁶、
 * 复核闭合差 ×10⁹）。若放大后溢出为 Infinity，页面会出现 Infinity/空缺，
 * 因此“可计算”还必须“可展示”：value 本身有限且 value×factor 仍有限。
 */
function displaySafe(value: number, factor: number): boolean {
  return Number.isFinite(value) && Number.isFinite(value * factor);
}

const MM_FACTOR = 100;
const SCALE_FACTOR = 1e6;
const TOLERANCE_FACTOR = 1e9;

/** 解析一个数值输入：空白 / 非有限数 都视为非法。 */
export function parseFinite(raw: string): ParseOutcome {
  const text = raw.trim();
  if (text === '') return { ok: false, empty: true };
  const value = Number(text);
  if (!Number.isFinite(value)) return { ok: false, empty: false };
  return { ok: true, value };
}

function sub(p: Point, q: Point): Point {
  return { x: p.x - q.x, y: p.y - q.y };
}

function distance(p: Point, q: Point): number {
  return Math.hypot(p.x - q.x, p.y - q.y);
}

/**
 * 把任意角度（弧度）规范到 (-π, π]：
 * 即 大于 -180°、小于等于 180°。
 */
export function normalizeAngle(rad: number): number {
  const twoPi = Math.PI * 2;
  let m = ((rad % twoPi) + twoPi) % twoPi; // [0, 2π)
  if (m > Math.PI) m -= twoPi; // (m 在 (π,2π) 时落到 (-π,0))；m===π 保留为 +π
  return m;
}

/**
 * 由两对基准点求解唯一相似变换。
 *
 * 设计侧有向向量 d = B − A，现场侧 d′ = B′ − A′，
 * 缩放率 s = |d′| / |d|，
 * 旋转角 θ = atan2(d′) − atan2(d)（规范到 (-π, π]），
 * 现场坐标 q = A′ + s·R(θ)·(p − A)。
 */
export function solveSimilarity(input: TransformInput): SolveOutcome {
  const errors: string[] = [];

  if (input.points.length === 0) {
    errors.push('至少需要录入一个具名落点。');
  }
  // 名称仅作展示标签：允许重名（两个落点都会保留并分别换算），只拒绝空名称。
  for (let i = 0; i < input.points.length; i++) {
    if (input.points[i].name.trim() === '') {
      errors.push(`第 ${i + 1} 个落点的名称为空。`);
    }
  }

  const d = sub(input.B, input.A);
  const dp = sub(input.Bp, input.Ap);
  const dLen2 = d.x * d.x + d.y * d.y;
  const dpLen2 = dp.x * dp.x + dp.y * dp.y;

  if (!(dLen2 > 0)) {
    errors.push('设计侧两个基准点 A、B 重合，无法确定方向与缩放。');
  }
  if (!(dpLen2 > 0)) {
    errors.push('现场侧两个基准点 A′、B′ 重合，无法确定方向与缩放。');
  }
  if (errors.length > 0) return { ok: false, errors };

  const dLen = Math.sqrt(dLen2);
  const dpLen = Math.sqrt(dpLen2);
  const scale = dpLen / dLen;

  if (!Number.isFinite(scale) || scale <= 0) {
    errors.push(`缩放率必须为有限正数，当前为 ${String(scale)}。`);
    return { ok: false, errors };
  }
  if (!displaySafe(scale, SCALE_FACTOR)) {
    errors.push(
      `缩放率 ${String(scale)} 过大，超出数值范围（无法安全展示），请缩小基准长度之比。`,
    );
    return { ok: false, errors };
  }

  // 两条有向基准向量的 atan2 角差，逆时针为正
  const theta = normalizeAngle(Math.atan2(dp.y, dp.x) - Math.atan2(d.y, d.x));
  const thetaDeg = (theta * 180) / Math.PI;
  if (!Number.isFinite(theta)) {
    errors.push('旋转角计算结果不是有限数。');
    return { ok: false, errors };
  }

  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  const forward = (p: Point): Point => {
    const v = sub(p, input.A);
    return {
      x: input.Ap.x + scale * (cos * v.x - sin * v.y),
      y: input.Ap.y + scale * (sin * v.x + cos * v.y),
    };
  };

  const reverse = (q: Point): Point => {
    const w = sub(q, input.Ap);
    // s·R 的逆：(1/s)·R(−θ)
    return {
      x: input.A.x + (cos * w.x + sin * w.y) / scale,
      y: input.A.y + (-sin * w.x + cos * w.y) / scale,
    };
  };

  // 仿射形式 q = s R p + t 的平移分量，仅用于展示复核
  const fA = forward(input.A);
  const tx = fA.x - scale * (cos * input.A.x - sin * input.A.y);
  const ty = fA.y - scale * (sin * input.A.x + cos * input.A.y);
  if (![tx, ty].every((v) => displaySafe(v, MM_FACTOR))) {
    errors.push('基准点坐标过大，平移量超出数值范围，请缩小输入量级。');
    return { ok: false, errors };
  }

  // 基准点本身（期望值列）也要能按毫米展示
  if (
    ![input.Ap.x, input.Ap.y, input.Bp.x, input.Bp.y].every((v) =>
      displaySafe(v, MM_FACTOR),
    )
  ) {
    errors.push('现场基准点坐标过大，超出数值范围，请缩小输入量级。');
    return { ok: false, errors };
  }

  const checkA = forward(input.A);
  const checkB = forward(input.B);
  const baseChecks: BaseCheck[] = [
    {
      label: 'A → A′',
      expected: input.Ap,
      actual: checkA,
      residual: distance(input.Ap, checkA),
    },
    {
      label: 'B → B′',
      expected: input.Bp,
      actual: checkB,
      residual: distance(input.Bp, checkB),
    },
  ];
  for (const c of baseChecks) {
    if (
      !displaySafe(c.actual.x, MM_FACTOR) ||
      !displaySafe(c.actual.y, MM_FACTOR) ||
      !displaySafe(c.residual, TOLERANCE_FACTOR)
    ) {
      errors.push(
        `基准复核「${c.label}」超出数值范围，请缩小基准点坐标量级。`,
      );
    }
  }

  const rows: NamedResultRow[] = [];
  for (let i = 0; i < input.points.length; i++) {
    const p = input.points[i];
    const site = forward(p);
    const back = reverse(site);
    const residual = distance(p, back);
    const label = p.name.trim() || `第 ${i + 1} 个`;
    // 设计/现场/反算坐标按毫米展示（×100），闭合差按高精度展示（×10⁹）
    if (
      !displaySafe(p.x, MM_FACTOR) ||
      !displaySafe(p.y, MM_FACTOR)
    ) {
      errors.push(
        `落点「${label}」的设计坐标过大，超出数值范围，请缩小输入量级。`,
      );
      continue;
    }
    if (
      !displaySafe(site.x, MM_FACTOR) ||
      !displaySafe(site.y, MM_FACTOR) ||
      !displaySafe(back.x, MM_FACTOR) ||
      !displaySafe(back.y, MM_FACTOR) ||
      !displaySafe(residual, TOLERANCE_FACTOR)
    ) {
      errors.push(
        `落点「${label}」坐标过大，现场坐标或复核量超出数值范围，请缩小输入量级。`,
      );
      // 继续遍历以便一次性列出所有越界落点，但最终整批拒绝
      continue;
    }
    rows.push({
      name: p.name.trim(),
      design: { x: p.x, y: p.y },
      site,
      back,
      residual,
    });
  }
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: { scale, theta, thetaDeg, tx, ty, rows, baseChecks },
  };
}
