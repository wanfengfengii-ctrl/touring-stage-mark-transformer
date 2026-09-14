import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from '../../src/App';

/**
 * 设计侧 A=(0,0) B=(1000,0)；现场侧 A′=(100,200) B′=(100,1200)：
 * 平移 + 逆时针 90°。落点 (100,0) -> (100,300)；(0,100) -> (0,200)。
 */
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

async function fillDesignPoint(
  user: ReturnType<typeof userEvent.setup>,
  n: number,
  name: string,
  x: string,
  y: string,
) {
  await user.type(screen.getByLabelText(`第 ${n} 个落点（${name}）x`), x);
  await user.type(screen.getByLabelText(`第 ${n} 个落点（${name}）y`), y);
}

async function fillSurvey(
  user: ReturnType<typeof userEvent.setup>,
  n: number,
  name: string,
  x: string,
  y: string,
) {
  await user.clear(screen.getByLabelText(`第 ${n} 个落点（${name}）现场复测 x`));
  await user.type(screen.getByLabelText(`第 ${n} 个落点（${name}）现场复测 x`), x);
  await user.clear(screen.getByLabelText(`第 ${n} 个落点（${name}）现场复测 y`));
  await user.type(screen.getByLabelText(`第 ${n} 个落点（${name}）现场复测 y`), y);
}

function surveyRows() {
  return within(screen.getByTestId('survey-table')).getAllByTestId('survey-row');
}

function statusOf(row: HTMLElement) {
  return within(row).getByTestId('survey-status').textContent;
}

describe('现场复测核对', () => {
  it('换算成功后复测面板出现，默认全部“未录入”，且不改变换算结果', async () => {
    const user = userEvent.setup();
    render(<App />);
    await fillValidBases(user);
    await fillDesignPoint(user, 1, '落点 1', '100', '0');
    await fillDesignPoint(user, 2, '落点 2', '0', '100');

    const panel = screen.getByRole('region', { name: '现场复测核对' });
    expect(panel).toBeInTheDocument();
    const rows = surveyRows();
    expect(rows).toHaveLength(2);
    expect(statusOf(rows[0])).toBe('未录入');
    expect(statusOf(rows[1])).toBe('未录入');
    // 偏差列均为占位符
    expect(rows[0]).toHaveTextContent('未录入');
    expect(screen.getByTestId('survey-idle-note')).toBeInTheDocument();

    // 换算结果不受任何影响
    const resultTable = screen.getByTestId('result-table');
    const cells = within(resultTable).getAllByRole('cell');
    expect(cells[3]).toHaveTextContent('100.00');
    expect(cells[4]).toHaveTextContent('300.00');
  });

  it('未使用复测功能时页面行为与既有版本一致（初始无换算结果时没有复测面板）', async () => {
    render(<App />);
    expect(screen.queryByRole('region', { name: '现场复测核对' })).not.toBeInTheDocument();
    expect(screen.getByTestId('initial-hint')).toBeInTheDocument();
  });

  it('允许偏差为空时成对录入：该行输入无效并在控件附近说明，其他行与换算/复核保留；补容差后即时恢复', async () => {
    const user = userEvent.setup();
    render(<App />);
    await fillValidBases(user);
    await fillDesignPoint(user, 1, '落点 1', '100', '0');
    await fillDesignPoint(user, 2, '落点 2', '0', '100');

    await fillSurvey(user, 1, '落点 1', '100', '300'); // 与期望完全重合
    const rows = surveyRows();
    expect(statusOf(rows[0])).toBe('输入无效');
    expect(statusOf(rows[1])).toBe('未录入');
    // 容差输入框附近说明原因
    expect(screen.getByTestId('survey-tolerance-error')).toHaveTextContent(/允许偏差/);
    expect(screen.getByTestId('survey-tolerance')).toHaveAttribute('aria-invalid', 'true');
    // 换算结果与基准复核仍保留
    expect(screen.getByTestId('result-table')).toBeInTheDocument();
    expect(screen.getByText('A → A′')).toBeInTheDocument();

    // 填入容差 0（完全重合也应合格）即时恢复
    await user.type(screen.getByLabelText('全局允许偏差（毫米）'), '0');
    expect(statusOf(surveyRows()[0])).toBe('合格');
    expect(screen.queryByTestId('survey-tolerance-error')).not.toBeInTheDocument();
  });

  it('容差非有限数或负数时输入无效并分别提示，修正后恢复核对', async () => {
    const user = userEvent.setup();
    render(<App />);
    await fillValidBases(user);
    await fillDesignPoint(user, 1, '落点 1', '100', '0');
    await fillDesignPoint(user, 2, '落点 2', '0', '100');
    await fillSurvey(user, 1, '落点 1', '100', '300');
    const tol = screen.getByLabelText('全局允许偏差（毫米）');

    await user.type(tol, 'abc');
    expect(screen.getByTestId('survey-tolerance-error')).toHaveTextContent('不是有限数');
    expect(statusOf(surveyRows()[0])).toBe('输入无效');

    await user.clear(tol);
    await user.type(tol, '-2');
    expect(screen.getByTestId('survey-tolerance-error')).toHaveTextContent('负数');
    expect(statusOf(surveyRows()[0])).toBe('输入无效');

    await user.clear(tol);
    await user.type(tol, '5');
    expect(statusOf(surveyRows()[0])).toBe('合格');
  });

  it('只填写一个坐标或非有限数时该行无效、标红对应控件并说明；修正后即时恢复', async () => {
    const user = userEvent.setup();
    render(<App />);
    await fillValidBases(user);
    await fillDesignPoint(user, 1, '落点 1', '100', '0');
    await fillDesignPoint(user, 2, '落点 2', '0', '100');
    await user.type(screen.getByLabelText('全局允许偏差（毫米）'), '5');

    const sx = screen.getByLabelText('第 1 个落点（落点 1）现场复测 x');
    const sy = screen.getByLabelText('第 1 个落点（落点 1）现场复测 y');

    // 只填 x
    await user.type(sx, '100');
    let rows = surveyRows();
    expect(statusOf(rows[0])).toBe('输入无效');
    expect(sy).toHaveAttribute('aria-invalid', 'true');
    expect(sx).not.toHaveAttribute('aria-invalid');
    expect(screen.getByText(/复测 y 为空/)).toBeInTheDocument();

    // 把 y 填成非有限数
    await user.type(sy, 'Infinity');
    rows = surveyRows();
    expect(statusOf(rows[0])).toBe('输入无效');
    expect(sy).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/Infinity.*有限数/)).toBeInTheDocument();
    // 另一行仍未录入，换算结果仍在
    expect(statusOf(rows[1])).toBe('未录入');
    expect(screen.getByTestId('result-table')).toBeInTheDocument();

    // 修正为成对有限数（与期望重合），即时恢复合格
    await user.clear(sy);
    await user.type(sy, '300');
    rows = surveyRows();
    expect(statusOf(rows[0])).toBe('合格');
    expect(sy).not.toHaveAttribute('aria-invalid');
  });

  it('合格值改成超差值后即时更新，其余行与换算坐标保持不变', async () => {
    const user = userEvent.setup();
    render(<App />);
    await fillValidBases(user);
    await fillDesignPoint(user, 1, '落点 1', '100', '0');
    await fillDesignPoint(user, 2, '落点 2', '0', '100');
    await user.type(screen.getByLabelText('全局允许偏差（毫米）'), '5');
    await fillSurvey(user, 1, '落点 1', '100', '300'); // 偏差 0：合格
    await fillSurvey(user, 2, '落点 2', '0', '200'); // 偏差 0：合格

    let rows = surveyRows();
    expect(statusOf(rows[0])).toBe('合格');
    expect(statusOf(rows[1])).toBe('合格');

    // 第 1 行复测 x 改成 110：直线偏差 10 > 5，立即超差
    const sx = screen.getByLabelText('第 1 个落点（落点 1）现场复测 x');
    await user.clear(sx);
    await user.type(sx, '110');
    rows = surveyRows();
    expect(statusOf(rows[0])).toBe('超差');
    expect(statusOf(rows[1])).toBe('合格'); // 其余行不变
    // 偏差列展示：纵向 0（现场方向 +y），横向 −10，直线 10.00
    expect(rows[0]).toHaveTextContent('10.00');

    // 换算坐标不被复测影响：仍是 (100,300) 与 (0,200)
    const cells = within(screen.getByTestId('result-table')).getAllByRole('cell');
    expect(cells[3]).toHaveTextContent('100.00');
    expect(cells[4]).toHaveTextContent('300.00');

    // 改回后恢复合格
    await user.clear(sx);
    await user.type(sx, '100');
    expect(statusOf(surveyRows()[0])).toBe('合格');
  });

  it('恰好等于允许偏差（3-4-5 边界）显示合格', async () => {
    const user = userEvent.setup();
    render(<App />);
    await fillValidBases(user);
    await fillDesignPoint(user, 1, '落点 1', '100', '0');
    await fillDesignPoint(user, 2, '落点 2', '0', '100');
    await user.type(screen.getByLabelText('全局允许偏差（毫米）'), '5');
    // 期望 (100,300)，实测 (103,304)：dx=3、沿 +y 的纵向 4，直线偏差恰为 5
    await fillSurvey(user, 1, '落点 1', '103', '304');
    const row = surveyRows()[0];
    expect(statusOf(row)).toBe('合格');
    expect(row).toHaveTextContent('+4.00'); // 纵向
    expect(row).toHaveTextContent('-3.00'); // 横向（+90° 场景横向正方向为 −x）
    expect(row).toHaveTextContent('5.00'); // 直线偏差
  });

  it('同名落点动态增删时复测数据按内部标识关联，删除后不串到其他行', async () => {
    const user = userEvent.setup();
    render(<App />);
    await fillValidBases(user);
    // 两行改成同名“灯位”
    const name1 = screen.getByLabelText('第 1 个落点名称');
    const name2 = screen.getByLabelText('第 2 个落点名称');
    await user.clear(name1);
    await user.type(name1, '灯位');
    await user.clear(name2);
    await user.type(name2, '灯位');
    await fillDesignPoint(user, 1, '灯位', '100', '0'); // -> (100,300)
    await fillDesignPoint(user, 2, '灯位', '0', '100'); // -> (0,200)
    await user.type(screen.getByLabelText('全局允许偏差（毫米）'), '5');
    await fillSurvey(user, 1, '灯位', '110', '300'); // 第 1 行：超差
    await fillSurvey(user, 2, '灯位', '0', '200'); // 第 2 行：合格

    // 删除第 1 行（超差那行）
    await user.click(screen.getAllByRole('button', { name: /删除/ })[0]);

    // 剩余的是原第 2 行（id=2），其复测输入必须仍是 0 / 200，且判定合格
    const sx = screen.getByLabelText('第 1 个落点（灯位）现场复测 x');
    const sy = screen.getByLabelText('第 1 个落点（灯位）现场复测 y');
    expect(sx).toHaveValue('0');
    expect(sy).toHaveValue('200');
    const rows = surveyRows();
    expect(rows).toHaveLength(1);
    expect(statusOf(rows[0])).toBe('合格');
    // 换算结果中同名落点保留的是 (0,200) 这一行
    const cells = within(screen.getByTestId('result-table')).getAllByRole('cell');
    expect(cells[3]).toHaveTextContent('0.00');
    expect(cells[4]).toHaveTextContent('200.00');

    // 新增一行：复测数据为空、未录入（设计坐标仍需成对填写以保持换算成功）
    await user.click(screen.getByTestId('add-point'));
    await user.clear(screen.getByLabelText('第 2 个落点名称'));
    await user.type(screen.getByLabelText('第 2 个落点名称'), '灯位');
    await fillDesignPoint(user, 2, '灯位', '50', '50');
    const surveyAfterAdd = surveyRows();
    expect(surveyAfterAdd).toHaveLength(2);
    expect(statusOf(surveyAfterAdd[1])).toBe('未录入');
    expect(statusOf(surveyAfterAdd[0])).toBe('合格'); // 原行不受影响
  });
});
