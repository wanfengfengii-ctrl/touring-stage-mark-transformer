import { expect, test, type Page } from '@playwright/test';

async function setField(page: Page, label: string, value: string) {
  await page.getByLabel(label, { exact: true }).fill(value);
}

async function fillBases(
  page: Page,
  b: {
    ax: string; ay: string; bx: string; by: string;
    apx: string; apy: string; bpx: string; bpy: string;
  },
) {
  await setField(page, '设计侧 · A · x（毫米）', b.ax);
  await setField(page, '设计侧 · A · y（毫米）', b.ay);
  await setField(page, '设计侧 · B · x（毫米）', b.bx);
  await setField(page, '设计侧 · B · y（毫米）', b.by);
  await setField(page, '现场侧 · A′ · x（毫米）', b.apx);
  await setField(page, '现场侧 · A′ · y（毫米）', b.apy);
  await setField(page, '现场侧 · B′ · x（毫米）', b.bpx);
  await setField(page, '现场侧 · B′ · y（毫米）', b.bpy);
}

async function fillPoint(page: Page, n: number, name: string, x: string, y: string) {
  await page.getByLabel(`第 ${n} 个落点名称`).fill(name);
  await page.getByLabel(`第 ${n} 个落点（${name}）x`).fill(x);
  await page.getByLabel(`第 ${n} 个落点（${name}）y`).fill(y);
}

async function setTolerance(page: Page, value: string) {
  await page.getByLabel('全局允许偏差（毫米）', { exact: true }).fill(value);
}

async function fillSurvey(page: Page, n: number, name: string, x: string, y: string) {
  await page.getByLabel(`第 ${n} 个落点（${name}）现场复测 x`).fill(x);
  await page.getByLabel(`第 ${n} 个落点（${name}）现场复测 y`).fill(y);
}

type RobustBases = {
  cx: string; cy: string; dx: string; dy: string;
  cpx: string; cpy: string; dpx: string; dpy: string;
};

async function fillRobust(page: Page, b: RobustBases, threshold: string) {
  await setField(page, '补录设计侧 · C · x（毫米）', b.cx);
  await setField(page, '补录设计侧 · C · y（毫米）', b.cy);
  await setField(page, '补录设计侧 · D · x（毫米）', b.dx);
  await setField(page, '补录设计侧 · D · y（毫米）', b.dy);
  await setField(page, '补录现场侧 · C′ · x（毫米）', b.cpx);
  await setField(page, '补录现场侧 · C′ · y（毫米）', b.cpy);
  await setField(page, '补录现场侧 · D′ · x（毫米）', b.dpx);
  await setField(page, '补录现场侧 · D′ · y（毫米）', b.dpy);
  await setField(page, '稳健校准 · 异常阈值（毫米，非负）', threshold);
}

function surveyRow(page: Page, n: number) {
  return page.getByTestId('survey-table').locator('tbody tr[data-testid="survey-row"]').nth(n);
}

test.describe('坐标换算台', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('初始页面只有录入表单与提示，无结果', async ({ page }) => {
    await expect(page.getByTestId('initial-hint')).toBeVisible();
    await expect(page.getByTestId('result-table')).toHaveCount(0);
    await expect(page.getByTestId('error-panel')).toHaveCount(0);
  });

  test('合法数据：平移 + 逆时针 90°，现场坐标与复核量正确', async ({ page }) => {
    await fillBases(page, {
      ax: '0', ay: '0', bx: '1000', by: '0',
      apx: '100', apy: '200', bpx: '100', bpy: '1200',
    });
    await fillPoint(page, 1, '中景区灯位', '100', '0');
    await fillPoint(page, 2, '下场口音箱', '0', '100');

    const results = page.getByRole('region', { name: '换算结果' });
    await expect(results).toBeVisible();
    await expect(results.getByText('1.000000')).toBeVisible();
    await expect(results.getByText('90.00°')).toBeVisible();

    const table = page.getByTestId('result-table');
    await expect(table.getByText('中景区灯位')).toBeVisible();
    await expect(table.getByText('下场口音箱')).toBeVisible();
    // (100,0) -> (100,300)；(0,100) -> (0,200)
    const firstRow = table.locator('tbody tr').nth(0);
    await expect(firstRow.locator('td').nth(3)).toHaveText('100.00');
    await expect(firstRow.locator('td').nth(4)).toHaveText('300.00');
    const secondRow = table.locator('tbody tr').nth(1);
    await expect(secondRow.locator('td').nth(3)).toHaveText('0.00');
    await expect(secondRow.locator('td').nth(4)).toHaveText('200.00');

    // 基准复核两行都在，且闭合差为 0
    await expect(results.getByText('A → A′')).toBeVisible();
    await expect(results.getByText('B → B′')).toBeVisible();
    await expect(results.locator('tbody td', { hasText: '0' }).first()).toBeVisible();
  });

  test('旋转方向：现场向量向下时必须是 -90°，不得写反', async ({ page }) => {
    await fillBases(page, {
      ax: '0', ay: '0', bx: '1000', by: '0',
      apx: '0', apy: '0', bpx: '0', bpy: '-1000',
    });
    await fillPoint(page, 1, 'P1', '100', '0');
    await fillPoint(page, 2, 'P2', '0', '0');

    await expect(page.getByText('-90.00°')).toBeVisible();
    const row = page.getByTestId('result-table').locator('tbody tr').nth(0);
    // (100,0) 顺时针 90° -> (0,-100)
    await expect(row.locator('td').nth(3)).toHaveText('0.00');
    await expect(row.locator('td').nth(4)).toHaveText('-100.00');
  });

  test('角差跨 ±180° 接缝时取短角（179° → -179° 为 +2°）', async ({ page }) => {
    const b = { x: Math.cos((179 * Math.PI) / 180) * 1000, y: Math.sin((179 * Math.PI) / 180) * 1000 };
    const bp = { x: Math.cos((-179 * Math.PI) / 180) * 1000, y: Math.sin((-179 * Math.PI) / 180) * 1000 };
    await fillBases(page, {
      ax: '0', ay: '0', bx: b.x.toFixed(6), by: b.y.toFixed(6),
      apx: '0', apy: '0', bpx: bp.x.toFixed(6), bpy: bp.y.toFixed(6),
    });
    await fillPoint(page, 1, 'P1', '0', '0');
    await fillPoint(page, 2, 'P2', '1', '1');
    await expect(page.getByText('2.00°')).toBeVisible();
  });

  test('缩放率展示：设计 2000 mm 对应现场 1000 mm 即 50.00%', async ({ page }) => {
    await fillBases(page, {
      ax: '0', ay: '0', bx: '2000', by: '0',
      apx: '0', apy: '0', bpx: '1000', bpy: '0',
    });
    await fillPoint(page, 1, 'P1', '1000', '400');
    await fillPoint(page, 2, 'P2', '0', '0');
    await expect(page.getByText('0.500000')).toBeVisible();
    await expect(page.getByText('50.00%')).toBeVisible();
    const row = page.getByTestId('result-table').locator('tbody tr').nth(0);
    await expect(row.locator('td').nth(3)).toHaveText('500.00');
    await expect(row.locator('td').nth(4)).toHaveText('200.00');
  });

  test('舍入：半点向绝对值增大方向（1.005→1.01，-2.345→-2.35）', async ({ page }) => {
    await fillBases(page, {
      ax: '0', ay: '0', bx: '1000', by: '0',
      apx: '0', apy: '0', bpx: '1000', bpy: '0',
    });
    await fillPoint(page, 1, '半点正', '1.005', '0');
    await fillPoint(page, 2, '半点负', '0', '-2.345');
    const rows = page.getByTestId('result-table').locator('tbody tr');
    await expect(rows.nth(0).locator('td').nth(3)).toHaveText('1.01');
    await expect(rows.nth(1).locator('td').nth(4)).toHaveText('-2.35');
  });

  test('合法后清空任一字段：结果整批消失并报错；补回后完整替换为新结果', async ({ page }) => {
    await fillBases(page, {
      ax: '0', ay: '0', bx: '1000', by: '0',
      apx: '0', apy: '0', bpx: '2000', bpy: '0',
    });
    await fillPoint(page, 1, 'P1', '100', '0');
    await fillPoint(page, 2, 'P2', '0', '0');
    await expect(page.getByText('2.000000')).toBeVisible();

    // 清空现场 B′ x
    await setField(page, '现场侧 · B′ · x（毫米）', '');
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByTestId('result-table')).toHaveCount(0);
    await expect(page.getByText('2.000000')).toHaveCount(0);
    await expect(page.getByText(/为空/)).toBeVisible();

    // 补回不同的值（缩放变为 3），旧结果不得残留
    await setField(page, '现场侧 · B′ · x（毫米）', '3000');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByText('3.000000')).toBeVisible();
    await expect(page.getByText('2.000000')).toHaveCount(0);
    const row = page.getByTestId('result-table').locator('tbody tr').nth(0);
    await expect(row.locator('td').nth(3)).toHaveText('300.00');
  });

  test('非有限数输入被拒绝并指出字段', async ({ page }) => {
    await fillBases(page, {
      ax: '0', ay: '0', bx: '1000', by: '0',
      apx: '0', apy: '0', bpx: '1000', bpy: '0',
    });
    await fillPoint(page, 1, 'P1', 'abc', '0');
    await fillPoint(page, 2, 'P2', 'Infinity', '0');
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByText(/不是有限数/).first()).toBeVisible();
    await expect(page.getByTestId('result-table')).toHaveCount(0);
  });

  test('设计侧基准重合时拒绝', async ({ page }) => {    await fillBases(page, {
      ax: '5', ay: '5', bx: '5', by: '5',
      apx: '0', apy: '0', bpx: '1000', bpy: '0',
    });
    await fillPoint(page, 1, 'P1', '1', '1');
    await fillPoint(page, 2, 'P2', '2', '2');
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByText(/重合/)).toBeVisible();
    await expect(page.getByTestId('result-table')).toHaveCount(0);
  });

  test('动态增删落点后结果行数随之完整替换', async ({ page }) => {
    await fillBases(page, {
      ax: '0', ay: '0', bx: '1000', by: '0',
      apx: '0', apy: '0', bpx: '1000', bpy: '0',
    });
    await fillPoint(page, 1, 'P1', '1', '1');
    await fillPoint(page, 2, 'P2', '2', '2');
    await expect(page.getByTestId('result-table').locator('tbody tr')).toHaveCount(2);

    await page.getByTestId('add-point').click();
    await page.getByLabel('第 3 个落点名称').fill('P3');
    await page.getByLabel('第 3 个落点（P3）x').fill('3');
    await page.getByLabel('第 3 个落点（P3）y').fill('3');
    await expect(page.getByTestId('result-table').locator('tbody tr')).toHaveCount(3);

    await page.getByRole('button', { name: '删除第 3 个落点' }).click();
    await expect(page.getByTestId('result-table').locator('tbody tr')).toHaveCount(2);
  });

  test('两个落点同名时仍保留并分别换算', async ({ page }) => {
    await fillBases(page, {
      ax: '0', ay: '0', bx: '1000', by: '0',
      apx: '0', apy: '0', bpx: '1000', bpy: '0',
    });
    await fillPoint(page, 1, '灯位', '100', '0');
    await fillPoint(page, 2, '灯位', '0', '100');

    await expect(page.getByRole('alert')).toHaveCount(0);
    const rows = page.getByTestId('result-table').locator('tbody tr');
    await expect(rows).toHaveCount(2);
    // 两个同名落点各自换算，坐标不同
    await expect(rows.nth(0).locator('td').nth(3)).toHaveText('100.00');
    await expect(rows.nth(0).locator('td').nth(4)).toHaveText('0.00');
    await expect(rows.nth(1).locator('td').nth(3)).toHaveText('0.00');
    await expect(rows.nth(1).locator('td').nth(4)).toHaveText('100.00');
  });

  test('恒等换算下极大但有限的落点坐标超出展示范围时整批拒绝，并提示超出计算范围', async ({ page }) => {
    // 恒等基准：现场坐标 = 1e308 本身有限，但两位小数展示需 ×100 → Infinity。
    await fillBases(page, {
      ax: '0', ay: '0', bx: '1000', by: '0',
      apx: '0', apy: '0', bpx: '1000', bpy: '0',
    });
    await fillPoint(page, 1, '巨值点', '1e308', '0');
    await fillPoint(page, 2, '正常点', '1', '1');

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('超出数值范围');
    // 整批清除：无结果表、无 Infinity、无空缺符号
    await expect(page.getByTestId('result-table')).toHaveCount(0);
    await expect(page.getByText('Infinity')).toHaveCount(0);
    await expect(page.getByText('—')).toHaveCount(0);
  });

  test.describe('现场复测核对', () => {
    test('未使用复测功能时行为不变：换算成功前无复测面板，默认全部未录入', async ({ page }) => {
      await expect(page.getByRole('region', { name: '现场复测核对' })).toHaveCount(0);
      await fillBases(page, {
        ax: '0', ay: '0', bx: '1000', by: '0',
        apx: '100', apy: '200', bpx: '100', bpy: '1200',
      });
      await fillPoint(page, 1, '落点 1', '100', '0');
      await fillPoint(page, 2, '落点 2', '0', '100');

      const panel = page.getByRole('region', { name: '现场复测核对' });
      await expect(panel).toBeVisible();
      const statuses = page.getByTestId('survey-status');
      await expect(statuses.nth(0)).toHaveText('未录入');
      await expect(statuses.nth(1)).toHaveText('未录入');
      await expect(page.getByTestId('survey-idle-note')).toBeVisible();
    });

    test('全精度判定：旋转+缩放下，按页面展示的期望坐标会得到相反结论，证明判定未使用舍入坐标', async ({ page }) => {
      // 设计基准 (0,0)-(10000,0)；现场基准 (0,0)-(0,3333.2)：
      // s = 3333.2/10000 = 0.33332，θ = +90°。
      // 落点 1 设计 (0,-300)：全精度期望现场 (s*300, 0) = (99.996, 0)，
      // 但期望现场坐标两位小数展示为 100.00；允许偏差 0.006（本身小于 0.01 mm）。
      await fillBases(page, {
        ax: '0', ay: '0', bx: '10000', by: '0',
        apx: '0', apy: '0', bpx: '0', bpy: '3333.2',
      });
      await fillPoint(page, 1, '复测点', '0', '-300');
      await fillPoint(page, 2, '参照点', '0', '0');

      const row0 = surveyRow(page, 0);
      // 前置断言：期望现场 x 展示为 100.00（全精度实为 99.996）
      await expect(row0.locator('td').nth(1)).toHaveText('100.00');
      await setTolerance(page, '0.006');

      // 笔一：复测 (100.005, 0)。
      // 全精度差 |100.005−99.996|≈0.009 > 0.006 -> 超差，展示直线偏差 0.01；
      // 若判定误用页面展示的期望 100.00，则偏差仅 0.005 ≤ 0.006，会被误判合格。
      await fillSurvey(page, 1, '复测点', '100.005', '0');
      await expect(row0.locator('td').nth(7)).toHaveText('0.01');
      await expect(row0.getByTestId('survey-status')).toHaveText('超差');

      // 笔二：复测 (99.991, 0)。
      // 全精度差 |99.996−99.991|≈0.005 ≤ 0.006 -> 合格，展示直线偏差 0.00；
      // 若判定误用页面展示的期望 100.00，则偏差 0.009（展示 0.01）> 0.006，会被误判超差。
      await fillSurvey(page, 1, '复测点', '99.991', '0');
      await expect(row0.locator('td').nth(7)).toHaveText('0.00');
      await expect(row0.getByTestId('survey-status')).toHaveText('合格');
      // 期望现场坐标的展示仍是 100.00，换算结果未被复测改动
      await expect(row0.locator('td').nth(1)).toHaveText('100.00');
    });

    test('合格值改为超差值后即时更新，其余行与换算坐标不变', async ({ page }) => {
      await fillBases(page, {
        ax: '0', ay: '0', bx: '1000', by: '0',
        apx: '100', apy: '200', bpx: '100', bpy: '1200',
      });
      await fillPoint(page, 1, '灯位', '100', '0'); // -> (100,300)
      await fillPoint(page, 2, '灯位', '0', '100'); // -> (0,200)
      await setTolerance(page, '5');
      await fillSurvey(page, 1, '灯位', '100', '300');
      await fillSurvey(page, 2, '灯位', '0', '200');

      await expect(surveyRow(page, 0).getByTestId('survey-status')).toHaveText('合格');
      await expect(surveyRow(page, 1).getByTestId('survey-status')).toHaveText('合格');

      // 第 1 行复测 x 由 100 改为 110：直线偏差 10 > 5，立即超差
      await page.getByLabel('第 1 个落点（灯位）现场复测 x').fill('110');
      await expect(surveyRow(page, 0).getByTestId('survey-status')).toHaveText('超差');
      await expect(surveyRow(page, 0).locator('td').nth(7)).toHaveText('10.00');
      // 其余行仍合格
      await expect(surveyRow(page, 1).getByTestId('survey-status')).toHaveText('合格');
      // 换算坐标完全不变
      const results = page.getByTestId('result-table').locator('tbody tr');
      await expect(results.nth(0).locator('td').nth(3)).toHaveText('100.00');
      await expect(results.nth(0).locator('td').nth(4)).toHaveText('300.00');
      await expect(results.nth(1).locator('td').nth(3)).toHaveText('0.00');
      await expect(results.nth(1).locator('td').nth(4)).toHaveText('200.00');
      // 基准复核保留
      await expect(page.getByText('A → A′')).toBeVisible();

      // 改回合格值即时恢复
      await page.getByLabel('第 1 个落点（灯位）现场复测 x').fill('100');
      await expect(surveyRow(page, 0).getByTestId('survey-status')).toHaveText('合格');
    });

    test('边界：直线偏差恰等于允许偏差（3-4-5）判合格，并正确分解纵向/横向差', async ({ page }) => {
      await fillBases(page, {
        ax: '0', ay: '0', bx: '1000', by: '0',
        apx: '100', apy: '200', bpx: '100', bpy: '1200',
      });
      await fillPoint(page, 1, 'P1', '100', '0'); // 期望 (100,300)
      await fillPoint(page, 2, 'P2', '0', '0');
      await setTolerance(page, '5');
      // 实测 (103,304)：现场基准沿 +y，纵向 +4、横向 −3、直线恰为 5
      await fillSurvey(page, 1, 'P1', '103', '304');
      const row = surveyRow(page, 0);
      await expect(row.getByTestId('survey-status')).toHaveText('合格');
      await expect(row.locator('td').nth(5)).toHaveText('+4.00'); // 纵向差
      await expect(row.locator('td').nth(6)).toHaveText('-3.00'); // 横向差
      await expect(row.locator('td').nth(7)).toHaveText('5.00'); // 直线偏差
    });

    test('只填一个坐标或非有限数：该行输入无效并在控件附近说明，其他行与换算保留，修正后恢复', async ({ page }) => {
      await fillBases(page, {
        ax: '0', ay: '0', bx: '1000', by: '0',
        apx: '0', apy: '0', bpx: '1000', bpy: '0',
      });
      await fillPoint(page, 1, 'P1', '100', '0');
      await fillPoint(page, 2, 'P2', '0', '0');
      await setTolerance(page, '5');

      // 只填复测 x
      await page.getByLabel('第 1 个落点（P1）现场复测 x').fill('100');
      await expect(surveyRow(page, 0).getByTestId('survey-status')).toHaveText('输入无效');
      await expect(page.getByText('复测 y 为空')).toBeVisible();
      await expect(page.getByLabel('第 1 个落点（P1）现场复测 y')).toHaveAttribute('aria-invalid', 'true');
      // 另一行未录入、换算结果仍保留
      await expect(surveyRow(page, 1).getByTestId('survey-status')).toHaveText('未录入');
      await expect(page.getByTestId('result-table')).toBeVisible();

      // y 改成非有限数
      await page.getByLabel('第 1 个落点（P1）现场复测 y').fill('abc');
      await expect(page.getByText(/abc.*有限数/)).toBeVisible();

      // 修正后即时恢复合格（与期望重合）
      await page.getByLabel('第 1 个落点（P1）现场复测 y').fill('0');
      await expect(surveyRow(page, 0).getByTestId('survey-status')).toHaveText('合格');
    });

    test('允许偏差为空/非有限/负数时无法核对并在控件附近说明；修正后恢复', async ({ page }) => {
      await fillBases(page, {
        ax: '0', ay: '0', bx: '1000', by: '0',
        apx: '0', apy: '0', bpx: '1000', bpy: '0',
      });
      await fillPoint(page, 1, 'P1', '100', '0');
      await fillPoint(page, 2, 'P2', '0', '0');
      await fillSurvey(page, 1, 'P1', '100', '0');

      // 为空（初始状态）
      await expect(surveyRow(page, 0).getByTestId('survey-status')).toHaveText('输入无效');
      await expect(page.getByTestId('survey-tolerance-error')).toContainText('允许偏差');
      await expect(surveyRow(page, 1).getByTestId('survey-status')).toHaveText('未录入');

      await setTolerance(page, 'xyz');
      await expect(page.getByTestId('survey-tolerance-error')).toContainText('有限数');
      await expect(surveyRow(page, 0).getByTestId('survey-status')).toHaveText('输入无效');

      await setTolerance(page, '-1');
      await expect(page.getByTestId('survey-tolerance-error')).toContainText('负数');

      await setTolerance(page, '0');
      await expect(page.getByTestId('survey-tolerance-error')).toHaveCount(0);
      await expect(surveyRow(page, 0).getByTestId('survey-status')).toHaveText('合格');
    });

    test('动态增删与同名落点：复测按内部标识关联，删除后不串到其他行', async ({ page }) => {
      await fillBases(page, {
        ax: '0', ay: '0', bx: '1000', by: '0',
        apx: '0', apy: '0', bpx: '1000', bpy: '0',
      });
      await fillPoint(page, 1, '灯位', '100', '0');
      await fillPoint(page, 2, '灯位', '0', '100');
      await setTolerance(page, '5');
      await fillSurvey(page, 1, '灯位', '110', '0'); // 第 1 行超差
      await fillSurvey(page, 2, '灯位', '0', '100'); // 第 2 行合格

      // 删除第 1 行（超差行）
      await page.getByRole('button', { name: '删除第 1 个落点' }).click();
      await expect(page.getByTestId('survey-table').locator('tbody tr[data-testid="survey-row"]')).toHaveCount(1);
      // 剩余行必须仍是原第 2 行的复测数据 (0,100) 且合格，不得串成 (110,0)
      await expect(page.getByLabel('第 1 个落点（灯位）现场复测 x')).toHaveValue('0');
      await expect(page.getByLabel('第 1 个落点（灯位）现场复测 y')).toHaveValue('100');
      await expect(surveyRow(page, 0).getByTestId('survey-status')).toHaveText('合格');

      // 新增一行（同名），新行复测为空且未录入，原行不受影响
      await page.getByTestId('add-point').click();
      await page.getByLabel('第 2 个落点名称').fill('灯位');
      await page.getByLabel('第 2 个落点（灯位）x').fill('50');
      await page.getByLabel('第 2 个落点（灯位）y').fill('50');
      await expect(surveyRow(page, 0).getByTestId('survey-status')).toHaveText('合格');
      await expect(surveyRow(page, 1).getByTestId('survey-status')).toHaveText('未录入');
      await expect(page.getByLabel('第 2 个落点（灯位）现场复测 x')).toHaveValue('');
    });
    test('有限极大复测坐标使合成偏差无法按毫米展示时，整行输入无效并说明原因（不得超差却空缺）', async ({ page }) => {
      // 现场基准方向 45°：A′=(0,0)，B′=(1000,1000)（s=√2）。
      // 落点设计 (0,0) -> 期望现场 (0,0)；复测 (a,a)，a=1.7e306（有限且 ×100 有限）。
      // 沿 45° 方向纵向差 = 直线偏差 = a·√2 ≈ 2.4e306，×100 溢出；
      // 旧实现会判“超差”，但纵向差/直线偏差列渲染成空缺“—”。
      await fillBases(page, {
        ax: '0', ay: '0', bx: '1000', by: '0',
        apx: '0', apy: '0', bpx: '1000', bpy: '1000',
      });
      await fillPoint(page, 1, '远点', '0', '0');
      await fillPoint(page, 2, '近点', '1', '1');
      await setTolerance(page, '5');
      await fillSurvey(page, 1, '远点', '1.7e306', '1.7e306');

      const row = surveyRow(page, 0);
      await expect(row.getByTestId('survey-status')).toHaveText('输入无效');
      await expect(page.getByText('复测偏差过大，超出数值范围')).toBeVisible();
      // 纵向差、横向差、直线偏差均不得给出结论/空缺混搭：整行偏差列统一为占位
      await expect(row.locator('td').nth(5)).toHaveText('—');
      await expect(row.locator('td').nth(6)).toHaveText('—');
      await expect(row.locator('td').nth(7)).toHaveText('—');
      // 复测坐标输入框本身合法（有限、可展示），不标红
      await expect(page.getByLabel('第 1 个落点（远点）现场复测 x')).not.toHaveAttribute('aria-invalid');
      // 换算结果与另一行不受影响
      await expect(page.getByTestId('result-table')).toBeVisible();
      await expect(surveyRow(page, 1).getByTestId('survey-status')).toHaveText('未录入');

      // 修正为可展示的成对坐标后即时恢复核对
      await fillSurvey(page, 1, '远点', '0', '0');
      await expect(surveyRow(page, 0).getByTestId('survey-status')).toHaveText('合格');
    });
  });

  test.describe('稳健校准补录', () => {
    test('补录区留空时行为与双点校准完全一致：无横幅、无判定列、基准复核两行', async ({ page }) => {
      await fillBases(page, {
        ax: '0', ay: '0', bx: '1000', by: '0',
        apx: '0', apy: '0', bpx: '1000', bpy: '0',
      });
      await fillPoint(page, 1, 'P1', '100', '0');
      await fillPoint(page, 2, 'P2', '0', '0');
      await expect(page.getByTestId('robust-banner')).toHaveCount(0);
      await expect(page.getByTestId('base-adoption')).toHaveCount(0);
      await expect(page.getByTestId('base-check-row')).toHaveCount(2);
      await expect(page.getByRole('alert')).toHaveCount(0);
    });

    test('单个离群基准（D 现场偏移 100mm）：剔除 D、采用 A/B/C，落点与复测期望都按重估模型换算', async ({ page }) => {
      // 真模型 s=2、θ=30°、平移 (50,-70)
      const th = (30 * Math.PI) / 180;
      const map = (x: number, y: number) => ({
        x: 50 + 2 * (Math.cos(th) * x - Math.sin(th) * y),
        y: -70 + 2 * (Math.sin(th) * x + Math.cos(th) * y),
      });
      const A = map(0, 0), B = map(1000, 0), C = map(0, 1000), D = map(1000, 1000);
      await fillBases(page, {
        ax: '0', ay: '0', bx: '1000', by: '0',
        apx: A.x.toFixed(6), apy: A.y.toFixed(6),
        bpx: B.x.toFixed(6), bpy: B.y.toFixed(6),
      });
      await fillRobust(page, {
        cx: '0', cy: '1000', dx: '1000', dy: '1000',
        cpx: C.x.toFixed(6), cpy: C.y.toFixed(6),
        // D 现场被错误测量：x 多 100mm
        dpx: (D.x + 100).toFixed(6), dpy: D.y.toFixed(6),
      }, '5');
      // 落点 (500,500) 的真模型现场坐标
      const want = map(500, 500);
      await fillPoint(page, 1, '灯位', '500', '500');
      await fillPoint(page, 2, '参照', '0', '0');

      const banner = page.getByTestId('robust-banner');
      await expect(banner).toBeVisible();
      await expect(banner).toContainText('共识集含 3 个可信基准（A、B、C）');
      await expect(banner).toContainText('剔除 D');
      // 缩放率/旋转角重估回真模型
      await expect(page.getByText('2.000000')).toBeVisible();
      await expect(page.getByText('30.00°')).toBeVisible();

      // 基准复核四行：A/B/C 采用、D 剔除
      const checkRows = page.getByTestId('base-check-row');
      await expect(checkRows).toHaveCount(4);
      await expect(checkRows.nth(0)).toHaveAttribute('data-adopted', 'adopted');
      await expect(checkRows.nth(3)).toHaveAttribute('data-adopted', 'rejected');
      await expect(checkRows.nth(3)).toContainText('剔除');

      // 落点消费重估模型
      const row = page.getByTestId('result-table').locator('tbody tr').nth(0);
      await expect(row.locator('td').nth(3)).toHaveText(want.x.toFixed(2));
      await expect(row.locator('td').nth(4)).toHaveText(want.y.toFixed(2));

      // 复测期望坐标同样消费重估模型：与期望重合到 1e-6 内 → 小容差下合格
      await setTolerance(page, '0.001');
      await fillSurvey(page, 1, '灯位', want.x.toFixed(6), want.y.toFixed(6));
      await expect(surveyRow(page, 0).getByTestId('survey-status')).toHaveText('合格');

      // 反证：若误用 D 在内的候选（如 CD），期望坐标会明显不同
      await expect(surveyRow(page, 0).locator('td').nth(1)).toHaveText(want.x.toFixed(2));
      await expect(surveyRow(page, 0).locator('td').nth(2)).toHaveText(want.y.toFixed(2));
    });

    test('对称冲突同分：AB/AC/BC 三候选共识与残差和相同，字典序决胜 AB，结果确定', async ({ page }) => {
      // identity：A/B/C 精确，D=(1100,1000) 离群 100mm，阈值 1
      await fillBases(page, {
        ax: '0', ay: '0', bx: '1000', by: '0',
        apx: '0', apy: '0', bpx: '1000', bpy: '0',
      });
      await fillRobust(page, {
        cx: '0', cy: '1000', dx: '1000', dy: '1000',
        cpx: '0', cpy: '1000', dpx: '1100', dpy: '1000',
      }, '1');
      await fillPoint(page, 1, 'P1', '100', '0');
      await fillPoint(page, 2, 'P2', '0', '0');

      const banner = page.getByTestId('robust-banner');
      await expect(banner).toContainText('胜出候选 AB');
      await expect(banner).toContainText('共识集含 3 个可信基准（A、B、C）');
      await expect(banner).toContainText('剔除 D');
      await expect(page.getByText('1.000000')).toBeVisible();
      const row = page.getByTestId('result-table').locator('tbody tr').nth(0);
      await expect(row.locator('td').nth(3)).toHaveText('100.00');
      await expect(row.locator('td').nth(4)).toHaveText('0.00');
    });

    test('全体冲突：任何候选共识都不足三点，确定性失败并清除换算结果', async ({ page }) => {
      await fillBases(page, {
        ax: '0', ay: '0', bx: '1000', by: '0',
        apx: '0', apy: '0', bpx: '2000', bpy: '0',
      });
      await fillPoint(page, 1, 'P1', '100', '0');
      await fillPoint(page, 2, 'P2', '0', '0');
      await expect(page.getByTestId('result-table')).toBeVisible();

      await fillRobust(page, {
        cx: '0', cy: '1000', dx: '1000', dy: '1000',
        cpx: '0', cpy: '500', dpx: '-3000', dpy: '-3000',
      }, '50');

      const alertBox = page.getByRole('alert').first();
      await expect(alertBox).toBeVisible();
      await expect(alertBox).toContainText('最佳共识集仅含 2 个可信基准点');
      await expect(page.getByTestId('result-table')).toHaveCount(0);
      // 换算结果清除，但复测面板以“暂不核对”挂起态保留录入
      await expect(page.getByRole('region', { name: '现场复测核对' })).toBeVisible();
      await expect(surveyRow(page, 0).getByTestId('survey-status')).toHaveText('暂不核对');
      // 落点录入仍保留，可立即修正
      await expect(page.getByTestId('named-row')).toHaveCount(2);
    });

    test('确定性失败后修正补录基准，原复测数据按行恢复核对', async ({ page }) => {
      // 设计基准 A=(0,0) B=(1000,0)；双点 s=2。
      await fillBases(page, {
        ax: '0', ay: '0', bx: '1000', by: '0',
        apx: '0', apy: '0', bpx: '2000', bpy: '0',
      });
      // 先用合法补录（C′、D′ 服从 s=2）让稳健换算成功
      await fillRobust(page, {
        cx: '0', cy: '1000', dx: '1000', dy: '1000',
        cpx: '0', cpy: '2000', dpx: '2000', dpy: '2000',
      }, '50');
      await fillPoint(page, 1, 'P1', '100', '0'); // s=2 → (200,0)
      await fillPoint(page, 2, 'P2', '0', '0');
      await setTolerance(page, '5');
      await fillSurvey(page, 1, 'P1', '200', '0'); // 与期望重合：合格
      await expect(surveyRow(page, 0).getByTestId('survey-status')).toHaveText('合格');

      // 把 C′、D′ 改成全体冲突配置 → 六个候选共识都不足三点，确定性失败：
      // 换算与复测面板消失，但落点、复测与容差录入全部保留
      await setField(page, '补录现场侧 · C′ · x（毫米）', '0');
      await setField(page, '补录现场侧 · C′ · y（毫米）', '500');
      await setField(page, '补录现场侧 · D′ · x（毫米）', '-3000');
      await setField(page, '补录现场侧 · D′ · y（毫米）', '-3000');
      await expect(page.getByRole('alert').first()).toBeVisible();
      await expect(page.getByTestId('result-table')).toHaveCount(0);
      // 换算与核对挂起：复测面板保留、状态“暂不核对”，录入不清除
      await expect(page.getByRole('region', { name: '现场复测核对' })).toBeVisible();
      await expect(surveyRow(page, 0).getByTestId('survey-status')).toHaveText('暂不核对');
      // 复测录入本身未被清除
      await expect(page.getByLabel('第 1 个落点（P1）现场复测 x')).toHaveValue('200');
      await expect(page.getByLabel('全局允许偏差（毫米）')).toHaveValue('5');

      // 修正 C′、D′ 恢复合法补录：换算恢复且原复测按行重新核对（无需重录）
      await setField(page, '补录现场侧 · C′ · x（毫米）', '0');
      await setField(page, '补录现场侧 · C′ · y（毫米）', '2000');
      await setField(page, '补录现场侧 · D′ · x（毫米）', '2000');
      await setField(page, '补录现场侧 · D′ · y（毫米）', '2000');
      await expect(page.getByRole('alert')).toHaveCount(0);
      await expect(page.getByTestId('result-table')).toBeVisible();
      await expect(surveyRow(page, 0).getByTestId('survey-status')).toHaveText('合格');
      await expect(page.getByLabel('第 1 个落点（P1）现场复测 x')).toHaveValue('200');
      await expect(surveyRow(page, 1).getByTestId('survey-status')).toHaveText('未录入');
    });

    test('仅填写部分补录字段：按表单位置稳定列出全部缺项且不进入算法；补齐后恢复', async ({ page }) => {
      await fillBases(page, {
        ax: '0', ay: '0', bx: '1000', by: '0',
        apx: '0', apy: '0', bpx: '1000', bpy: '0',
      });
      await fillPoint(page, 1, 'P1', '100', '0');
      await fillPoint(page, 2, 'P2', '0', '0');
      // 只填 C 的设计坐标与阈值，其余补录字段留空
      await setField(page, '补录设计侧 · C · x（毫米）', '0');
      await setField(page, '补录设计侧 · C · y（毫米）', '1000');
      await setField(page, '稳健校准 · 异常阈值（毫米，非负）', '5');

      const alertBox = page.getByRole('alert');
      await expect(alertBox).toBeVisible();
      const items = await alertBox.locator('li').allInnerTexts();
      // 缺 6 个补录坐标字段（C′x/y、Dx/y、D′x/y）
      expect(items).toHaveLength(6);
      expect(items[0]).toContain('补录设计基准点 D · x');
      expect(items[5]).toContain('补录现场基准点 D′ · y');
      await expect(page.getByTestId('result-table')).toHaveCount(0);

      await fillRobust(page, {
        cx: '0', cy: '1000', dx: '1000', dy: '1000',
        cpx: '0', cpy: '1000', dpx: '1000', dpy: '1000',
      }, '5');
      await expect(page.getByRole('alert')).toHaveCount(0);
      await expect(page.getByTestId('result-table')).toBeVisible();
      // 四点全部采用、无剔除
      await expect(page.getByTestId('robust-banner')).toContainText('无基准被剔除');
      const checkRows = page.getByTestId('base-check-row');
      await expect(checkRows).toHaveCount(4);
      for (let i = 0; i < 4; i++) {
        await expect(checkRows.nth(i)).toHaveAttribute('data-adopted', 'adopted');
      }
    });
  });
});
