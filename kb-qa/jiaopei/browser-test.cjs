/* browser-test.cjs — 教培业务页 浏览器端实测（Playwright）
 * 验证：页面加载、预设学校、新建学校、自建子文件夹、重命名、导出结构、持久化
 */
const { chromium } = require('playwright');

const BASE = 'http://127.0.0.1:8899/kb-qa/jiaopei/';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, label) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; fails.push(label); console.log('  ✗ ' + label); }
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  console.log('\n=== 1. 页面加载 ===');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  ok(await page.title() === '教培业务 · 共享文件夹库', '标题正确');
  ok((await page.locator('.logo-txt h1').textContent()).includes('教培业务'), '页头标题');
  ok(await page.locator('.tree-panel').isVisible(), '左侧文件夹区可见');
  ok(await page.locator('#mainBody').isVisible(), '右侧主区可见');

  console.log('\n=== 2. 预设学校（首次加载自动写入） ===');
  await page.waitForTimeout(500);
  const schoolNames = await page.locator('#treeScroll .node-row .node-name').allTextContents();
  ok(schoolNames.length === 3, `预设 3 所学校，实际 ${schoolNames.length}`);
  ok(schoolNames.includes('芳草地小学'), '含「芳草地小学」');
  ok(schoolNames.includes('朝阳实验小学'), '含「朝阳实验小学」');
  ok(schoolNames.includes('日坛中学'), '含「日坛中学」');

  console.log('\n=== 3. 新建学校 ===');
  await page.click('#btnNewSchool');
  await page.waitForSelector('#mSchoolName', { state: 'visible' });
  await page.fill('#mSchoolName', '第三实验中学');
  await page.click('#modalFoot button:has-text("创建")');
  await page.waitForTimeout(500);
  const after = await page.locator('#treeScroll .node-row .node-name').allTextContents();
  ok(after.includes('第三实验中学'), '新建学校出现在树中');
  ok(after.length === 4, `学校数增至 4，实际 ${after.length}`);
  ok((await page.locator('#crumb .crumb-cur').textContent()) === '第三实验中学', '自动跳到新学校');

  console.log('\n=== 4. 预设 chip 填入 ===');
  await page.click('#btnNewSchool');
  await page.waitForSelector('#mPresets', { state: 'visible' });
  await page.click('#mPresets .preset-chip:has-text("日坛中学")');
  const chipVal = await page.inputValue('#mSchoolName');
  ok(chipVal === '日坛中学', '点 chip 填入名称');
  await page.click('#modalFoot button:has-text("取消")');
  await page.waitForTimeout(300);

  console.log('\n=== 5. 自建子文件夹（悬停节点 → ＋） ===');
  // 定位「第三实验中学」节点行
  const row = page.locator('#treeScroll .node-row', { has: page.locator('.node-name', { hasText: '第三实验中学' }) }).first();
  await row.hover();
  await row.locator('.node-op[data-act="add"]').click();
  await page.waitForSelector('#mSubName', { state: 'visible' });
  await page.fill('#mSubName', '2026春 课后服务');
  await page.click('#modalFoot button:has-text("创建")');
  await page.waitForTimeout(500);

  // 展开后应看到子节点
  const subExists = await page.locator('#treeScroll .node-name', { hasText: '2026春 课后服务' }).count();
  ok(subExists > 0, '子文件夹出现在树中');

  console.log('\n=== 6. 主区展示子文件夹卡片 ===');
  await page.click('#crumb .crumb-item:has-text("全部学校")');
  await page.waitForTimeout(300);
  await page.locator('#mainBody .card-folder', { hasText: '第三实验中学' }).click();
  await page.waitForTimeout(400);
  const cardTxt = await page.locator('#mainBody .card-folder').first().textContent();
  ok(cardTxt.includes('2026春 课后服务'), '主区显示子文件夹卡片');
  ok(/0 子文件夹 · 0 文件/.test(cardTxt), '空子文件夹计数为 0');

  console.log('\n=== 7. 重命名（双击内联编辑） ===');
  const nameEl = page.locator('#treeScroll .node-name', { hasText: '2026春 课后服务' }).first();
  await nameEl.dblclick();
  await page.waitForTimeout(350);
  const editable = await nameEl.getAttribute('contenteditable');
  ok(editable === 'true', '双击后进入可编辑态');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('2026暑期托管');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  const renamed = await page.locator('#treeScroll .node-name', { hasText: '2026暑期托管' }).count();
  ok(renamed > 0, '重命名生效');

  console.log('\n=== 8. 重名自动加序号 ===');
  const row2 = page.locator('#treeScroll .node-row', { has: page.locator('.node-name', { hasText: '第三实验中学' }) }).first();
  await row2.hover();
  await row2.locator('.node-op[data-act="add"]').click();
  await page.waitForSelector('#mSubName', { state: 'visible' });
  await page.fill('#mSubName', '2026暑期托管');
  await page.click('#modalFoot button:has-text("创建")');
  await page.waitForTimeout(500);
  const dupCount = await page.locator('#treeScroll .node-name', { hasText: '2026暑期托管 (2)' }).count();
  ok(dupCount > 0, '同名自动加「(2)」');

  console.log('\n=== 9. 持久化（刷新后仍在） ===');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  const afterReload = await page.locator('#treeScroll .node-name').allTextContents();
  ok(afterReload.includes('第三实验中学'), '刷新后新学校仍在');
  ok(afterReload.some(t => t.includes('2026暑期托管')), '刷新后重命名结果保留');
  ok(!afterReload.includes('芳草地小学') === false, '预设学校仍在');

  console.log('\n=== 10. 统计条 ===');
  const statsTxt = await page.locator('#stats').textContent();
  ok(/学校/.test(statsTxt), '统计含学校数');
  ok(/总文件/.test(statsTxt), '统计含总文件数');

  console.log('\n=== 11. 使用说明弹窗 ===');
  await page.click('#btnHelp');
  await page.waitForTimeout(400);
  ok(await page.locator('#veil').isVisible(), '说明弹窗打开');
  const helpTxt = await page.locator('#modalBody').textContent();
  ok(helpTxt.includes('拖整个文件夹'), '说明含拖拽指引');
  ok(helpTxt.includes('企业微信微盘'), '说明含共享路径');
  await page.click('#modalFoot button:has-text("知道了")');
  await page.waitForTimeout(300);
  ok(!(await page.locator('#veil').isVisible()), '弹窗关闭');

  console.log('\n=== 12. 导出弹窗与结构预览 ===');
  await page.click('#btnExport');
  await page.waitForTimeout(400);
  const expTxt = await page.locator('#modalBody').textContent();
  const expFoot = await page.locator('#modalFoot').textContent();
  ok(expTxt.includes('结构预览'), '导出弹窗含结构预览');
  ok(expTxt.includes('第三实验中学'), '预览含新建的学校');
  ok(expFoot.includes('导出结构 JSON'), '含 JSON 导出按钮');
  ok(expFoot.includes('导出完整 ZIP'), '含 ZIP 导出按钮');
  await page.click('#modalFoot button:has-text("关闭")');
  await page.waitForTimeout(300);

  console.log('\n=== 13. 搜索 ===');
  await page.fill('#treeSearch', '芳草地');
  await page.waitForTimeout(500);
  const mainTxt = await page.locator('#mainBody').textContent();
  ok(mainTxt.includes('芳草地小学'), '搜索结果含芳草地小学');
  ok(mainTxt.includes('搜索'), '显示搜索态标签');
  await page.fill('#treeSearch', '');
  await page.waitForTimeout(500);

  console.log('\n=== 14. 删除确认弹窗 ===');
  const row3 = page.locator('#treeScroll .node-row', { has: page.locator('.node-name', { hasText: '第三实验中学' }) }).first();
  await row3.hover();
  await row3.locator('.node-op[data-act="del"]').click();
  await page.waitForTimeout(400);
  const delTxt = await page.locator('#modalBody').textContent();
  ok(delTxt.includes('删除确认') || delTxt.includes('确定删除'), '删除确认弹窗');
  ok(delTxt.includes('不可撤销'), '含风险提示');
  await page.click('#modalFoot button:has-text("取消")');
  await page.waitForTimeout(300);
  const stillThere = await page.locator('#treeScroll .node-name', { hasText: '第三实验中学' }).count();
  ok(stillThere > 0, '取消后未被删除');

  console.log('\n=== 15. 无 JS 错误 ===');
  ok(errors.length === 0, `无控制台错误（实际 ${errors.length} 条）`);
  if (errors.length) errors.slice(0, 6).forEach(e => console.log('    ! ' + e));

  await page.screenshot({ path: '._shot-main.png', fullPage: false });
  await browser.close();

  console.log('\n' + '='.repeat(46));
  if (fail === 0) console.log(`✅ 浏览器端全部通过：${pass} 项`);
  else { console.log(`❌ 失败 ${fail} / 通过 ${pass}`); fails.forEach(f => console.log('  ✗ ' + f)); process.exitCode = 1; }
})().catch(e => { console.error('测试崩溃:', e); process.exitCode = 1; });
