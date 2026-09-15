/**
 * 二维相似变换核心库。
 *
 * 坐标系：x 向右、y 向上；逆时针角为正。
 * 仅允许 平移 + 统一缩放 + 旋转，不允许非等比拉伸或镜像。
 * 内部计算一律使用 number 完整精度，舍入只发生在展示层（format.ts）。
 *
 * 校准模式：
 * - 双点校准（solveSimilarity）：仅由 A/A′、B/B′ 确定唯一相似变换；
 * - 稳健校准（solveSimilarityRobust）：在 A、B 之外补录 C、D 与异常阈值，
 *   枚举四点中全部两点组合作为候选，以全精度残差划入共识集，
 *   按「共识点最多 → 集内平方残差和最小 → 候选索引字典序」选出唯一候选，
 *   胜出共识至少含三点，再以质心化闭式最小二乘重估平移、正缩放与旋转，
 *   落点换算与复测期望坐标一律消费重估后的模型。
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

/**
 * 稳健校准输入：补录的第三、第四对基准与共识异常阈值（毫米，非负）。
 * 残差以全精度现场距离计，小于等于阈值才进入共识集。
 */
export interface RobustTransformInput extends TransformInput {
  C: Point;
  D: Point;
  Cp: Point;
  Dp: Point;
  /** 异常阈值（毫米，非负有限数） */
  threshold: number;
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
  /** 是否属于胜出共识集（双点校准时恒为 true） */
  adopted: boolean;
}

/** 稳健校准的决策留痕（仅稳健校准时存在）。 */
export interface RobustInfo {
  /** 实际生效的异常阈值（毫米） */
  threshold: number;
  /** 胜出共识集内的基准点名，按 A、B、C、D 排列，如 ['B','C','D'] */
  consensus: string[];
  /** 被剔除的基准点名，按 A、B、C、D 排列，如 ['A'] */
  rejected: string[];
  /** 胜出候选的枚举索引（0=AB,1=AC,2=AD,3=BC,4=BD,5=CD） */
  candidateIndex: number;
  /** 胜出共识集内的平方残差和（全精度） */
  sse: number;
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
  /**
   * 基准复核行：双点校准时为 A、B 两行；稳健校准时为 A、B、C、D 四行，
   * 按胜出共识集标记 adopted（采用/剔除）。
   */
  baseChecks: BaseCheck[];
  /** 仅稳健校准时存在：候选枚举、共识与决胜留痕 */
  robust?: RobustInfo;
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

/* ------------------------------------------------------------------ */
/* 相似变换模型（质心表示，闭式重估与两点求解共用）                      */
/* ------------------------------------------------------------------ */

/**
 * 统一以质心形式表示 q = q̄ + s·R(θ)·(p − p̄)。
 * 两点求解时质心退化为候选起点对 (p0, p0′)；闭式重估时为共识质心。
 */
interface SimilarityModel {
  scale: number;
  theta: number;
  cos: number;
  sin: number;
  pBar: Point;
  qBar: Point;
}

function modelForward(m: SimilarityModel, p: Point): Point {
  const vx = p.x - m.pBar.x;
  const vy = p.y - m.pBar.y;
  return {
    x: m.qBar.x + m.scale * (m.cos * vx - m.sin * vy),
    y: m.qBar.y + m.scale * (m.sin * vx + m.cos * vy),
  };
}

function modelReverse(m: SimilarityModel, q: Point): Point {
  const wx = q.x - m.qBar.x;
  const wy = q.y - m.qBar.y;
  // s·R 的逆：(1/s)·R(−θ)
  return {
    x: m.pBar.x + (m.cos * wx + m.sin * wy) / m.scale,
    y: m.pBar.y + (-m.sin * wx + m.cos * wy) / m.scale,
  };
}

/**
 * 由一对设计点 (p0,p1) 与对应现场点 (q0,q1) 构造候选相似变换。
 * 任一侧两点重合（或缩放率非有限正数）时该候选不可用，返回 null。
 */
function pairModel(p0: Point, p1: Point, q0: Point, q1: Point): SimilarityModel | null {
  const d = sub(p1, p0);
  const dp = sub(q1, q0);
  const dLen2 = d.x * d.x + d.y * d.y;
  const dpLen2 = dp.x * dp.x + dp.y * dp.y;
  if (!(dLen2 > 0) || !(dpLen2 > 0)) return null;
  const scale = Math.sqrt(dpLen2) / Math.sqrt(dLen2);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const theta = normalizeAngle(
    Math.atan2(dp.y, dp.x) - Math.atan2(d.y, d.x),
  );
  if (!Number.isFinite(theta)) return null;
  return {
    scale,
    theta,
    cos: Math.cos(theta),
    sin: Math.sin(theta),
    pBar: p0,
    qBar: q0,
  };
}

interface BaseDescriptor {
  /** 基准点名（A/B/C/D），用于复核行标签与共识标记 */
  key: string;
  design: Point;
  site: Point;
}

/**
 * 由一个已确定的模型装配完整结果：统一缩放率/旋转角/平移量、基准复核、
 * 落点换算与反算复核；沿用既有“可计算且可展示，否则整批拒绝”的规则。
 */
function assembleResult(
  model: SimilarityModel,
  bases: BaseDescriptor[],
  points: NamedPoint[],
  robust: RobustInfo | undefined,
  adoptedSet: Set<string> | undefined,
): SolveOutcome {
  const errors: string[] = [];

  if (!displaySafe(model.scale, SCALE_FACTOR)) {
    errors.push(
      `缩放率 ${String(model.scale)} 过大，超出数值范围（无法安全展示），请缩小基准长度之比。`,
    );
    return { ok: false, errors };
  }
  if (!Number.isFinite(model.theta)) {
    errors.push('旋转角计算结果不是有限数。');
    return { ok: false, errors };
  }

  // 仿射形式 q = s R p + t 的平移分量（仅用于展示复核）
  const tx =
    model.qBar.x -
    model.scale * (model.cos * model.pBar.x - model.sin * model.pBar.y);
  const ty =
    model.qBar.y -
    model.scale * (model.sin * model.pBar.x + model.cos * model.pBar.y);
  if (![tx, ty].every((v) => displaySafe(v, MM_FACTOR))) {
    errors.push('基准点坐标过大，平移量超出数值范围，请缩小输入量级。');
    return { ok: false, errors };
  }

  const baseChecks: BaseCheck[] = bases.map((b) => {
    const actual = modelForward(model, b.design);
    return {
      label: `${b.key} → ${b.key}′`,
      expected: b.site,
      actual,
      residual: distance(b.site, actual),
      adopted: adoptedSet ? adoptedSet.has(b.key) : true,
    };
  });

  // 基准录入现场点本身、模型映射点与闭合差都必须能安全展示
  for (const c of baseChecks) {
    if (
      !displaySafe(c.expected.x, MM_FACTOR) ||
      !displaySafe(c.expected.y, MM_FACTOR)
    ) {
      errors.push(`现场基准点 ${c.label} 坐标过大，超出数值范围，请缩小输入量级。`);
      continue;
    }
    if (
      !displaySafe(c.actual.x, MM_FACTOR) ||
      !displaySafe(c.actual.y, MM_FACTOR) ||
      !displaySafe(c.residual, TOLERANCE_FACTOR)
    ) {
      errors.push(`基准复核「${c.label}」超出数值范围，请缩小基准点坐标量级。`);
    }
  }

  const rows: NamedResultRow[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const site = modelForward(model, p);
    const back = modelReverse(model, site);
    const residual = distance(p, back);
    const label = p.name.trim() || `第 ${i + 1} 个`;
    // 设计/现场/反算坐标按毫米展示（×100），闭合差按高精度展示（×10⁹）
    if (!displaySafe(p.x, MM_FACTOR) || !displaySafe(p.y, MM_FACTOR)) {
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
    value: {
      scale: model.scale,
      theta: model.theta,
      thetaDeg: (model.theta * 180) / Math.PI,
      tx,
      ty,
      rows,
      baseChecks,
      robust,
    },
  };
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

  const model = pairModel(input.A, input.B, input.Ap, input.Bp);
  if (!model) {
    if (dLen2 > 0 && dpLen2 > 0) {
      const scale = Math.sqrt(dpLen2) / Math.sqrt(dLen2);
      if (!Number.isFinite(scale) || scale <= 0) {
        errors.push(`缩放率必须为有限正数，当前为 ${String(scale)}。`);
      }
    }
    if (errors.length === 0) {
      errors.push(`缩放率必须为有限正数。`);
    }
    return { ok: false, errors };
  }

  return assembleResult(
    model,
    [
      { key: 'A', design: input.A, site: input.Ap },
      { key: 'B', design: input.B, site: input.Bp },
    ],
    input.points,
    undefined,
    undefined,
  );
}

/* ------------------------------------------------------------------ */
/* 稳健校准：四点候选枚举 + 共识决胜 + 闭式最小二乘重估                 */
/* ------------------------------------------------------------------ */

/**
 * 候选两点组合的枚举顺序，即“候选索引字典序”决胜依据：
 * 0=AB, 1=AC, 2=AD, 3=BC, 4=BD, 5=CD。
 */
const CANDIDATE_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 2],
  [1, 3],
  [2, 3],
];

const ROBUST_KEYS = ['A', 'B', 'C', 'D'] as const;

/** 候选索引对应的两点组合名称（0=AB … 5=CD），用于结果留痕展示。 */
const CANDIDATE_PAIR_NAMES = ['AB', 'AC', 'AD', 'BC', 'BD', 'CD'] as const;

export function robustCandidatePairName(index: number): string {
  return CANDIDATE_PAIR_NAMES[index] ?? `候选 ${index}`;
}

interface Candidate {
  index: number;
  model: SimilarityModel;
  /** 共识集基准点在四点数组中的下标（残差全精度且 ≤ 阈值） */
  consensus: number[];
  /** 四个基准点在该候选模型下的全精度残差 */
  residuals: number[];
  /** 共识集内平方残差和 */
  sse: number;
}

/**
 * 由共识点以质心化点积/叉积闭式最小二乘重估
 * 平移、正缩放与旋转：
 *
 * 质心 p̄、q̄；x_i = p_i − p̄，u_i = q_i − q̄（二维记 x=(x,y), u=(u,v)）。
 *   a = Σ(x·u + y·v) / Σ(x² + y²)
 *   b = Σ(x·v − y·u) / Σ(x² + y²)
 *   s = hypot(a,b)（恒正，不镜像），cos = a/s，sin = b/s
 *   θ = atan2(b, a)，t = q̄ − s·R(θ)·p̄
 *
 * 分母为零或任何一步溢出为 Infinity/NaN 时返回对应失败原因。
 */
function refitModel(pairs: { design: Point; site: Point }[]):
  | { ok: true; model: SimilarityModel }
  | { ok: false; reason: 'denom' | 'overflow' } {
  const n = pairs.length;
  let sx = 0;
  let sy = 0;
  let su = 0;
  let sv = 0;
  for (const p of pairs) {
    sx += p.design.x;
    sy += p.design.y;
    su += p.site.x;
    sv += p.site.y;
  }
  const pBar = { x: sx / n, y: sy / n };
  const qBar = { x: su / n, y: sv / n };
  if (
    !Number.isFinite(pBar.x) ||
    !Number.isFinite(pBar.y) ||
    !Number.isFinite(qBar.x) ||
    !Number.isFinite(qBar.y)
  ) {
    return { ok: false, reason: 'overflow' };
  }

  let denom = 0;
  let aNum = 0;
  let bNum = 0;
  for (const p of pairs) {
    const x = p.design.x - pBar.x;
    const y = p.design.y - pBar.y;
    const u = p.site.x - qBar.x;
    const v = p.site.y - qBar.y;
    denom += x * x + y * y;
    aNum += x * u + y * v;
    bNum += x * v - y * u;
  }
  if (!Number.isFinite(denom) || !Number.isFinite(aNum) || !Number.isFinite(bNum)) {
    return { ok: false, reason: 'overflow' };
  }
  // 共识含至少三点且候选两点不重合，正常必为正；为零属防御性失败分支。
  if (!(denom > 0)) {
    return { ok: false, reason: 'denom' };
  }
  const a = aNum / denom;
  const b = bNum / denom;
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return { ok: false, reason: 'overflow' };
  }
  const scale = Math.hypot(a, b);
  if (!Number.isFinite(scale) || !(scale > 0)) {
    return { ok: false, reason: 'overflow' };
  }
  const cos = a / scale;
  const sin = b / scale;
  const theta = normalizeAngle(Math.atan2(b, a));
  if (!Number.isFinite(theta)) {
    return { ok: false, reason: 'overflow' };
  }
  return { ok: true, model: { scale, theta, cos, sin, pBar, qBar } };
}

/**
 * 四点稳健校准：
 * 1. 枚举 C(4,2)=6 个“设计侧与现场侧均不重合”的两点候选相似变换；
 * 2. 每个候选把四个基准全部换一遍，全精度残差 ≤ 阈值者进入共识集；
 * 3. 依次按 共识点最多 → 集内平方残差和最小 → 候选索引字典序 选唯一候选；
 * 4. 胜出共识至少含三点，再做质心化闭式最小二乘重估；
 * 5. 落点换算、基准复核、复测期望坐标一律消费重估模型，
 *    基准复核按胜出共识集标记采用/剔除。
 */
export function solveSimilarityRobust(input: RobustTransformInput): SolveOutcome {
  const errors: string[] = [];

  if (input.points.length === 0) {
    errors.push('至少需要录入一个具名落点。');
  }
  for (let i = 0; i < input.points.length; i++) {
    if (input.points[i].name.trim() === '') {
      errors.push(`第 ${i + 1} 个落点的名称为空。`);
    }
  }

  const all: BaseDescriptor[] = [
    { key: 'A', design: input.A, site: input.Ap },
    { key: 'B', design: input.B, site: input.Bp },
    { key: 'C', design: input.C, site: input.Cp },
    { key: 'D', design: input.D, site: input.Dp },
  ];
  for (const b of all) {
    if (!Number.isFinite(b.design.x) || !Number.isFinite(b.design.y)) {
      errors.push(`设计侧基准点 ${b.key} 坐标必须为有限数。`);
    }
    if (!Number.isFinite(b.site.x) || !Number.isFinite(b.site.y)) {
      errors.push(`现场侧基准点 ${b.key}′ 坐标必须为有限数。`);
    }
  }
  if (!Number.isFinite(input.threshold) || input.threshold < 0) {
    errors.push('稳健校准的异常阈值必须为非负有限毫米数。');
  }
  if (errors.length > 0) return { ok: false, errors };

  // 枚举候选
  const candidates: Candidate[] = [];
  for (let ci = 0; ci < CANDIDATE_PAIRS.length; ci++) {
    const [i, j] = CANDIDATE_PAIRS[ci];
    const model = pairModel(
      all[i].design,
      all[j].design,
      all[i].site,
      all[j].site,
    );
    if (!model) continue; // 设计侧或现场侧重合：该候选不可用
    const residuals = all.map((b) =>
      distance(b.site, modelForward(model, b.design)),
    );
    const consensus: number[] = [];
    let sse = 0;
    for (let k = 0; k < residuals.length; k++) {
      const r = residuals[k];
      // 残差非有限（中间结果溢出）不可能落入共识；比较为 false。
      if (Number.isFinite(r) && r <= input.threshold) {
        consensus.push(k);
        sse += r * r;
      }
    }
    if (!Number.isFinite(sse)) sse = Number.POSITIVE_INFINITY;
    candidates.push({ index: ci, model, consensus, residuals, sse });
  }

  if (candidates.length === 0) {
    errors.push(
      '稳健校准失败：可用候选不足——四点中任意两点组合都在设计侧或现场侧重合，无法构成相似变换。',
    );
    return { ok: false, errors };
  }

  // 决胜：共识点最多；集内平方残差和最小；候选索引字典序（枚举靠前者保留）。
  // 枚举本身按索引升序，故同分时只在 SSE 严格更小时替换，即天然保留字典序最小者。
  let best = candidates[0];
  for (let ci = 1; ci < candidates.length; ci++) {
    const c = candidates[ci];
    if (c.consensus.length > best.consensus.length) {
      best = c;
    } else if (c.consensus.length === best.consensus.length && c.sse < best.sse) {
      best = c;
    }
  }

  if (best.consensus.length < 3) {
    errors.push(
      `稳健校准失败：最佳共识集仅含 ${best.consensus.length} 个可信基准点（至少需要 3 个），` +
        '请放宽异常阈值或复核 C、D 补录坐标；本次未生成换算结果。',
    );
    return { ok: false, errors };
  }

  const refit = refitModel(
    best.consensus.map((k) => ({ design: all[k].design, site: all[k].site })),
  );
  if (!refit.ok) {
    if (refit.reason === 'denom') {
      errors.push(
        '稳健校准失败：共识基准点质心化闭式解的分母为零，无法重估缩放与旋转。',
      );
    } else {
      errors.push(
        '稳健校准失败：可信基准重估时超出数值范围（缩放、旋转或平移溢出），请缩小坐标量级。',
      );
    }
    return { ok: false, errors };
  }

  const consensusKeys = best.consensus.map((k) => ROBUST_KEYS[k]);
  const adoptedSet = new Set(consensusKeys);
  const rejectedKeys = ROBUST_KEYS.filter((k) => !adoptedSet.has(k));
  const info: RobustInfo = {
    threshold: input.threshold,
    consensus: consensusKeys.map(String),
    rejected: rejectedKeys.map(String),
    candidateIndex: best.index,
    sse: best.sse,
  };

  const assembled = assembleResult(refit.model, all, input.points, info, adoptedSet);
  if (!assembled.ok) {
    // 重估模型在换算落点/复核量时溢出：同样清除换算结果并说明原因。
    return assembled;
  }

  // 重估后再自检一次四个基准在新模型下的闭合差有限性（assembleResult 已覆盖展示安全，
  // 这里仅防御非有限的残差比较），理论不可达。
  for (const c of assembled.value.baseChecks) {
    if (!Number.isFinite(c.residual)) {
      return {
        ok: false,
        errors: ['稳健校准失败：重估模型的基准闭合差不是有限数，超出数值范围。'],
      };
    }
  }
  return assembled;
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
