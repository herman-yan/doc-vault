/*
 * 账号与权限核心层（Auth Core）
 * 供 work-order / report-center 共用：人名登录、口令校验、岗位权限、管理员分派。
 *
 * 定位与边界（务必知晓）：
 *   本站是纯静态站点，没有服务端。因此本层的口令校验发生在浏览器里，
 *   其作用是「日常使用中的人为约束」——防止误操作、防止随手切换身份、
 *   让每个人的视图与留痕对应到真实的人；
 *   它**不是**防攻击的安全边界。懂技术的人查看网页源码仍可绕过。
 *   需要真正的安全边界时，必须把校验挪到服务端（见 recruit/ 的 node 样板）。
 *
 * 本文件是纯逻辑层：不碰 DOM、不读全局状态，便于离线单测。
 * 依赖：AFG（assets/aftersales-guardrails.js，提供岗位与页面定义、姓名归一化）
 */
(function (root) {
  'use strict';

  var AFG = root.AFG;

  // ===== 常量 =====
  var ACCOUNTS_KEY = 'nj_accounts';
  var SESSION_KEY = 'nj_session';
  var PEPPER = 'ningjia-workshop-2026';   // 固定调味值，抬高直接读哈希的成本
  var DB_VERSION = 1;

  // 可分配页面（与 work-order 导航 data-page 对齐；'report' 为报表中心）
  var PAGE_IDS = ['dashboard', 'report', 'warranty', 'nonwarranty', 'warehouse', 'engineers', 'export'];
  var PAGE_LABELS = {
    dashboard: '数据看板',
    report: '报表中心',
    warranty: '保内工单',
    nonwarranty: '保外工单',
    warehouse: '仓库登记',
    engineers: '工程师管理',
    export: '数据导出'
  };
  var PAGE_HINTS = {
    dashboard: '首页概览：待办、产值、回款、风险提示',
    report: '日报 / 周报 / 月报与流程时效、人效排名',
    warranty: '保内工单台账与流转',
    nonwarranty: '保外工单台账与流转',
    warehouse: '库房登记、旧件与采购关联',
    engineers: '工程师名单与工单分布',
    export: '台账导出为 Excel'
  };

  // 数据可见范围
  var SCOPE_IDS = ['role', 'all', 'own'];
  var SCOPE_LABELS = { role: '跟随岗位', all: '全部数据', own: '仅本人相关' };
  var SCOPE_HINTS = {
    role: '按该岗位的既定口径过滤（如技师只看自己的、财务只看已结算的）',
    all: '不受岗位限制，可看到全部工单',
    own: '只看与自己相关的工单（本人为责任工程师或报单员）'
  };

  // ===== 姓名归一（与 AFG 保持一致；AFG 缺席时退化为简单归一）=====
  function normName(v) {
    if (AFG && AFG.normName) return AFG.normName(v);
    if (v === null || v === undefined) return '';
    return String(v).replace(/[\s\u3000\u00a0\u200b-\u200d\ufeff]+/g, '')
      .replace(/[()（）·・.．、,，]/g, '').trim();
  }

  // ===== SHA-256（纯 JS，同步；避免依赖异步 crypto.subtle）=====
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function utf8Bytes(str) {
    var s = String(str), out = [], i, c;
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        var c2 = s.charCodeAt(i + 1);
        if (c2 >= 0xdc00 && c2 <= 0xdfff) {
          var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
          out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
          i++;
        } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  function sha256(msg) {
    var bytes = utf8Bytes(msg);
    var bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    // 64 位长度（高位恒为 0：消息远小于 2^32 位）
    bytes.push(0, 0, 0, 0);
    bytes.push((bitLen >>> 24) & 255, (bitLen >>> 16) & 255, (bitLen >>> 8) & 255, bitLen & 255);

    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var w = new Array(64);

    function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

    for (var off = 0; off < bytes.length; off += 64) {
      var i, t;
      for (i = 0; i < 16; i++) {
        w[i] = ((bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) |
                (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3]) >>> 0;
      }
      for (i = 16; i < 64; i++) {
        var s0 = (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
        var s1 = (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        var S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
        var ch = ((e & f) ^ (~e & g)) >>> 0;
        var t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
        var S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
        var maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        var t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e;
        e = (d + t1) >>> 0;
        d = c; c = b; b = a;
        a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0;
      H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0;
      H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    return H.map(function (x) { return ('00000000' + x.toString(16)).slice(-8); }).join('');
  }

  // ===== 口令 =====
  function makeSalt() {
    var out = '', i, r;
    var seed = '';
    try { seed = String(Date.now()) + Math.random() + (root.performance && root.performance.now ? root.performance.now() : ''); }
    catch (e) { seed = String(Date.now()) + Math.random(); }
    for (i = 0; i < 8; i++) {
      r = Math.floor(Math.random() * 0x100000000) >>> 0;
      out += ('00000000' + r.toString(16)).slice(-8);
    }
    return sha256(seed + out).slice(0, 32);
  }

  function hashPwd(pwd, salt) {
    return sha256(String(salt) + ':' + String(pwd) + ':' + PEPPER);
  }

  function makeCredential(pwd) {
    var salt = makeSalt();
    return { salt: salt, hash: hashPwd(pwd, salt) };
  }

  // ===== 存储 =====
  function store() { return root.localStorage; }

  function emptyDb() { return { version: DB_VERSION, accounts: [] }; }

  function load() {
    try {
      var raw = store().getItem(ACCOUNTS_KEY);
      if (!raw) return emptyDb();
      var db = JSON.parse(raw);
      if (!db || !Array.isArray(db.accounts)) return emptyDb();
      db.accounts = db.accounts.filter(function (a) { return a && normName(a.name); });
      db.version = DB_VERSION;
      return db;
    } catch (e) { return emptyDb(); }
  }

  function save(db) {
    var d = db && Array.isArray(db.accounts) ? db : emptyDb();
    try { store().setItem(ACCOUNTS_KEY, JSON.stringify({ version: DB_VERSION, accounts: d.accounts })); } catch (e) {}
    return d;
  }

  function list() { return load().accounts.slice(); }

  function get(name) {
    var k = normName(name);
    if (!k) return null;
    var arr = load().accounts;
    for (var i = 0; i < arr.length; i++) if (normName(arr[i].name) === k) return arr[i];
    return null;
  }

  function exists(name) { return !!get(name); }

  function indexOf(name) {
    var k = normName(name);
    var arr = load().accounts;
    for (var i = 0; i < arr.length; i++) if (normName(arr[i].name) === k) return i;
    return -1;
  }

  function nowIso() { try { return new Date().toISOString(); } catch (e) { return ''; } }

  function normalizeAccount(a) {
    var pages = (a && Array.isArray(a.pages)) ? a.pages.filter(function (p) { return PAGE_IDS.indexOf(p) >= 0; }) : null;
    if (pages && !pages.length) pages = null;   // 空数组等同「跟随岗位」，避免出现谁都进不去的账号
    var scope = (a && SCOPE_IDS.indexOf(a.scope) >= 0) ? a.scope : null;
    return {
      name: String(a.name).replace(/[\s\u3000\u00a0]+/g, ''),
      role: (a.role && (!AFG || !AFG.ROLES || AFG.ROLES[a.role])) ? a.role : 'REPORTER',
      pwd: (a.pwd && a.pwd.salt && a.pwd.hash) ? { salt: a.pwd.salt, hash: a.pwd.hash } : null,
      pages: pages,
      scope: scope,
      active: a.active === undefined ? true : !!a.active,
      admin: !!a.admin,
      createdAt: a.createdAt || nowIso(),
      updatedAt: nowIso()
    };
  }

  // 生效页面：个人微调优先，否则跟随岗位默认。
  // 注意：这是「展示口径」，停用账号也会返回其配置，便于管理员在面板里看清待恢复的权限。
  // 真正做门禁判断请用 canEnter（停用/不存在一律拒绝）。
  function effectivePages(name) {
    var a = (typeof name === 'object' && name) ? name : get(name);
    if (!a) return [];
    if (a.pages && a.pages.length) return a.pages.slice();
    if (AFG && AFG.ROLE_PAGES && AFG.ROLE_PAGES[a.role]) return AFG.ROLE_PAGES[a.role].slice();
    return PAGE_IDS.slice();
  }

  function effectiveScope(name) {
    var a = (typeof name === 'object' && name) ? name : get(name);
    if (!a) return 'role';
    return a.scope || 'role';
  }

  // 门禁判断：fail-closed。账号不存在或已停用 → 一律拒绝，
  // 避免「停用后仍能凭残留配置进入页面」这种权限外溢。
  function canEnter(name, page) {
    var a = (typeof name === 'object' && name) ? name : get(name);
    if (!a || !a.active) return false;
    if (page === 'report') {
      // 报表中心另有一道岗位门（canPage），两者取交集由页面自行处理
      return effectivePages(a).indexOf('report') >= 0;
    }
    return effectivePages(a).indexOf(page) >= 0;
  }

  function isAdmin(name) {
    var a = (typeof name === 'object' && name) ? name : get(name);
    return !!(a && a.admin && a.active);
  }

  function hasPassword(name) {
    var a = (typeof name === 'object' && name) ? name : get(name);
    return !!(a && a.pwd);
  }

  function activeAdmins() {
    return list().filter(function (a) { return a.admin && a.active; });
  }

  function withPwdAdmins() {
    return activeAdmins().filter(function (a) { return !!a.pwd; });
  }

  // ===== 口令校验 =====
  // 返回 { ok, reason }：reason ∈ '' | 'no-account' | 'inactive' | 'no-password' | 'bad-password'
  function verify(name, pwd) {
    var a = get(name);
    if (!a) return { ok: false, reason: 'no-account' };
    if (!a.active) return { ok: false, reason: 'inactive' };
    if (!a.pwd) return { ok: false, reason: 'no-password' };
    if (hashPwd(pwd, a.pwd.salt) !== a.pwd.hash) return { ok: false, reason: 'bad-password' };
    return { ok: true, reason: '' };
  }

  // ===== 管理员操作 =====
  // 不变量：任何会让「可用管理员」归零的操作一律拒绝
  function wouldDropLastAdmin(db, mutate) {
    var before = db.accounts.filter(function (a) { return a.admin && a.active && !!a.pwd; }).length;
    var copy = JSON.parse(JSON.stringify(db.accounts));
    mutate(copy);
    var after = copy.filter(function (a) { return a.admin && a.active && !!a.pwd; }).length;
    if (after < 1) return { ok: false, error: before === 0 ? '当前没有可用的管理员，请先设定管理员口令' : '这是最后一名可用管理员，不能停用或降权' };
    return { ok: true };
  }

  function add(name, role, opts) {
    opts = opts || {};
    var clean = String(name === undefined || name === null ? '' : name).replace(/[\s\u3000\u00a0]+/g, '');
    if (!clean) return { ok: false, error: '姓名不能为空' };
    if (AFG && AFG.isRealName && !AFG.isRealName(clean)) return { ok: false, error: '「' + clean + '」不像一个真实姓名，请检查' };
    if (exists(clean)) return { ok: false, error: '「' + clean + '」已存在账号' };
    var db = load();
    var acc = normalizeAccount({
      name: clean,
      role: role || 'REPORTER',
      pages: opts.pages || null,
      scope: opts.scope || null,
      active: opts.active === undefined ? true : opts.active,
      admin: !!opts.admin
    });
    if (opts.password) acc.pwd = makeCredential(opts.password);
    db.accounts.push(acc);
    // 新增管理员是「加强」不变量，无需校验
    save(db);
    return { ok: true, account: acc };
  }

  function update(name, patch) {
    var i = indexOf(name);
    if (i < 0) return { ok: false, error: '账号不存在' };
    patch = patch || {};
    var db = load();
    var guard = wouldDropLastAdmin(db, function (arr) {
      var t = normalizeAccount(Object.assign({}, arr[i], patch));
      arr[i] = t;
    });
    if (!guard.ok) return guard;
    db.accounts[i] = normalizeAccount(Object.assign({}, db.accounts[i], patch));
    save(db);
    return { ok: true, account: db.accounts[i] };
  }

  function remove(name) {
    var i = indexOf(name);
    if (i < 0) return { ok: false, error: '账号不存在' };
    var db = load();
    var guard = wouldDropLastAdmin(db, function (arr) { arr.splice(i, 1); });
    if (!guard.ok) return guard;
    db.accounts.splice(i, 1);
    save(db);
    return { ok: true };
  }

  // 设定 / 重置口令。改自己的口令需带 oldPwd 校验；管理员重置他人不需。
  function setPassword(name, newPwd, oldPwd) {
    var i = indexOf(name);
    if (i < 0) return { ok: false, error: '账号不存在' };
    var pwd = String(newPwd === undefined || newPwd === null ? '' : newPwd);
    if (pwd.length < 4) return { ok: false, error: '口令至少 4 位' };
    var db = load();
    if (oldPwd !== undefined && oldPwd !== null) {
      var a = db.accounts[i];
      if (!a.pwd) return { ok: false, error: '该账号尚未设置口令' };
      if (hashPwd(oldPwd, a.pwd.salt) !== a.pwd.hash) return { ok: false, error: '原口令不正确' };
    }
    db.accounts[i].pwd = makeCredential(pwd);
    db.accounts[i].updatedAt = nowIso();
    save(db);
    return { ok: true };
  }

  function clearPassword(name) {
    var i = indexOf(name);
    if (i < 0) return { ok: false, error: '账号不存在' };
    var db = load();
    var guard = wouldDropLastAdmin(db, function (arr) { arr[i].pwd = null; });
    if (!guard.ok) return guard;
    db.accounts[i].pwd = null;
    db.accounts[i].updatedAt = nowIso();
    save(db);
    return { ok: true };
  }

  // ===== 会话 =====
  var session = {
    get: function () {
      try {
        var raw = store().getItem(SESSION_KEY);
        if (!raw) return null;
        var s = JSON.parse(raw);
        if (!s || !normName(s.name)) return null;
        return { name: s.name, role: s.role, at: s.at || '' };
      } catch (e) { return null; }
    },
    set: function (name, role) {
      var s = { name: name, role: role, at: nowIso() };
      try { store().setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) {}
      return s;
    },
    clear: function () { try { store().removeItem(SESSION_KEY); } catch (e) {} }
  };

  // 校验会话是否仍然有效（账号被停用/删除后应立即失效）
  function sessionValid() {
    var s = session.get();
    if (!s) return null;
    var a = get(s.name);
    if (!a || !a.active) { session.clear(); return null; }
    return a;
  }

  // ===== 首次启用 =====
  function needsBootstrap() { return withPwdAdmins().length === 0; }

  function bootstrap(name, pwd) {
    if (!needsBootstrap()) return { ok: false, error: '系统已完成初始化' };
    var clean = String(name === undefined || name === null ? '' : name).replace(/[\s\u3000\u00a0]+/g, '');
    if (!clean) return { ok: false, error: '请选择或输入姓名' };
    if (String(pwd || '').length < 4) return { ok: false, error: '口令至少 4 位' };
    var a = get(clean);
    var db = load();
    if (a) {
      var i = indexOf(clean);
      db.accounts[i] = normalizeAccount(Object.assign({}, db.accounts[i], { admin: true, active: true }));
      db.accounts[i].pwd = makeCredential(pwd);
    } else {
      var acc = normalizeAccount({ name: clean, role: 'ADMIN', admin: true, active: true });
      acc.pwd = makeCredential(pwd);
      db.accounts.push(acc);
    }
    save(db);
    return { ok: true, account: get(clean) };
  }

  // 应急通道：忘记管理员口令时，凭站点口令重新指定一名管理员
  // 站点口令沿用首页门口令（SITE_PASS），仅用于自救，不用于日常登录
  var SITE_PASS = 'ningjia1';
  function emergencyReset(name, sitePwd, newPwd) {
    if (String(sitePwd || '') !== SITE_PASS) return { ok: false, error: '站点口令不正确' };
    if (String(newPwd || '').length < 4) return { ok: false, error: '新口令至少 4 位' };
    var clean = String(name === undefined || name === null ? '' : name).replace(/[\s\u3000\u00a0]+/g, '');
    if (!clean) return { ok: false, error: '请选择或输入姓名' };
    var db = load();
    var i = indexOf(clean);
    if (i >= 0) {
      db.accounts[i] = normalizeAccount(Object.assign({}, db.accounts[i], { admin: true, active: true }));
      db.accounts[i].pwd = makeCredential(newPwd);
    } else {
      var acc = normalizeAccount({ name: clean, role: 'ADMIN', admin: true, active: true });
      acc.pwd = makeCredential(newPwd);
      db.accounts.push(acc);
    }
    save(db);
    return { ok: true, account: get(clean) };
  }

  // ===== 名单候选（用于管理员新增账号时挑选）=====
  // 台账提取 ∪ 手动补充 − 手动隐藏，排除已有账号者
  function nameCandidates(groups) {
    var roster = [];
    try {
      if (AFG && AFG.nameRoster) roster = AFG.nameRoster(groups || []) || [];
    } catch (e) { roster = []; }
    var have = {};
    list().forEach(function (a) { have[normName(a.name)] = true; });
    return roster.filter(function (n) { return !have[normName(n)]; });
  }

  var AUTH = {
    VERSION: 'auth.v1',
    ACCOUNTS_KEY: ACCOUNTS_KEY,
    SESSION_KEY: SESSION_KEY,
    SITE_PASS: SITE_PASS,
    PAGE_IDS: PAGE_IDS, PAGE_LABELS: PAGE_LABELS, PAGE_HINTS: PAGE_HINTS,
    SCOPE_IDS: SCOPE_IDS, SCOPE_LABELS: SCOPE_LABELS, SCOPE_HINTS: SCOPE_HINTS,

    sha256: sha256,
    hashPwd: hashPwd,
    makeSalt: makeSalt,
    makeCredential: makeCredential,
    normName: normName,

    load: load, save: save, list: list, get: get, exists: exists, indexOf: indexOf,

    effectivePages: effectivePages,
    effectiveScope: effectiveScope,
    canEnter: canEnter,
    isAdmin: isAdmin,
    hasPassword: hasPassword,
    activeAdmins: activeAdmins,
    withPwdAdmins: withPwdAdmins,
    verify: verify,

    add: add,
    update: update,
    remove: remove,
    setPassword: setPassword,
    clearPassword: clearPassword,

    session: session,
    sessionValid: sessionValid,
    needsBootstrap: needsBootstrap,
    bootstrap: bootstrap,
    emergencyReset: emergencyReset,
    nameCandidates: nameCandidates
  };

  root.AUTH = AUTH;
  if (typeof module !== 'undefined' && module.exports) module.exports = AUTH;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
