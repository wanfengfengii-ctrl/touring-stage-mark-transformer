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

  test('极大但有限的落点坐标导致溢出时整批拒绝，并提示超出计算范围', async ({ page }) => {
    // 缩放率 2：现场坐标 2×1e308 = Infinity；输入本身仍是有限数
    await fillBases(page, {
      ax: '0', ay: '0', bx: '1000', by: '0',
      apx: '0', apy: '0', bpx: '2000', bpy: '0',
    });
    await fillPoint(page, 1, '巨值点', '1e308', '0');
    await fillPoint(page, 2, '正常点', '1', '1');

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('超出数值范围');
    // 不允许出现空缺符号或残缺结果
    await expect(page.getByTestId('result-table')).toHaveCount(0);
    await expect(page.getByText('—')).toHaveCount(0);
  });
});
