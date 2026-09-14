import { describe, expect, it } from 'vitest';
import {
  formatDegrees,
  formatMm,
  formatPercent,
  formatScale,
  formatTolerance,
  roundHalfAway,
} from '../../src/lib/format';

describe('roundHalfAway', () => {
  it('恰好半个最小单位时向绝对值增大方向取整（正负对称）', () => {
    expect(roundHalfAway(2.345, 2)).toBe(2.35);
    expect(roundHalfAway(-2.345, 2)).toBe(-2.35);
    expect(roundHalfAway(0.005, 2)).toBe(0.01);
    expect(roundHalfAway(-0.005, 2)).toBe(-0.01);
    expect(roundHalfAway(1.005, 2)).toBe(1.01);
    expect(roundHalfAway(-1.005, 2)).toBe(-1.01);
    // 不是半点时四舍五入正常
    expect(roundHalfAway(2.344, 2)).toBe(2.34);
    expect(roundHalfAway(-2.344, 2)).toBe(-2.34);
    expect(roundHalfAway(2.346, 2)).toBe(2.35);
    expect(roundHalfAway(-2.346, 2)).toBe(-2.35);
  });

  it('零保持为零，不带出 -0', () => {
    expect(roundHalfAway(0, 2)).toBe(0);
    expect(Object.is(roundHalfAway(-0, 2), -0)).toBe(false);
  });

  it('不同位数可用', () => {
    expect(roundHalfAway(0.123456789, 6)).toBe(0.123457);
    expect(roundHalfAway(1234.5, 0)).toBe(1235);
    expect(roundHalfAway(-1234.5, 0)).toBe(-1235);
  });
});

describe('formatMm', () => {
  it('固定两位小数，单位毫米', () => {
    expect(formatMm(100)).toBe('100.00');
    expect(formatMm(-12.345)).toBe('-12.35');
    expect(formatMm(0.004)).toBe('0.00');
    expect(formatMm(0.005)).toBe('0.01');
    expect(formatMm(-0.005)).toBe('-0.01');
  });

  it('非有限数给占位符', () => {
    expect(formatMm(NaN)).toBe('—');
    expect(formatMm(Infinity)).toBe('—');
  });

  it('放大到展示精度后溢出时回退占位符，绝不输出 Infinity', () => {
    expect(formatMm(1e308)).toBe('—');
    expect(Number.isNaN(roundHalfAway(1e308, 2))).toBe(true);
    expect(formatScale(1e308)).toBe('—');
    expect(formatPercent(1e308)).toBe('—');
    expect(formatTolerance(1e308)).toBe('—');
  });
});

describe('其他展示格式', () => {
  it('缩放率保留六位小数', () => {
    expect(formatScale(2)).toBe('2.000000');
    expect(formatScale(1 / 3)).toBe('0.333333');
  });

  it('百分比两位小数', () => {
    expect(formatPercent(2)).toBe('200.00%');
    expect(formatPercent(0.12345)).toBe('12.35%');
  });

  it('角度带度符号', () => {
    expect(formatDegrees(90)).toBe('90.00°');
    expect(formatDegrees(-179.995)).toBe('-180.00°');
  });

  it('闭合差极小用科学计数法，为零显示 0', () => {
    expect(formatTolerance(0)).toBe('0');
    expect(formatTolerance(1e-12)).toMatch(/^1\.000e\+?-?12 mm$/);
    expect(formatTolerance(0.000002)).toMatch(/mm$/);
  });
});
