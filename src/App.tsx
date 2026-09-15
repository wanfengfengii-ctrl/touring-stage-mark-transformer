import { Fragment, useMemo, useRef, useState } from 'react';
import {
  evaluateSurveys,
  parseFinite,
  robustCandidatePairName,
  solveSimilarity,
  solveSimilarityRobust,
  type EvaluateSurveysResult,
  type NamedPoint,
  type SimilarityResult,
  type SurveyRowResult,
} from './lib/geometry';
import {
  formatDegrees,
  formatMm,
  formatPercent,
  formatScale,
  formatSignedMm,
  formatTolerance,
  roundHalfAway,
} from './lib/format';

type BaseKey =
  | 'ax'
  | 'ay'
  | 'bx'
  | 'by'
  | 'apx'
  | 'apy'
  | 'bpx'
  | 'bpy';

type BaseState = Record<BaseKey, string>;

/** 稳健校准补录字段：设计侧 C、D，现场侧 C′、D′，以及异常阈值。 */
type RobustKey =
  | 'cx'
  | 'cy'
  | 'dx'
  | 'dy'
  | 'cpx'
  | 'cpy'
  | 'dpx'
  | 'dpy';

type RobustState = Record<RobustKey, string>;

interface RawNamed {
  id: number;
  name: string;
  x: string;
  y: string;
  /** 现场复测坐标（按内部 id 挂接；行删除后随之消失，绝不串到同名其他行） */
  sx: string;
  sy: string;
}

const EMPTY_BASE: BaseState = {
  ax: '',
  ay: '',
  bx: '',
  by: '',
  apx: '',
  apy: '',
  bpx: '',
  bpy: '',
};

const EMPTY_ROBUST: RobustState = {
  cx: '',
  cy: '',
  dx: '',
  dy: '',
  cpx: '',
  cpy: '',
  dpx: '',
  dpy: '',
};

let nextPointId = 3;

const INITIAL_POINTS: RawNamed[] = [
  { id: 1, name: '落点 1', x: '', y: '', sx: '', sy: '' },
  { id: 2, name: '落点 2', x: '', y: '', sx: '', sy: '' },
];

interface FieldProps {
  id: string;
  label: string;
  value: string;
  invalid?: boolean;
  ariaLabel?: string;
  hint?: string;
  onChange: (value: string) => void;
}

function NumberField({ id, label, value, invalid, ariaLabel, hint, onChange }: FieldProps) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        spellCheck={false}
        autoComplete="off"
        placeholder={hint}
        value={value}
        aria-label={ariaLabel ?? label}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

interface BaseBlockProps {
  title: string;
  prefix: string;
  keys: [string, string];
  values: Record<string, string>;
  invalid: Set<string>;
  onChange: (key: string, value: string) => void;
}

function BaseBlock({ title, prefix, keys, values, invalid, onChange }: BaseBlockProps) {
  const [kx, ky] = keys;
  return (
    <fieldset className="card base-block">
      <legend>{title}</legend>
      <div className="field-row">
        <NumberField
          id={`${prefix}-x`}
          label="x (mm)"
          value={values[kx]}
          invalid={invalid.has(kx)}
          ariaLabel={`${title} · x（毫米）`}
          onChange={(v) => onChange(kx, v)}
        />
        <NumberField
          id={`${prefix}-y`}
          label="y (mm)"
          value={values[ky]}
          invalid={invalid.has(ky)}
          ariaLabel={`${title} · y（毫米）`}
          onChange={(v) => onChange(ky, v)}
        />
      </div>
    </fieldset>
  );
}

/** 平方残差和（mm²）的高精度展示：不附加单位。 */
function formatSse(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  if (Math.abs(value) < 1e-6) return value.toExponential(3);
  const rounded = roundHalfAway(value, 9);
  return Number.isFinite(rounded) ? rounded.toFixed(9) : '—';
}

function ResultPanel({ result }: { result: SimilarityResult }) {
  return (
    <section className="results" aria-label="换算结果">
      <h2>换算结果</h2>

      {result.robust && (
        <div className="robust-banner" data-testid="robust-banner">
          <strong>稳健校准已启用</strong>：异常阈值 {formatMm(result.robust.threshold)} mm；
          共识集含 {result.robust.consensus.length} 个可信基准（
          {result.robust.consensus.join('、')}），
          {result.robust.rejected.length > 0
            ? <>剔除 {result.robust.rejected.join('、')}</>
            : <>无基准被剔除</>}
          ；胜出候选 {robustCandidatePairName(result.robust.candidateIndex)}（枚举序号{' '}
          {result.robust.candidateIndex}），共识集平方残差和 {formatSse(result.robust.sse)}{' '}
          mm²。以下缩放率、旋转角、全部落点现场坐标与复测期望坐标均按重估模型计算。
        </div>
      )}

      <div className="summary">
        <div className="stat">
          <span className="stat-label">统一缩放率</span>
          <span className="stat-value">{formatScale(result.scale)}</span>
          <span className="stat-sub">{formatPercent(result.scale)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">旋转角（逆时针为正）</span>
          <span className="stat-value">{formatDegrees(result.thetaDeg)}</span>
          <span className="stat-sub">范围 (−180°, 180°]</span>
        </div>
        <div className="stat">
          <span className="stat-label">平移量</span>
          <span className="stat-value">
            ({formatMm(result.tx)}, {formatMm(result.ty)})
          </span>
          <span className="stat-sub">毫米</span>
        </div>
      </div>

      <h3>基准复核</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th>有向基准</th>
            <th>期望现场坐标 (mm)</th>
            <th>实际映射坐标 (mm)</th>
            <th>闭合差 (mm)</th>
            {result.robust && <th>校准判定</th>}
          </tr>
        </thead>
        <tbody>
          {result.baseChecks.map((c) => (
            <tr
              key={c.label}
              className={c.adopted ? undefined : 'base-rejected'}
              data-testid="base-check-row"
              data-adopted={c.adopted ? 'adopted' : 'rejected'}
            >
              <td>{c.label}</td>
              <td>
                ({formatMm(c.expected.x)}, {formatMm(c.expected.y)})
              </td>
              <td>
                ({formatMm(c.actual.x)}, {formatMm(c.actual.y)})
              </td>
              <td>{formatTolerance(c.residual)}</td>
              {result.robust && (
                <td>
                  <span
                    className={`base-adopt base-adopt--${c.adopted ? 'adopted' : 'rejected'}`}
                    data-testid="base-adoption"
                  >
                    {c.adopted ? '采用' : '剔除'}
                  </span>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      <h3>具名落点现场坐标</h3>
      <table className="data-table" data-testid="result-table">
        <thead>
          <tr>
            <th>名称</th>
            <th>设计 x (mm)</th>
            <th>设计 y (mm)</th>
            <th>现场 x (mm)</th>
            <th>现场 y (mm)</th>
            <th>反算设计 (mm)</th>
            <th>闭合差 (mm)</th>
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, i) => (
            <tr key={i}>
              <td>{row.name}</td>
              <td>{formatMm(row.design.x)}</td>
              <td>{formatMm(row.design.y)}</td>
              <td className="site-coord">{formatMm(row.site.x)}</td>
              <td className="site-coord">{formatMm(row.site.y)}</td>
              <td>
                ({formatMm(row.back.x)}, {formatMm(row.back.y)})
              </td>
              <td>{formatTolerance(row.residual)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">
        全部内部计算保留完整精度；现场坐标按“恰好半个最小单位时向绝对值增大方向取整”展示到
        0.01 mm；闭合差为现场坐标反算回设计侧后与原设计点的距离。
      </p>
    </section>
  );
}

const STATUS_TEXT: Record<SurveyRowResult['status'], string> = {
  unentered: '未录入',
  invalid: '输入无效',
  pass: '合格',
  fail: '超差',
};

interface SurveyPanelProps {
  points: RawNamed[];
  expectedById: Map<number, { x: number; y: number }>;
  survey: EvaluateSurveysResult | null;
  toleranceRaw: string;
  /**
   * 换算当前失败但此前成功过：复测录入全部保留可见，偏差/状态暂不计算，
   * 待基准修正后按原行即时恢复核对。
   */
  suspended?: boolean;
  onToleranceChange: (value: string) => void;
  onSurveyChange: (id: number, key: 'sx' | 'sy', value: string) => void;
}

function SurveyPanel({
  points,
  expectedById,
  survey,
  toleranceRaw,
  suspended,
  onToleranceChange,
  onSurveyChange,
}: SurveyPanelProps) {
  const surveyById = survey
    ? new Map(survey.rows.map((r) => [r.id, r]))
    : new Map<number, SurveyRowResult>();
  const anyEntered = points.some((p) => p.sx.trim() !== '' || p.sy.trim() !== '');
  // 容差为空是未启用复测时的默认态（不打扰）；一旦录入了复测坐标，
  // 或用户显式填了非有限/负数值，则在控件附近说明原因。
  // 换算挂起期间不重复提示容差问题（错误面板已说明换算失败原因）。
  const toleranceProblem =
    !suspended &&
    survey !== null &&
    !survey.tolerance.ok &&
    (!survey.tolerance.empty || anyEntered);

  return (
    <section className="results survey-panel" aria-label="现场复测核对">
      <h2>现场复测核对</h2>

      <div className="tolerance-row">
        <div className="field tolerance-field">
          <label htmlFor="survey-tolerance">全局允许偏差 (mm)</label>
          <input
            id="survey-tolerance"
            data-testid="survey-tolerance"
            type="text"
            inputMode="decimal"
            spellCheck={false}
            autoComplete="off"
            placeholder="例如 5"
            value={toleranceRaw}
            aria-label="全局允许偏差（毫米）"
            aria-invalid={toleranceProblem || undefined}
            onChange={(e) => onToleranceChange(e.target.value)}
          />
          {toleranceProblem && survey && !survey.tolerance.ok && (
            <p className="field-error" role="alert" data-testid="survey-tolerance-error">
              {survey.tolerance.reason}
            </p>
          )}
        </div>
        <p className="note tolerance-note">
          为既有落点成对录入现场复测坐标后立即核对；横向差、纵向差、直线偏差与合格判定
          均由相似变换产生的全精度现场坐标计算（不使用展示舍入值），偏差展示到 0.01 mm；
          直线偏差 ≤ 允许偏差 判合格（恰好位于边界也合格）。
        </p>
      </div>

      <table className="data-table survey-table" data-testid="survey-table">
        <thead>
          <tr>
            <th>名称</th>
            <th>期望现场 x (mm)</th>
            <th>期望现场 y (mm)</th>
            <th>复测 x (mm)</th>
            <th>复测 y (mm)</th>
            <th>纵向差 (mm)</th>
            <th>横向差 (mm)</th>
            <th>直线偏差 (mm)</th>
            <th>核对状态</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => {
            const s = surveyById.get(p.id);
            // 换算挂起期间：录入保留，但期望/偏差/状态一律不计算（结果已清除）
            const status = suspended ? 'suspended' : (s?.status ?? 'unentered');
            const expected = suspended ? undefined : expectedById.get(p.id);
            const label = p.name.trim() || `第 ${i + 1} 个`;
            return (
              <Fragment key={p.id}>
                <tr className="survey-row" data-testid="survey-row" data-state={status}>
                  <td>{label}</td>
                  <td>{expected ? formatMm(expected.x) : '—'}</td>
                  <td>{expected ? formatMm(expected.y) : '—'}</td>
                  <td>
                    <input
                      id={`survey-x-${p.id}`}
                      className="survey-input"
                      type="text"
                      inputMode="decimal"
                      spellCheck={false}
                      autoComplete="off"
                      value={p.sx}
                      aria-label={`第 ${i + 1} 个落点（${label}）现场复测 x`}
                      aria-invalid={!suspended && s?.xInvalid ? true : undefined}
                      onChange={(e) => onSurveyChange(p.id, 'sx', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      id={`survey-y-${p.id}`}
                      className="survey-input"
                      type="text"
                      inputMode="decimal"
                      spellCheck={false}
                      autoComplete="off"
                      value={p.sy}
                      aria-label={`第 ${i + 1} 个落点（${label}）现场复测 y`}
                      aria-invalid={!suspended && s?.yInvalid ? true : undefined}
                      onChange={(e) => onSurveyChange(p.id, 'sy', e.target.value)}
                    />
                  </td>
                  <td className="deviation">
                    {suspended || s?.longitudinal === undefined
                      ? '—'
                      : formatSignedMm(s.longitudinal)}
                  </td>
                  <td className="deviation">
                    {suspended || s?.lateral === undefined
                      ? '—'
                      : formatSignedMm(s.lateral)}
                  </td>
                  <td className="deviation">
                    {suspended || s?.linear === undefined ? '—' : formatMm(s.linear)}
                  </td>
                  <td>
                    {suspended ? (
                      <span
                        className="survey-status survey-status--suspended"
                        data-testid="survey-status"
                        data-state="suspended"
                      >
                        暂不核对
                      </span>
                    ) : (
                      <span
                        className={`survey-status survey-status--${status}`}
                        data-testid="survey-status"
                        data-state={status}
                      >
                        {STATUS_TEXT[status as SurveyRowResult['status']]}
                      </span>
                    )}
                  </td>
                </tr>
                {!suspended && status === 'invalid' && s?.reason && (
                  <tr className="survey-reason-row" data-testid="survey-reason-row">
                    <td colSpan={9}>
                      <span className="field-error">{s.reason}</span>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {suspended && (
        <p className="note" role="status" data-testid="survey-suspended-note">
          当前稳健校准未通过，换算结果已清除；复测录入已保留，修正基准后将按行即时恢复核对。
        </p>
      )}
      <p className="note">
        纵向差沿现场基准 A′→B′ 方向为正；横向差沿该方向逆时针转 90°（线路左侧）为正。
        状态按全精度直线偏差判定：合格 ≤ 允许偏差，超出为超差；每行复测坐标均为空时为未录入。
      </p>
      {!anyEntered && (
        <p className="note" data-testid="survey-idle-note">
          尚未录入复测坐标：复测功能为可选项，不录入时不影响换算结果与基准复核。
        </p>
      )}
    </section>
  );
}

export default function App() {
  const [base, setBase] = useState<BaseState>(EMPTY_BASE);
  const [robust, setRobust] = useState<RobustState>(EMPTY_ROBUST);
  const [thresholdRaw, setThresholdRaw] = useState('');
  const [points, setPoints] = useState<RawNamed[]>(INITIAL_POINTS);
  const [dirty, setDirty] = useState(false);
  const [surveyToleranceRaw, setSurveyToleranceRaw] = useState('');

  const parsed = useMemo(() => {
    const errors: string[] = [];
    const invalid = new Set<string>();

    const readNum = (
      raw: string,
      key: string,
      label: string,
    ): number => {
      const r = parseFinite(raw);
      if (r.ok) return r.value;
      invalid.add(key);
      errors.push(
        r.empty
          ? `「${label}」为空。`
          : `「${label}」的值 “${raw.trim()}” 不是有限数。`,
      );
      return NaN;
    };

    const A = {
      x: readNum(base.ax, 'ax', '设计基准点 A · x'),
      y: readNum(base.ay, 'ay', '设计基准点 A · y'),
    };
    const B = {
      x: readNum(base.bx, 'bx', '设计基准点 B · x'),
      y: readNum(base.by, 'by', '设计基准点 B · y'),
    };
    const Ap = {
      x: readNum(base.apx, 'apx', '现场基准点 A′ · x'),
      y: readNum(base.apy, 'apy', '现场基准点 A′ · y'),
    };
    const Bp = {
      x: readNum(base.bpx, 'bpx', '现场基准点 B′ · x'),
      y: readNum(base.bpy, 'bpy', '现场基准点 B′ · y'),
    };

    // 稳健校准区全部留空 → 仍按双点换算；任一字段有值 → C、D 与阈值必须整体合法，
    // 缺项 / 非有限 / 负值按表单位置稳定列出全部错误，且不进入算法。
    const robustKeys: RobustKey[] = ['cx', 'cy', 'dx', 'dy', 'cpx', 'cpy', 'dpx', 'dpy'];
    const robustActive =
      robustKeys.some((k) => robust[k].trim() !== '') || thresholdRaw.trim() !== '';

    let robustValue:
      | {
          C: { x: number; y: number };
          D: { x: number; y: number };
          Cp: { x: number; y: number };
          Dp: { x: number; y: number };
          threshold: number;
        }
      | null = null;

    if (robustActive) {
      const C = {
        x: readNum(robust.cx, 'cx', '补录设计基准点 C · x'),
        y: readNum(robust.cy, 'cy', '补录设计基准点 C · y'),
      };
      const D = {
        x: readNum(robust.dx, 'dx', '补录设计基准点 D · x'),
        y: readNum(robust.dy, 'dy', '补录设计基准点 D · y'),
      };
      const Cp = {
        x: readNum(robust.cpx, 'cpx', '补录现场基准点 C′ · x'),
        y: readNum(robust.cpy, 'cpy', '补录现场基准点 C′ · y'),
      };
      const Dp = {
        x: readNum(robust.dpx, 'dpx', '补录现场基准点 D′ · x'),
        y: readNum(robust.dpy, 'dpy', '补录现场基准点 D′ · y'),
      };
      const tr = parseFinite(thresholdRaw);
      let threshold = NaN;
      if (!tr.ok) {
        invalid.add('rthr');
        errors.push(
          tr.empty
            ? '「稳健校准 · 异常阈值」为空：启用稳健校准后必须填写非负毫米数。'
            : `「稳健校准 · 异常阈值」的值 “${thresholdRaw.trim()}” 不是有限数。`,
        );
      } else if (tr.value < 0) {
        invalid.add('rthr');
        errors.push('「稳健校准 · 异常阈值」不能为负数。');
      } else if (!Number.isFinite(tr.value * 100)) {
        invalid.add('rthr');
        errors.push('「稳健校准 · 异常阈值」过大，超出数值范围。');
      } else {
        threshold = tr.value;
      }
      // 解析阶段不阻断 readNum 继续收集错误；threshold 为 NaN 时不构造，最终整批拒绝。
      robustValue = { C, D, Cp, Dp, threshold };
    }

    const named: NamedPoint[] = [];
    points.forEach((p, i) => {
      if (p.name.trim() === '') {
        invalid.add(`name-${p.id}`);
        errors.push(`第 ${i + 1} 个具名落点的名称为空。`);
      }
      const x = readNum(p.x, `px-${p.id}`, `第 ${i + 1} 个落点（${p.name.trim() || '未命名'}）· x`);
      const y = readNum(p.y, `py-${p.id}`, `第 ${i + 1} 个落点（${p.name.trim() || '未命名'}）· y`);
      named.push({ name: p.name.trim(), x, y });
    });

    if (errors.length > 0) {
      return { errors, invalid, result: null as SimilarityResult | null };
    }

    if (robustActive && robustValue) {
      const solved = solveSimilarityRobust({
        A,
        B,
        Ap,
        Bp,
        C: robustValue.C,
        D: robustValue.D,
        Cp: robustValue.Cp,
        Dp: robustValue.Dp,
        threshold: robustValue.threshold,
        points: named,
      });
      if (!solved.ok) {
        return { errors: solved.errors, invalid, result: null as SimilarityResult | null };
      }
      return { errors: [] as string[], invalid, result: solved.value };
    }

    const solved = solveSimilarity({ A, B, Ap, Bp, points: named });
    if (!solved.ok) {
      return { errors: solved.errors, invalid, result: null as SimilarityResult | null };
    }
    return { errors: [] as string[], invalid, result: solved.value };
  }, [base, robust, thresholdRaw, points]);

  /**
   * 复测核对完全独立于换算：仅在换算成功后，用全精度现场坐标逐行核对。
   * 期望坐标按内部 id 对齐（result.rows 与 points 同序），
   * 因此同名落点、动态增删都不会串行。
   * 纵/横向差的分解方向固定为录入的现场基准 A′→B′（baseChecks 的前两行
   * A、B 的录入现场点）：即使 B 因测量失误被共识剔除，线路方向定义仍不
   * 切换到其他基准（例如 A′→C′）；逐点期望现场坐标则只消费重估模型。
   *
   * 稳健校准失败（候选不足/共识少于三点/分母为零/重估溢出）时换算结果清除，
   * 但复测录入仍保留在挂起面板中：期望坐标暂缺、状态“暂不核对”，
   * 基准修正后即时按行恢复（lastGoodRef 保留上次成功模型的期望坐标快照）。
   */
  const robustActive =
    Object.values(robust).some((v) => v.trim() !== '') || thresholdRaw.trim() !== '';

  const lastGoodRef = useRef<{
    expectedById: Map<number, { x: number; y: number }>;
  } | null>(null);
  if (parsed.result) {
    const expectedById = new Map<number, { x: number; y: number }>();
    points.forEach((p, i) => {
      const row = parsed.result!.rows[i];
      if (row) expectedById.set(p.id, row.site);
    });
    lastGoodRef.current = { expectedById };
  }

  const survey = useMemo(() => {
    const result = parsed.result;
    if (result) {
      const expectedById = new Map<number, { x: number; y: number }>();
      points.forEach((p, i) => {
        const row = result.rows[i];
        if (row) expectedById.set(p.id, row.site);
      });
      // 固定使用录入的现场基准 A′、B′（稳健模式下 B 被剔除也不换方向）
      const a = result.baseChecks[0].expected;
      const b = result.baseChecks[1].expected;
      const evaluation = evaluateSurveys({
        siteDirection: { x: b.x - a.x, y: b.y - a.y },
        expectedById,
        toleranceRaw: surveyToleranceRaw,
        rows: points.map((p) => ({ id: p.id, rawX: p.sx, rawY: p.sy })),
      });
      return { evaluation, expectedById, suspended: false as const };
    }
    // 稳健校准启用后换算失败：挂起保留复测面板与录入，不消费任何换算结果
    if (robustActive && lastGoodRef.current) {
      return {
        evaluation: null,
        expectedById: lastGoodRef.current.expectedById,
        suspended: true as const,
      };
    }
    return null;
  }, [parsed.result, points, surveyToleranceRaw, robustActive]);

  const updateBase = (key: BaseKey, value: string) => {
    setDirty(true);
    setBase((prev) => ({ ...prev, [key]: value }));
  };

  const updateRobust = (key: RobustKey, value: string) => {
    setDirty(true);
    setRobust((prev) => ({ ...prev, [key]: value }));
  };

  const updateThreshold = (value: string) => {
    setDirty(true);
    setThresholdRaw(value);
  };

  const updatePoint = (id: number, patch: Partial<Omit<RawNamed, 'id'>>) => {
    setDirty(true);
    setPoints((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    );
  };

  const addPoint = () => {
    setDirty(true);
    const id = nextPointId++;
    setPoints((prev) => [
      ...prev,
      { id, name: `落点 ${id}`, x: '', y: '', sx: '', sy: '' },
    ]);
  };

  const removePoint = (id: number) => {
    setDirty(true);
    // 复测坐标挂在同一行状态上：删除即连同复测数据一起消失，不会串到其他行
    setPoints((prev) => prev.filter((p) => p.id !== id));
  };

  const updateSurvey = (id: number, key: 'sx' | 'sy', value: string) => {
    setPoints((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [key]: value } : p)),
    );
  };

  return (
    <main className="page">
      <header>
        <h1>巡演布景坐标换算台</h1>
        <p className="subtitle">
          由两对基准点求解 平移 · 统一缩放 · 旋转 的二维相似变换（x 向右、y
          向上，逆时针角为正；单位：毫米）。不存在非等比拉伸或镜像。
        </p>
      </header>

      <section className="input-area">
        <h2>基准点录入</h2>
        <div className="base-grid">
          <BaseBlock
            title="设计侧 · A"
            prefix="A"
            keys={['ax', 'ay']}
            values={base}
            invalid={parsed.invalid}
            onChange={(k, v) => updateBase(k as BaseKey, v)}
          />
          <BaseBlock
            title="设计侧 · B"
            prefix="B"
            keys={['bx', 'by']}
            values={base}
            invalid={parsed.invalid}
            onChange={(k, v) => updateBase(k as BaseKey, v)}
          />
          <BaseBlock
            title="现场侧 · A′"
            prefix="Ap"
            keys={['apx', 'apy']}
            values={base}
            invalid={parsed.invalid}
            onChange={(k, v) => updateBase(k as BaseKey, v)}
          />
          <BaseBlock
            title="现场侧 · B′"
            prefix="Bp"
            keys={['bpx', 'bpy']}
            values={base}
            invalid={parsed.invalid}
            onChange={(k, v) => updateBase(k as BaseKey, v)}
          />
        </div>

        <h2>稳健校准补录（可选）</h2>
        <p className="note" data-testid="robust-hint">
          怀疑个别基准测量失误时，补录 C、D 两对设计/现场坐标与异常阈值：
          系统枚举四点的全部两点候选，以全精度残差不大于阈值划入共识集，
          按共识点最多、集内平方残差和最小、候选索引字典序决胜，
          再由至少三点的可信共识闭式重估模型并标记采用/剔除。
          本区域全部留空时仍按原有双点校准换算。
        </p>
        <div className="base-grid">
          <BaseBlock
            title="补录设计侧 · C"
            prefix="C"
            keys={['cx', 'cy']}
            values={robust}
            invalid={parsed.invalid}
            onChange={(k, v) => updateRobust(k as RobustKey, v)}
          />
          <BaseBlock
            title="补录设计侧 · D"
            prefix="D"
            keys={['dx', 'dy']}
            values={robust}
            invalid={parsed.invalid}
            onChange={(k, v) => updateRobust(k as RobustKey, v)}
          />
          <BaseBlock
            title="补录现场侧 · C′"
            prefix="Cp"
            keys={['cpx', 'cpy']}
            values={robust}
            invalid={parsed.invalid}
            onChange={(k, v) => updateRobust(k as RobustKey, v)}
          />
          <BaseBlock
            title="补录现场侧 · D′"
            prefix="Dp"
            keys={['dpx', 'dpy']}
            values={robust}
            invalid={parsed.invalid}
            onChange={(k, v) => updateRobust(k as RobustKey, v)}
          />
        </div>
        <div className="robust-threshold-row">
          <NumberField
            id="robust-threshold"
            label="异常阈值 (mm)"
            value={thresholdRaw}
            invalid={parsed.invalid.has('rthr')}
            ariaLabel="稳健校准 · 异常阈值（毫米，非负）"
            hint="例如 5"
            onChange={updateThreshold}
          />
          <p className="note">
            全精度基准残差 ≤ 阈值才进入共识集；阈值为非负毫米数，
            仅在 C、D、阈值任一被填写时参与校验。
          </p>
        </div>

        <h2>具名设计落点</h2>
        <div className="named-list" data-testid="named-list">
          {points.map((p, i) => (
            <div className="card named-row" key={p.id} data-testid="named-row">
              <div className="field field-name">
                <label htmlFor={`point-name-${p.id}`}>名称</label>
                <input
                  id={`point-name-${p.id}`}
                  type="text"
                  value={p.name}
                  aria-label={`第 ${i + 1} 个落点名称`}
                  aria-invalid={parsed.invalid.has(`name-${p.id}`) || undefined}
                  onChange={(e) => updatePoint(p.id, { name: e.target.value })}
                />
              </div>
              <NumberField
                id={`point-x-${p.id}`}
                label="x (mm)"
                value={p.x}
                invalid={parsed.invalid.has(`px-${p.id}`)}
                ariaLabel={`第 ${i + 1} 个落点（${p.name.trim() || '未命名'}）x`}
                onChange={(v) => updatePoint(p.id, { x: v })}
              />
              <NumberField
                id={`point-y-${p.id}`}
                label="y (mm)"
                value={p.y}
                invalid={parsed.invalid.has(`py-${p.id}`)}
                ariaLabel={`第 ${i + 1} 个落点（${p.name.trim() || '未命名'}）y`}
                onChange={(v) => updatePoint(p.id, { y: v })}
              />
              <button
                type="button"
                className="remove-btn"
                aria-label={`删除第 ${i + 1} 个落点`}
                onClick={() => removePoint(p.id)}
              >
                删除
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="add-btn" data-testid="add-point" onClick={addPoint}>
          ＋ 增加落点
        </button>
      </section>

      {dirty && parsed.errors.length > 0 && (
        <section className="errors" role="alert" data-testid="error-panel">
          <h2>输入无效，整批拒绝（未生成或保留任何换算结果）</h2>
          <ul>
            {parsed.errors.map((msg, i) => (
              <li key={i}>{msg}</li>
            ))}
          </ul>
        </section>
      )}

      {!dirty && parsed.result === null && (
        <p className="hint" data-testid="initial-hint">
          请录入两对基准点与全部具名落点；数据首次合法后将自动显示换算结果与复核量。
        </p>
      )}

      {parsed.result && <ResultPanel result={parsed.result} />}
      {survey && (
        <SurveyPanel
          points={points}
          expectedById={survey.expectedById}
          survey={survey.evaluation}
          toleranceRaw={surveyToleranceRaw}
          suspended={survey.suspended}
          onToleranceChange={setSurveyToleranceRaw}
          onSurveyChange={updateSurvey}
        />
      )}
    </main>
  );
}
