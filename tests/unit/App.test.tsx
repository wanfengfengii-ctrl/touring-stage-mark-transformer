import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from '../../src/App';

/** 设计侧 A=(0,0) B=(1000,0)；现场侧 A′=(100,200) B′=(100,1200)，即平移 +90° 旋转。 */
async function fillValidBases(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('设计侧 · A · x（毫米）'), '0');
  await user.type(screen.getByLabelText('设计侧 · A · y（毫米）'), '0');
  await user.type(screen.getByLabelText('设计侧 · B · x（毫米）'), '1000');
  await user.type(screen.getByLabelText('设计侧 · B · y（毫米）'), '0');
  await user.type(screen.getByLabelText('现场侧 · A′ · x（毫米）'), '100');
  await user.type(screen.getByLabelText('现场侧 · A′ · y（毫米）'), '200');
  await user.type(screen.getByLabelText('现场侧 · B′ · x（毫米）'), '100');
  await user.type(screen.getByLabelText('现场侧 · B′ · y（毫米）'), '1200');
}

describe('App 换算台交互', () => {
  it('初始状态提示录入，不显示结果', () => {
    render(<App />);
    expect(screen.getByTestId('initial-hint')).toBeInTheDocument();
    expect(screen.queryByTestId('result-table')).not.toBeInTheDocument();
    expect(screen.queryByTestId('error-panel')).not.toBeInTheDocument();
  });

  it('首次合法输入后显示全部具名落点、缩放率与旋转角', async () => {
    const user = userEvent.setup();
    render(<App />);
    await fillValidBases(user);
    await user.type(screen.getByLabelText('第 1 个落点（落点 1）x'), '100');
    await user.type(screen.getByLabelText('第 1 个落点（落点 1）y'), '0');
    await user.type(screen.getByLabelText('第 2 个落点（落点 2）x'), '0');
    await user.type(screen.getByLabelText('第 2 个落点（落点 2）y'), '100');

    // (100,0) 旋转 +90° 并平移 -> (100, 300)；(0,100) -> (0, 200)
    const table = screen.getByTestId('result-table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3); // 表头 + 2 个落点
    expect(within(table).getByText('落点 1')).toBeInTheDocument();
    expect(within(table).getByText('落点 2')).toBeInTheDocument();
    const cells = within(table).getAllByRole('cell');
    // 落点 1 的现场 x / y
    expect(cells[3]).toHaveTextContent('100.00');
    expect(cells[4]).toHaveTextContent('300.00');

    const section = screen.getByRole('region', { name: '换算结果' });
    expect(section).toBeInTheDocument();
    expect(screen.getByText('1.000000')).toBeInTheDocument();
    expect(screen.getByText('90.00°')).toBeInTheDocument();
    expect(screen.queryByTestId('initial-hint')).not.toBeInTheDocument();
    expect(screen.queryByTestId('error-panel')).not.toBeInTheDocument();
  });

  it('合法坐标变化时立即重算并完整替换旧结果', async () => {
    const user = userEvent.setup();
    render(<App />);
    await fillValidBases(user);
    const bx = screen.getByLabelText('设计侧 · B · x（毫米）');
    await user.clear(bx);
    await user.type(bx, '2000');
    await user.type(screen.getByLabelText('第 1 个落点（落点 1）x'), '1000');
    await user.type(screen.getByLabelText('第 1 个落点（落点 1）y'), '0');
    await user.type(screen.getByLabelText('第 2 个落点（落点 2）x'), '0');
    await user.type(screen.getByLabelText('第 2 个落点（落点 2）y'), '0');

    // 缩放率 0.5；点 (1000,0) -> 现场 (100, 700)
    expect(screen.getByText('0.500000')).toBeInTheDocument();
    const table = screen.getByTestId('result-table');
    const cells = within(table).getAllByRole('cell');
    expect(cells[3]).toHaveTextContent('100.00');
    expect(cells[4]).toHaveTextContent('700.00');
    // 旧缩放率 1.000000 不应残留；旋转角仍为 90°（该场景只改了缩放）
    expect(screen.queryByText('1.000000')).not.toBeInTheDocument();
    expect(screen.getByText('90.00°')).toBeInTheDocument();
  });

  it('任一字段为空时整批拒绝、清除旧结果并指出错误', async () => {
    const user = userEvent.setup();
    render(<App />);
    await fillValidBases(user);
    await user.type(screen.getByLabelText('第 1 个落点（落点 1）x'), '100');
    await user.type(screen.getByLabelText('第 1 个落点（落点 1）y'), '0');

    // 第二个落点留空 y：此时应整体拒绝（无结果），但不显示结果
    expect(screen.queryByTestId('result-table')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('第 2 个落点（落点 2）x'), '0');
    expect(screen.getByTestId('error-panel')).toBeInTheDocument();
    expect(screen.getByText(/为空/)).toBeInTheDocument();

    // 补齐第二落点后结果出现
    await user.type(screen.getByLabelText('第 2 个落点（落点 2）y'), '100');
    expect(screen.getByTestId('result-table')).toBeInTheDocument();
    expect(screen.queryByTestId('error-panel')).not.toBeInTheDocument();

    // 再把基准点清空：结果立即消失、报错
    await user.clear(screen.getByLabelText('设计侧 · B · y（毫米）'));
    expect(screen.queryByTestId('result-table')).not.toBeInTheDocument();
    expect(screen.getByTestId('error-panel')).toBeInTheDocument();
  });

  it('输入非有限数（abc / Infinity）时拒绝并提示具体字段', async () => {
    const user = userEvent.setup();
    render(<App />);
    await fillValidBases(user);
    await user.type(screen.getByLabelText('第 1 个落点（落点 1）x'), 'abc');
    await user.type(screen.getByLabelText('第 1 个落点（落点 1）y'), '0');
    await user.type(screen.getByLabelText('第 2 个落点（落点 2）x'), '0');
    await user.type(screen.getByLabelText('第 2 个落点（落点 2）y'), 'Infinity');

    const panel = screen.getByTestId('error-panel');
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveTextContent('不是有限数');
    expect(screen.queryByTestId('result-table')).not.toBeInTheDocument();
  });

  it('任一侧两个基准点重合时拒绝', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText('设计侧 · A · x（毫米）'), '0');
    await user.type(screen.getByLabelText('设计侧 · A · y（毫米）'), '0');
    await user.type(screen.getByLabelText('设计侧 · B · x（毫米）'), '0');
    await user.type(screen.getByLabelText('设计侧 · B · y（毫米）'), '0');
    await user.type(screen.getByLabelText('现场侧 · A′ · x（毫米）'), '0');
    await user.type(screen.getByLabelText('现场侧 · A′ · y（毫米）'), '0');
    await user.type(screen.getByLabelText('现场侧 · B′ · x（毫米）'), '1');
    await user.type(screen.getByLabelText('现场侧 · B′ · y（毫米）'), '0');
    await user.type(screen.getByLabelText('第 1 个落点（落点 1）x'), '1');
    await user.type(screen.getByLabelText('第 1 个落点（落点 1）y'), '1');
    await user.type(screen.getByLabelText('第 2 个落点（落点 2）x'), '2');
    await user.type(screen.getByLabelText('第 2 个落点（落点 2）y'), '2');

    expect(screen.getByTestId('error-panel')).toHaveTextContent('重合');
    expect(screen.queryByTestId('result-table')).not.toBeInTheDocument();
  });

  it('增加与删除落点行', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getAllByTestId('named-row')).toHaveLength(2);
    await user.click(screen.getByTestId('add-point'));
    expect(screen.getAllByTestId('named-row')).toHaveLength(3);
    const removeButtons = screen.getAllByRole('button', { name: /删除/ });
    await user.click(removeButtons[2]);
    expect(screen.getAllByTestId('named-row')).toHaveLength(2);
  });
});
