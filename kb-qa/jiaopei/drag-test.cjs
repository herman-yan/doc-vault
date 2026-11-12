/* drag-test.cjs — 教培业务页 拖拽入库实测
 * 覆盖需求④（整体文件夹拖拽 → 按学校/项目层级还原）
 * 与需求⑤（分布区自建文件夹 + 编辑名称）
 *
 * 两条入库路径分别验证：
 *   A. webkitRelativePath（<input webkitdirectory> / 部分浏览器拖拽回退）
 *   B. 真实 drop 事件链路（window drop → collectDropped → ingestDropped）
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE = 'http://127.0.0.1:8899/kb-qa/jiaopei/';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, label) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; fails.push(label); console.log('  ✗ ' + label); }
}

/* 造真实目录树：顶层目录名 = 学校名（模拟用户拖入一个学校文件夹） */
function makeFixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-fx-'));
  const mk = (rel, content) => {
    const p = path.join(base, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  };
  // 学校一：两个项目 + 一层嵌套子目录
  mk('芳草地小学/2026春课后服务/合同.pdf', '%PDF-1.4 contract');
  mk('芳草地小学/2026春课后服务/教学资料/课表.xlsx', 'xlsx');
  mk('芳草地小学/2026秋项目/预算.xlsx', 'xlsx');
  // 学校二
  mk('朝阳实验小学/资料/简介.docx', 'docx');
  return base;
}

(async () => {
  const fixture = makeFixture();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  console.log('\n=== 0. 清库重载，保证干净状态 ===');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.evaluate(() => new Promise(res => {
    const r = indexedDB.deleteDatabase('jiaopei-vault');
    r.onsuccess = r.onerror = r.onblocked = () => res();
  }));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  ok(await page.locator('#treeScroll .node-row').count() === 3, '初始 3 所预设学校');

  console.log('\n=== 1. 路径 A：选择学校文件夹（webkitRelativePath） ===');
  await page.evaluate(() => { document.getElementById('dirInput').style.display = 'block'; });
  await page.setInputFiles('#dirInput', path.join(fixture, '芳草地小学'));
  await page.waitForTimeout(2000);

  let treeNames = await page.locator('#treeScroll .node-name').allTextContents();
  ok(treeNames.includes('2026春课后服务'), '项目子文件夹「2026春课后服务」已建');
  ok(treeNames.includes('2026秋项目'), '项目子文件夹「2026秋项目」已建');
  ok(treeNames.includes('教学资料'), '嵌套子文件夹「教学资料」已建');
  ok(!treeNames.includes('芳草地小学 (2)'), '同名学校未重复创建（合并进预设）');
  ok(!treeNames.some(t => t.indexOf('jp-fx-') === 0), '未产生临时目录层级');

  console.log('\n=== 2. 文件落到正确层级 ===');
  await page.locator('#mainBody .card-folder', { hasText: '芳草地小学' }).first().click();
  await page.waitForTimeout(400);
  let lvl2 = await page.locator('#mainBody .card-folder .card-name').allTextContents();
  ok(lvl2.includes('2026春课后服务'), '学校下显示项目「2026春课后服务」');
  ok(lvl2.includes('2026秋项目'), '学校下显示项目「2026秋项目」');

  await page.locator('#mainBody .card-folder', { hasText: '2026春课后服务' }).first().click();
  await page.waitForTimeout(400);
  let lvl3 = await page.locator('#mainBody .card .card-name').allTextContents();
  ok(lvl3.includes('合同.pdf'), '项目下含「合同.pdf」');
  ok(lvl3.includes('教学资料'), '项目下含嵌套文件夹「教学资料」');

  await page.locator('#mainBody .card-folder', { hasText: '教学资料' }).first().click();
  await page.waitForTimeout(400);
  let lvl4 = await page.locator('#mainBody .card .card-name').allTextContents();
  ok(lvl4.includes('课表.xlsx'), '三层嵌套下的文件正确落位');

  console.log('\n=== 3. 路径 B：真实 drop 事件（构造 DataTransfer） ===');
  // 回到根，用 drop 事件拖入第二个学校
  await page.click('#crumb .crumb-item:has-text("全部学校")');
  await page.waitForTimeout(300);

  const dropped = await page.evaluate(async () => {
    function mkFile(name, rel, content) {
      const f = new File([content], name, { type: 'text/plain' });
      Object.defineProperty(f, 'webkitRelativePath', { value: rel, configurable: true });
      return f;
    }
    const files = [
      mkFile('简介.docx', '朝阳实验小学/资料/简介.docx', 'docx'),
      mkFile('招生简章.pdf', '朝阳实验小学/招生/2026/招生简章.pdf', 'pdf')
    ];
    const dt = new DataTransfer();
    files.forEach(f => dt.items.add(f));
    // drop 到 window（走全局处理器）
    const ev = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    return files.length;
  });
  ok(dropped === 2, '构造了 2 个文件用于 drop');
  await page.waitForTimeout(2500);

  treeNames = await page.locator('#treeScroll .node-name').allTextContents();
  ok(treeNames.includes('资料'), 'drop 路径创建「资料」');
  ok(treeNames.includes('招生'), 'drop 路径创建「招生」');
  ok(treeNames.includes('2026'), 'drop 路径创建深层「2026」');

  console.log('\n=== 4. 拖到具体节点（平铺入该文件夹） ===');
  await page.click('#crumb .crumb-item:has-text("全部学校")');
  await page.waitForTimeout(300);
  await page.locator('#mainBody .card-folder', { hasText: '朝阳实验小学' }).first().click();
  await page.waitForTimeout(400);
  const beforeFiles = await page.locator('#mainBody .card').count();

  const dropped2 = await page.evaluate(() => {
    const f = new File(['x'], '散装文件.txt', { type: 'text/plain' });
    const dt = new DataTransfer();
    dt.items.add(f);
    const target = document.querySelector('#mainBody');
    const ev = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
    target.dispatchEvent(ev);
    return true;
  });
  await page.waitForTimeout(2000);
  const afterFiles = await page.locator('#mainBody .card .card-name').allTextContents();
  ok(afterFiles.includes('散装文件.txt'), '零散文件平铺进当前文件夹');

  console.log('\n=== 5. 统计正确性 ===');
  const statsTxt = (await page.locator('#stats').textContent()).replace(/\s+/g, ' ');
  ok(/6\s*总文件/.test(statsTxt), `总文件 6（实际：${statsTxt.trim()}）`);

  console.log('\n=== 6. 分布区自建文件夹 + 编辑名称 ===');
  const row = page.locator('#treeScroll .node-row', { has: page.locator('.node-name', { hasText: '日坛中学' }) }).first();
  await row.hover();
  await row.locator('.node-op[data-act="add"]').click();
  await page.waitForSelector('#mSubName', { state: 'visible' });
  await page.fill('#mSubName', '临时项目');
  await page.click('#modalFoot button:has-text("创建")');
  await page.waitForTimeout(600);
  ok(await page.locator('#treeScroll .node-name', { hasText: '临时项目' }).count() > 0, '自建文件夹成功');

  const nm = page.locator('#treeScroll .node-name', { hasText: '临时项目' }).first();
  await nm.dblclick();
  await page.waitForTimeout(400);
  ok(await nm.getAttribute('contenteditable') === 'true', '双击进入编辑态');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('已改名项目');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
  ok(await page.locator('#treeScroll .node-name', { hasText: '已改名项目' }).count() > 0, '编辑名称生效');
  ok(await page.locator('#treeScroll .node-name', { hasText: '临时项目' }).count() === 0, '旧名称已消失');

  console.log('\n=== 7. Esc 取消改名 ===');
  const nm2 = page.locator('#treeScroll .node-name', { hasText: '已改名项目' }).first();
  await nm2.dblclick();
  await page.waitForTimeout(350);
  await page.keyboard.press('Control+A');
  await page.keyboard.type('不应保存');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  ok(await page.locator('#treeScroll .node-name', { hasText: '已改名项目' }).count() > 0, 'Esc 后保留原名');
  ok(await page.locator('#treeScroll .node-name', { hasText: '不应保存' }).count() === 0, '未保存输入被丢弃');

  console.log('\n=== 8. 刷新后全部保留 ===');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1300);
  const afterReload = await page.locator('#treeScroll .node-name').allTextContents();
  ok(afterReload.includes('2026春课后服务'), '刷新后项目在');
  ok(afterReload.includes('教学资料'), '刷新后嵌套文件夹在');
  ok(afterReload.includes('招生'), '刷新后 drop 创建的在');
  ok(afterReload.includes('已改名项目'), '刷新后改名结果在');
  const stats2 = (await page.locator('#stats').textContent()).replace(/\s+/g, ' ');
  ok(/6\s*总文件/.test(stats2), '刷新后文件数不变');

  console.log('\n=== 9. 下载文件 ===');
  await page.click('#crumb .crumb-item:has-text("全部学校")');
  await page.waitForTimeout(300);
  await page.locator('#mainBody .card-folder', { hasText: '芳草地小学' }).first().click();
  await page.waitForTimeout(300);
  await page.locator('#mainBody .card-folder', { hasText: '2026春课后服务' }).first().click();
  await page.waitForTimeout(400);
  const dl = await Promise.all([
    page.waitForEvent('download', { timeout: 9000 }).catch(() => null),
    page.locator('#mainBody .card', { hasText: '合同.pdf' }).first().click()
  ]);
  ok(dl[0] !== null, '点击文件卡片触发下载');
  if (dl[0]) ok(dl[0].suggestedFilename() === '合同.pdf', '下载文件名正确');

  console.log('\n=== 10. 无 JS 错误 ===');
  ok(errors.length === 0, `无控制台错误（实际 ${errors.length}）`);
  errors.slice(0, 5).forEach(e => console.log('    ! ' + e));

  await page.screenshot({ path: '._shot-drag.png' });
  await browser.close();
  fs.rmSync(fixture, { recursive: true, force: true });

  console.log('\n' + '='.repeat(46));
  if (fail === 0) console.log(`✅ 拖拽与文件夹管理全部通过：${pass} 项`);
  else { console.log(`❌ 失败 ${fail} / 通过 ${pass}`); fails.forEach(f => console.log('  ✗ ' + f)); process.exitCode = 1; }
})().catch(e => { console.error('测试崩溃:', e); process.exitCode = 1; });
