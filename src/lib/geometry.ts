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

/* ------------------------------------------------------------------ */
/* 现场复测核对                                                         */
/* ------------------------------------------------------------------ */

/**
 * 复测行状态：
 * - unentered：x/y 均为空，未录入，不影响换算与其他行；
 * - invalid：只填一个坐标、非有限数、超出数值范围，或容差无效；
 * - pass / fail：成对有限录入后，按【全精度】直线偏差与允许偏差比较。
 */
export type SurveyRowStatus = 'unentered' | 'invalid' | 'pass' | 'fail';

export interface SurveyRowResult {
  /** 与落点行的内部标识对应（绝不按同名落点名称关联） */
  id: number;
  status: SurveyRowStatus;
  /** 行级原因说明（显示在对应控件附近） */
  reason?: string;
  /** 哪些复测输入框非法（用于标红对应控件） */
  xInvalid?: boolean;
  yInvalid?: boolean;
  /** 现场复测坐标（成对有限录入时存在） */
  measured?: Point;
  /** 换算产生的全精度期望现场坐标 */
  expected?: Point;
  /** 纵向差（毫米）：沿现场基准 A′→B′ 方向为正 */
  longitudinal?: number;
  /** 横向差（毫米）：沿 A′→B′ 逆时针旋转 90° 方向为正（线路左侧） */
  lateral?: number;
  /** 直线偏差（毫米）：实测点与全精度期望现场点的距离 */
  linear?: number;
}

export type SurveyToleranceState =
  | { ok: true; value: number }
  | { ok: false; empty: boolean; reason: string };

/** 解析允许偏差原始文本：空白 / 非有限数 / 负数 均为非法。 */
export function validateTolerance(raw: string): SurveyToleranceState {
  const r = parseFinite(raw);
  if (!r.ok) {
    return r.empty
      ? {
          ok: false,
          empty: true,
          reason: '请填写全局允许偏差（非负毫米数），否则暂不判定。',
        }
      : {
          ok: false,
          empty: false,
          reason: `允许偏差 “${raw.trim()}” 不是有限数。`,
        };
  }
  if (r.value < 0) {
    return { ok: false, empty: false, reason: '允许偏差不能为负数。' };
  }
  // 允许偏差按毫米两位小数展示（×100），溢出则无法安全展示
  if (!Number.isFinite(r.value * MM_FACTOR)) {
    return {
      ok: false,
      empty: false,
      reason: '允许偏差过大，超出数值范围。',
    };
  }
  return { ok: true, value: r.value };
}

export interface SurveyRowInput {
  id: number;
  rawX: string;
  rawY: string;
}

export interface EvaluateSurveysInput {
  /**
   * 现场基准有向向量 d′ = B′ − A′，仅取其方向分解横向/纵向差
   * （换算成功时长度必然大于 0）。
   */
  siteDirection: Point;
  /** 按内部标识对齐的全精度期望现场坐标 */
  expectedById: Map<number, Point>;
  toleranceRaw: string;
  rows: SurveyRowInput[];
}

export interface EvaluateSurveysResult {
  tolerance: SurveyToleranceState;
  rows: SurveyRowResult[];
}

/**
 * 逐行核对此前已成功的相似变换结果与现场复测坐标。
 *
 * 横向差/纵向差/直线偏差全部用相似变换产生的【全精度】现场坐标计算，
 * 不经过任何展示舍入；合格判定为 直线偏差 ≤ 允许偏差（边界合格）。
 * 本函数不参与落点换算：任何复测输入问题都不会改动换算结果或基准复核。
 */
export function evaluateSurveys(
  input: EvaluateSurveysInput,
): EvaluateSurveysResult {
  const tolerance = validateTolerance(input.toleranceRaw);
  const dirLen = Math.hypot(input.siteDirection.x, input.siteDirection.y);

  const rows: SurveyRowResult[] = input.rows.map((r) => {
    const px = parseFinite(r.rawX);
    const py = parseFinite(r.rawY);
    const xEmpty = !px.ok && px.empty;
    const yEmpty = !py.ok && py.empty;

    // 两个坐标都为空：未录入，不影响任何其他逻辑
    if (xEmpty && yEmpty) return { id: r.id, status: 'unentered' };

    const problems: string[] = [];
    let xInvalid = false;
    let yInvalid = false;
    if (xEmpty) {
      xInvalid = true;
      problems.push('复测 x 为空：现场复测坐标需与 y 成对录入。');
    }
    if (yEmpty) {
      yInvalid = true;
      problems.push('复测 y 为空：现场复测坐标需与 x 成对录入。');
    }
    if (!px.ok && !px.empty) {
      xInvalid = true;
      problems.push(`复测 x “${r.rawX.trim()}” 不是有限数。`);
    }
    if (!py.ok && !py.empty) {
      yInvalid = true;
      problems.push(`复测 y “${r.rawY.trim()}” 不是有限数。`);
    }
    if (problems.length > 0) {
      return {
        id: r.id,
        status: 'invalid',
        reason: problems.join(''),
        xInvalid,
        yInvalid,
      };
    }

    const measured: Point = {
      x: px.ok ? px.value : NaN,
      y: py.ok ? py.value : NaN,
    };
    // 复测坐标本身需能按毫米两位小数展示
    if (
      !displaySafe(measured.x, MM_FACTOR) ||
      !displaySafe(measured.y, MM_FACTOR)
    ) {
      return {
        id: r.id,
        status: 'invalid',
        xInvalid,
        yInvalid,
        reason: '复测坐标过大，超出数值范围，无法核对。',
      };
    }

    const expected = input.expectedById.get(r.id);
    if (!expected) return { id: r.id, status: 'unentered' };

    // 允许偏差无效时，成对录入的行无法判定（未录入行仍保持未录入）
    if (!tolerance.ok) {
      return {
        id: r.id,
        status: 'invalid',
        measured,
        expected,
        reason: '允许偏差未设置为有效的非负数值，暂无法核对。',
      };
    }
    if (!(dirLen > 0)) {
      return {
        id: r.id,
        status: 'invalid',
        measured,
        expected,
        reason: '现场基准方向无效，无法分解横向/纵向差。',
      };
    }

    // 全精度差值：切勿先把 expected 舍入到 0.01 mm 再比较
    const dx = measured.x - expected.x;
    const dy = measured.y - expected.y;

    const ux = input.siteDirection.x / dirLen; // 纵向单位向量（A′→B′）
    const uy = input.siteDirection.y / dirLen;
    const longitudinal = dx * ux + dy * uy;
    // 纵向方向逆时针转 90°：(ux,uy) -> (-uy,ux)，即线路左侧为正
    const lateral = dx * -uy + dy * ux;
    const linear = Math.hypot(dx, dy);

    // 分量有限不代表合成量可展示：斜向时纵向差/直线偏差可达分量的 √2 倍。
    // 若合成量放大到展示精度（×100）溢出，就不能给出带空缺的合格/超差结论，
    // 整行按输入无效处理（绝不输出 Infinity/空缺占位的偏差）。
    if (
      !displaySafe(dx, MM_FACTOR) ||
      !displaySafe(dy, MM_FACTOR) ||
      !displaySafe(longitudinal, MM_FACTOR) ||
      !displaySafe(lateral, MM_FACTOR) ||
      !displaySafe(linear, MM_FACTOR)
    ) {
      return {
        id: r.id,
        status: 'invalid',
        measured,
        expected,
        reason: '复测偏差过大，超出数值范围，无法核对。',
      };
    }

    return {
      id: r.id,
      // 恰好位于边界也判合格
      status: linear <= tolerance.value ? 'pass' : 'fail',
      measured,
      expected,
      longitudinal,
      lateral,
      linear,
    };
  });

  return { tolerance, rows };
}
