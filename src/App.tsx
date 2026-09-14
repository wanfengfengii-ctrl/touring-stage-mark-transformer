import { useMemo, useState } from 'react';
import {
  parseFinite,
  solveSimilarity,
  type NamedPoint,
  type SimilarityResult,
} from './lib/geometry';
import {
  formatDegrees,
  formatMm,
  formatPercent,
  formatScale,
  formatTolerance,
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

interface RawNamed {
  id: number;
  name: string;
  x: string;
  y: string;
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

let nextPointId = 3;

const INITIAL_POINTS: RawNamed[] = [
  { id: 1, name: '落点 1', x: '', y: '' },
  { id: 2, name: '落点 2', x: '', y: '' },
];

interface FieldProps {
  id: string;
  label: string;
  value: string;
  invalid?: boolean;
  ariaLabel?: string;
  onChange: (value: string) => void;
}

function NumberField({ id, label, value, invalid, ariaLabel, onChange }: FieldProps) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        spellCheck={false}
        autoComplete="off"
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
  keys: [BaseKey, BaseKey];
  values: BaseState;
  invalid: Set<string>;
  onChange: (key: BaseKey, value: string) => void;
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

function ResultPanel({ result }: { result: SimilarityResult }) {
  return (
    <section className="results" aria-label="换算结果">
      <h2>换算结果</h2>

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
          </tr>
        </thead>
        <tbody>
          {result.baseChecks.map((c) => (
            <tr key={c.label}>
              <td>{c.label}</td>
              <td>
                ({formatMm(c.expected.x)}, {formatMm(c.expected.y)})
              </td>
              <td>
                ({formatMm(c.actual.x)}, {formatMm(c.actual.y)})
              </td>
              <td>{formatTolerance(c.residual)}</td>
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

export default function App() {
  const [base, setBase] = useState<BaseState>(EMPTY_BASE);
  const [points, setPoints] = useState<RawNamed[]>(INITIAL_POINTS);
  const [dirty, setDirty] = useState(false);

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

    const solved = solveSimilarity({ A, B, Ap, Bp, points: named });
    if (!solved.ok) {
      return { errors: solved.errors, invalid, result: null as SimilarityResult | null };
    }
    return { errors: [] as string[], invalid, result: solved.value };
  }, [base, points]);

  const updateBase = (key: BaseKey, value: string) => {
    setDirty(true);
    setBase((prev) => ({ ...prev, [key]: value }));
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
      { id, name: `落点 ${id}`, x: '', y: '' },
    ]);
  };

  const removePoint = (id: number) => {
    setDirty(true);
    setPoints((prev) => prev.filter((p) => p.id !== id));
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
            onChange={updateBase}
          />
          <BaseBlock
            title="设计侧 · B"
            prefix="B"
            keys={['bx', 'by']}
            values={base}
            invalid={parsed.invalid}
            onChange={updateBase}
          />
          <BaseBlock
            title="现场侧 · A′"
            prefix="Ap"
            keys={['apx', 'apy']}
            values={base}
            invalid={parsed.invalid}
            onChange={updateBase}
          />
          <BaseBlock
            title="现场侧 · B′"
            prefix="Bp"
            keys={['bpx', 'bpy']}
            values={base}
            invalid={parsed.invalid}
            onChange={updateBase}
          />
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
    </main>
  );
}
