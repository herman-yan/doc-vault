/**
 * 前端渲染验证（离线，毫秒级）：  node verify-frontend.cjs
 *
 * index.html 是单文件页面，逻辑都在内联 <script> 里，没有构建步骤，
 * 所以这里用 Node 的 vm + 一个 DOM 桩把它跑起来，再用「实时模式的数据形态」
 * （无到期日、相对方为推断值、账款为空、条款为空）断言渲染结果。
 *
 * 为什么需要它：这类缺陷（NaN 天、NaN%、整页因单个面板异常而空白）
 * 只在实时数据下才出现，用内置演示数据完全测不出来。
 */
const fs = require('fs');
const vm = require('vm');
const html = fs.readFileSync('index.html', 'utf8');

const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
const inlineSrc = scripts.join('\n;\n');
const source = new vm.Script(inlineSrc); // 语法错误会在这里直接抛出
console.log('内联脚本块数:', scripts.length, '  字符数:', inlineSrc.length);

const names = ['renderDashboard', 'renderContracts', 'renderDue', 'renderRisk', 'renderAccounting', 'renderCounterparty',
  'renderCompare', 'renderTemplate', 'renderBatch', 'renderBorrow', 'renderAbout', 'renderContractModal', 'refreshPartyOwn'];
// vm 里顶层 let/const 不会挂到 context 上，附加一行把需要的引用导出来
const shim = '\n;globalThis.__S={CONTRACTS,PARTIES,ACCOUNTING,BORROWS,OWN_COMPS,today,GATE_HASH,GATE_LS,gateHash,' + names.join(',') + '};';

// 一次运行 = 一套独立的 DOM 桩 + localStorage（seed 用来模拟「本机已解锁过」）
function makeEnv(seed) {
  const store = new Map();
  function el(id) {
    return {
      id, innerHTML: '', textContent: '', value: '', dataset: {}, style: {}, disabled: false, removed: false,
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      addEventListener(ev, fn) { (this.__h = this.__h || {}); (this.__h[ev] = this.__h[ev] || []).push(fn); },
      fire(ev, e) { for (const fn of (this.__h || {})[ev] || []) fn(e || { preventDefault() {} }); },
      appendChild() {}, querySelector() { return el('child'); }, querySelectorAll() { return []; },
      remove() { this.removed = true; },
    };
  }
  const document = {
    getElementById(id) { const k = String(id); if (!store.has(k)) store.set(k, el(k)); return store.get(k); },
    // 页面里的 $() 是 querySelector('#x')，必须与 getElementById 返回同一对象，
    // 否则写入落在两个不同元素上，断言会读到空壳而「假通过」
    querySelector(sel) { if (sel && sel[0] === '#') return this.getElementById(sel.slice(1)); const k = 'q:' + sel; if (!store.has(k)) store.set(k, el(k)); return store.get(k); },
    querySelectorAll() { return []; },
    createElement(t) { return el(t); },
    addEventListener() {},
  };
  document.body = el('body');
  const ctx = {
    console, document, window: {},
    localStorage: { getItem: k => (seed && k in seed ? seed[k] : null), setItem() {}, removeItem() {} },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }),
    setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON, Intl, BigInt,
    prompt: () => null, alert: () => {}, encodeURIComponent, decodeURIComponent,
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  try { vm.runInContext(inlineSrc + shim, ctx); }
  catch (e) { console.log('脚本加载失败:', e.message); process.exit(1); }
  return { store, ctx, S: ctx.__S, mk: id => { if (!store.has(id)) store.set(id, el(id)); return store.get(id); } };
}

const env = makeEnv(null);
const S = env.S;
const store = env.store, mk = env.mk, sec = id => mk(id).innerHTML;

let pass = 0, fail = 0;
const chk = (label, cond, extra) => { if (cond) { pass++; console.log('  PASS  ' + label); } else { fail++; console.log('  FAIL  ' + label + (extra ? '  → ' + String(extra).slice(0, 200) : '')); } };

console.log('\n=== 0. 访问口令门：未解锁时不得渲染台账 ===');
chk('页面含口令遮罩与密码输入框', /id="gate"/.test(html) && /type="password" id="gatePwd"/.test(html));
chk('源码里只有哈希、没有明文口令', /GATE_HASH\s*=\s*'[0-9a-f]{16}'/.test(inlineSrc));
chk('加载后各面板保持空白（数据未取、未渲染）', sec('sec-dashboard') === '' && sec('sec-contracts') === '');
const gateForm = mk('gateForm'), gatePwd = mk('gatePwd'), gateEl = mk('gate');
gatePwd.value = '随手猜的一个口令';
gateForm.fire('submit');
chk('口令错误：给出提示且不进入', /口令不正确/.test(mk('gateErr').textContent) && gateEl.removed === false && sec('sec-dashboard') === '');
chk('gateHash 稳定且与长度无关的碰撞（不同串不同值）', S.gateHash('a') !== S.gateHash('b') && S.gateHash('') !== S.GATE_HASH);

// 与后端 normalizeDwsContract 输出同形的实时数据
const liveShape = [
  { id: 'HT-1', cid: 1, name: '员工劳动合同', party: '—', partyInferred: false, amount: 0, currency: '¥', sign: '2026-09-20', start: '', end: '', status: '未生效', owner: '张三', archive: '未归档', standard: '—', clauses: [], archiveCheck: [], live: true, files: [] },
  { id: 'HT-2', cid: 2, name: '借调协议', party: '北京易联', partyInferred: true, amount: 120000, currency: '¥', sign: '2026-09-20', start: '2026-09-20', end: '2026-11-30', status: '履行中', owner: '张三', archive: '未归档', standard: '—', clauses: [], archiveCheck: [], live: true, files: [] },
  { id: 'HT-3', cid: 3, name: '分红方案', party: '城东公交', partyInferred: false, amount: 0, currency: '¥', sign: '2025-01-24', start: '', end: '', status: '履行中', owner: '张三', archive: '未归档', standard: '—', clauses: [], archiveCheck: [], live: true, files: [], _detail: { accounting: {}, files: [], formFields: [{ label: '用印日期', value: '2025-01-24' }] } },
];
S.CONTRACTS.length = 0;
for (const c of liveShape) S.CONTRACTS.push(c);
// 孤儿账款：cid 已不在台账，验证 renderAccounting 的兜底不会拖垮整页
S.ACCOUNTING.push({ cid: 'GHOST-999', period: '2026-09', recv: 5000, recvAmt: 0, invoiced: false, overdue: true, note: '台账已删除的合同' });
for (const k of [...store.keys()]) { if (k.startsWith('sec-') || k === 'modalBody') store.get(k).innerHTML = ''; }

console.log('\n=== 1. 逐个渲染函数不抛异常 ===');
for (const n of names.slice(0, 11)) {
  try { S[n](); chk(n + '()', true); }
  catch (e) { chk(n + '()', false, e.message + ' @ ' + String(e.stack).split('\n')[1]); }
}

console.log('\n=== 2. 各面板不得出现 NaN / undefined ===');
for (const id of ['sec-dashboard', 'sec-contracts', 'sec-due', 'sec-risk', 'sec-accounting', 'sec-counterparty', 'sec-compare', 'sec-template']) {
  const h = sec(id);
  chk(`${id} 无 NaN/undefined（长度 ${h.length}）`, !/NaN|undefined/.test(h), h.replace(/\s+/g, ' ').slice(0, 200));
}

console.log('\n=== 3. 空值/推断值的呈现 ===');
chk('合同列表：推断相对方带「推断」标记', /推断/.test(sec('sec-contracts')));
chk('合同列表：无到期日不显示「NaN 天」', !/NaN/.test(sec('sec-contracts')));
chk('合同列表：有到期日显示剩余天数', /天<\/td>/.test(sec('sec-contracts')));

console.log('\n=== 4. 合同详情弹窗 ===');
for (const c of S.CONTRACTS) {
  mk('modalBody').innerHTML = '';
  try { S.renderContractModal(c); } catch (e) { chk('弹窗[' + c.id + '] 可渲染', false, e.message); continue; }
  const h = mk('modalBody').innerHTML;
  chk(`弹窗[${c.id}] 无 NaN/undefined`, !/NaN|undefined/.test(h), h.replace(/\s+/g, ' ').slice(0, 160));
  if (c.id === 'HT-1') chk('  无到期日 → 显示「无到期日」', /无到期日/.test(h));
  if (c.id === 'HT-2') { chk('  推断相对方 → 带标签', /推断/.test(h)); chk('  期限区间正确', /2026-09-20 ~ 2026-11-30/.test(h)); }
  if (c.id === 'HT-3') chk('  取过详情但表单无日期 → 说明「表单未登记」', /表单未登记/.test(h));
}

console.log('\n=== 5. 实时模式：账款为空时不得出现 NaN% ===');
S.ACCOUNTING.length = 0;
for (const k of [...store.keys()]) { if (k.startsWith('sec-')) store.get(k).innerHTML = ''; }
try { S.renderDashboard(); } catch (e) { chk('renderDashboard(空账款) 可执行', false, e.message); }
chk('空账款：无 NaN/undefined', !/NaN|undefined/.test(sec('sec-dashboard')));
chk('空账款：回款进度显示 0%', /回款进度 0%/.test(sec('sec-dashboard')));

console.log('\n=== 6. 集团内用印（相对方其实是我方盖章主体）===');
S.OWN_COMPS.push('北京易联汽车技术服务有限公司', '陕西顺行时代新能源科技有限公司');
const internal = S.CONTRACTS.find(c => c.id === 'HT-2');   // party 为简称「北京易联」
const external = S.CONTRACTS.find(c => c.id === 'HT-3');   // party 为外部主体
S.refreshPartyOwn(internal); S.refreshPartyOwn(external);
chk('简称命中自家全称 → 标记为集团内', internal.partyOwn === true);
chk('无关外部主体 → 不标记', external.partyOwn === false);
// 误伤防线：按名称推断出的通用碎片「新能源」同时出现在多家自家公司全称里，不得算我方
const frag = { id: 'X', party: '新能源', company: '', cat: '' };
S.CONTRACTS.push(frag); S.refreshPartyOwn(frag);
chk('碎片「新能源」不被误判为集团内', frag.partyOwn === false);
mk('sec-contracts').innerHTML = ''; mk('sec-counterparty').innerHTML = '';
S.renderContracts(); S.renderCounterparty();
chk('合同列表：集团内相对方带标记', /集团内/.test(sec('sec-contracts')));
chk('相对方面板：排除集团内用印并注明份数', /已排除集团内用印 1 份/.test(sec('sec-counterparty')));
chk('相对方面板：不列出被排除的主体', !/北京易联/.test(sec('sec-counterparty')));
S.CONTRACTS.length = liveShape.length;

console.log('\n=== 7. 本机已解锁过（localStorage 有标记）→ 直接进系统 ===');
const env2 = makeEnv({ [S.GATE_LS]: '1' });
chk('遮罩已移除', env2.mk('gate').removed === true);
chk('未点任何按钮就已完成渲染', env2.mk('sec-dashboard').innerHTML.length > 0);
chk('已渲染内容无 NaN/undefined', !/NaN|undefined/.test(env2.mk('sec-dashboard').innerHTML));

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
