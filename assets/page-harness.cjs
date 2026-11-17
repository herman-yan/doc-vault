/*
 * 页面级测试夹具：把 ningservice-management-system 单文件页面的内联脚本放进 vm 沙箱 + 伪 DOM 里真实运行。
 * 页面脚本顶层的 let/const 属于「词法全局」，取不到对象属性，因此在同一上下文里再跑一段
 * 取值脚本，把句柄交回测试。护栏模块也在同一上下文加载，和浏览器里「同页共享 localStorage」
 * 保持一致。
 *
 * 定位：验证逻辑与状态流转，不验证视觉渲染。
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

function makeEl(id) {
  const _cls = Object.create(null);
  return {
    id, innerHTML: '', textContent: '', value: '', checked: false, title: '',
    style: {}, dataset: {},
    // 真实记录类名：登录门靠 body.nj-locked 控制整页可见性
    classList: {
      add(c) { _cls[c] = 1; },
      remove(c) { delete _cls[c]; },
      toggle(c, on) { if (on === undefined ? !_cls[c] : on) _cls[c] = 1; else delete _cls[c]; },
      contains(c) { return !!_cls[c]; }
    },
    parentElement: { style: {}, onclick: null, title: '' },
    addEventListener() {}, removeEventListener() {}, scrollIntoView() {}, click() {}, focus() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    appendChild() {}, insertAdjacentHTML() {}, setAttribute() {}, getAttribute() { return null; },
    closest() { return null; }, files: [], options: [], children: []
  };
}

function loadPage(htmlRel, opt) {
  opt = opt || {};
  const root = opt.root || path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, htmlRel), 'utf8');
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  if (!blocks.length) throw new Error('no inline script in ' + htmlRel);
  const code = blocks.join('\n;\n');

  const els = new Map();
  const doc = {
    getElementById(id) { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {}, removeEventListener() {},
    createElement() { return makeEl('created'); },
    createDocumentFragment() { return makeEl('frag'); },
    documentElement: makeEl('html'), head: makeEl('head'),
    body: Object.assign(makeEl('body'), { style: {} }),
    title: '', cookie: '', visibilityState: 'visible'
  };
  const store = {};
  Object.keys(opt.storage || {}).forEach(k => { store[k] = typeof opt.storage[k] === 'string' ? opt.storage[k] : JSON.stringify(opt.storage[k]); });
  const ls = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); }
  };
  const sandbox = {
    document: doc, localStorage: ls, console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    fetch: opt.fetch || (async () => ({ ok: false, status: 404, json: async () => null, text: async () => '' })),
    confirm: opt.confirm || (() => true), alert: () => {}, prompt: () => '',
    location: { href: 'https://example.test/' + htmlRel, search: '', hash: '', origin: 'https://example.test' },
    navigator: { onLine: true, userAgent: 'node', language: 'zh-CN' },
    Blob: function () {}, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    FileReader: function () { this.readAsText = () => {}; },
    Notification: function () {}, indexedDB: undefined, WebSocket: undefined,
    XLSX: opt.XLSX || undefined, supabase: undefined, echarts: undefined,
    Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Promise, Set, Map, Symbol,
    encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN, Intl, Infinity, NaN, undefined,
    crypto: require('crypto').webcrypto
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  const ctx = vm.createContext(sandbox);

  // 按浏览器真实顺序加载页面自己引用的本地 <script src>。
  // 页面脚本普遍依赖外部模块（report-core / aftersales-guardrails / identity-panel / auth-*），
  // 漏加载会让页面走「依赖未加载」兜底分支，测试假失败。
  //
  // auth-core/auth-gate 例外：只在 opt.withAuth=true 时加载。这样既保留「无登录门」的
  // 退化路径测试（wo-page / report-page 不传 withAuth），又能验证「未登录锁定」路径。
  const AUTH_SRCS = /(?:^|\/)(auth-core|auth-gate)\.js$/;
  // noGuard=true 表示「护栏模块整体缺席」，页面自己引用的那份也要一起屏蔽，
  // 否则 auto-load 会把护栏补回来，fail-closed 用例就失去意义了。
  const GUARD_SRCS = /(?:^|\/)(aftersales-guardrails|identity-panel)\.js$/;
  const localSrcs = [...html.matchAll(/<script\s+src="([^"]+)"/g)]
    .map(m => m[1])
    .filter(src => !/^https?:|^\/\//.test(src))
    .filter(src => (opt.withAuth ? true : !AUTH_SRCS.test(src)))
    .filter(src => (opt.noGuard ? !GUARD_SRCS.test(src) : true));
  const loaded = new Set();
  function loadLocal(src, strict) {
    const abs = path.resolve(path.dirname(path.join(root, htmlRel)), src);
    if (!fs.existsSync(abs)) return;
    const name = path.basename(abs);
    if (loaded.has(name)) return;
    loaded.add(name);
    const code = fs.readFileSync(abs, 'utf8');
    if (strict) { vm.runInContext(code, ctx, { filename: src }); return; }
    // 页面自带的装饰性脚本（如首页宣传片）依赖真实 DOM，缺失元素不该让整个夹具崩掉
    try { vm.runInContext(code, ctx, { filename: src }); } catch (e) { /* 忽略：非被测依赖 */ }
  }
  if (!opt.noGuard) loadLocal('../assets/aftersales-guardrails.js', true);
  if (!opt.noGuard) loadLocal('../assets/identity-panel.js', true);
  // 依赖顺序：auth-core 必须先于 auth-gate
  if (opt.withAuth) { loadLocal('../assets/auth-core.js', true); loadLocal('../assets/auth-gate.js', true); }
  // 页面显式声明的本地脚本（如报表中心的 report-core.js）
  localSrcs.forEach(s => loadLocal(s, false));
  let runError = null;
  try {
    vm.runInContext(code, ctx, { filename: htmlRel });
  } catch (e) {
    runError = e;
  }

  const parts = [];
  (opt.read || []).forEach(n => parts.push('get ' + n + '(){return ' + n + '}'));
  (opt.write || []).forEach(n => parts.push('set ' + n + '(v){' + n + '=v}'));
  (opt.fns || []).forEach(n => parts.push(n + ':' + n));
  let T = {};
  if (parts.length && !runError) T = vm.runInContext('({' + parts.join(',') + '})', ctx);
  return {
    ctx, els, store, doc, sandbox, T, runError, get: id => doc.getElementById(id),
    // 账号体系句柄（仅在 withAuth 时可用）
    AUTH: opt.withAuth ? ctx.AUTH : undefined,
    GATE: opt.withAuth ? ctx.NJ_GATE : undefined,
    IDP: ctx.IDP,
    setInput: (id, v) => { doc.getElementById(id).value = v; },
    loginAs: function (name, pwd) {
      if (!opt.withAuth) throw new Error('withAuth 未开启');
      ctx.NJ_GATE.pickLogin(name);
      doc.getElementById('njgLoginPwd').value = pwd;
      ctx.NJ_GATE.submitLogin();
    },
    isLocked: () => !!(ctx.document.body.classList && ctx.document.body.classList.contains('nj-locked'))
  };
}

let pass = 0, fail = 0, currentGroup = '';
function group(t) { currentGroup = t; console.log('\n== ' + t); }
function ok(name, cond, extra) {
  if (cond) pass++;
  else { fail++; console.log('  FAIL [' + currentGroup + '] ' + name + (extra ? '  -> ' + extra : '')); }
}
function report(label) {
  console.log('\n----------------------------------------');
  console.log(label + ' PASS ' + pass + ' / FAIL ' + fail);
  return fail;
}

module.exports = { loadPage, makeEl, group, ok, report, state: () => ({ pass, fail }) };
