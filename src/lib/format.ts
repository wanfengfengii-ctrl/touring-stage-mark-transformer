/**
 * 展示层舍入：现场坐标保留小数点后两位，
 * 恰好处于半个最小单位时向绝对值增大方向取整（half away from zero）。
 * 内部计算结果不做任何截断，只有渲染时调用这里的函数。
 */

/**
 * 恰好半个最小单位时向绝对值增大方向取整（half away from zero）。
 *
 * 内部坐标是二进制浮点，像 1.005 这样的十进制半点会被表示为
 * 100.49999999999999（乘 100 后）。为了实现“十进制半点向绝对值增大方向”
 * 的语义，先按相对机器误差识别“恰好半点”，再向上取整；
 * 其余值按最近的 1/factor 取整（半整数以上进一，以下舍去）。
 */
export function roundHalfAway(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return NaN;
  const factor = 10 ** digits;
  const sign = value < 0 ? -1 : 1;
  const scaled = Math.abs(value) * factor;
  // 放大到目标小数位后若溢出，无法按该精度表示
  if (!Number.isFinite(scaled)) return NaN;
  const halfStep = Math.floor(scaled) + 0.5;
  const eps = Number.EPSILON * Math.max(1, halfStep) * 16;
  let rounded: number;
  if (Math.abs(scaled - halfStep) <= eps) {
    rounded = Math.floor(scaled) + 1; // 恰好半点：向绝对值增大方向
  } else {
    rounded = Math.round(scaled);
  }
  return (sign * rounded) / factor;
}

/** 固定小数位；无法安全表示（含溢出）时回退为占位符，绝不输出 Infinity/NaN。 */
function fixedOrDash(value: number, digits: number): string {
  const rounded = roundHalfAway(value, digits);
  return Number.isFinite(rounded) ? rounded.toFixed(digits) : '—';
}

/** 毫米坐标，固定两位小数。 */
export function formatMm(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return fixedOrDash(value, 2);
}

/**
 * 带方向的毫米偏差（横向差/纵向差），固定两位小数并显式标注正负号：
 * 正号表示沿规定方向为正（纵向沿 A′→B′、横向沿其逆时针 90° 方向）。
 * 0 不加正号。
 */
export function formatSignedMm(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (Object.is(value, 0)) return '0.00';
  const text = fixedOrDash(value, 2);
  if (text === '—') return '—';
  return value > 0 && !text.startsWith('-') ? `+${text}` : text;
}

/** 旋转角（度），两位小数。 */
export function formatDegrees(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const text = fixedOrDash(value, 2);
  return text === '—' ? text : `${text}°`;
}

/** 缩放率（比值），六位小数。 */
export function formatScale(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return fixedOrDash(value, 6);
}

/** 缩放率百分比，两位小数。 */
export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const text = fixedOrDash(value * 100, 2);
  return text === '—' ? text : `${text}%`;
}

/**
 * 复核闭合差（毫米）：数值极小（浮点噪声量级）时用科学计数法如实展示，
 * 避免被两位小数舍入成 0 而掩盖真实误差；稍大时保留 9 位小数。
 */
export function formatTolerance(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  if (Math.abs(value) < 1e-6) {
    return Number.isFinite(value) ? `${value.toExponential(3)} mm` : '—';
  }
  const text = fixedOrDash(value, 9);
  return text === '—' ? '—' : `${text} mm`;
}
