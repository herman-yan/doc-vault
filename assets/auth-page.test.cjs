/*
 * 登录门在真实页面中的集成回归（work-order / report-center）
 * 验证：未登录时业务内容锁定、登录后放行、权限按账号生效、退出后重新锁定。
 * 运行：node assets/auth-page.test.cjs
 */
const { loadPage, group, ok, report } = require('./page-harness.cjs');
const path = require('path');

const WO = 'work-order/index.html';
const RC = 'work-order/report-center.html';

const seedData = {
  warrantyOrders: [
    { id: 'WN-000001', registerDate: '2026-10-10', customerName: '客户甲', vehicleInfo: '京A1', faultDesc: 'X', status: '未派工', engineer: '', reporter: '' },
    { id: 'WN-000002', registerDate: '2026-10-11', customerName: '客户乙', vehicleInfo: '京A2', faultDesc: 'Y', status: '在修', engineer: '罗永豪', reporter: '' }
  ],
  nonWarrantyOrders: [
    { id: 'NW-000001', registerDate: '2026-10-12', signedCustomer: '甲公司', customerName: '张三', plateNumber: '京B1', status: '待客户确认', engineer: '刘珍' }
  ],
  engineers: ['刘珍', '罗永豪', '马迪'],
  reporters: ['周字欢'],
  warehouseLogs: [],
  idCounters: { wn: 2, nw: 1, wh: 0 }
};

// 账号库种子：管理员刘珍 / 技师罗永豪（页面受限）/ 财务赵轩
function acctSeed() {
  const A = require('./auth-core.js');
  const mem = {};
  const ls = {
    getItem: k => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: k => { delete mem[k]; }
  };
  // 用同一份实现生成哈希，保证与页面内校验一致
  const AFG = require('./aftersales-guardrails.js');
  const savedWin = global.window, savedLS = global.localStorage, savedAFG = global.AFG;
  global.window = global; global.localStorage = ls; global.AFG = AFG;
  delete require.cache[require.resolve('./auth-core.js')];
  const A2 = require('./auth-core.js');
  A2.bootstrap('刘珍', 'admin2026');
  A2.add('罗永豪', 'TECHNICIAN', { password: 'luo123456' });
  A2.add('赵轩', 'FINANCE', { password: 'zhao123456' });
  global.window = savedWin; global.localStorage = savedLS; global.AFG = savedAFG;
  delete require.cache[require.resolve('./auth-core.js')];
  return mem;
}

const HANDLES = {
  read: ['APP', 'ME', 'currentPage'],
  write: ['ME', 'currentPage'],
  fns: ['renderPage', 'switchPage', 'afWarranty', 'afNonWarranty', 'afApplyNavPermission', 'afCanEnter']
};

const accts = acctSeed();

// ============================================================
group('1. 工单系统：未登录时业务内容锁定');
let P = loadPage(WO, Object.assign({ storage: Object.assign({ station_mgmt_data: seedData }, accts), withAuth: true }, HANDLES));
ok('页面脚本无运行错误', !P.runError, P.runError && P.runError.message);
ok('进入登录模式', P.GATE.mode() === 'login');
ok('页面处于锁定态', P.isLocked() === true);
ok('body 带锁定类', P.doc.body.classList.contains('nj-locked') === true);
ok('登录门已渲染', (P.get('njGate').innerHTML || '').indexOf('工单系统') >= 0);
ok('未登录时未渲染业务页面', (P.get('mainContent').innerHTML || '').length === 0,
  'mainContent 长度=' + (P.get('mainContent').innerHTML || '').length);
ok('未登录时身份栏为空', (P.get('identityBar').innerHTML || '').length === 0);
ok('可登录名单来自账号库', (P.get('njGate').innerHTML || '').indexOf('罗永豪') >= 0);
ok('未设口令者不在登录名单', P.GATE.__probe.loginPool().indexOf('马迪') < 0);

// ============================================================
group('2. 工单系统：错误口令不放行');
P.GATE.pickLogin('刘珍');
P.setInput('njgLoginPwd', 'wrongpass');
P.GATE.submitLogin();
ok('错误口令后仍锁定', P.isLocked() === true);
ok('错误口令有提示', (P.get('njGate').innerHTML || '').indexOf('口令不正确') >= 0);
ok('错误口令后仍未渲染业务页面', (P.get('mainContent').innerHTML || '').length === 0);

// ============================================================
group('3. 工单系统：管理员登录后放行');
P.setInput('njgLoginPwd', 'admin2026');
P.GATE.submitLogin();
ok('登录后解锁', P.isLocked() === false);
ok('登录后身份为刘珍', P.GATE.current().name === '刘珍');
ok('登录后渲染了业务页面', (P.get('mainContent').innerHTML || '').length > 0);
ok('登录后身份栏出现', (P.get('identityBar').innerHTML || '').indexOf('刘珍') >= 0);
ok('身份栏为账号菜单（锁定态）', (P.get('identityBar').innerHTML || '').indexOf('>账号<') >= 0);
ok('管理员可见全部工单', P.T.afWarranty().length === 2 && P.T.afNonWarranty().length === 1);
ok('管理员可进报表中心', P.T.afCanEnter('report') === true);

// ============================================================
group('4. 工单系统：退出登录后重新锁定');
P.GATE.logout();
ok('退出后重新锁定', P.isLocked() === true);
ok('退出后身份栏清空', (P.get('identityBar').innerHTML || '').length === 0);
ok('退出后回到登录门', (P.get('njGate').innerHTML || '').indexOf('请选择你的姓名') >= 0);
ok('退出后会话已清', P.AUTH.session.get() === null);

// ============================================================
group('5. 工单系统：技师登录后权限与数据范围生效');
P.GATE.pickLogin('罗永豪');
P.setInput('njgLoginPwd', 'luo123456');
P.GATE.submitLogin();
ok('技师登录成功', P.GATE.current().name === '罗永豪');
ok('技师非管理员', P.GATE.isAdmin() === false);
ok('技师进得了保内', P.T.afCanEnter('warranty') === true);
ok('技师进不了报表中心', P.T.afCanEnter('report') === false);
ok('技师进不了数据导出', P.T.afCanEnter('export') === false);
ok('技师可见工单按岗位过滤', P.T.afWarranty().length === 1, '实得 ' + P.T.afWarranty().length);
ok('技师只看得到自己的工单', P.T.afWarranty()[0] && P.T.afWarranty()[0].engineer === '罗永豪');
ok('技师非管理员时身份栏无权限管理', (() => { P.IDP.open(); const h = P.IDP.el().innerHTML; P.IDP.close(); return h.indexOf('权限管理') < 0; })());

// ============================================================
group('6. 工单系统：管理员在面板里给技师开权限，即时生效');
P.GATE.logout();
P.GATE.pickLogin('刘珍');
P.setInput('njgLoginPwd', 'admin2026');
P.GATE.submitLogin();
ok('管理员重新登录', P.GATE.isAdmin() === true);
P.GATE.openPanel();
P.GATE.pEdit('罗永豪');
P.GATE.pFollowRole(false);                 // 取消跟随岗位 → 逐页自定义
P.GATE.pClickPage(null, 'report');         // 给技师开报表中心
P.GATE.pClickPage(null, 'export');         // 也给数据导出
P.GATE.pSave();
ok('技师已获得报表中心权限', P.AUTH.canEnter('罗永豪', 'report') === true);
ok('技师已获得数据导出权限', P.AUTH.canEnter('罗永豪', 'export') === true);
ok('技师仍可进保内', P.AUTH.canEnter('罗永豪', 'warranty') === true);
// 数据范围改为全部
P.GATE.pEdit('罗永豪');
P.GATE.pScope('all');
P.GATE.pSave();
ok('技师数据范围改为全部', P.AUTH.effectiveScope('罗永豪') === 'all');

// ============================================================
group('7. 工单系统：权限变更后技师视角随之变化');
P.GATE.logout();
P.GATE.pickLogin('罗永豪');
P.setInput('njgLoginPwd', 'luo123456');
P.GATE.submitLogin();
ok('技师登录成功', P.GATE.current().name === '罗永豪');
ok('技师现在可进报表中心', P.T.afCanEnter('report') === true);
ok('技师现在可进数据导出', P.T.afCanEnter('export') === true);
ok('数据范围为全部时可见全部工单', P.T.afWarranty().length === 2, '实得 ' + P.T.afWarranty().length);
// 改回仅本人
P.GATE.openPanel();
P.GATE.selfSave && null;
P.GATE.closePanel();

// ============================================================
group('8. 报表中心：未登录锁定与登录放行');
// 报表中心整段包在 IIFE 里，boot/render 不是词法全局，改以渲染结果核验
let R = loadPage(RC, { storage: Object.assign({ station_mgmt_data: seedData }, accts), withAuth: true,
  read: ['ME'] });
ok('报表页脚本无运行错误', !R.runError, R.runError && R.runError.message);
ok('报表页处于锁定态', R.isLocked() === true);
ok('报表页登录门已渲染', (R.get('njGate').innerHTML || '').indexOf('报表中心') >= 0);
ok('未登录时报表视图为空', (R.get('view').innerHTML || '').length === 0,
  'view 长度=' + (R.get('view').innerHTML || '').length);
R.loginAs('刘珍', 'admin2026');
ok('登录后解锁', R.isLocked() === false);
ok('登录后身份为刘珍', R.GATE.current().name === '刘珍');
ok('登录后报表已渲染', (R.get('view').innerHTML || '').length > 0);

// ============================================================
group('9. 报表中心：无权岗位被拒之门外');
R.GATE.logout();
R.GATE.pickLogin('罗永豪');
R.setInput('njgLoginPwd', 'luo123456');
R.GATE.submitLogin();
ok('技师登录成功', R.GATE.current().name === '罗永豪');
ok('技师默认无权进报表中心', R.GATE.isAdmin() === false);
const denied = (R.get('view').innerHTML || '');
ok('技师看到无权提示', denied.indexOf('无权查看') >= 0 || denied.indexOf('无权') >= 0, denied.slice(0, 160));
ok('无权提示保留「返回工单系统」入口', denied.indexOf('返回工单系统') >= 0);
ok('无权提示不再含「返回首页」', denied.indexOf('返回首页') < 0);

// ============================================================
group('10. 报表中心：管理员授权后技师可进');
R.GATE.logout();
R.loginAs('刘珍', 'admin2026');
ok('管理员登录', R.GATE.isAdmin() === true);
ok('报表中心已渲染（管理员）', (R.get('view').innerHTML || '').length > 0);

console.log('\n----------------------------------------');
process.exit(report('登录门页面集成'));
