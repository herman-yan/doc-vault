/*
 * 报表中心页面渲染冒烟测试（Node + 轻量 DOM 桩）
 * 目的：不依赖浏览器，验证 15 项 KPI 渲染、日/周/月切换、节点时效、人效排名、
 *      周报导出 AOA 结构、导入分类等核心路径能跑通且产出合理内容。
 * 运行：node report-page.test.cjs
 */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log('  ✗ ' + m); } }
function sec(t) { console.log('\n== ' + t + ' =='); }

// ---------- 轻量 DOM 桩 ----------
function mkEl(id) {
  var el = {
    id: id, _html: '', className: '', dataset: {}, value: '', textContent: '',
    style: {}, classList: {
      _s: {},
      add: function (c) { this._s[c] = 1; },
      remove: function (c) { delete this._s[c]; },
      toggle: function (c, on) { if (on) this._s[c] = 1; else delete this._s[c]; },
      contains: function (c) { return !!this._s[c]; }
    },
    set innerHTML(v) { this._html = String(v); },
    get innerHTML() { return this._html; },
    addEventListener: function () {},
    appendChild: function () {},
    querySelectorAll: function () { return []; }
  };
  return el;
}
var els = {};
['view', 'uploadBar', 'modalOverlay', 'modalContent', 'excelInput', 'identityBar', 'navImport', 'navConfig'].forEach(function (id) { els[id] = mkEl(id); });

var bodyEl = mkEl('body');
var doc = {
  getElementById: function (id) { return els[id] || (els[id] = mkEl(id)); },
  querySelectorAll: function () { return []; },
  createElement: function () { return mkEl('x'); },
  head: { appendChild: function () {} },
  body: bodyEl,
  documentElement: mkEl('html'),
  addEventListener: function () {}
};

var store = {};
var localStorageStub = {
  getItem: function (k) { return store[k] === undefined ? null : store[k]; },
  setItem: function (k, v) { store[k] = String(v); },
  removeItem: function (k) { delete store[k]; }
};

var alerts = [];
var sandbox = {
  console: console,
  document: doc,
  localStorage: localStorageStub,
  fetch: function () { return Promise.reject(new Error('no network in test')); },
  alert: function (m) { alerts.push(String(m)); },
  setTimeout: function (f) { return 0; },
  scrollTo: function () {},
  print: function () {},
  Date: Date, Math: Math, JSON: JSON, Object: Object, Array: Array,
  Number: Number, String: String, Boolean: Boolean, Promise: Promise,
  isFinite: isFinite, parseFloat: parseFloat, parseInt: parseInt,
  encodeURIComponent: encodeURIComponent, Error: Error, RegExp: RegExp
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
// 页面用 window.xxx 暴露交互函数；测试里让 window 即沙箱全局，便于直接调用
sandbox.window = sandbox;

// 载入被测依赖：report-core + guardrails + identity-panel
var ctx = vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'report-core.js'), 'utf8'), ctx, { filename: 'report-core.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, 'aftersales-guardrails.js'), 'utf8'), ctx, { filename: 'aftersales-guardrails.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, 'identity-panel.js'), 'utf8'), ctx, { filename: 'identity-panel.js' });
ok(typeof ctx.RPT === 'object', 'report-core 注入成功');
ok(typeof ctx.AFG === 'object', 'guardrails 注入成功');
ok(typeof ctx.IDP === 'object', 'identity-panel 注入成功');

// SheetJS 桩：只实现导出/导入所需
var lastWb = null;
sandbox.XLSX = {
  utils: {
    aoa_to_sheet: function (aoa) {
      var ws = { _aoa: aoa, '!cols': null, '!merges': null };
      aoa.forEach(function (row, R) {
        (row || []).forEach(function (v, C) {
          var addr = '';
          var c = C, r = R;
          do { addr = String.fromCharCode(65 + (c % 26)) + addr; c = Math.floor(c / 26) - 1; } while (c >= 0);
          ws[addr + (r + 1)] = { v: v, t: typeof v };
        });
      });
      return ws;
    },
    book_new: function () { return { SheetNames: [], Sheets: {} }; },
    book_append_sheet: function (wb, ws, n) { wb.SheetNames.push(n); wb.Sheets[n] = ws; },
    sheet_to_json: function () { return []; },
    encode_cell: function (c) { return String.fromCharCode(65 + c.c) + (c.r + 1); },
    decode_range: function () { return { s: { r: 6, c: 5 }, e: { r: 20, c: 5 } }; }
  },
  read: function () { return { SheetNames: [], Sheets: {} }; },
  writeFile: function (wb, name) { lastWb = { wb: wb, name: name }; }
};
ctx.XLSX = sandbox.XLSX;

// ---------- 注入真实台账 ----------
var wn = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'work-order', 'data_wn.json'), 'utf8'));
var nw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'work-order', 'data_nw.json'), 'utf8'));
store['station_mgmt_data'] = JSON.stringify({ warrantyOrders: wn, nonWarrantyOrders: nw });

// ---------- 加载报表中心页面内联脚本 ----------
sec('加载 report-center.html 内联脚本');
var html = fs.readFileSync(path.join(__dirname, '..', 'work-order', 'report-center.html'), 'utf8');
var m = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/);
ok(!!m, '提取到内联 script');
vm.runInContext(m[1], ctx, { filename: 'report-center-inline.js' });
ok(true, '内联脚本执行未抛异常');

// ---------- 默认视图（周报）----------
sec('周报默认视图渲染');
var v = els.view.innerHTML;
ok(v.length > 3000, '渲染出内容（' + v.length + ' 字符）');
ok(v.indexOf('核心运营数据（15 项）') >= 0, '含 15 项指标表');
ok(v.indexOf('站内总人数') >= 0, '含「站内总人数」');
ok(v.indexOf('人均产值') >= 0, '含「人均产值」');
ok(v.indexOf('GSS 绩效评分') >= 0, '含「GSS 绩效评分」');
ok(v.indexOf('工单完成率') >= 0, '含「工单完成率」');
ok(v.indexOf('环比') >= 0, '含环比列');
ok(v.indexOf('竣工已结算产值') >= 0, '含竣工产值');
ok(v.indexOf('当期') >= 0 || v.indexOf('本期') >= 0, '含本期标记');
ok(v.indexOf('undefined') < 0, '无 undefined 泄漏');
ok(v.indexOf('NaN') < 0, '无 NaN 泄漏');
ok(v.indexOf('[object Object]') < 0, '无对象字符串泄漏');
var rowCount = (v.match(/<tr/g) || []).length;
ok(rowCount > 15, '表格行数 > 15（实际 ' + rowCount + '）');

sec('周报周期口径');
ok(v.indexOf('周日至周六') >= 0, '声明周日至周六口径');
var perLabel = (v.match(/class="period-label">([^<]+)</) || [])[1] || '';
ok(/^\d{4}-\d{2}-\d{2} ~ \d{2}(-\d{2})?$/.test(perLabel), '周期标签格式正确：' + perLabel);

// ---------- 切到日报 ----------
sec('日报视图');
vm.runInContext("window.switchTab('daily')", ctx);
var dv = els.view.innerHTML;
ok(dv.indexOf('日报') >= 0, '标题为日报');
ok(dv.indexOf('核心运营数据（15 项）') >= 0, '日报同样含 15 项');
ok(dv.indexOf('undefined') < 0, '日报无 undefined');
var dLabel = (dv.match(/class="period-label">([^<]+)</) || [])[1] || '';
ok(/^\d{4}-\d{2}-\d{2}$/.test(dLabel), '日报周期标签为单日：' + dLabel);
ok(dv.indexOf('自然日') >= 0, '日报声明自然日口径');

// ---------- 切到月报 ----------
sec('月报视图');
vm.runInContext("window.switchTab('monthly')", ctx);
var mv = els.view.innerHTML;
ok(mv.indexOf('月报') >= 0, '标题为月报');
ok(mv.indexOf('自然月') >= 0, '声明自然月口径');
ok(mv.indexOf('undefined') < 0, '月报无 undefined');
ok(mv.indexOf('NaN') < 0, '月报无 NaN');

// ---------- 周期切换 ----------
sec('周期切换');
vm.runInContext("window.switchTab('weekly')", ctx);
var before = (els.view.innerHTML.match(/class="period-label">([^<]+)</) || [])[1];
vm.runInContext('window.shiftPeriod(-1)', ctx);
var afterPrev = (els.view.innerHTML.match(/class="period-label">([^<]+)</) || [])[1];
ok(before !== afterPrev, '上一周生效：' + before + ' → ' + afterPrev);
vm.runInContext('window.shiftPeriod(1)', ctx);
var afterNext = (els.view.innerHTML.match(/class="period-label">([^<]+)</) || [])[1];
ok(afterNext === before, '下一周回到原周期');
vm.runInContext('window.shiftPeriod(0)', ctx);
var afterNow = (els.view.innerHTML.match(/class="period-label">([^<]+)</) || [])[1];
ok(afterNow === before, '回到本周一致');

// ---------- 流程时效 ----------
sec('流程时效视图');
vm.runInContext("window.switchTab('nodes')", ctx);
var nv = els.view.innerHTML;
ok(nv.indexOf('流程节点时效') >= 0, '标题正确');
ok(nv.indexOf('接单响应') >= 0, '含接单响应节点');
ok(nv.indexOf('维修时长') >= 0, '含维修时长节点');
ok(nv.indexOf('全周期') >= 0, '含全周期节点');
ok(nv.indexOf('超期') >= 0, '含超期列');
ok(nv.indexOf('undefined') < 0, '时效视图无 undefined');
ok(nv.indexOf('NaN') < 0, '时效视图无 NaN');
vm.runInContext('window.toggleNodeScope()', ctx);
ok(els.view.innerHTML.indexOf('全量台账') >= 0, '切到全量台账');
ok(els.view.innerHTML.indexOf('undefined') < 0, '全量视图无 undefined');
vm.runInContext('window.toggleNodeScope()', ctx);

// ---------- 人效排名 ----------
sec('人效排名视图');
vm.runInContext("window.switchTab('people')", ctx);
var pv = els.view.innerHTML;
ok(pv.indexOf('人效排名') >= 0, '标题正确');
ok(pv.indexOf('工程师排行') >= 0, '含排行表');
ok(pv.indexOf('平均维修') >= 0, '含平均维修时长');
ok(pv.indexOf('undefined') < 0, '人效视图无 undefined');
ok(pv.indexOf('NaN') < 0, '人效视图无 NaN');
var pRows = (pv.match(/<tr/g) || []).length;
ok(pRows > 10, '工程师行数 > 10（实际 ' + pRows + '）');

// ---------- 周报导出 ----------
sec('周报 Excel 导出');
vm.runInContext("window.switchTab('weekly')", ctx);
lastWb = null;
vm.runInContext('window.exportWeekly()', ctx);
ok(!!lastWb, '触发导出');
if (lastWb) {
  ok(/服务站运营周报_\d{4}-\d{2}-\d{2}\.xlsx/.test(lastWb.name), '文件名含周期：' + lastWb.name);
  var aoa = lastWb.wb.Sheets['服务站运营周报']._aoa;
  ok(Array.isArray(aoa) && aoa.length > 20, '导出 AOA 行数 ' + aoa.length);
  ok(aoa[0][0] === '服务站运营周报', '标题行正确');
  ok(aoa[1][0] === '一、基础填报信息', '段一存在');
  ok(aoa[4][0] === '二、本周核心运营数据', '段二存在');
  ok(aoa[5][1] === '指标名称', '指标表头正确');
  var kpiRows = 0;
  for (var i = 6; i < aoa.length; i++) { if (typeof aoa[i][0] === 'number') kpiRows++; }
  ok(kpiRows >= 15, '导出含 ≥15 项 KPI（实际 ' + kpiRows + '）');
  var seg3 = aoa.some(function (r) { return r[0] === '三、本周工作遇到的问题及改进建议'; });
  var seg4 = aoa.some(function (r) { return r[0] === '四、需要集团/总部支持的事项'; });
  var seg5 = aoa.some(function (r) { return r[0] === '五、下周核心工作计划'; });
  var seg6 = aoa.some(function (r) { return r[0] === '六、其他备注说明（安全/合规/运营特殊事项）'; });
  ok(seg3, '段三存在');
  ok(seg4, '段四存在');
  ok(seg5, '段五存在');
  ok(seg6, '段六存在');
  ok(aoa.some(function (r) { return String(r[0]).indexOf('流程节点时效') >= 0; }), '附流程节点时效');
  var numericOk = true;
  aoa.forEach(function (r) { r.forEach(function (c) { if (typeof c === 'number' && !isFinite(c)) numericOk = false; }); });
  ok(numericOk, '导出数值全部有限');
}

// ---------- 口径设置 ----------
sec('口径设置');
vm.runInContext('window.openConfig()', ctx);
var cfgHtml = els.modalContent.innerHTML;
ok(cfgHtml.indexOf('报表口径设置') >= 0, '弹窗打开');
ok(cfgHtml.indexOf('站内总人数') >= 0, '含总人数输入');
ok(cfgHtml.indexOf('工程师人数') >= 0, '含工程师人数输入');
ok(cfgHtml.indexOf('增值产值') >= 0, '含增值产值输入');
ok(cfgHtml.indexOf('投诉数量') >= 0, '含投诉输入');
ok(cfgHtml.indexOf('超期阈值') >= 0, '含超期阈值');
// 改配置并保存（cfg_* 输入框由弹窗 HTML 生成，桩里按 id 预置）
['cfg_head', 'cfg_eng', 'cfg_va', 'cfg_complaint', 'cfg_site', 'cfg_star', 'cfg_reporter', 'cfg_gss', 'cfg_over'].forEach(function (id) { els[id] = mkEl(id); });
els['cfg_head'].value = '40';
els['cfg_eng'].value = '26';
els['cfg_va'].value = '8888';
els['cfg_complaint'].value = '2';
vm.runInContext('window.saveCfg()', ctx);
var saved = JSON.parse(store['station_report_config']);
ok(saved.headcount === 40, '总人数已保存 40');
ok(saved.engineers === 26, '工程师人数已保存 26');
ok(saved.valueAdded[Object.keys(saved.valueAdded)[0]] === 8888, '增值产值已保存 8888');
ok(saved.complaints[Object.keys(saved.complaints)[0]] === 2, '投诉已保存 2');
var v2 = els.view.innerHTML;
ok(v2.indexOf('40') >= 0, '报表反映新总人数');

// ---------- 导入分类 ----------
sec('导入分类逻辑');
// 通过页面暴露的只读探针直接校验导入分类函数（与线上完全同一份实现）
var probe = vm.runInContext('window.__rptProbe', ctx);
ok(!!probe, '探针已暴露');
var wnHeaders = ['编号', '登记日期', '客户名称', '责任工程师', '完成状态', 'GSS工单号', '工程师产值'];
var nwHeaders = ['序号', '城市', '工单号', '车牌号', '车架号', '签约客户名称', '维修状态', '报价单总金额', '分润'];
ok(probe.detectSheetType(wnHeaders) === 'warranty', '保内表头识别为 warranty');
ok(probe.detectSheetType(nwHeaders) === 'nonwarranty', '保外表头识别为 nonwarranty');
ok(probe.detectSheetType(['随便', '列名']) === null, '无关表头返回 null');
ok(probe.normHeader('  登记日期 ') === '登记日期', 'normHeader 去空格');
ok(probe.findTypeCol(['编号', '内外', '状态']) === '内外', '类型列识别');
ok(probe.findTypeCol(['编号', '状态']) === null, '无类型列返回 null');

// 行级分类：类型列优先
var defs = probe.makeDefs();
ok(probe.classifyRow({ '内外': '保内', '状态': '在修' }, '内外', ['内外', '状态'], defs.wnDefs, defs.nwDefs) === 'warranty', '类型列「保内」→ warranty');
ok(probe.classifyRow({ '内外': '保外', '状态': '在修' }, '内外', ['内外', '状态'], defs.wnDefs, defs.nwDefs) === 'nonwarranty', '类型列「保外」→ nonwarranty');
ok(probe.classifyRow({ '内外': '保内/保外', '状态': '' }, '内外', ['内外', '状态'], defs.wnDefs, defs.nwDefs) === null, '类型列含糊（同时含保内保外）不误判');
// 行级分类：无类型列时靠状态
ok(probe.classifyRow({ '完成状态': '已结算' }, null, ['完成状态'], defs.wnDefs, defs.nwDefs) === 'warranty', '状态「已结算」→ warranty');
ok(probe.classifyRow({ '维修状态': '待客户确认' }, null, ['维修状态'], defs.wnDefs, defs.nwDefs) === 'nonwarranty', '状态「待客户确认」→ nonwarranty');
// 行级分类：无类型列无状态时靠列填充度
ok(probe.classifyRow({ '责任工程师': '张三', 'GSS工单号': 'G1' }, null, ['责任工程师', 'GSS工单号'], defs.wnDefs, defs.nwDefs) === 'warranty', '按列填充度判为 warranty');
ok(probe.classifyRow({ '签约客户名称': 'A公司', '报价单总金额': '100' }, null, ['签约客户名称', '报价单总金额'], defs.wnDefs, defs.nwDefs) === 'nonwarranty', '按列填充度判为 nonwarranty');
ok(probe.classifyRow({ '未知列': 'x' }, null, ['未知列'], defs.wnDefs, defs.nwDefs) === null, '无法判定返回 null');

sec('岗位权限门控');
// 默认管理员可进入，身份栏渲染为折叠态（一行：姓名 · 岗位 + 切换）
ok(els.identityBar.innerHTML.indexOf('管理员') >= 0, '身份栏显示当前岗位');
ok(els.identityBar.innerHTML.indexOf('idp-bar') >= 0, '身份栏为折叠态面板');
ok(els.identityBar.innerHTML.indexOf('切换') >= 0, '身份栏含「切换」入口');
ok(els.identityBar.innerHTML.indexOf('idp-switch') >= 0, '切换入口样式就位');
ok(els.view.innerHTML.indexOf('无权查看') < 0, '管理员可进入报表中心');

// 弹窗：点开后应含姓名 chips + 岗位卡片 + 口径说明
vm.runInContext('window.IDP.open()', ctx);
var modal = vm.runInContext('window.IDP.el().innerHTML', ctx);
ok(modal.indexOf('idp-chip') >= 0, '弹窗含姓名 chips');
ok(modal.indexOf('idp-rolecard') >= 0, '弹窗含岗位卡片');
ok(modal.indexOf('不是安全边界') >= 0, '弹窗含口径说明');
ok(modal.indexOf('idpSearch') >= 0, '弹窗含姓名搜索框');
ok(modal.indexOf('IDP.pickRole') >= 0, '岗位卡片可点击切换');
vm.runInContext('window.IDP.close()', ctx);

// 技师：无权进入
vm.runInContext('window.afSwitchIdentity("张三","TECHNICIAN")', ctx);
ok(els.view.innerHTML.indexOf('无权查看报表中心') >= 0, '技师被拦截');
ok(els.view.innerHTML.indexOf('维修技师') >= 0, '拦截页显示当前岗位');
ok(els.view.innerHTML.indexOf('核心运营数据') < 0, '拦截页不泄漏报表数据');
ok(els.identityBar.innerHTML.indexOf('维修技师') >= 0, '身份栏同步为技师');

// 监管员：可进入但只读（导入/口径入口隐藏，导出保留）
vm.runInContext('window.afSwitchIdentity("审计员","AUDITOR")', ctx);
ok(els.view.innerHTML.indexOf('无权查看') < 0, '监管员可进入');
ok(els.view.innerHTML.indexOf('核心运营数据（15 项）') >= 0, '监管员能看到 15 项指标');
ok(els.navImport.style.display === 'none', '只读岗位隐藏「导入工单」');
ok(els.navConfig.style.display === 'none', '只读岗位隐藏「口径设置」');

// 只读岗位调用写操作被拦截
vm.runInContext('window.guardWrite(function(){ window.__wrote = true; })', ctx);
ok(vm.runInContext('window.__wrote', ctx) !== true, '只读岗位写操作被拦截');
ok(els.uploadBar.innerHTML.indexOf('只读') >= 0, '给出只读提示');

// 财务：可进入，写入口可见
vm.runInContext('window.afSwitchIdentity("财务甲","FINANCE")', ctx);
ok(els.view.innerHTML.indexOf('无权查看') < 0, '财务可进入');
ok(els.navImport.style.display !== 'none', '财务可见「导入工单」');
vm.runInContext('window.guardWrite(function(){ window.__wrote2 = true; })', ctx);
ok(vm.runInContext('window.__wrote2', ctx) === true, '财务写操作放行');

// 恢复管理员，供后续用例使用
vm.runInContext('window.afSwitchIdentity("管理员","ADMIN")', ctx);
ok(els.view.innerHTML.indexOf('核心运营数据（15 项）') >= 0, '切回管理员恢复报表');

sec('边界：空数据渲染');
store['station_mgmt_data'] = JSON.stringify({ warrantyOrders: [], nonWarrantyOrders: [] });
// 重新 boot：直接调用 loadRemote 会走网络失败路径，改为验证 renderEmpty 分支
vm.runInContext('window.boot()', ctx);
ok(els.view.innerHTML.indexOf('尚无工单数据') >= 0, '空数据展示引导页');
ok(els.view.innerHTML.indexOf('导入工单台账') >= 0, '引导页含导入入口');

console.log('\n' + '='.repeat(52));
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('='.repeat(52));
process.exit(fail ? 1 : 0);
