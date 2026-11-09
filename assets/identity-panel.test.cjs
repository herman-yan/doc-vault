/*
 * 岗位身份面板 + 姓名名单 单测
 * 覆盖：姓名归一化（全角空格）、名单提取过滤、名单手册（补充/隐藏）、
 *      面板折叠态/弹窗/搜索/选择/应用、跨页共享（工单页与报表页共用 af_identity）。
 * 运行：node identity-panel.test.cjs
 */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log('  ✗ ' + m); } }
function sec(t) { console.log('\n== ' + t + ' =='); }

// ---------- DOM 桩 ----------
function mkEl(id) {
  var el = {
    id: id, _html: '', _text: '', className: '', dataset: {}, value: '', title: '',
    style: {}, children: [],
    classList: {
      _s: {},
      add: function (c) { this._s[c] = 1; },
      remove: function (c) { delete this._s[c]; },
      toggle: function (c, on) { if (on) this._s[c] = 1; else delete this._s[c]; },
      contains: function (c) { return !!this._s[c]; }
    },
    set innerHTML(v) { this._html = String(v); },
    get innerHTML() { return this._html; },
    set textContent(v) { this._text = String(v); },
    get textContent() { return this._text; },
    addEventListener: function () {}, removeEventListener: function () {},
    appendChild: function (c) { this.children.push(c); return c; },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    setAttribute: function () {}, getAttribute: function () { return null; },
    focus: function () {}, click: function () {}
  };
  return el;
}
var els = {};
var bodyEl = mkEl('body');
var doc = {
  getElementById: function (id) { return els[id] || (els[id] = mkEl(id)); },
  querySelectorAll: function () { return []; },
  createElement: function (tag) { return mkEl(tag); },
  head: mkEl('head'),
  body: bodyEl,
  documentElement: mkEl('html'),
  addEventListener: function () {}
};

var store = {};
var ls = {
  getItem: function (k) { return store[k] === undefined ? null : store[k]; },
  setItem: function (k, v) { store[k] = String(v); },
  removeItem: function (k) { delete store[k]; }
};

var sandbox = {
  console: console, document: doc, localStorage: ls,
  fetch: function () { return Promise.reject(new Error('no net')); },
  alert: function () {}, setTimeout: function () { return 0; }, clearTimeout: function () {},
  Date: Date, Math: Math, JSON: JSON, Object: Object, Array: Array, String: String,
  Number: Number, Boolean: Boolean, Promise: Promise, RegExp: RegExp, Error: Error,
  isFinite: isFinite, parseFloat: parseFloat, parseInt: parseInt, encodeURIComponent: encodeURIComponent
};
sandbox.globalThis = sandbox; sandbox.self = sandbox; sandbox.window = sandbox;

var ctx = vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'aftersales-guardrails.js'), 'utf8'), ctx, { filename: 'guardrails.js' });
vm.runInContext(fs.readFileSync(path.join(__dirname, 'identity-panel.js'), 'utf8'), ctx, { filename: 'identity-panel.js' });
var AFG = ctx.AFG, IDP = ctx.IDP;
ok(typeof AFG === 'object', 'AFG 注入');
ok(typeof IDP === 'object', 'IDP 注入');

// ---------- 1. 姓名归一化（回归：全角空格）----------
sec('1. 姓名归一化（全角空格 / 零宽字符）');
ok(AFG.normName('刘　珍') === '刘珍', '全角空格被去除');
ok(AFG.normName('张 峻') === '张峻', '半角空格被去除');
ok(AFG.normName('  刘星彤\u200b ') === '刘星彤', '首尾空白与零宽字符被去除');
ok(AFG.normName('苏\u3000越') === '苏越', '全角空格（苏越）');
ok(AFG.normName(null) === '' && AFG.normName(undefined) === '', 'null/undefined 归为空串');
ok(AFG.samePerson('刘　珍', '刘珍') === true, '「刘　珍」≡「刘珍」');
ok(AFG.samePerson('张　峻', '张峻') === true, '「张　峻」≡「张峻」');
ok(AFG.samePerson('苏　越', '苏越') === true, '「苏　越」≡「苏越」');
ok(AFG.samePerson('马　迪', '马迪') === true, '「马　迪」≡「马迪」');
ok(AFG.samePerson('刘珍', '罗永豪') === false, '不同人不相等');
ok(AFG.samePerson('', '刘珍') === false, '空值不相等');
ok(AFG.samePerson(null, null) === false, '双 null 不相等');

// ---------- 2. 名单提取与脏值过滤 ----------
sec('2. 名单提取与脏值过滤');
ok(AFG.isRealName('李恩浩') === true, '正常姓名通过');
ok(AFG.isRealName('刘　珍') === true, '含全角空格的姓名通过');
ok(AFG.isRealName('无') === false, '占位「无」被过滤');
ok(AFG.isRealName('-') === false && AFG.isRealName('/') === false, '占位符号被过滤');
ok(AFG.isRealName('430.17') === false, '纯数字被过滤');
ok(AFG.isRealName('') === false && AFG.isRealName(null) === false, '空值被过滤');
ok(AFG.isRealName('终止') === false, '误填状态词「终止」被过滤（真实台账 19 条）');
ok(AFG.isRealName('已完成') === false, '状态词「已完成」被过滤');
ok(AFG.isRealName('x'.repeat(20)) === false, '超长串被过滤');

var wn = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'work-order', 'data_wn.json'), 'utf8'));
var nw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'work-order', 'data_nw.json'), 'utf8'));
var names = AFG.collectNames([wn, nw]);
ok(names.length >= 25, '真实台账提取到 ≥25 人（实得 ' + names.length + '）');
ok(names.indexOf('终止') < 0, '名单不含「终止」');
ok(names.indexOf('430.17') < 0, '名单不含「430.17」');
ok(names.indexOf('无') < 0, '名单不含「无」');
ok(names.indexOf('刘珍') >= 0, '名单含「刘珍」（已去全角空格）');
ok(names.indexOf('刘　珍') < 0, '名单不含带全角空格的重复项');
ok(names.indexOf('张峻') >= 0 && names.indexOf('苏越') >= 0 && names.indexOf('马迪') >= 0, '名单含张峻/苏越/马迪');
ok(names.indexOf('赵轩') >= 0, '名单含报单员「赵轩」');
ok(names.indexOf('刘利伟') >= 0 && names.indexOf('曾悦') >= 0, '名单含责任外服「刘利伟/曾悦」');
ok(names.indexOf('周字欢') >= 0, '名单含报单员「周字欢」');
// 去重：不应有归一化后重复的项
var normed = names.map(AFG.normName);
ok(normed.length === new Set(normed).size, '名单无归一化重复项');

// ---------- 3. 名单手册：手动补充 / 隐藏 ----------
sec('3. 名单手册（补充 / 隐藏）');
var st = { getItem: function (k) { return store[k] === undefined ? null : store[k]; }, setItem: function (k, v) { store[k] = String(v); } };
ok(AFG.getNameBook(st).extra.length === 0 && AFG.getNameBook(st).hidden.length === 0, '初始手册为空');

AFG.setNameBook({ extra: ['新同事甲'], hidden: ['罗永豪'] }, st);
var book = AFG.getNameBook(st);
ok(book.extra.indexOf('新同事甲') >= 0, '手动补充已持久化');
ok(book.hidden.indexOf('罗永豪') >= 0, '手动隐藏已持久化（存归一化键）');

var roster = AFG.nameRoster([wn, nw], st);
ok(roster.indexOf('新同事甲') >= 0, '最终名单含手动补充');
ok(roster.indexOf('罗永豪') < 0, '最终名单排除手动隐藏');
ok(roster.indexOf('刘珍') >= 0, '最终名单保留其他人');
ok(AFG.nameRoster([wn, nw], st).length === roster.length, '重复调用结果稳定');

// 补充非法姓名应被拒
AFG.setNameBook({ extra: ['无', '430.17', '正常名'], hidden: [] }, st);
ok(AFG.getNameBook(st).extra.join() === '正常名', '非法补充项被剔除');
AFG.setNameBook({ extra: [], hidden: [] }, st);

// 隐藏后再补充同名 → 应解除隐藏（走面板 addName 的语义，而非底层 setNameBook 覆盖）
AFG.setNameBook({ extra: [], hidden: ['罗永豪'] }, st);
els.identityBar = mkEl('identityBar');
IDP.init({ getNames: function () { return AFG.nameRoster([fake], st); } });
IDP.open(); IDP.toggleManage();
doc.getElementById('idpNewName').value = '罗永豪';
IDP.addName();
ok(AFG.getNameBook(st).hidden.indexOf('罗永豪') < 0, '重新补充会解除同名隐藏');
ok(IDP.names().indexOf('罗永豪') >= 0, '解除隐藏后回到名单');
AFG.setNameBook({ extra: [], hidden: [] }, st);

// ---------- 4. 面板：折叠态 ----------
sec('4. 面板折叠态');
var fake = [{ engineer: '刘珍' }, { engineer: '罗永豪' }, { reporter: '赵轩' }];
IDP.init({
  pageName: '测试页',
  getNames: function () { return AFG.nameRoster([fake]); },
  onChange: function () {}
});
var bar = els.identityBar.innerHTML;
ok(bar.indexOf('idp-bar') >= 0, '折叠态渲染 idp-bar');
ok(bar.indexOf('idp-avatar') >= 0, '折叠态含头像首字');
ok(bar.indexOf('idp-switch') >= 0 && bar.indexOf('切换') >= 0, '折叠态含「切换」入口');
ok(bar.indexOf('<select') < 0, '折叠态不再使用原生下拉');
ok(bar.indexOf('IDP.open()') >= 0, '折叠态可点开弹窗');
ok(bar.indexOf('tabindex="0"') >= 0, '折叠态可键盘聚焦');

// ---------- 5. 面板：弹窗 ----------
sec('5. 面板弹窗');
IDP.close();
ok(IDP.isOpen() === false, '初始未打开');
IDP.open();
ok(IDP.isOpen() === true, 'open 后为打开态');
var ovEl = IDP.el();
ok(!!ovEl && ovEl.classList.contains('show'), '遮罩显示');
var modal = ovEl.innerHTML;
ok(modal.indexOf('切换岗位身份') >= 0, '弹窗标题');
ok(modal.indexOf('idp-chip') >= 0, '含姓名 chips');
ok(modal.indexOf('idp-rolecard') >= 0, '含岗位卡片');
ok(modal.indexOf('idpSearch') >= 0, '含搜索框');
ok(modal.indexOf('管理名单') >= 0, '含「管理名单」入口');
ok(modal.indexOf('不是安全边界') >= 0, '含口径说明');
ok(modal.indexOf('IDP.apply()') >= 0, '含应用按钮');
ok(modal.indexOf('未改动') >= 0, '未改动时提示');
// 岗位卡片应展示职责说明
ok(modal.indexOf('负责建单、报单与结算信息录入') >= 0, '岗位卡片含职责说明');
// 只读岗位有标记
ok(modal.indexOf('idp-tag ro') >= 0, '只读岗位有标记');

// ---------- 6. 搜索筛选 ----------
sec('6. 姓名搜索');
IDP.filter('刘');
var f1 = IDP.filtered();
ok(f1.length > 0 && f1.every(function (n) { return n.indexOf('刘') >= 0; }), '按「刘」筛选正确');
IDP.filter('罗永豪');
ok(IDP.filtered().length === 1 && IDP.filtered()[0] === '罗永豪', '精确筛选命中 1 人');
IDP.filter('不存在的人名');
ok(IDP.filtered().length === 0, '无匹配返回空');
ok(els.idpNames.innerHTML.indexOf('没有匹配') >= 0, '无匹配给出提示');
IDP.filter('');
ok(IDP.filtered().length >= 3, '清空搜索恢复全量');

// ---------- 7. 选择与应用 ----------
sec('7. 选择与应用');
var applied = null;
IDP.init({
  getNames: function () { return ['刘珍', '罗永豪', '赵轩']; },
  onChange: function (n, r) { applied = { n: n, r: r }; }
});
IDP.open();
IDP.pickNameAt(1);
IDP.pickRole('FINANCE');
var m2 = IDP.el().innerHTML;
ok(m2.indexOf('将切换为：<b>罗永豪</b>') >= 0, '底部预览显示待切换姓名');
ok(m2.indexOf('财务') >= 0, '底部预览显示待切换岗位');
ok(m2.indexOf('未改动') < 0, '有改动时不再提示未改动');

// 未点应用前不应落库
ok(AFG.getIdentity() === null || AFG.getIdentity().name !== '罗永豪', '应用前不写入身份');

IDP.apply();
ok(applied && applied.n === '罗永豪' && applied.r === 'FINANCE', 'onChange 回调收到新身份');
ok(AFG.getIdentity().name === '罗永豪' && AFG.getIdentity().role === 'FINANCE', '身份已持久化到 af_identity');
ok(IDP.isOpen() === false, '应用后自动关闭');
ok(els.identityBar.innerHTML.indexOf('罗永豪') >= 0, '折叠态同步为新姓名');
ok(els.identityBar.innerHTML.indexOf('财务') >= 0, '折叠态同步为新岗位');

// 只读岗位标记
IDP.open(); IDP.pickRole('AUDITOR'); IDP.apply();
ok(els.identityBar.innerHTML.indexOf('只读') >= 0, '只读岗位在折叠态标注');

// 选择相同身份 → 应用按钮禁用
IDP.open();
ok(IDP.el().innerHTML.indexOf('未改动') >= 0, '重开时待应用 = 当前');
ok(IDP.el().innerHTML.indexOf('disabled') >= 0, '无改动时应用按钮禁用');

// ---------- 8. 跨页共享 ----------
sec('8. 跨页共享（工单页 / 报表页）');
IDP.close();
IDP.open(); IDP.pickNameAt(0); IDP.pickRole('DISPATCHER'); IDP.apply();
var saved = AFG.getIdentity();
ok(saved.name === '刘珍' && saved.role === 'DISPATCHER', '工单页设置的身份已存');
// 模拟报表页 init：应恢复同一身份
var bar2 = mkEl('identityBar');
els.identityBar = bar2;
IDP.init({ pageName: '报表中心', getNames: function () { return ['刘珍', '罗永豪']; } });
ok(bar2.innerHTML.indexOf('刘珍') >= 0 && bar2.innerHTML.indexOf('调度') >= 0, '报表页恢复同一身份');
ok(IDP.current().name === '刘珍' && IDP.current().role === 'DISPATCHER', 'current() 与存储一致');

// ---------- 9. 名单管理交互 ----------
sec('9. 名单管理交互');
els.identityBar = mkEl('identityBar');
AFG.setNameBook({ extra: [], hidden: [] }, st);
IDP.init({ getNames: function () { return AFG.nameRoster([fake], st); } });
IDP.open();
ok(IDP.el().innerHTML.indexOf('idp-manage') < 0, '默认不展开名单管理');
IDP.toggleManage();
ok(IDP.el().innerHTML.indexOf('idp-manage') >= 0, '展开后显示名单管理');
ok(IDP.el().innerHTML.indexOf('idpNewName') >= 0, '含新增姓名输入框');
// 新增
els.idpNewName.value = '新来的人';
IDP.addName();
ok(AFG.getNameBook(st).extra.indexOf('新来的人') >= 0, '新增写入手册');
ok(IDP.names().indexOf('新来的人') >= 0, '新增后出现在名单');
// 隐藏
IDP.hideName('罗永豪');
ok(AFG.getNameBook(st).hidden.indexOf('罗永豪') >= 0, '隐藏写入手册');
ok(IDP.names().indexOf('罗永豪') < 0, '隐藏后从名单移除');
// 恢复
var hi = AFG.getNameBook(st).hidden.indexOf('罗永豪');
IDP.restoreName(hi);
ok(IDP.names().indexOf('罗永豪') >= 0, '恢复后回到名单');
// 移除补充项
var ei = AFG.getNameBook(st).extra.indexOf('新来的人');
IDP.delExtra(ei);
ok(AFG.getNameBook(st).extra.indexOf('新来的人') < 0, '补充项可移除');

// ---------- 10. 边界 ----------
sec('10. 边界');
IDP.filter(undefined); ok(IDP.filtered().length >= 3, 'filter(undefined) 不崩且返回全量');
IDP.pickNameAt(999); ok(true, '越界索引不抛异常');
IDP.pickRole('NOT_A_ROLE'); ok(true, '未知岗位被忽略');
IDP.pickRole(''); ok(true, '空岗位被忽略');
AFG.setNameBook({}, st); ok(AFG.getNameBook(st).extra.length === 0, '空手册安全');
AFG.setNameBook({ extra: null, hidden: null }, st); ok(AFG.getNameBook(st).hidden.length === 0, 'null 字段安全');
store['af_namebook'] = '{坏 JSON'; ok(AFG.getNameBook(st).extra.length === 0, '损坏 JSON 回退为空手册');
store['af_identity'] = '{"name":"甲","role":"BAD"}'; ok(AFG.getIdentity(st) === null, '未知岗位的身份被拒');

console.log('\n====================================================');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('====================================================');
process.exit(fail ? 1 : 0);
