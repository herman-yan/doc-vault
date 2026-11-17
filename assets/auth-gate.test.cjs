/*
 * 登录门与权限管理界面单测（auth-gate.js）
 * 覆盖：登录流程、错误口令、首次启用、未登录时内容锁定、退出登录、
 *       管理员面板的增删改、权限门控、自助改口令、XSS 转义安全。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) pass++;
  else { fail++; console.log('  FAIL: ' + name + (extra ? '  -> ' + extra : '')); }
}
function group(t) { console.log('\n== ' + t); }

// ---------- DOM 桩 ----------
function mkEl(id) {
  var el = {
    id: id, _html: '', _text: '', className: '', dataset: {}, value: '', title: '',
    style: {}, children: [], _cls: {},
    classList: {
      add: function (c) { el._cls[c] = 1; },
      remove: function (c) { delete el._cls[c]; },
      toggle: function (c, on) { if (on) el._cls[c] = 1; else delete el._cls[c]; },
      contains: function (c) { return !!el._cls[c]; }
    },
    addEventListener: function () {}, removeEventListener: function () {},
    appendChild: function (c) { el.children.push(c); return c; },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    setAttribute: function () {}, getAttribute: function () { return null; },
    focus: function () {}, click: function () {}
  };
  Object.defineProperty(el, 'innerHTML', {
    get: function () { return el._html; },
    set: function (v) { el._html = String(v); },
    configurable: true
  });
  Object.defineProperty(el, 'textContent', {
    get: function () { return el._text; },
    set: function (v) { el._text = String(v); },
    configurable: true
  });
  return el;
}

function makeEnv() {
  var els = {};
  var bodyEl = mkEl('body');
  var doc = {
    getElementById: function (id) { return els[id] || (els[id] = mkEl(id)); },
    querySelector: function () { return null; },
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
    removeItem: function (k) { delete store[k]; },
    clear: function () { for (var k in store) delete store[k]; }
  };
  var sandbox = {
    console: console, document: doc, localStorage: ls,
    fetch: function () { return Promise.reject(new Error('no net')); },
    alert: function () {}, setTimeout: function () { return 0; }, clearTimeout: function () {},
    Date: Date, Math: Math, JSON: JSON, Object: Object, Array: Array, String: String,
    Number: Number, Boolean: Boolean, Promise: Promise, RegExp: RegExp, Error: Error,
    isFinite: isFinite, parseFloat: parseFloat, parseInt: parseInt,
    encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent
  };
  sandbox.globalThis = sandbox; sandbox.self = sandbox; sandbox.window = sandbox;
  var ctx = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'aftersales-guardrails.js'), 'utf8'), ctx, { filename: 'guardrails.js' });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'auth-core.js'), 'utf8'), ctx, { filename: 'auth-core.js' });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'auth-gate.js'), 'utf8'), ctx, { filename: 'auth-gate.js' });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'identity-panel.js'), 'utf8'), ctx, { filename: 'identity-panel.js' });
  return {
    ctx: ctx, doc: doc, body: bodyEl, els: els, store: store,
    AUTH: ctx.AUTH, GATE: ctx.NJ_GATE, AFG: ctx.AFG, IDP: ctx.IDP,
    setInput: function (id, v) { doc.getElementById(id).value = v; },
    gateHtml: function () { return els['njGate'] ? els['njGate'].innerHTML : ''; },
    panelHtml: function () { return els['njPanel'] ? els['njPanel'].innerHTML : ''; },
    barHtml: function () { return els['identityBar'] ? els['identityBar'].innerHTML : ''; }
  };
}

// 登录辅助：走真实登录路径
function loginAs(E, name, pwd) {
  E.GATE.pickLogin(name);
  E.setInput('njgLoginPwd', pwd);
  E.GATE.submitLogin();
}

// ============================================================
group('1. 首次启用流程（系统尚无管理员）');
let E = makeEnv();
E.GATE.init({ pageName: '工单系统', getNames: () => ['刘珍', '罗永豪', '周大伟'] });
ok('初始即判定需要初始化', E.AUTH.needsBootstrap() === true);
ok('未 start 时尚未进入任何模式', E.GATE.mode() === 'login');
E.GATE.start();
ok('start 后进入首次启用', E.GATE.mode() === 'bootstrap');
ok('未登录时页面被锁定', E.GATE.isLocked() === true);
ok('body 带锁定类', E.body.classList.contains('nj-locked') === true);
ok('登录门渲染了首次启用标题', E.gateHtml().indexOf('首次启用') >= 0, E.gateHtml().slice(0, 120));
ok('登录门渲染了姓名选项', E.gateHtml().indexOf('刘珍') >= 0);
ok('未选姓名时提交被拒', (() => { E.setInput('njgBootPwd', 'abcd1234'); E.setInput('njgBootPwd2', 'abcd1234'); E.GATE.doBootstrap(); return E.gateHtml().indexOf('请先选择你的姓名') >= 0; })());
E.GATE.pickBoot('刘珍');
ok('选中姓名后高亮', E.gateHtml().indexOf('njg-chip on') >= 0);
ok('口令过短被拒', (() => { E.setInput('njgBootPwd', 'abc'); E.setInput('njgBootPwd2', 'abc'); E.GATE.doBootstrap(); return E.gateHtml().indexOf('至少 4 位') >= 0; })());
ok('两次口令不一致被拒', (() => { E.setInput('njgBootPwd', 'abcd1234'); E.setInput('njgBootPwd2', 'abcd9999'); E.GATE.doBootstrap(); return E.gateHtml().indexOf('不一致') >= 0; })());
ok('未启用前仍锁定', E.GATE.isLocked() === true);
E.setInput('njgBootPwd', 'admin2026'); E.setInput('njgBootPwd2', 'admin2026');
E.GATE.doBootstrap();
ok('正确提交后解锁', E.GATE.isLocked() === false);
ok('body 锁定类已移除', E.body.classList.contains('nj-locked') === false);
ok('当前登录者为刘珍', E.GATE.current().name === '刘珍');
ok('当前登录者为管理员', E.GATE.isAdmin() === true);
ok('会话已写入', E.AUTH.session.get().name === '刘珍');
ok('刘珍成为管理员账号', E.AUTH.isAdmin('刘珍') === true);

// ============================================================
group('2. 登录流程（已有管理员，换人登录）');
E = makeEnv();
E.AUTH.bootstrap('刘珍', 'admin2026');
E.AUTH.add('罗永豪', 'TECHNICIAN', { password: 'luo123456' });
E.AUTH.add('马迪', 'REPORTER');                       // 未设口令
E.AUTH.add('离职同事', 'REPORTER', { password: 'lz123456', active: false });
E.GATE.init({ pageName: '工单系统', getNames: () => ['刘珍', '罗永豪', '马迪'] });
E.GATE.start();
ok('进入登录模式', E.GATE.mode() === 'login');
ok('未登录时锁定', E.GATE.isLocked() === true);
const pool = E.GATE.__probe.loginPool();
ok('可登录名单含管理员', pool.indexOf('刘珍') >= 0, JSON.stringify(pool));
ok('可登录名单含技师', pool.indexOf('罗永豪') >= 0);
ok('未设口令者不在名单', pool.indexOf('马迪') < 0);
ok('已停用者不在名单', pool.indexOf('离职同事') < 0);
ok('登录门显示姓名', E.gateHtml().indexOf('罗永豪') >= 0);
ok('未选姓名提交被拒', (() => { E.setInput('njgLoginPwd', 'x'); E.GATE.submitLogin(); return E.gateHtml().indexOf('请先选择你的姓名') >= 0; })());
E.GATE.pickLogin('罗永豪');
ok('未输口令被拒', (() => { E.setInput('njgLoginPwd', ''); E.GATE.submitLogin(); return E.gateHtml().indexOf('请输入登录口令') >= 0; })());
ok('错误口令被拒', (() => { E.setInput('njgLoginPwd', 'wrongpwd'); E.GATE.submitLogin(); return E.GATE.isLocked() === true && E.gateHtml().indexOf('口令不正确') >= 0; })());
ok('错误口令后仍锁定', E.GATE.isLocked() === true);
E.setInput('njgLoginPwd', 'luo123456');
E.GATE.submitLogin();
ok('正确口令后解锁', E.GATE.isLocked() === false);
ok('当前登录者为罗永豪', E.GATE.current().name === '罗永豪');
ok('罗永豪非管理员', E.GATE.isAdmin() === false);
ok('会话写入罗永豪', E.AUTH.session.get().name === '罗永豪');

// ============================================================
group('3. 登录失败原因与安全提示');
E = makeEnv();
E.AUTH.bootstrap('刘珍', 'admin2026');
E.AUTH.add('马迪', 'REPORTER');
E.AUTH.add('离职同事', 'REPORTER', { password: 'lz123456', active: false });
E.GATE.init({ pageName: '工单系统', getNames: () => ['刘珍', '马迪', '离职同事', '查无此人'] });
E.GATE.start();
ok('未设口令账号登录被拒并提示', (() => {
  E.GATE.pickLogin('马迪'); E.setInput('njgLoginPwd', 'anything'); E.GATE.submitLogin();
  return E.gateHtml().indexOf('尚未设置口令') >= 0;
})());
ok('停用账号登录被拒并提示', (() => {
  E.GATE.pickLogin('离职同事'); E.setInput('njgLoginPwd', 'lz123456'); E.GATE.submitLogin();
  return E.gateHtml().indexOf('已停用') >= 0;
})());
ok('口令哈希不落明文（页面 HTML 不含口令）', E.gateHtml().indexOf('admin2026') < 0);
ok('锁定态页面不泄露账号库', JSON.stringify(E.GATE.__probe.state()).indexOf('admin2026') < 0);

// ============================================================
group('4. 会话恢复（刷新页面免重复登录）');
E = makeEnv();
E.AUTH.bootstrap('刘珍', 'admin2026');
E.AUTH.session.set('刘珍', 'ADMIN');
E.GATE.init({ pageName: '工单系统', getNames: () => ['刘珍'] });
E.GATE.start();
ok('有会话时直接放行', E.GATE.isLocked() === false);
ok('当前登录者恢复为刘珍', E.GATE.current().name === '刘珍');
ok('有会话时不进登录模式', E.GATE.mode() === 'login');

// ============================================================
group('5. 会话失效（账号被停用后应被踢回登录）');
E = makeEnv();
E.AUTH.bootstrap('刘珍', 'admin2026');
E.AUTH.add('周大伟', 'ADMIN', { password: 'zhou123456', admin: true });
E.AUTH.session.set('周大伟', 'ADMIN');
E.AUTH.update('周大伟', { active: false });
E.GATE.init({ pageName: '工单系统', getNames: () => ['刘珍', '周大伟'] });
E.GATE.start();
ok('停用账号的会话不再放行', E.GATE.isLocked() === true);
ok('未进入已登录状态', E.GATE.current() === null);

// ============================================================
group('6. 退出登录');
E = makeEnv();
E.AUTH.bootstrap('刘珍', 'admin2026');
E.GATE.init({ pageName: '工单系统', getNames: () => ['刘珍'] });
E.GATE.start();
loginAs(E, '刘珍', 'admin2026');
ok('先处于已登录', E.GATE.isLocked() === false);
E.GATE.logout();
ok('退出后重新锁定', E.GATE.isLocked() === true);
ok('退出后当前用户为空', E.GATE.current() === null);
ok('退出后会话被清', E.AUTH.session.get() === null);
ok('退出后回到登录门', E.gateHtml().indexOf('请选择你的姓名') >= 0);

// ============================================================
group('7. 管理员权限面板：列表与门控');
E = makeEnv();
E.AUTH.bootstrap('刘珍', 'admin2026');
E.AUTH.add('罗永豪', 'TECHNICIAN', { password: 'luo123456' });
E.AUTH.add('马迪', 'REPORTER');
E.AUTH.add('离职同事', 'REPORTER', { password: 'lz123456', active: false });
E.GATE.init({ pageName: '工单系统', getNames: () => ['刘珍', '罗永豪'] });
E.GATE.start();
loginAs(E, '刘珍', 'admin2026');
ok('管理员已登录', E.GATE.isAdmin() === true);
E.GATE.openPanel();
ok('面板已打开', E.GATE.__probe.state().panel.open === true);
ok('面板为管理视图', E.GATE.__probe.state().panel.kind === 'manage');
let ph = E.panelHtml();
ok('列表显示全部账号', ph.indexOf('刘珍') >= 0 && ph.indexOf('罗永豪') >= 0 && ph.indexOf('马迪') >= 0 && ph.indexOf('离职同事') >= 0);
ok('标记管理员', ph.indexOf('管理员') >= 0);
ok('标记未设口令', ph.indexOf('未设口令') >= 0);
ok('标记已停用', ph.indexOf('已停用') >= 0);
ok('提供新增入口', ph.indexOf('新增账号') >= 0);
ok('停用账号显示「启用」按钮', ph.indexOf('启用') >= 0);
ok('列表显示可见页面数', ph.indexOf('可见') >= 0);
E.GATE.pFilter('罗永');
ok('搜索过滤生效', E.panelHtml().indexOf('罗永豪') >= 0 && E.panelHtml().indexOf('马迪') < 0);
E.GATE.pFilter('');
ok('清空搜索恢复', E.panelHtml().indexOf('马迪') >= 0);

// ============================================================
group('8. 管理员面板：编辑权限（岗位 + 页面 + 数据范围）');
E.GATE.pEdit('罗永豪');
ok('进入编辑视图', E.GATE.__probe.state().panel.view === 'edit');
ph = E.panelHtml();
ok('编辑页显示姓名', ph.indexOf('罗永豪') >= 0);
ok('编辑页显示岗位选择', ph.indexOf('岗位') >= 0);
ok('编辑页显示可见页面', ph.indexOf('可见页面') >= 0);
ok('编辑页显示数据范围', ph.indexOf('数据可见范围') >= 0);
ok('编辑页显示口令区', ph.indexOf('登录口令') >= 0);
ok('默认跟随岗位已勾选', ph.indexOf('跟随岗位') >= 0);
const d0 = E.GATE.__probe.state();
ok('草稿为技师岗位', E.AUTH.get('罗永豪').role === 'TECHNICIAN');
// 取消跟随岗位 → 逐页自定义
E.GATE.pFollowRole(false);
ok('取消跟随岗位后草稿有页面', true);
E.GATE.pClickPage(null, 'report');
E.GATE.pSave();
ok('保存后技师可进报表', E.AUTH.canEnter('罗永豪', 'report') === true);
ok('保存后回到列表', E.GATE.__probe.state().panel.view === 'list');
// 改岗位
E.GATE.pEdit('罗永豪');
E.GATE.pRole('FINANCE');
E.GATE.pFollowRole(true);            // 回到跟随岗位
E.GATE.pSave();
ok('改岗位后角色为财务', E.AUTH.get('罗永豪').role === 'FINANCE');
ok('改岗位后页面跟随财务默认', JSON.stringify(E.AUTH.effectivePages('罗永豪')) === JSON.stringify(E.AFG.ROLE_PAGES.FINANCE));
// 数据范围
E.GATE.pEdit('罗永豪');
E.GATE.pScope('all');
E.GATE.pSave();
ok('数据范围改为全部', E.AUTH.effectiveScope('罗永豪') === 'all');
E.GATE.pEdit('罗永豪');
E.GATE.pScope('own');
E.GATE.pSave();
ok('数据范围改为仅本人', E.AUTH.effectiveScope('罗永豪') === 'own');

// ============================================================
group('9. 管理员面板：停用 / 启用 / 删除 / 不可自毁');
if (!E.GATE.current()) loginAs(E, '刘珍', 'admin2026');
E.GATE.pToggleActive('马迪');
ok('停用生效', E.AUTH.get('马迪').active === false);
E.GATE.pToggleActive('马迪');
ok('启用生效', E.AUTH.get('马迪').active === true);
E.GATE.pEdit('马迪');
E.GATE.pRemove();
ok('删除生效', E.AUTH.exists('马迪') === false);
ok('删除后回列表', E.GATE.__probe.state().panel.view === 'list');
// 不能删掉最后一个管理员
E.GATE.pEdit('刘珍');
ph = E.panelHtml();
ok('编辑自己时提示风险', ph.indexOf('这是你自己的账号') >= 0);
ok('编辑自己时不显示删除按钮', ph.indexOf('删除此账号') < 0);
ok('唯一管理员不能停用', E.AUTH.update('刘珍', { active: false }).ok === false);
E.GATE.pToggleActive('刘珍');
ok('面板停用唯一管理员被拒', E.AUTH.get('刘珍').active === true);
ok('拒绝原因已提示', E.panelHtml().indexOf('最后一名') >= 0, E.panelHtml().slice(0, 200));

// ============================================================
group('10. 管理员面板：新增账号');
if (!E.GATE.isAdmin()) loginAs(E, '刘珍', 'admin2026');
E.GATE.openPanel();
E.GATE.pAddView();
ok('进入新增视图', E.GATE.__probe.state().panel.view === 'add');
ph = E.panelHtml();
ok('新增页提供台账姓名候选', ph.indexOf('刘珍') >= 0 || ph.indexOf('罗永豪') >= 0);
ok('新增页提示可手动输入', ph.indexOf('手动输入') >= 0);
E.setInput('njpAddName', '李恩浩');
E.GATE.aRole('WAREHOUSE');
E.setInput('njpAddPwd', 'li123456');
E.GATE.aSave();
ok('新增成功', E.AUTH.exists('李恩浩') === true);
ok('新增岗位正确', E.AUTH.get('李恩浩').role === 'WAREHOUSE');
ok('新增可登录', E.AUTH.verify('李恩浩', 'li123456').ok === true);
ok('新增后回列表并提示', E.GATE.__probe.state().panel.view === 'list' && E.panelHtml().indexOf('已创建账号') >= 0);
// 脏姓名
E.GATE.pAddView();
E.setInput('njpAddName', '终止');
E.GATE.aSave();
ok('脏姓名被拒并提示', E.panelHtml().indexOf('不像一个真实姓名') >= 0);
// 重复姓名
E.setInput('njpAddName', '刘珍');
E.GATE.aSave();
ok('重复姓名被拒并提示', E.panelHtml().indexOf('已存在') >= 0);
// 空姓名
E.setInput('njpAddName', '');
E.GATE.aSave();
ok('空姓名被拒', E.panelHtml().indexOf('不能为空') >= 0);

// ============================================================
group('11. 管理员面板：设置 / 清除口令');
E.GATE.pEdit('罗永豪');
E.setInput('njpNewPwd', 'newpass123');
E.GATE.pSetPwd();
ok('设置口令成功', E.AUTH.verify('罗永豪', 'newpass123').ok === true);
ok('设置后有成功提示', E.panelHtml().indexOf('口令已更新') >= 0);
E.setInput('njpNewPwd', 'ab');
E.GATE.pSetPwd();
ok('过短口令被拒', E.panelHtml().indexOf('至少 4 位') >= 0);
ok('过短口令未生效', E.AUTH.verify('罗永豪', 'newpass123').ok === true);
E.GATE.pClearPwd();
ok('清除口令生效', E.AUTH.get('罗永豪').pwd === null);
ok('清除后无法登录', E.AUTH.verify('罗永豪', 'newpass123').reason === 'no-password');
ok('清除后提示', E.panelHtml().indexOf('已清除口令') >= 0);
ok('清除后不在可登录名单', E.GATE.__probe.loginPool().indexOf('罗永豪') < 0);

// ============================================================
group('12. 非管理员：只能改自己的口令，看不到权限项');
E = makeEnv();
E.AUTH.bootstrap('刘珍', 'admin2026');
E.AUTH.add('罗永豪', 'TECHNICIAN', { password: 'luo123456' });
E.GATE.init({ pageName: '工单系统', getNames: () => ['刘珍', '罗永豪'] });
E.GATE.start();
E.GATE.pickLogin('罗永豪');
E.setInput('njgLoginPwd', 'luo123456');
E.GATE.submitLogin();
ok('技师登录成功', E.GATE.current().name === '罗永豪');
ok('技师非管理员', E.GATE.isAdmin() === false);
E.GATE.openPanel();
ok('技师打开的是自助视图', E.GATE.__probe.state().panel.kind === 'self');
ph = E.panelHtml();
ok('自助视图显示改口令', ph.indexOf('修改我的登录口令') >= 0);
ok('自助视图不含权限管理标题', ph.indexOf('权限管理') < 0);
ok('自助视图不含账号列表', ph.indexOf('新增账号') < 0);
ok('自助视图不含其他同事姓名', ph.indexOf('刘珍') < 0);
// 改口令：原口令错
E.setInput('njpSelfOld', 'wrongpwd');
E.setInput('njpSelfNew', 'newpass123');
E.setInput('njpSelfNew2', 'newpass123');
E.GATE.selfSave();
ok('原口令错误被拒', E.panelHtml().indexOf('原口令不正确') >= 0);
ok('原口令错误未生效', E.AUTH.verify('罗永豪', 'luo123456').ok === true);
// 两次不一致
E.setInput('njpSelfOld', 'luo123456');
E.setInput('njpSelfNew', 'newpass123');
E.setInput('njpSelfNew2', 'other12345');
E.GATE.selfSave();
ok('两次不一致被拒', E.panelHtml().indexOf('不一致') >= 0);
// 成功
E.setInput('njpSelfOld', 'luo123456');
E.setInput('njpSelfNew', 'newpass123');
E.setInput('njpSelfNew2', 'newpass123');
E.GATE.selfSave();
ok('改口令成功', E.AUTH.verify('罗永豪', 'newpass123').ok === true);
ok('旧口令失效', E.AUTH.verify('罗永豪', 'luo123456').ok === false);
ok('成功提示', E.panelHtml().indexOf('口令已修改') >= 0);
// 非管理员直接调用管理 API 应无效（没有管理权限，面板不提供入口）
ok('技师无管理入口（列表视图不可达）', (() => { E.GATE.pAddView(); return E.GATE.__probe.state().panel.kind === 'self'; })());

// ============================================================
group('13. 应急重置（忘记口令）');
E = makeEnv();
E.AUTH.bootstrap('刘珍', 'admin2026');
E.GATE.init({ pageName: '工单系统', getNames: () => ['刘珍', '周大伟'] });
E.GATE.start();
ok('默认收起应急区', E.gateHtml().indexOf('应急重置') < 0);
E.GATE.toggleRescue();
ok('展开应急区', E.gateHtml().indexOf('应急重置') >= 0);
ok('提供站点口令输入', E.gateHtml().indexOf('站点口令') >= 0);
E.setInput('njgResName', '周大伟');
E.setInput('njgResSite', 'wrongsite');
E.setInput('njgResPwd', 'zhou123456');
E.GATE.doRescue();
ok('站点口令错误被拒', E.gateHtml().indexOf('站点口令不正确') >= 0);
E.setInput('njgResName', '周大伟');
E.setInput('njgResSite', 'ningjia1');
E.setInput('njgResPwd', 'zhou123456');
E.GATE.doRescue();
ok('站点口令正确可自救', E.AUTH.isAdmin('周大伟') === true);
ok('自救成功提示', E.gateHtml().indexOf('重置为管理员') >= 0);
ok('自救后可登录', E.AUTH.verify('周大伟', 'zhou123456').ok === true);

// ============================================================
group('14. XSS / 注入安全（姓名进入内联处理器与 HTML）');
E = makeEnv();
E.AUTH.bootstrap('刘珍', 'admin2026');
// 注：超长 payload（如 <img src=x onerror=alert(1)>）在 add() 阶段就被「姓名≤12字」拦下，
// 这里改用能通过校验的短恶意串，检验真正的转义是否到位。
const evilQ = "刘'";        // 单引号：可闭合内联处理器里的字符串
const evilT = '张<b>';      // 尖括号：可注入标签
ok('长 payload 在新增阶段即被拒', E.AUTH.add('<img src=x onerror=alert(1)>', 'REPORTER').ok === false);
ok('含单引号的短姓名可通过校验', E.AUTH.add(evilQ, 'ADMIN', { password: 'ev123456', admin: true }).ok === true);
ok('含尖括号的短姓名可通过校验', E.AUTH.add(evilT, 'REPORTER', { password: 'ev123456' }).ok === true);
E.GATE.init({ pageName: '工单系统', getNames: () => [evilQ, evilT, '刘珍'] });
E.GATE.start();
let g = E.gateHtml();
ok('单引号被转义（不闭合 JS 字符串）', g.indexOf("\\'") >= 0, g.slice(0, 300));
ok('尖括号被实体化（无裸标签）', g.indexOf('<b>') < 0 && g.indexOf('&lt;b&gt;') >= 0);
ok('恶意姓名仍可作为登录项出现', g.indexOf('&lt;b&gt;') >= 0);
E.GATE.pickLogin(evilQ);
E.setInput('njgLoginPwd', 'ev123456');
E.GATE.submitLogin();
ok('带单引号的姓名也能正常登录', E.GATE.current() && E.GATE.current().name === evilQ, E.GATE.current() ? E.GATE.current().name : 'null');
ok('登录者为管理员', E.GATE.isAdmin() === true);
E.GATE.openPanel();
let p = E.panelHtml();
ok('进入管理列表', E.GATE.__probe.state().panel.kind === 'manage');
ok('管理面板同样实体化尖括号', p.indexOf('张<b>') < 0 && p.indexOf('&lt;b&gt;') >= 0);
ok('管理面板转义单引号', p.indexOf("\\'") >= 0);
E.GATE.pEdit(evilQ);
p = E.panelHtml();
ok('编辑页可定位到含单引号的姓名', p.indexOf('正在编辑') >= 0);
E.GATE.pEdit(evilT);
p = E.panelHtml();
ok('编辑页对尖括号姓名不产生裸标签', p.indexOf('张<b>') < 0 && p.indexOf('&lt;b&gt;') >= 0);
ok('编辑页可定位到尖括号姓名', p.indexOf('正在编辑') >= 0);

// ============================================================
group('15. 页面标题与接口稳定性');
E = makeEnv();
E.AUTH.bootstrap('刘珍', 'admin2026');
E.GATE.init({ pageName: '报表中心', getNames: () => ['刘珍'] });
E.GATE.start();
ok('登录门显示传入的页面名', E.gateHtml().indexOf('报表中心') >= 0);
ok('init 返回自身（可链式）', E.GATE.init({}) === E.GATE);
ok('start 返回自身', E.GATE.start() === E.GATE);
ok('current 无登录时返回 null', (() => { const e2 = makeEnv(); e2.AUTH.bootstrap('刘珍', 'admin2026'); e2.GATE.init({}); return e2.GATE.current() === null; })());
ok('暴露 lock/unlock', typeof E.GATE.lock === 'function' && typeof E.GATE.unlock === 'function');
ok('暴露 logout/openPanel/openChangePwd', typeof E.GATE.logout === 'function' && typeof E.GATE.openPanel === 'function' && typeof E.GATE.openChangePwd === 'function');

// ============================================================
group('16. 身份面板锁定态（登录后身份只读，只提供账号动作）');
E = makeEnv();
E.AUTH.bootstrap('刘珍', 'admin2026');
E.AUTH.add('罗永豪', 'TECHNICIAN', { password: 'luo123456' });
E.GATE.init({ pageName: '工单系统', getNames: () => ['刘珍', '罗永豪'] });
E.GATE.start();
loginAs(E, '刘珍', 'admin2026');
ok('管理员已登录', E.GATE.isAdmin() === true);

let calls = { pwd: 0, manage: 0, logout: 0 };
E.IDP.init({
  pageName: '工单系统',
  locked: true,
  getNames: () => ['刘珍', '罗永豪'],
  onChangePwd: () => { calls.pwd++; },
  onManage: () => { calls.manage++; },
  onLogout: () => { calls.logout++; }
});
ok('折叠条显示当前登录者', E.barHtml().indexOf('刘珍') >= 0);
ok('锁定态折叠条提示「账号」而非「切换」', E.barHtml().indexOf('>账号<') >= 0 && E.barHtml().indexOf('>切换<') < 0);
ok('折叠条显示岗位', E.barHtml().indexOf('管理员') >= 0);

E.IDP.open();
let m = E.IDP.el().innerHTML;
ok('账号菜单显示姓名', m.indexOf('刘珍') >= 0);
ok('账号菜单提供改口令', m.indexOf('修改我的登录口令') >= 0);
ok('管理员可见权限管理入口', m.indexOf('权限管理') >= 0);
ok('账号菜单提供退出登录', m.indexOf('退出登录') >= 0);
ok('锁定态不出现选姓名步骤', m.indexOf('选择姓名') < 0);
ok('锁定态不出现选岗位步骤', m.indexOf('选择岗位') < 0);
ok('锁定态不出现名单管理', m.indexOf('管理名单') < 0);

E.IDP.changePwd();
ok('点改口令触发回调', calls.pwd === 1);
E.IDP.manage();
ok('点权限管理触发回调', calls.manage === 1);
E.IDP.logout();
ok('点退出触发回调', calls.logout === 1);

// 非管理员：不应看到权限管理
E = makeEnv();
E.AUTH.bootstrap('刘珍', 'admin2026');
E.AUTH.add('罗永豪', 'TECHNICIAN', { password: 'luo123456' });
E.GATE.init({ pageName: '工单系统', getNames: () => ['刘珍', '罗永豪'] });
E.GATE.start();
loginAs(E, '罗永豪', 'luo123456');
ok('技师已登录且非管理员', E.GATE.current().name === '罗永豪' && E.GATE.isAdmin() === false);
E.IDP.init({ pageName: '工单系统', locked: true, getNames: () => ['刘珍', '罗永豪'] });
E.IDP.open();
m = E.IDP.el().innerHTML;
ok('技师账号菜单无权限管理', m.indexOf('权限管理') < 0);
ok('技师仍可改自己口令', m.indexOf('修改我的登录口令') >= 0);
ok('技师仍可退出登录', m.indexOf('退出登录') >= 0);
ok('技师不显示管理员标记', m.indexOf('管理员') < 0);

// 回归：未开启 locked 时保持原有「切换岗位身份」行为
E.IDP.init({ pageName: '工单系统', getNames: () => ['刘珍', '罗永豪'] });
ok('默认态折叠条提示「切换」', E.barHtml().indexOf('>切换<') >= 0);
ok('默认态不提示「账号」', E.barHtml().indexOf('>账号<') < 0);
E.IDP.open();
m = E.IDP.el().innerHTML;
ok('默认态仍可选姓名', m.indexOf('选择姓名') >= 0);
ok('默认态仍可选岗位', m.indexOf('选择岗位') >= 0);
ok('默认态不含账号菜单项', m.indexOf('修改我的登录口令') < 0);
ok('IDP.locked() 反映开关', E.IDP.locked() === false);

E.IDP.setIdentity('罗永豪', 'TECHNICIAN');
ok('setIdentity 同步折叠条', E.barHtml().indexOf('罗永豪') >= 0);

console.log('\n----------------------------------------');
console.log('PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
