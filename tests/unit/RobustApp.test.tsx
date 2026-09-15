import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from '../../src/App';

async function fillIdentityBases(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('设计侧 · A · x（毫米）'), '0');
  await user.type(screen.getByLabelText('设计侧 · A · y（毫米）'), '0');
  await user.type(screen.getByLabelText('设计侧 · B · x（毫米）'), '1000');
  await user.type(screen.getByLabelText('设计侧 · B · y（毫米）'), '0');
  await user.type(screen.getByLabelText('现场侧 · A′ · x（毫米）'), '0');
  await user.type(screen.getByLabelText('现场侧 · A′ · y（毫米）'), '0');
  await user.type(screen.getByLabelText('现场侧 · B′ · x（毫米）'), '1000');
  await user.type(screen.getByLabelText('现场侧 · B′ · y（毫米）'), '0');
}

describe('稳健校准补录区（App 交互）', () => {
  it('补录区全部留空时仍按双点换算，不显示稳健横幅与校准判定列', async () => {
    const user = userEvent.setup();
    render(<App />);
    await fillIdentityBases(user);
    await user.type(screen.getByLabelText('第 1 个落点（落点 1）x'), '100');
    await user.type(screen.getByLabelText('第 1 个落点（落点 1）y'), '0');
    await user.type(screen.getByLabelText('第 2 个落点（落点 2）x'), '0');
    await user.type(screen.getByLabelText('第 2 个落点（落点 2）y'), '0');

    expect(screen.getByTestId('result-table')).toBeInTheDocument();
    expect(screen.queryByTestId('robust-banner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('base-adoption')).not.toBeInTheDocument();
    // 基准复核仍是 A、B 两行
    expect(screen.getAllByTestId('base-check-row')).toHaveLength(2);
    expect(screen.queryByTestId('error-panel')).not.toBeInTheDocument();
  });

  it('仅填阈值：C、D 八个坐标缺项与阈值本身齐全性无关，按表单位置稳定列出全部错误且不进入算法', async () => {
    const user = userEvent.setup();
    render(<App />);
    await fillIdentityBases(user);
    await user.type(screen.getByLabelText('第 1 个落点（落点 1）x'), '100');
    await user.type(screen.getByLabelText('第 1 个落点（落点 1）y'), '0');
    await user.type(screen.getByLabelText('第 2 个落点（落点 2）x'), '0');
    await user.type(screen.getByLabelText('第 2 个落点（落点 2）y'), '0');

    // 只填阈值一个字段：C、D 的 8 个坐标全部为空
    await user.type(screen.getByLabelText('稳健校准 · 异常阈值（毫米，非负）'), '5');

    const panel = screen.getByTestId('error-panel');
    expect(panel).toBeInTheDocument();
    const items = within(panel).getAllByRole('listitem').map((li) => li.textContent ?? '');
    // 八条“为空”错误，且第一条是表单位置最靠前的 C · x
    expect(items).toHaveLength(8);
    expect(items[0]).toContain('补录设计基准点 C · x');
    expect(items[1]).toContain('补录设计基准点 C · y');
    expect(items[7]).toContain('补录现场基准点 D′ · y');
    // 不进入算法：无结果、无稳健横幅
    expect(screen.queryByTestId('result-table')).not.toBeInTheDocument();
    expect(screen.queryByTestId('robust-banner')).not.toBeInTheDocument();
    // 对应控件标红
    expect(screen.getByLabelText('补录设计侧 · C · x（毫米）')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByLabelText('稳健校准 · 异常阈值（毫米，非负）')).not.toHaveAttribute(
      'aria-invalid',
    );

    // 补齐 C、D（identity 一致）后即时恢复换算
    await user.type(screen.getByLabelText('补录设计侧 · C · x（毫米）'), '0');
    await user.type(screen.getByLabelText('补录设计侧 · C · y（毫米）'), '1000');
    await user.type(screen.getByLabelText('补录设计侧 · D · x（毫米）'), '1000');
    await user.type(screen.getByLabelText('补录设计侧 · D · y（毫米）'), '1000');
    await user.type(screen.getByLabelText('补录现场侧 · C′ · x（毫米）'), '0');
    await user.type(screen.getByLabelText('补录现场侧 · C′ · y（毫米）'), '1000');
    await user.type(screen.getByLabelText('补录现场侧 · D′ · x（毫米）'), '1000');
    await user.type(screen.getByLabelText('补录现场侧 · D′ · y（毫米）'), '1000');
    expect(screen.getByTestId('result-table')).toBeInTheDocument();
    expect(screen.queryByTestId('error-panel')).not.toBeInTheDocument();
  });

  it('阈值为负数或非有限数：指出错误、标红阈值且不进入算法', async () => {
    const user = userEvent.setup();
    render(<App />);
    await fillIdentityBases(user);
    await user.type(screen.getByLabelText('第 1 个落点（落点 1）x'), '100');
    await user.type(screen.getByLabelText('第 1 个落点（落点 1）y'), '0');
    await user.type(screen.getByLabelText('第 2 个落点（落点 2）x'), '0');
    await user.type(screen.getByLabelText('第 2 个落点（落点 2）y'), '0');
    // C、D 坐标齐全（identity）
    for (const [label, value] of [
      ['补录设计侧 · C · x（毫米）', '0'],
      ['补录设计侧 · C · y（毫米）', '1000'],
      ['补录设计侧 · D · x（毫米）', '1000'],
      ['补录设计侧 · D · y（毫米）', '1000'],
      ['补录现场侧 · C′ · x（毫米）', '0'],
      ['补录现场侧 · C′ · y（毫米）', '1000'],
      ['补录现场侧 · D′ · x（毫米）', '1000'],
      ['补录现场侧 · D′ · y（毫米）', '1000'],
    ] as const) {
      await user.type(screen.getByLabelText(label), value);
    }
    const thr = screen.getByLabelText('稳健校准 · 异常阈值（毫米，非负）');

    await user.type(thr, '-1');
    expect(screen.getByTestId('error-panel')).toHaveTextContent('不能为负数');
    expect(thr).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByTestId('result-table')).not.toBeInTheDocument();

    await user.clear(thr);
    await user.type(thr, 'abc');
    expect(screen.getByTestId('error-panel')).toHaveTextContent('不是有限数');

    await user.clear(thr);
    await user.type(thr, '5');
    expect(screen.queryByTestId('error-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('result-table')).toBeInTheDocument();
  });

  it('确定性失败（最佳共识少于三点）时清除换算结果并说明，落点录入仍保留；清空补录区后恢复双点换算', async () => {
    const user = userEvent.setup();
    render(<App />);
    await fillIdentityBases(user);
    await user.type(screen.getByLabelText('第 1 个落点（落点 1）x'), '500');
    await user.type(screen.getByLabelText('第 1 个落点（落点 1）y'), '500');
    await user.type(screen.getByLabelText('第 2 个落点（落点 2）x'), '0');
    await user.type(screen.getByLabelText('第 2 个落点（落点 2）y'), '0');
    expect(screen.getByTestId('result-table')).toBeInTheDocument();

    // 全体冲突的补录
    await user.type(screen.getByLabelText('补录设计侧 · C · x（毫米）'), '0');
    await user.type(screen.getByLabelText('补录设计侧 · C · y（毫米）'), '1000');
    await user.type(screen.getByLabelText('补录设计侧 · D · x（毫米）'), '1000');
    await user.type(screen.getByLabelText('补录设计侧 · D · y（毫米）'), '1000');
    await user.type(screen.getByLabelText('补录现场侧 · C′ · x（毫米）'), '0');
    await user.type(screen.getByLabelText('补录现场侧 · C′ · y（毫米）'), '500');
    await user.type(screen.getByLabelText('补录现场侧 · D′ · x（毫米）'), '-3000');
    await user.type(screen.getByLabelText('补录现场侧 · D′ · y（毫米）'), '-3000');
    await user.type(screen.getByLabelText('稳健校准 · 异常阈值（毫米，非负）'), '50');

    expect(screen.queryByTestId('result-table')).not.toBeInTheDocument();
    expect(screen.getByTestId('error-panel')).toHaveTextContent(/可信基准点|至少需要 3 个/);
    // 落点录入行仍保留
    expect(screen.getAllByTestId('named-row')).toHaveLength(2);

    // 清空补录区（阈值与 8 个坐标）后立即恢复双点换算
    for (const label of [
      '补录设计侧 · C · x（毫米）',
      '补录设计侧 · C · y（毫米）',
      '补录设计侧 · D · x（毫米）',
      '补录设计侧 · D · y（毫米）',
      '补录现场侧 · C′ · x（毫米）',
      '补录现场侧 · C′ · y（毫米）',
      '补录现场侧 · D′ · x（毫米）',
      '补录现场侧 · D′ · y（毫米）',
      '稳健校准 · 异常阈值（毫米，非负）',
    ]) {
      await user.clear(screen.getByLabelText(label));
    }
    expect(screen.getByTestId('result-table')).toBeInTheDocument();
    expect(screen.queryByTestId('error-panel')).not.toBeInTheDocument();
  });

  it('单离群（s=2、30°，D 现场偏移 100mm）：剔除 D、落点按重估模型换算，复测期望也消费重估模型', async () => {
    const user = userEvent.setup();
    render(<App />);
    const th = (30 * Math.PI) / 180;
    const map = (x: number, y: number) => ({
      x: 50 + 2 * (Math.cos(th) * x - Math.sin(th) * y),
      y: -70 + 2 * (Math.sin(th) * x + Math.cos(th) * y),
    });
    const A = map(0, 0), B = map(1000, 0), C = map(0, 1000), D = map(1000, 1000);
    const type = (label: string, value: string) =>
      user.type(screen.getByLabelText(label), value);
    await type('设计侧 · A · x（毫米）', '0');
    await type('设计侧 · A · y（毫米）', '0');
    await type('设计侧 · B · x（毫米）', '1000');
    await type('设计侧 · B · y（毫米）', '0');
    await type('现场侧 · A′ · x（毫米）', A.x.toFixed(6));
    await type('现场侧 · A′ · y（毫米）', A.y.toFixed(6));
    await type('现场侧 · B′ · x（毫米）', B.x.toFixed(6));
    await type('现场侧 · B′ · y（毫米）', B.y.toFixed(6));
    await type('补录设计侧 · C · x（毫米）', '0');
    await type('补录设计侧 · C · y（毫米）', '1000');
    await type('补录设计侧 · D · x（毫米）', '1000');
    await type('补录设计侧 · D · y（毫米）', '1000');
    await type('补录现场侧 · C′ · x（毫米）', C.x.toFixed(6));
    await type('补录现场侧 · C′ · y（毫米）', C.y.toFixed(6));
    await type('补录现场侧 · D′ · x（毫米）', (D.x + 100).toFixed(6));
    await type('补录现场侧 · D′ · y（毫米）', D.y.toFixed(6));
    await type('稳健校准 · 异常阈值（毫米，非负）', '5');
    await type('第 1 个落点（落点 1）x', '500');
    await type('第 1 个落点（落点 1）y', '500');
    await type('第 2 个落点（落点 2）x', '0');
    await type('第 2 个落点（落点 2）y', '0');

    // 横幅与采用/剔除标记
    expect(screen.getByTestId('robust-banner')).toHaveTextContent('A、B、C');
    expect(screen.getByTestId('robust-banner')).toHaveTextContent('剔除 D');
    const checkRows = screen.getAllByTestId('base-check-row');
    expect(checkRows).toHaveLength(4);
    expect(checkRows[0]).toHaveAttribute('data-adopted', 'adopted');
    expect(checkRows[3]).toHaveAttribute('data-adopted', 'rejected');
    expect(within(checkRows[3]).getByText('剔除')).toBeInTheDocument();

    // 落点按重估模型（真模型）换算
    const want = map(500, 500);
    const cells = within(screen.getByTestId('result-table')).getAllByRole('cell');
    expect(cells[3]).toHaveTextContent(want.x.toFixed(2));
    expect(cells[4]).toHaveTextContent(want.y.toFixed(2));

    // 复测期望坐标消费同一重估模型：与期望重合（1e-6 内）→ 小容差合格
    await type('全局允许偏差（毫米）', '0.001');
    await type('第 1 个落点（落点 1）现场复测 x', want.x.toFixed(6));
    await type('第 1 个落点（落点 1）现场复测 y', want.y.toFixed(6));
    const surveyRows = within(screen.getByTestId('survey-table')).getAllByTestId('survey-row');
    expect(within(surveyRows[0]).getByTestId('survey-status')).toHaveTextContent('合格');
    // 期望列展示的也是重估模型坐标
    expect(surveyRows[0]).toHaveTextContent(want.x.toFixed(2));
  });

  it('全体冲突失败后修正补录基准，原复测数据按行即时恢复核对', async () => {
    const user = userEvent.setup();
    render(<App />);
    await fillIdentityBases(user);
    // 先让双点 s=2 成立：把现场 B′ 改成 2000
    await user.clear(screen.getByLabelText('现场侧 · B′ · x（毫米）'));
    await user.type(screen.getByLabelText('现场侧 · B′ · x（毫米）'), '2000');
    const type = (label: string, value: string) =>
      user.type(screen.getByLabelText(label), value);
    // 合法补录（C′、D′ 服从 s=2）
    await type('补录设计侧 · C · x（毫米）', '0');
    await type('补录设计侧 · C · y（毫米）', '1000');
    await type('补录设计侧 · D · x（毫米）', '1000');
    await type('补录设计侧 · D · y（毫米）', '1000');
    await type('补录现场侧 · C′ · x（毫米）', '0');
    await type('补录现场侧 · C′ · y（毫米）', '2000');
    await type('补录现场侧 · D′ · x（毫米）', '2000');
    await type('补录现场侧 · D′ · y（毫米）', '2000');
    await type('稳健校准 · 异常阈值（毫米，非负）', '50');
    await type('第 1 个落点（落点 1）x', '100');
    await type('第 1 个落点（落点 1）y', '0');
    await type('第 2 个落点（落点 2）x', '0');
    await type('第 2 个落点（落点 2）y', '0');
    await type('全局允许偏差（毫米）', '5');
    await type('第 1 个落点（落点 1）现场复测 x', '200');
    await type('第 1 个落点（落点 1）现场复测 y', '0');
    let surveyRows = within(screen.getByTestId('survey-table')).getAllByTestId('survey-row');
    expect(within(surveyRows[0]).getByTestId('survey-status')).toHaveTextContent('合格');

    // 改成全体冲突 → 确定性失败：换算与复测面板清除，录入保留
    const cpy = screen.getByLabelText('补录现场侧 · C′ · y（毫米）');
    const dpx = screen.getByLabelText('补录现场侧 · D′ · x（毫米）');
    const dpy = screen.getByLabelText('补录现场侧 · D′ · y（毫米）');
    await user.clear(cpy);
    await user.type(cpy, '500');
    await user.clear(dpx);
    await user.type(dpx, '-3000');
    await user.clear(dpy);
    await user.type(dpy, '-3000');
    expect(screen.getByTestId('error-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('result-table')).not.toBeInTheDocument();
    // 换算结果已清除，但复测面板与录入保留为“暂不核对”挂起态
    expect(screen.getByRole('region', { name: '现场复测核对' })).toBeInTheDocument();
    let suspendedRows = within(screen.getByTestId('survey-table')).getAllByTestId('survey-row');
    expect(within(suspendedRows[0]).getByTestId('survey-status')).toHaveTextContent('暂不核对');
    expect(screen.getByTestId('survey-suspended-note')).toBeInTheDocument();
    expect(screen.getByLabelText('第 1 个落点（落点 1）现场复测 x')).toHaveValue('200');
    expect(screen.getByLabelText('全局允许偏差（毫米）')).toHaveValue('5');

    // 修正后即时恢复：复测无需重录，按行重新核对
    await user.clear(cpy);
    await user.type(cpy, '2000');
    await user.clear(dpx);
    await user.type(dpx, '2000');
    await user.clear(dpy);
    await user.type(dpy, '2000');
    expect(screen.queryByTestId('error-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('result-table')).toBeInTheDocument();
    surveyRows = within(screen.getByTestId('survey-table')).getAllByTestId('survey-row');
    expect(within(surveyRows[0]).getByTestId('survey-status')).toHaveTextContent('合格');
    expect(within(surveyRows[1]).getByTestId('survey-status')).toHaveTextContent('未录入');
    expect(screen.getByLabelText('第 1 个落点（落点 1）现场复测 x')).toHaveValue('200');
  });

  it('B 被剔除时复测纵/横向差仍沿录入的 A′→B′ 分解，不切换为 A′→C′', async () => {
    const user = userEvent.setup();
    render(<App />);
    // 真模型 s=2、θ=30°、平移 (50,-70)；现场 B′ 带 +100mm 测量失误 → 共识 A、C、D，剔除 B。
    const th = (30 * Math.PI) / 180;
    const map = (x: number, y: number) => ({
      x: 50 + 2 * (Math.cos(th) * x - Math.sin(th) * y),
      y: -70 + 2 * (Math.sin(th) * x + Math.cos(th) * y),
    });
    const A = map(0, 0), B = map(1000, 0), C = map(0, 1000), D = map(1000, 1000);
    const Bp = { x: B.x + 100, y: B.y }; // 录入现场基准（含失误）
    const type = (label: string, value: string) =>
      user.type(screen.getByLabelText(label), value);
    await type('设计侧 · A · x（毫米）', '0');
    await type('设计侧 · A · y（毫米）', '0');
    await type('设计侧 · B · x（毫米）', '1000');
    await type('设计侧 · B · y（毫米）', '0');
    await type('现场侧 · A′ · x（毫米）', A.x.toFixed(6));
    await type('现场侧 · A′ · y（毫米）', A.y.toFixed(6));
    await type('现场侧 · B′ · x（毫米）', Bp.x.toFixed(6));
    await type('现场侧 · B′ · y（毫米）', Bp.y.toFixed(6));
    await type('补录设计侧 · C · x（毫米）', '0');
    await type('补录设计侧 · C · y（毫米）', '1000');
    await type('补录设计侧 · D · x（毫米）', '1000');
    await type('补录设计侧 · D · y（毫米）', '1000');
    await type('补录现场侧 · C′ · x（毫米）', C.x.toFixed(6));
    await type('补录现场侧 · C′ · y（毫米）', C.y.toFixed(6));
    await type('补录现场侧 · D′ · x（毫米）', D.x.toFixed(6));
    await type('补录现场侧 · D′ · y（毫米）', D.y.toFixed(6));
    await type('稳健校准 · 异常阈值（毫米，非负）', '5');
    await type('第 1 个落点（落点 1）x', '500');
    await type('第 1 个落点（落点 1）y', '500');
    await type('第 2 个落点（落点 2）x', '0');
    await type('第 2 个落点（落点 2）y', '0');

    // 前置：B 确实被剔除，落点期望按重估真模型换算
    expect(screen.getByTestId('robust-banner')).toHaveTextContent('剔除 B');
    const want = map(500, 500);

    // 沿【录入的】A′→B′（含 +100 失误，方位角约 28.62°）偏移 3mm 录入复测点
    const dx = Bp.x - A.x;
    const dy = Bp.y - A.y;
    const len = Math.hypot(dx, dy);
    const ux = dx / len;
    const uy = dy / len;
    const mx = want.x + 3 * ux;
    const my = want.y + 3 * uy;
    await type('全局允许偏差（毫米）', '5');
    await type('第 1 个落点（落点 1）现场复测 x', mx.toFixed(6));
    await type('第 1 个落点（落点 1）现场复测 y', my.toFixed(6));

    const row = within(screen.getByTestId('survey-table')).getAllByTestId('survey-row')[0];
    const cells = within(row).getAllByRole('cell');
    // 纵向差 = +3.00、横向差 = 0.00：证明分解方向就是录入的 A′→B′
    expect(cells[5]).toHaveTextContent('+3.00');
    expect(cells[6]).toHaveTextContent('0.00');
    expect(cells[7]).toHaveTextContent('3.00');
    expect(within(row).getByTestId('survey-status')).toHaveTextContent('合格');

    // 反证：A′→C′ 方位角约 120°，与录入 A′→B′（约 28.62°）相差约 91.4°；
    // 若错误改用 A′→C′ 分解，横向差会接近 3.00 而非 0.00。
    const acx = C.x - A.x;
    const acy = C.y - A.y;
    const cross = ux * acy - uy * acx;
    expect(Math.abs(cross) / (Math.hypot(acx, acy))).toBeGreaterThan(0.99); // 近垂直
  });
});
