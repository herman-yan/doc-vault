/*
 * 账号与权限核心层单测（auth-core.js）
 * 覆盖：SHA-256 向量、口令加盐哈希、账号库增删改、会话、管理员不变量、
 *       权限解析（岗位默认 + 个人微调）、数据范围、首次启用与应急重置。
 */
const path = require('path');
const crypto = require('crypto');

// ---------- localStorage 桩（每个 section 前清空） ----------
const mem = {};
global.localStorage = {
  getItem: k => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: k => { delete mem[k]; },
  clear: () => { for (const k in mem) delete mem[k]; }
};
global.window = global;

const AFG = require('../assets/aftersales-guardrails.js');
global.AFG = AFG;
const A = require('../assets/auth-core.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) pass++;
  else { fail++; console.log('  FAIL: ' + name + (extra ? '  -> ' + extra : '')); }
}
function group(t) { console.log('\n== ' + t); }
function reset() { localStorage.clear(); }

// 便捷：建一个「已有管理员」的环境
function seed() {
  reset();
  A.bootstrap('刘珍', 'admin2026');
}

// ============================================================
group('1. SHA-256 正确性（含中文/emoji，与 Node crypto 对照）');
const vectors = [
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ['hello world', 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'],
  ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
  ['The quick brown fox jumps over the lazy dog', 'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592']
];
vectors.forEach(([m, exp]) => ok('已知向量 sha256("' + m.slice(0, 16) + '")', A.sha256(m) === exp));
ok('长输入 1000 个 a', A.sha256('a'.repeat(1000)) === '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
['中文口令测试', '刘珍的密码', 'emoji🔧测试', '全角\u3000空格', '混合 mixed 12345'].forEach(s => {
  ok('与 Node crypto 一致：' + s, A.sha256(s) === crypto.createHash('sha256').update(s, 'utf8').digest('hex'));
});
ok('输出恒为 64 位十六进制', /^[0-9a-f]{64}$/.test(A.sha256('任意')));

// ============================================================
group('2. 口令哈希与加盐');
ok('同口令同盐哈希稳定', A.hashPwd('abc', 'salt1') === A.hashPwd('abc', 'salt1'));
ok('同口令异盐哈希不同', A.hashPwd('abc', 'salt1') !== A.hashPwd('abc', 'salt2'));
ok('异口令同盐哈希不同', A.hashPwd('abc', 's') !== A.hashPwd('abd', 's'));
ok('盐为 32 位十六进制', /^[0-9a-f]{32}$/.test(A.makeSalt()));
ok('两次生成盐不同', A.makeSalt() !== A.makeSalt());
const c1 = A.makeCredential('p@ss'), c2 = A.makeCredential('p@ss');
ok('凭据含 salt 与 hash', !!c1.salt && /^[0-9a-f]{64}$/.test(c1.hash));
ok('同口令两次凭据不同（随机盐）', c1.salt !== c2.salt && c1.hash !== c2.hash);

// ============================================================
group('3. 初始状态与首次启用');
reset();
ok('初始无账号', A.list().length === 0);
ok('初始需要初始化', A.needsBootstrap() === true);
ok('初始无会话', A.session.get() === null);
ok('空姓名被拒', A.bootstrap('', 'abcd1234').ok === false);
ok('纯空白姓名被拒', A.bootstrap('   ', 'abcd1234').ok === false);
ok('口令短于 4 位被拒', A.bootstrap('刘珍', 'abc').ok === false);
ok('恰好 4 位口令可用', A.bootstrap('刘珍', 'abcd').ok === true);
ok('初始化后不再需要', A.needsBootstrap() === false);
ok('首位成为管理员', A.isAdmin('刘珍') === true);
ok('首位角色为管理员', A.get('刘珍').role === 'ADMIN');
ok('重复初始化被拒', A.bootstrap('张三', 'xyz12345').ok === false);
ok('全角空格姓名被归一', (() => { reset(); A.bootstrap('刘\u3000珍', 'abcd1234'); return A.get('刘珍') !== null; })());

// ============================================================
group('4. 口令校验与失败原因');
seed();
ok('正确口令通过', A.verify('刘珍', 'admin2026').ok === true);
ok('错误口令拒绝', A.verify('刘珍', 'admin2027').ok === false);
ok('错误口令原因 bad-password', A.verify('刘珍', 'x').reason === 'bad-password');
ok('不存在账号 no-account', A.verify('查无此人', 'x').reason === 'no-account');
ok('空口令不通过', A.verify('刘珍', '').ok === false);
ok('姓名含全角空格也能登录', (() => { A.add('张\u3000峻', 'REPORTER', { password: 'zj123456' }); return A.verify('张峻', 'zj123456').ok === true; })());
ok('账号库不存明文口令', JSON.stringify(A.list()).indexOf('admin2026') < 0);
ok('账号库不存明文（新增者）', JSON.stringify(A.list()).indexOf('zj123456') < 0);

// ============================================================
group('5. 会话与停用联动');
seed();
A.add('周大伟', 'ADMIN', { password: 'zhou123456', admin: true });
ok('写入会话', A.session.set('刘珍', 'ADMIN').name === '刘珍');
ok('会话有效', A.sessionValid() !== null);
ok('会话姓名可读', A.session.get().name === '刘珍');
ok('停用非唯一管理员成功', A.update('刘珍', { active: false }).ok === true);
ok('停用后会话失效', A.sessionValid() === null);
ok('停用后会话被清', A.session.get() === null);
ok('停用账号登录被拒', A.verify('刘珍', 'admin2026').reason === 'inactive');
ok('恢复后可登录', A.update('刘珍', { active: true }).ok === true && A.verify('刘珍', 'admin2026').ok === true);
A.session.set('刘珍', 'ADMIN');
ok('删除账号后会话失效', A.remove('刘珍').ok === true && A.sessionValid() === null);
ok('clear 会话', A.session.set('周大伟', 'DISPATCHER') && (A.session.clear(), A.session.get() === null));

// ============================================================
group('6. 管理员不变量（任何操作都不得让可用管理员归零）');
seed();
ok('唯一管理员不能停用', A.update('刘珍', { active: false }).ok === false);
ok('唯一管理员不能降权', A.update('刘珍', { admin: false }).ok === false);
ok('唯一管理员不能删除', A.remove('刘珍').ok === false);
ok('唯一管理员不能清口令', A.clearPassword('刘珍').ok === false);
ok('被拒后仍可登录', A.verify('刘珍', 'admin2026').ok === true);
ok('错误信息可读', A.update('刘珍', { admin: false }).error.indexOf('最后一名') >= 0);
ok('补一名管理员后可降权', (() => { A.add('周大伟', 'ADMIN', { password: 'zhou123456', admin: true }); return A.update('刘珍', { admin: false }).ok === true; })());
ok('降权后周大伟是管理员', A.isAdmin('周大伟') === true && A.isAdmin('刘珍') === false);
ok('再降周大伟被拒', A.update('周大伟', { admin: false }).ok === false);
ok('无口令的管理员不算可用', (() => { reset(); A.bootstrap('刘珍', 'admin2026'); A.add('王鹏', 'ADMIN', { admin: true }); return A.withPwdAdmins().length === 1; })());

// ============================================================
group('7. 账号新增与校验');
seed();
ok('空姓名被拒', A.add('', 'REPORTER').ok === false);
ok('占位词「无」被拒', A.add('无', 'REPORTER').ok === false);
ok('状态词「终止」被拒', A.add('终止', 'REPORTER').ok === false);
ok('纯数字被拒', A.add('430.17', 'REPORTER').ok === false);
ok('重复账号被拒', A.add('刘珍', 'REPORTER').ok === false);
ok('重复账号提示可读', A.add('刘珍', 'REPORTER').error.indexOf('已存在') >= 0);
ok('正常新增成功', A.add('罗永豪', 'TECHNICIAN', { password: 'luo123456' }).ok === true);
ok('新增后可登录', A.verify('罗永豪', 'luo123456').ok === true);
ok('新增者非管理员', A.isAdmin('罗永豪') === false);
ok('新增默认启用', A.get('罗永豪').active === true);
ok('新增无口令者不可登录', A.add('马迪', 'REPORTER').ok === true && A.verify('马迪', 'x').reason === 'no-password');
ok('非法岗位回落到报单员', A.add('李恩浩', 'NOT_A_ROLE').ok === true && A.get('李恩浩').role === 'REPORTER');
ok('停用状态可新增', A.add('离职同事', 'REPORTER', { active: false }).ok === true && A.verify('离职同事', 'x').reason === 'inactive');

// ============================================================
group('8. 权限解析：岗位默认 + 个人微调');
seed();
A.add('罗永豪', 'TECHNICIAN', { password: 'luo123456' });
A.add('赵轩', 'FINANCE', { password: 'zx123456' });
ok('技师页面 = 岗位默认', JSON.stringify(A.effectivePages('罗永豪')) === JSON.stringify(AFG.ROLE_PAGES.TECHNICIAN));
ok('财务页面 = 岗位默认', JSON.stringify(A.effectivePages('赵轩')) === JSON.stringify(AFG.ROLE_PAGES.FINANCE));
ok('技师进不了报表中心', A.canEnter('罗永豪', 'report') === false);
ok('财务进得了报表中心', A.canEnter('赵轩', 'report') === true);
ok('技师进得了保内', A.canEnter('罗永豪', 'warranty') === true);
ok('技师进不了数据导出', A.canEnter('罗永豪', 'export') === false);
ok('管理员全通', A.PAGE_IDS.every(p => A.canEnter('刘珍', p) === true));
ok('微调覆盖岗位', A.update('罗永豪', { pages: ['dashboard', 'warranty'] }).ok === true);
ok('微调后恰好 2 页', A.effectivePages('罗永豪').length === 2);
ok('微调后可进保内', A.canEnter('罗永豪', 'warranty') === true);
ok('微调后进不了保外', A.canEnter('罗永豪', 'nonwarranty') === false);
ok('微调后进不了报表', A.canEnter('罗永豪', 'report') === false);
ok('微调可扩权（给技师开报表）', A.update('罗永豪', { pages: ['dashboard', 'report'] }).ok === true && A.canEnter('罗永豪', 'report') === true);
ok('空数组等同跟随岗位', A.update('罗永豪', { pages: [] }).ok === true && A.effectivePages('罗永豪').length === AFG.ROLE_PAGES.TECHNICIAN.length);
ok('非法页面 id 被过滤', A.update('罗永豪', { pages: ['dashboard', '不存在的页'] }).ok === true && A.effectivePages('罗永豪').length === 1);
ok('未知账号页面为空', A.effectivePages('查无此人').length === 0);
ok('页面清单覆盖导航全部项', ['dashboard', 'report', 'warranty', 'nonwarranty', 'warehouse', 'engineers', 'export'].every(p => A.PAGE_IDS.indexOf(p) >= 0));
ok('每个页面都有中文名', A.PAGE_IDS.every(p => !!A.PAGE_LABELS[p]));
// 门禁必须 fail-closed：停用账号不得凭残留配置继续进入任何页面
A.update('罗永豪', { active: false });
ok('停用账号 canEnter 一律拒绝（含其原本有权的页面）',
  A.canEnter('罗永豪', 'dashboard') === false && A.canEnter('罗永豪', 'report') === false && A.canEnter('罗永豪', 'warranty') === false);
ok('停用账号 effectivePages 仍返回配置（供管理员面板查看待恢复权限）',
  A.effectivePages('罗永豪').length > 0);
A.update('罗永豪', { active: true });
ok('恢复启用后权限立即回来', A.canEnter('罗永豪', 'dashboard') === true);
ok('不存在账号 canEnter 拒绝', A.canEnter('查无此人', 'dashboard') === false);

// ============================================================
group('9. 数据可见范围');
seed();
A.add('罗永豪', 'TECHNICIAN', { password: 'luo123456' });
ok('默认跟随岗位', A.effectiveScope('罗永豪') === 'role');
ok('可覆盖为全部', A.update('罗永豪', { scope: 'all' }).ok === true && A.effectiveScope('罗永豪') === 'all');
ok('可覆盖为仅本人', A.update('罗永豪', { scope: 'own' }).ok === true && A.effectiveScope('罗永豪') === 'own');
ok('非法范围回落跟随岗位', A.update('罗永豪', { scope: '乱写' }).ok === true && A.effectiveScope('罗永豪') === 'role');
ok('未知账号默认跟随岗位', A.effectiveScope('查无此人') === 'role');
ok('范围选项齐全', JSON.stringify(A.SCOPE_IDS) === JSON.stringify(['role', 'all', 'own']));

// ============================================================
group('10. 口令修改与重置');
seed();
A.add('罗永豪', 'TECHNICIAN', { password: 'luo123456' });
ok('原口令错误被拒', A.setPassword('罗永豪', 'new12345', 'wrongpwd').ok === false);
ok('原口令错误提示可读', A.setPassword('罗永豪', 'new12345', 'wrongpwd').error.indexOf('原口令') >= 0);
ok('原口令正确可改', A.setPassword('罗永豪', 'new12345', 'luo123456').ok === true);
ok('新口令生效', A.verify('罗永豪', 'new12345').ok === true);
ok('旧口令失效', A.verify('罗永豪', 'luo123456').ok === false);
ok('新口令短于 4 位被拒', A.setPassword('罗永豪', 'ab', 'new12345').ok === false);
ok('管理员重置无需原口令', A.setPassword('罗永豪', 'reset1234', undefined).ok === true);
ok('重置后生效', A.verify('罗永豪', 'reset1234').ok === true);
ok('不存在账号改口令被拒', A.setPassword('查无此人', 'abcd1234').ok === false);
ok('无口令账号带原口令改被拒', (() => { A.add('马迪', 'REPORTER'); return A.setPassword('马迪', 'abcd1234', 'x').ok === false; })());
ok('清口令后不可登录', A.clearPassword('罗永豪').ok === true && A.verify('罗永豪', 'reset1234').reason === 'no-password');

// ============================================================
group('11. 应急重置（忘记管理员口令的自救通道）');
seed();
ok('站点口令错误被拒', A.emergencyReset('王鹏', 'wrongsite', 'abcd1234').ok === false);
ok('站点口令错误提示可读', A.emergencyReset('王鹏', 'wrongsite', 'abcd1234').error.indexOf('站点口令') >= 0);
ok('新口令过短被拒', A.emergencyReset('王鹏', 'ningjia1', 'ab').ok === false);
ok('空姓名被拒', A.emergencyReset('', 'ningjia1', 'abcd1234').ok === false);
ok('站点口令正确可自救', A.emergencyReset('王鹏', 'ningjia1', 'wang123456').ok === true);
ok('自救者成为管理员', A.isAdmin('王鹏') === true);
ok('自救者可登录', A.verify('王鹏', 'wang123456').ok === true);
ok('自救后不再需要初始化', A.needsBootstrap() === false);
ok('对已有账号自救会提权', (() => { reset(); A.bootstrap('刘珍', 'admin2026'); A.add('李恩浩', 'REPORTER', { password: 'le123456' }); A.emergencyReset('李恩浩', 'ningjia1', 'le654321'); return A.isAdmin('李恩浩') === true && A.verify('李恩浩', 'le654321').ok === true; })());
ok('管理员全丢时可自救', (() => {
  reset(); A.bootstrap('刘珍', 'admin2026');
  // 直接改写存储模拟「管理员身份全部丢失」（正常路径会被不变量拦住）
  const db = A.load(); db.accounts.forEach(a => { a.admin = false; }); A.save(db);
  return A.needsBootstrap() === true && A.emergencyReset('周大伟', 'ningjia1', 'zhou1234').ok === true && A.isAdmin('周大伟');
})());

// ============================================================
group('12. 名单候选（管理员新增账号时的可选姓名）');
reset();
const groups = [[{ engineer: '刘珍' }, { engineer: '罗永豪' }, { engineer: '周大伟' }, { engineer: '终止' }]];
const cand0 = A.nameCandidates(groups);
ok('候选来自台账', cand0.indexOf('刘珍') >= 0 && cand0.indexOf('罗永豪') >= 0, JSON.stringify(cand0));
ok('候选过滤脏值', cand0.indexOf('终止') < 0);
A.bootstrap('刘珍', 'admin2026');
const cand1 = A.nameCandidates(groups);
ok('候选排除已建账号', cand1.indexOf('刘珍') < 0, JSON.stringify(cand1));
ok('候选保留未建账号者', cand1.indexOf('罗永豪') >= 0, JSON.stringify(cand1));
ok('空输入不报错', A.nameCandidates().length === 0 || Array.isArray(A.nameCandidates()));

// ============================================================
group('13. 存储健壮性');
reset();
localStorage.setItem(A.ACCOUNTS_KEY, '{坏掉的 JSON');
ok('坏 JSON 不抛错且回落空库', A.list().length === 0);
localStorage.setItem(A.ACCOUNTS_KEY, JSON.stringify({ accounts: 'not-an-array' }));
ok('结构错误回落空库', A.list().length === 0);
reset();
A.bootstrap('刘珍', 'admin2026');
localStorage.setItem(A.ACCOUNTS_KEY, JSON.stringify({ accounts: [{ name: '刘珍', role: 'ADMIN', admin: true, pwd: A.makeCredential('admin2026') }, { name: '' }] }));
ok('空姓名账号被读时剔除', A.list().length === 1);
ok('数据版本号写入为 1', A.load().version === 1);
ok('规范化补全缺失字段', (() => { reset(); A.bootstrap('刘珍', 'admin2026'); const a = A.get('刘珍'); return a.active === true && !!a.createdAt; })());

console.log('\n----------------------------------------');
console.log('PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
