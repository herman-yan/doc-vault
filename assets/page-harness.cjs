/*
 * 页面级测试夹具：把 doc-vault 单文件页面的内联脚本放进 vm 沙箱 + 伪 DOM 里真实运行。
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
  return {
    id, innerHTML: '', textContent: '', value: '', checked: false, title: '',
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
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
  if (!opt.noGuard) vm.runInContext(fs.readFileSync(path.join(__dirname, 'aftersales-guardrails.js'), 'utf8'), ctx, { filename: 'aftersales-guardrails.js' });
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
  return { ctx, els, store, doc, sandbox, T, runError, get: id => doc.getElementById(id) };
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
