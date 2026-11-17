/*
 * 登录门与权限管理界面（Auth Gate）
 * 供 work-order / report-center 共用。
 *
 * 三块界面：
 *   1) 登录门：选姓名 → 输口令 → 进入。未登录时业务内容整体不可见（fail-closed）。
 *   2) 首次启用：系统还没有可用管理员时，引导设定首位管理员。
 *   3) 权限管理：管理员可新增/停用/删除账号、指定岗位、逐页勾选可见范围、
 *      设定数据可见范围、设置/重置口令；普通同事可改自己的口令。
 *
 * 定位：本站是纯静态站点，本层是「日常使用中的人为约束」，不是防攻击的安全边界。
 * 依赖：AUTH（assets/auth-core.js）、AFG（assets/aftersales-guardrails.js）
 */
(function (root) {
  'use strict';

  var doc = root.document;
  var AUTH = root.AUTH;
  var AFG = root.AFG;

  // ---------- 转义 ----------
  function esc(v) {
    return String(v === undefined || v === null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // 用于 onclick="F('…')"：属性用双引号界定、JS 字符串用单引号。
  // 先做 HTML 转义（不碰单引号与反斜杠），再做 JS 字符串转义。
  function jsArg(v) {
    return String(v === undefined || v === null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      .replace(/\\/g, '\\\\').replace(/'/g, "\\'")
      .replace(/[\r\n\u2028\u2029]/g, ' ');
  }
  function roleLabel(r) {
    if (AFG && AFG.roleLabel) return AFG.roleLabel(r);
    return r || '未识别岗位';
  }
  function roleKeys() {
    return (AFG && AFG.ROLES) ? Object.keys(AFG.ROLES) : ['REPORTER'];
  }

  // ---------- 样式 ----------
  var CSS = [
    /* 锁定态：业务内容整体隐藏，只留登录门（fail-closed） */
    'body.nj-locked > *:not(.nj-gate) { display: none !important; }',

    '.nj-gate { position: fixed; inset: 0; z-index: 9000; display: none; align-items: flex-start; justify-content: center;',
      'padding: 40px 16px; overflow-y: auto; background: radial-gradient(1100px 560px at 50% -8%, #1B3E63 0%, #0E2A47 46%, #091B2E 100%); }',
    'body.nj-locked .nj-gate { display: flex; }',
    '.njg-card { width: 100%; max-width: 460px; background: #fff; border-radius: 18px; padding: 28px 28px 22px;',
      'box-shadow: 0 26px 64px rgba(0,0,0,.46); }',
    '.njg-mark { width: 50px; height: 50px; margin: 0 auto 14px; border-radius: 15px; display: flex; align-items: center;',
      'justify-content: center; font-size: 23px; background: linear-gradient(135deg, #1E4A7A, #0E2A47); }',
    '.njg-title { font-size: 17px; font-weight: 700; color: #1F2A3A; text-align: center; }',
    '.njg-sub { font-size: 12.5px; color: #6B7A90; text-align: center; margin: 7px 0 18px; line-height: 1.6; }',
    '.njg-label { font-size: 12px; font-weight: 600; color: #475569; margin: 0 0 7px; display: flex; align-items: center; gap: 6px; }',
    '.njg-label .njg-step { display: inline-flex; align-items: center; justify-content: center; width: 17px; height: 17px;',
      'border-radius: 50%; background: #2563EB; color: #fff; font-size: 10.5px; font-weight: 700; }',
    '.njg-search { width: 100%; font-size: 13.5px; padding: 9px 12px; border: 1px solid #DCE2EC; border-radius: 9px;',
      'color: #1F2A3A; background: #F8FAFD; outline: none; margin-bottom: 9px; box-sizing: border-box; }',
    '.njg-search:focus { border-color: #2563EB; box-shadow: 0 0 0 3px rgba(37,99,235,.12); background: #fff; }',
    '.njg-chips { display: flex; flex-wrap: wrap; gap: 7px; max-height: 168px; overflow-y: auto; padding: 2px; margin-bottom: 16px; }',
    '.njg-chip { font-size: 12.5px; padding: 7px 13px; border: 1px solid #CBD5E1; border-radius: 999px; cursor: pointer;',
      'color: #334155; background: #fff; transition: all .12s; user-select: none; }',
    '.njg-chip:hover { border-color: #2563EB; color: #2563EB; background: #EFF6FF; }',
    '.njg-chip.on { background: #2563EB; border-color: #2563EB; color: #fff; font-weight: 600; }',
    '.njg-empty { font-size: 12.5px; color: #94A3B8; padding: 12px 2px; line-height: 1.6; }',
    '.njg-input { width: 100%; padding: 11px 13px; font-size: 14.5px; color: #1F2A3A; background: #F8FAFD;',
      'border: 1px solid #DCE2EC; border-radius: 10px; outline: none; letter-spacing: 1px; box-sizing: border-box; }',
    '.njg-input:focus { border-color: #2563EB; box-shadow: 0 0 0 3px rgba(37,99,235,.13); background: #fff; }',
    '.njg-btn { width: 100%; margin-top: 12px; padding: 12px; border: 0; border-radius: 11px; cursor: pointer;',
      'background: linear-gradient(135deg, #1E4A7A, #0E2A47); color: #fff; font-size: 15px; font-weight: 600;',
      'letter-spacing: 1px; transition: filter .15s, transform .1s; }',
    '.njg-btn:hover { filter: brightness(1.14); }',
    '.njg-btn:active { transform: translateY(1px); }',
    '.njg-btn-ghost { background: #fff; color: #334155; border: 1px solid #CBD5E1; letter-spacing: 0; }',
    '.njg-btn-ghost:hover { background: #F1F5F9; filter: none; }',
    '.njg-err { min-height: 17px; margin-top: 9px; font-size: 12.5px; color: #DC2626; text-align: center; }',
    '.njg-ok { min-height: 17px; margin-top: 9px; font-size: 12.5px; color: #059669; text-align: center; }',
    '.njg-foot { margin-top: 16px; padding-top: 13px; border-top: 1px solid #EEF2F7; display: flex; align-items: center;',
      'justify-content: space-between; gap: 10px; flex-wrap: wrap; }',
    '.njg-link { background: none; border: none; color: #2563EB; font-size: 12px; cursor: pointer; padding: 2px 0; }',
    '.njg-link:hover { text-decoration: underline; }',
    '.njg-tip { font-size: 11.5px; color: #93A1B5; line-height: 1.6; }',
    '.njg-note { font-size: 11.5px; color: #64748B; background: #F8FAFC; border-left: 3px solid #CBD5E1;',
      'padding: 9px 12px; border-radius: 5px; line-height: 1.65; margin-bottom: 14px; }',
    '.njg-note b { color: #475569; }',

    /* 权限管理面板 */
    '.njp-ov { display: none; position: fixed; inset: 0; background: rgba(15,23,42,.6); z-index: 9100;',
      'align-items: flex-start; justify-content: center; padding: 34px 16px; overflow-y: auto; }',
    '.njp-ov.show { display: flex; }',
    '.njp { background: #fff; border-radius: 15px; width: 100%; max-width: 780px; box-shadow: 0 24px 64px rgba(0,0,0,.34); overflow: hidden; }',
    '.njp-head { display: flex; align-items: flex-start; justify-content: space-between; padding: 17px 22px 13px; border-bottom: 1px solid #E2E8F0; }',
    '.njp-title { font-size: 15.5px; font-weight: 700; color: #0F172A; }',
    '.njp-sub { font-size: 12px; color: #64748B; margin-top: 3px; }',
    '.njp-x { background: none; border: none; font-size: 22px; line-height: 1; cursor: pointer; color: #94A3B8; padding: 0 4px; }',
    '.njp-x:hover { color: #475569; }',
    '.njp-bar { display: flex; gap: 8px; align-items: center; padding: 12px 22px; border-bottom: 1px solid #EEF2F7; flex-wrap: wrap; background: #FBFCFE; }',
    '.njp-bar .njg-search { margin-bottom: 0; flex: 1; min-width: 150px; }',
    '.njp-add { font-size: 12.5px; padding: 8px 14px; border-radius: 9px; border: 0; cursor: pointer;',
      'background: #2563EB; color: #fff; font-weight: 600; white-space: nowrap; }',
    '.njp-add:hover { background: #1D4ED8; }',
    '.njp-body { padding: 14px 22px 20px; max-height: 62vh; overflow-y: auto; }',
    '.njp-row { display: flex; align-items: center; gap: 12px; padding: 11px 12px; border: 1px solid #E8EDF3;',
      'border-radius: 11px; margin-bottom: 8px; transition: border-color .12s, background .12s; }',
    '.njp-row:hover { border-color: #BFD4F5; background: #FAFCFF; }',
    '.njp-av { width: 34px; height: 34px; border-radius: 50%; background: linear-gradient(135deg,#2563EB,#60A5FA);',
      'color: #fff; display: flex; align-items: center; justify-content: center; font-size: 13.5px; font-weight: 700; flex: 0 0 auto; }',
    '.njp-av.off { background: linear-gradient(135deg,#94A3B8,#CBD5E1); }',
    '.njp-info { flex: 1; min-width: 0; }',
    '.njp-nm { font-size: 13.5px; font-weight: 600; color: #0F172A; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }',
    '.njp-mt { font-size: 11.5px; color: #64748B; margin-top: 2px; line-height: 1.5; }',
    '.njp-tag { font-size: 10px; font-weight: 600; padding: 1.5px 7px; border-radius: 999px; }',
    '.njp-tag.admin { background: #DBEAFE; color: #1D4ED8; }',
    '.njp-tag.off { background: #FEE2E2; color: #B91C1C; }',
    '.njp-tag.nopwd { background: #FEF3C7; color: #92400E; }',
    '.njp-tag.ro { background: #F1F5F9; color: #475569; }',
    '.njp-tag.cus { background: #EDE9FE; color: #6D28D9; }',
    '.njp-act { display: flex; gap: 6px; flex: 0 0 auto; }',
    '.njp-mini { font-size: 11.5px; padding: 6px 11px; border-radius: 8px; border: 1px solid #CBD5E1; background: #fff;',
      'color: #334155; cursor: pointer; white-space: nowrap; }',
    '.njp-mini:hover { background: #F1F5F9; border-color: #94A3B8; }',
    '.njp-mini.p { background: #2563EB; border-color: #2563EB; color: #fff; font-weight: 600; }',
    '.njp-mini.p:hover { background: #1D4ED8; }',
    '.njp-mini.d { color: #B91C1C; border-color: #FCA5A5; }',
    '.njp-mini.d:hover { background: #FEF2F2; }',
    '.njp-sec { margin-bottom: 17px; }',
    '.njp-sec-h { font-size: 12.5px; font-weight: 700; color: #334155; margin-bottom: 8px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }',
    '.njp-sec-h .njg-tip { font-weight: 400; }',
    '.njp-pages { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 7px; }',
    '@media (max-width: 620px) { .njp-pages { grid-template-columns: 1fr; } }',
    '.njp-pg { display: flex; align-items: flex-start; gap: 9px; border: 1px solid #DCE2EC; border-radius: 9px; padding: 9px 11px; cursor: pointer; background: #fff; }',
    '.njp-pg:hover { border-color: #93B4E8; background: #FAFCFF; }',
    '.njp-pg.on { border-color: #2563EB; background: #EFF6FF; }',
    '.njp-pg.dis { opacity: .55; cursor: default; }',
    '.njp-pg input { margin: 2px 0 0; flex: 0 0 auto; }',
    '.njp-pg .pt { font-size: 12.5px; font-weight: 600; color: #0F172A; display: block; }',
    '.njp-pg .pd { font-size: 11px; color: #64748B; line-height: 1.5; margin-top: 2px; display: block; }',
    '.njp-scopes { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 7px; }',
    '@media (max-width: 620px) { .njp-scopes { grid-template-columns: 1fr; } }',
    '.njp-sc { border: 1px solid #DCE2EC; border-radius: 9px; padding: 9px 11px; cursor: pointer; background: #fff; }',
    '.njp-sc:hover { border-color: #93B4E8; background: #FAFCFF; }',
    '.njp-sc.on { border-color: #2563EB; background: #EFF6FF; }',
    '.njp-sc .st { font-size: 12.5px; font-weight: 600; color: #0F172A; }',
    '.njp-sc .sd { font-size: 11px; color: #64748B; line-height: 1.5; margin-top: 3px; }',
    '.njp-field { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }',
    '.njp-field .njg-input { flex: 1; min-width: 130px; letter-spacing: 0; }',
    '.njp-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 13px 22px;',
      'border-top: 1px solid #E2E8F0; background: #F8FAFC; flex-wrap: wrap; }',
    '.njp-acts { display: flex; gap: 8px; }',
    '.njp-btn { font-size: 13px; padding: 8px 17px; border-radius: 9px; border: 1px solid #CBD5E1; background: #fff; color: #334155; cursor: pointer; }',
    '.njp-btn:hover { background: #F1F5F9; }',
    '.njp-btn-p { background: #2563EB; border-color: #2563EB; color: #fff; font-weight: 600; }',
    '.njp-btn-p:hover { background: #1D4ED8; }',
    '.njp-sw { display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: #334155; cursor: pointer; user-select: none; }',
    '.njp-sw input { cursor: pointer; }',
    '.njp-warn { font-size: 11.5px; color: #B45309; background: #FFFBEB; border-left: 3px solid #FCD34D;',
      'padding: 8px 11px; border-radius: 5px; line-height: 1.6; margin-bottom: 13px; }'
  ].join('\n');

  var styled = false;
  function injectStyle() {
    if (styled || !doc || !doc.head) return;
    var s = doc.createElement('style');
    s.textContent = CSS;
    if (doc.head.appendChild) doc.head.appendChild(s);
    styled = true;
  }

  // ---------- 状态 ----------
  var opts = {
    pageName: '',
    getNames: function () { return []; },
    onEnter: function () {},
    onLeave: function () {}
  };

  var mode = 'login';                                  // 'login' | 'bootstrap'
  var login = { q: '', picked: '', err: '' };
  var boot = { q: '', picked: '', err: '' };
  var rescue = { open: false, name: '', err: '', ok: '' };

  var panel = {
    open: false,
    kind: 'manage',     // 'manage'（管理员）| 'self'（改自己的口令）
    view: 'list',       // 'list' | 'edit' | 'add'
    q: '',
    target: '',
    draft: null,
    add: { name: '', role: 'REPORTER', err: '' },
    self: { old: '', err: '', ok: '' },
    msg: '', msgType: ''
  };

  var cur = null;

  // ---------- 容器 ----------
  function ensureEl(id, cls) {
    var el = doc && doc.getElementById ? doc.getElementById(id) : null;
    if (el) { if (cls && el.className !== cls) el.className = cls; return el; }
    if (!doc || !doc.createElement) return null;
    el = doc.createElement('div');
    el.id = id;
    el.className = cls;
    var host = doc.body || doc.documentElement;
    if (host && host.appendChild) host.appendChild(el);
    return el;
  }
  function gateEl() { return ensureEl('njGate', 'nj-gate'); }
  function panelEl() {
    var el = ensureEl('njPanel', 'njp-ov');
    if (el && !el._njBound && el.addEventListener) {
      el.addEventListener('click', function (e) { if (e.target === el) closePanel(); });
      el._njBound = true;
    }
    return el;
  }

  // ---------- 共用片段 ----------
  function chipList(pool, picked, q, fnName) {
    var list = pool.filter(function (n) { return !q || n.indexOf(q) >= 0; });
    if (!list.length) {
      return '<div class="njg-empty">' +
        (pool.length ? '没有匹配「' + esc(q) + '」的姓名' : '暂无可登录账号，请联系管理员开通') +
        '</div>';
    }
    return list.map(function (n) {
      return '<span class="njg-chip' + (n === picked ? ' on' : '') + '" onclick="NJ_GATE.' + fnName + '(\'' + jsArg(n) + '\')">' + esc(n) + '</span>';
    }).join('');
  }

  // 可登录者：启用中 且 已设口令
  function loginPool() {
    return AUTH.list().filter(function (a) { return a.active && !!a.pwd; })
      .map(function (a) { return a.name; })
      .sort(function (a, b) { return a.localeCompare(b, 'zh-Hans-CN'); });
  }

  function gateHtml() {
    return mode === 'bootstrap' ? bootstrapHtml() : loginHtml();
  }

  function loginHtml() {
    var pool = loginPool();
    var body = '' +
      '<div class="njg-mark">🔒</div>' +
      '<div class="njg-title">' + esc(opts.pageName || '宁家服务数字化运营系统') + '</div>' +
      '<div class="njg-sub">请选择你的姓名，并输入本人登录口令</div>' +
      '<div class="njg-label"><span class="njg-step">1</span>选择姓名</div>' +
      (pool.length > 8 ? '<input class="njg-search" id="njgLoginQ" placeholder="🔍 输入姓名快速筛选…" value="' + esc(login.q) + '" oninput="NJ_GATE.filterLogin(this.value)">' : '') +
      '<div class="njg-chips">' + chipList(pool, login.picked, login.q, 'pickLogin') + '</div>' +
      '<div class="njg-label"><span class="njg-step">2</span>输入口令</div>' +
      '<input class="njg-input" id="njgLoginPwd" type="password" placeholder="登录口令" autocomplete="current-password" aria-label="登录口令"' +
        ' onkeydown="if(event.key===\'Enter\'){NJ_GATE.submitLogin();}">' +
      '<button class="njg-btn" type="button" onclick="NJ_GATE.submitLogin()">进 入 系 统</button>' +
      '<div class="njg-err">' + esc(login.err) + '</div>' +
      (rescue.open ? rescueHtml() : '') +
      '<div class="njg-foot">' +
        '<button class="njg-link" type="button" onclick="NJ_GATE.toggleRescue()">忘记口令？</button>' +
        '<span class="njg-tip">' + (pool.length ? '共 ' + pool.length + ' 个可登录账号' : '') + '</span>' +
      '</div>';
    return '<div class="njg-card">' + body + '</div>';
  }

  function rescueHtml() {
    return '<div class="njg-note" style="margin-top:16px">' +
      '<b>应急重置</b>：忘记口令时，可凭站点口令把某个账号重置为管理员。<br>' +
      '<input class="njg-input" id="njgResName" placeholder="你的姓名" value="' + esc(rescue.name) + '" style="margin-top:9px">' +
      '<input class="njg-input" id="njgResSite" type="password" placeholder="站点口令" style="margin-top:7px">' +
      '<input class="njg-input" id="njgResPwd" type="password" placeholder="设置新的登录口令" style="margin-top:7px"' +
        ' onkeydown="if(event.key===\'Enter\'){NJ_GATE.doRescue();}">' +
      '<button class="njg-btn njg-btn-ghost" type="button" style="margin-top:9px" onclick="NJ_GATE.doRescue()">重 置</button>' +
      (rescue.err ? '<div class="njg-err">' + esc(rescue.err) + '</div>' : '') +
      (rescue.ok ? '<div class="njg-ok">' + esc(rescue.ok) + '</div>' : '') +
      '</div>';
  }

  function bootstrapHtml() {
    var pool = (opts.getNames() || []).slice();
    var body = '' +
      '<div class="njg-mark">🛠️</div>' +
      '<div class="njg-title">首次启用 · 设定管理员</div>' +
      '<div class="njg-sub">系统还没有可用的管理员账号<br>请先设定一名管理员，之后由他/她为同事分配权限</div>' +
      '<div class="njg-label"><span class="njg-step">1</span>选择你的姓名</div>' +
      (pool.length > 8 ? '<input class="njg-search" id="njgBootQ" placeholder="🔍 输入姓名快速筛选…" value="' + esc(boot.q) + '" oninput="NJ_GATE.filterBoot(this.value)">' : '') +
      '<div class="njg-chips">' + chipList(pool, boot.picked, boot.q, 'pickBoot') + '</div>' +
      '<div class="njg-label"><span class="njg-step">2</span>设定登录口令</div>' +
      '<input class="njg-input" id="njgBootPwd" type="password" placeholder="登录口令（至少 4 位）">' +
      '<input class="njg-input" id="njgBootPwd2" type="password" placeholder="再输入一次确认" style="margin-top:8px"' +
        ' onkeydown="if(event.key===\'Enter\'){NJ_GATE.doBootstrap();}">' +
      '<button class="njg-btn" type="button" onclick="NJ_GATE.doBootstrap()">启 用 系 统</button>' +
      '<div class="njg-err">' + esc(boot.err) + '</div>' +
      '<div class="njg-foot"><span class="njg-tip">口令仅保存在本机浏览器，不会上传</span></div>';
    return '<div class="njg-card">' + body + '</div>';
  }

  function renderGate() {
    injectStyle();
    var el = gateEl();
    if (!el) return;
    el.innerHTML = gateHtml();
    try {
      if (mode === 'bootstrap') {
        var bq = doc.getElementById('njgBootQ');
        var bp = doc.getElementById('njgBootPwd');
        if (boot.picked && bp && bp.focus) bp.focus();
        else if (bq && bq.focus) bq.focus();
      } else {
        var q = doc.getElementById('njgLoginQ');
        var p = doc.getElementById('njgLoginPwd');
        if (login.picked && p && p.focus) p.focus();
        else if (q && q.focus) q.focus();
      }
    } catch (e) {}
  }

  function lock() {
    injectStyle();
    if (doc && doc.body && doc.body.classList) doc.body.classList.add('nj-locked');
    renderGate();
  }
  function unlock() {
    if (doc && doc.body && doc.body.classList) doc.body.classList.remove('nj-locked');
  }

  // ---------- 登录 ----------
  function reasonMsg(reason) {
    if (reason === 'no-account') return '账号不存在，请联系管理员开通';
    if (reason === 'inactive') return '该账号已停用，请联系管理员';
    if (reason === 'no-password') return '该账号尚未设置口令，请联系管理员';
    return '口令不正确，请重新输入';
  }

  function submitLogin() {
    if (!login.picked) { login.err = '请先选择你的姓名'; renderGate(); return; }
    var inp = doc.getElementById('njgLoginPwd');
    var pwd = inp ? String(inp.value || '') : '';
    if (!pwd) { login.err = '请输入登录口令'; renderGate(); return; }
    var r = AUTH.verify(login.picked, pwd);
    if (!r.ok) { login.err = reasonMsg(r.reason); renderGate(); return; }
    login.err = '';
    enter(login.picked);
  }

  function enter(name) {
    var acc = AUTH.get(name);
    if (!acc) { login.err = '账号不存在'; renderGate(); return; }
    cur = acc;
    AUTH.session.set(acc.name, acc.role);
    unlock();
    try { opts.onEnter(acc); } catch (e) { if (root.console) console.error(e); }
  }

  function doBootstrap() {
    var p1 = doc.getElementById('njgBootPwd');
    var p2 = doc.getElementById('njgBootPwd2');
    var v1 = p1 ? String(p1.value || '') : '';
    var v2 = p2 ? String(p2.value || '') : '';
    if (!boot.picked) { boot.err = '请先选择你的姓名'; renderGate(); return; }
    if (v1.length < 4) { boot.err = '口令至少 4 位'; renderGate(); return; }
    if (v1 !== v2) { boot.err = '两次输入的口令不一致'; renderGate(); return; }
    var r = AUTH.bootstrap(boot.picked, v1);
    if (!r.ok) { boot.err = r.error; renderGate(); return; }
    boot.err = '';
    enter(boot.picked);
  }

  function doRescue() {
    var n = doc.getElementById('njgResName');
    var s = doc.getElementById('njgResSite');
    var p = doc.getElementById('njgResPwd');
    rescue.name = n ? String(n.value || '').trim() : '';
    var r = AUTH.emergencyReset(rescue.name,
      s ? String(s.value || '') : '',
      p ? String(p.value || '') : '');
    if (!r.ok) { rescue.err = r.error; rescue.ok = ''; }
    else {
      rescue.err = '';
      rescue.ok = '已把「' + rescue.name + '」重置为管理员，请用新口令登录';
      mode = 'login';
      login.picked = rescue.name;
    }
    renderGate();
  }

  // ---------- 面板 ----------
  function openPanel() {
    if (!cur) return;
    panel.open = true;
    panel.kind = cur.admin ? 'manage' : 'self';
    panel.view = panel.kind === 'manage' ? 'list' : 'self';
    panel.q = '';
    panel.msg = ''; panel.msgType = '';
    panel.self = { old: '', err: '', ok: '' };
    if (panel.kind === 'self') panel.target = cur.name;
    renderPanel();
    var el = panelEl();
    if (el && el.classList) el.classList.add('show');
  }
  function closePanel() {
    panel.open = false;
    var el = panelEl();
    if (el && el.classList) el.classList.remove('show');
  }
  function openChangePwd() {
    if (!cur) return;
    panel.open = true;
    panel.kind = 'self';
    panel.view = 'self';
    panel.target = cur.name;
    panel.self = { old: '', err: '', ok: '' };
    renderPanel();
    var el = panelEl();
    if (el && el.classList) el.classList.add('show');
  }

  function draftOf(a) {
    return {
      role: a.role,
      pages: (a.pages && a.pages.length) ? a.pages.slice() : [],
      scope: AUTH.effectiveScope(a),
      admin: !!a.admin,
      active: !!a.active
    };
  }

  function badgeOf(a) {
    var t = [];
    if (a.admin) t.push('<span class="njp-tag admin">管理员</span>');
    if (AFG && AFG.isReadonly && AFG.isReadonly(a.role)) t.push('<span class="njp-tag ro">只读</span>');
    if (a.pages && a.pages.length) t.push('<span class="njp-tag cus">自定义页面</span>');
    if (!a.pwd) t.push('<span class="njp-tag nopwd">未设口令</span>');
    if (!a.active) t.push('<span class="njp-tag off">已停用</span>');
    return t.join('');
  }

  function listHtml() {
    var all = AUTH.list().sort(function (x, y) {
      if (!!y.admin !== !!x.admin) return y.admin ? 1 : -1;
      if (!!y.active !== !!x.active) return y.active ? 1 : -1;
      return x.name.localeCompare(y.name, 'zh-Hans-CN');
    });
    var q = panel.q.trim();
    var shown = all.filter(function (a) { return !q || a.name.indexOf(q) >= 0; });

    var html = '<div class="njp-bar">' +
      '<input class="njg-search" placeholder="🔍 搜索姓名…" value="' + esc(panel.q) + '" oninput="NJ_GATE.pFilter(this.value)">' +
      '<button class="njp-add" type="button" onclick="NJ_GATE.pAddView()">+ 新增账号</button>' +
      '</div><div class="njp-body">' +
      (panel.msg ? '<div class="njg-' + (panel.msgType === 'err' ? 'err' : 'ok') + '" style="text-align:left;margin-bottom:12px">' + esc(panel.msg) + '</div>' : '') +
      '<div class="njg-tip" style="margin-bottom:10px">共 ' + all.length + ' 个账号' +
        (q ? '，匹配 ' + shown.length + ' 个' : '') + '。账号与口令仅保存在本机浏览器。</div>';

    if (!shown.length) {
      html += '<div class="njg-empty">' + (all.length ? '没有匹配的账号' : '还没有账号，点右上角新增') + '</div>';
    } else {
      shown.forEach(function (a) {
        var nm = jsArg(a.name);
        html += '<div class="njp-row">' +
          '<div class="njp-av' + (a.active ? '' : ' off') + '">' + esc(a.name.slice(0, 1)) + '</div>' +
          '<div class="njp-info">' +
            '<div class="njp-nm">' + esc(a.name) + badgeOf(a) + '</div>' +
            '<div class="njp-mt">' + esc(roleLabel(a.role)) + ' · 可见 ' + AUTH.effectivePages(a).length + ' 个页面 · ' +
              esc(AUTH.SCOPE_LABELS[AUTH.effectiveScope(a)] || '') + '</div>' +
          '</div>' +
          '<div class="njp-act">' +
            '<button class="njp-mini" type="button" onclick="NJ_GATE.pEdit(\'' + nm + '\')">编辑权限</button>' +
            '<button class="njp-mini' + (a.active ? ' d' : ' p') + '" type="button" onclick="NJ_GATE.pToggleActive(\'' + nm + '\')">' +
              (a.active ? '停用' : '启用') + '</button>' +
          '</div></div>';
      });
    }
    html += '</div><div class="njp-foot">' +
      '<span class="njg-tip">管理员可指定岗位、逐页勾选可见范围、设定数据范围与口令</span>' +
      '<div class="njp-acts"><button class="njp-btn" type="button" onclick="NJ_GATE.closePanel()">关闭</button></div>' +
      '</div>';
    return html;
  }

  function editHtml() {
    var a = AUTH.get(panel.target);
    if (!a) {
      return '<div class="njp-body"><div class="njg-empty">账号已不存在</div></div>' +
        '<div class="njp-foot"><div class="njp-acts"><button class="njp-btn" type="button" onclick="NJ_GATE.pBack()">返回列表</button></div></div>';
    }
    var d = panel.draft;
    var followRole = !(d.pages && d.pages.length);
    var eff = followRole ? AUTH.effectivePages({ name: a.name, role: d.role }) : d.pages;

    var roleOpts = roleKeys().map(function (r) {
      var def = (AFG && AFG.ROLES && AFG.ROLES[r]) || {};
      return '<option value="' + esc(r) + '"' + (r === d.role ? ' selected' : '') + '>' + esc(def.label || r) + '</option>';
    }).join('');

    var pagesHtml = AUTH.PAGE_IDS.map(function (p) {
      var on = eff.indexOf(p) >= 0;
      return '<label class="njp-pg' + (on ? ' on' : '') + (followRole ? ' dis' : '') + '"' +
        ' onclick="NJ_GATE.pClickPage(event,\'' + esc(p) + '\')">' +
        '<input type="checkbox"' + (on ? ' checked' : '') + (followRole ? ' disabled' : '') + ' tabindex="-1">' +
        '<span><span class="pt">' + esc(AUTH.PAGE_LABELS[p]) + '</span>' +
        '<span class="pd">' + esc(AUTH.PAGE_HINTS[p] || '') + '</span></span>' +
        '</label>';
    }).join('');

    var scopesHtml = AUTH.SCOPE_IDS.map(function (s) {
      return '<div class="njp-sc' + (s === d.scope ? ' on' : '') + '" onclick="NJ_GATE.pScope(\'' + esc(s) + '\')">' +
        '<div class="st">' + (s === d.scope ? '● ' : '○ ') + esc(AUTH.SCOPE_LABELS[s]) + '</div>' +
        '<div class="sd">' + esc(AUTH.SCOPE_HINTS[s]) + '</div></div>';
    }).join('');

    var isSelf = cur && AUTH.normName(cur.name) === AUTH.normName(a.name);

    return '<div class="njp-body">' +
      (panel.msg ? '<div class="njg-' + (panel.msgType === 'err' ? 'err' : 'ok') + '" style="text-align:left;margin-bottom:12px">' + esc(panel.msg) + '</div>' : '') +
      '<div class="njp-sec">' +
        '<div class="njp-sec-h">岗位<span class="njg-tip">决定默认可见页面与数据口径</span></div>' +
        '<div class="njp-field">' +
          '<select class="njg-input" style="letter-spacing:0" onchange="NJ_GATE.pRole(this.value)">' + roleOpts + '</select>' +
          '<label class="njp-sw"><input type="checkbox"' + (d.admin ? ' checked' : '') + ' onchange="NJ_GATE.pAdmin(this.checked)"> 管理员</label>' +
          '<label class="njp-sw"><input type="checkbox"' + (d.active ? ' checked' : '') + ' onchange="NJ_GATE.pActive(this.checked)"> 启用</label>' +
        '</div>' +
      '</div>' +
      '<div class="njp-sec">' +
        '<div class="njp-sec-h">可见页面' +
          '<label class="njp-sw" style="margin-left:auto"><input type="checkbox"' + (followRole ? ' checked' : '') + ' onchange="NJ_GATE.pFollowRole(this.checked)"> 跟随岗位</label>' +
        '</div>' +
        (followRole ? '<div class="njg-tip" style="margin-bottom:8px">当前跟随「' + esc(roleLabel(d.role)) + '」的默认页面。取消勾选后可逐页自定义。</div>' : '') +
        '<div class="njp-pages">' + pagesHtml + '</div>' +
      '</div>' +
      '<div class="njp-sec">' +
        '<div class="njp-sec-h">数据可见范围</div>' +
        '<div class="njp-scopes">' + scopesHtml + '</div>' +
      '</div>' +
      '<div class="njp-sec">' +
        '<div class="njp-sec-h">登录口令<span class="njg-tip">' + (a.pwd ? '已设置' : '未设置，该账号当前无法登录') + '</span></div>' +
        '<div class="njp-field">' +
          '<input class="njg-input" id="njpNewPwd" type="password" placeholder="输入新口令（至少 4 位）">' +
          '<button class="njp-mini p" type="button" onclick="NJ_GATE.pSetPwd()">设置口令</button>' +
          (a.pwd ? '<button class="njp-mini" type="button" onclick="NJ_GATE.pClearPwd()">清除口令</button>' : '') +
        '</div>' +
      '</div>' +
      (isSelf
        ? '<div class="njp-warn">这是你自己的账号。若把自己降权或停用，将立即失去管理入口，请谨慎操作。</div>'
        : '<div class="njp-sec"><div class="njp-warn">删除账号会同时移除其口令与权限设置，且不可恢复。若该同事只是暂时离岗，建议用「停用」。</div>' +
          '<button class="njp-mini d" type="button" onclick="NJ_GATE.pRemove()">删除此账号</button></div>') +
      '</div>' +
      '<div class="njp-foot">' +
        '<span class="njg-tip">正在编辑：<b>' + esc(a.name) + '</b></span>' +
        '<div class="njp-acts">' +
          '<button class="njp-btn" type="button" onclick="NJ_GATE.pBack()">返回列表</button>' +
          '<button class="njp-btn njp-btn-p" type="button" onclick="NJ_GATE.pSave()">保存</button>' +
        '</div>' +
      '</div>';
  }

  function addHtml() {
    var have = {};
    AUTH.list().forEach(function (a) { have[a.name] = true; });
    var cand = (opts.getNames() || []).filter(function (n) { return !have[n]; });
    var d = panel.add;
    var roleOpts = roleKeys().map(function (r) {
      var def = (AFG && AFG.ROLES && AFG.ROLES[r]) || {};
      return '<option value="' + esc(r) + '"' + (r === d.role ? ' selected' : '') + '>' + esc(def.label || r) + '</option>';
    }).join('');
    return '<div class="njp-body">' +
      (d.err ? '<div class="njg-err" style="text-align:left;margin-bottom:12px">' + esc(d.err) + '</div>' : '') +
      '<div class="njp-sec">' +
        '<div class="njp-sec-h">姓名</div>' +
        (cand.length
          ? '<div class="njg-chips" style="max-height:110px;margin-bottom:9px">' + cand.map(function (n) {
              return '<span class="njg-chip' + (n === d.name ? ' on' : '') + '" onclick="NJ_GATE.aPick(\'' + jsArg(n) + '\')">' + esc(n) + '</span>';
            }).join('') + '</div>'
          : '<div class="njg-tip" style="margin-bottom:9px">台账名单里的人都已建账号，可直接手动输入新同事姓名。</div>') +
        '<input class="njg-input" id="njpAddName" placeholder="或手动输入姓名" value="' + esc(d.name) + '">' +
      '</div>' +
      '<div class="njp-sec">' +
        '<div class="njp-sec-h">岗位<span class="njg-tip">决定默认可见页面与数据口径</span></div>' +
        '<select class="njg-input" style="letter-spacing:0" onchange="NJ_GATE.aRole(this.value)">' + roleOpts + '</select>' +
      '</div>' +
      '<div class="njp-sec">' +
        '<div class="njp-sec-h">初始口令<span class="njg-tip">留空则暂不能登录，之后可再设置</span></div>' +
        '<input class="njg-input" id="njpAddPwd" type="password" placeholder="初始登录口令（至少 4 位）">' +
      '</div>' +
      '</div>' +
      '<div class="njp-foot">' +
        '<span class="njg-tip">新账号默认启用，页面权限跟随岗位</span>' +
        '<div class="njp-acts">' +
          '<button class="njp-btn" type="button" onclick="NJ_GATE.pBack()">返回列表</button>' +
          '<button class="njp-btn njp-btn-p" type="button" onclick="NJ_GATE.aSave()">创建账号</button>' +
        '</div>' +
      '</div>';
  }

  // 自助改口令：只显示口令，不暴露任何权限项
  function selfHtml() {
    var a = AUTH.get(cur ? cur.name : '');
    var s = panel.self;
    return '<div class="njp-body">' +
      '<div class="njg-tip" style="margin-bottom:12px">当前账号：<b>' + esc(a ? a.name : '') + '</b> · ' + esc(a ? roleLabel(a.role) : '') + '</div>' +
      '<div class="njp-sec">' +
        '<div class="njp-sec-h">修改我的登录口令</div>' +
        '<input class="njg-input" id="njpSelfOld" type="password" placeholder="当前口令">' +
        '<input class="njg-input" id="njpSelfNew" type="password" placeholder="新口令（至少 4 位）" style="margin-top:8px">' +
        '<input class="njg-input" id="njpSelfNew2" type="password" placeholder="再输入一次新口令" style="margin-top:8px"' +
          ' onkeydown="if(event.key===\'Enter\'){NJ_GATE.selfSave();}">' +
        '<button class="njp-btn njp-btn-p" type="button" style="margin-top:12px" onclick="NJ_GATE.selfSave()">确认修改</button>' +
        (s.err ? '<div class="njg-err" style="text-align:left">' + esc(s.err) + '</div>' : '') +
        (s.ok ? '<div class="njg-ok" style="text-align:left">' + esc(s.ok) + '</div>' : '') +
      '</div>' +
      '</div>' +
      '<div class="njp-foot">' +
        '<span class="njg-tip">口令仅保存在本机浏览器</span>' +
        '<div class="njp-acts"><button class="njp-btn" type="button" onclick="NJ_GATE.closePanel()">关闭</button></div>' +
      '</div>';
  }

  function renderPanel() {
    injectStyle();
    var el = panelEl();
    if (!el) return;
    var isSelf = panel.kind === 'self' || panel.view === 'self';
    var body;
    if (isSelf) body = selfHtml();
    else if (panel.view === 'edit') body = editHtml();
    else if (panel.view === 'add') body = addHtml();
    else body = listHtml();

    var title = isSelf ? '我的账号' : '权限管理';
    var sub = isSelf
      ? (opts.pageName || '')
      : (opts.pageName || '') + ' · 当前管理员：' + (cur ? cur.name : '');
    var xfn = isSelf ? 'closePanel' : (panel.view === 'list' ? 'closePanel' : 'pBack');

    el.className = 'njp-ov' + (panel.open ? ' show' : '');
    el.innerHTML = '<div class="njp">' +
      '<div class="njp-head">' +
        '<div><div class="njp-title">' + esc(title) + '</div><div class="njp-sub">' + esc(sub) + '</div></div>' +
        '<button class="njp-x" type="button" onclick="NJ_GATE.' + xfn + '()" aria-label="关闭">×</button>' +
      '</div>' + body + '</div>';
  }

  // ---------- 对外 API ----------
  var GATE = {
    init: function (options) {
      options = options || {};
      if (options.pageName) opts.pageName = options.pageName;
      if (options.getNames) opts.getNames = options.getNames;
      if (options.onEnter) opts.onEnter = options.onEnter;
      if (options.onLeave) opts.onLeave = options.onLeave;
      return GATE;
    },

    // 启动：需要初始化则进首次启用；已登录直接放行；否则进登录门
    start: function () {
      injectStyle();
      if (AUTH.needsBootstrap()) { mode = 'bootstrap'; boot.picked = ''; boot.err = ''; lock(); return GATE; }
      var acc = AUTH.sessionValid();
      if (acc) { enter(acc.name); return GATE; }
      mode = 'login';
      login.picked = '';
      login.err = '';
      lock();
      return GATE;
    },

    current: function () { return cur ? { name: cur.name, role: cur.role, admin: !!cur.admin } : null; },
    isAdmin: function () { return !!(cur && cur.admin); },
    mode: function () { return mode; },
    lock: lock,
    unlock: unlock,
    isLocked: function () { return !!(doc && doc.body && doc.body.classList && doc.body.classList.contains('nj-locked')); },

    // 登录门交互
    filterLogin: function (q) { login.q = String(q || ''); renderGate(); },
    pickLogin: function (n) { login.picked = n; login.err = ''; renderGate(); },
    submitLogin: submitLogin,
    toggleRescue: function () { rescue.open = !rescue.open; rescue.err = ''; rescue.ok = ''; renderGate(); },
    doRescue: doRescue,
    filterBoot: function (q) { boot.q = String(q || ''); renderGate(); },
    pickBoot: function (n) { boot.picked = n; boot.err = ''; renderGate(); },
    doBootstrap: doBootstrap,

    // 退出
    logout: function () {
      AUTH.session.clear();
      cur = null;
      closePanel();
      login.picked = '';
      login.err = '';
      rescue.open = false; rescue.ok = ''; rescue.err = '';
      mode = AUTH.needsBootstrap() ? 'bootstrap' : 'login';
      lock();
      try { opts.onLeave(); } catch (e) {}
    },

    // 面板入口
    openPanel: openPanel,
    openChangePwd: openChangePwd,
    closePanel: closePanel,
    pFilter: function (q) { panel.q = String(q || ''); renderPanel(); },
    pAddView: function () { panel.view = 'add'; panel.add = { name: '', role: 'REPORTER', err: '' }; panel.msg = ''; renderPanel(); },
    pBack: function () { panel.view = 'list'; panel.msg = ''; renderPanel(); },
    pEdit: function (name) {
      var a = AUTH.get(name);
      if (!a) return;
      panel.view = 'edit';
      panel.target = a.name;
      panel.draft = draftOf(a);
      panel.msg = ''; panel.msgType = '';
      renderPanel();
    },
    pRole: function (r) { if (panel.draft) { panel.draft.role = r; renderPanel(); } },
    pAdmin: function (v) { if (panel.draft) { panel.draft.admin = !!v; renderPanel(); } },
    pActive: function (v) { if (panel.draft) { panel.draft.active = !!v; renderPanel(); } },
    pFollowRole: function (follow) {
      if (!panel.draft) return;
      panel.draft.pages = follow ? [] : AUTH.effectivePages({ name: panel.target, role: panel.draft.role });
      renderPanel();
    },
    // 跟随岗位时忽略点击；否则切换该页勾选
    pClickPage: function (ev, p) {
      if (ev && ev.preventDefault) ev.preventDefault();
      if (ev && ev.stopPropagation) ev.stopPropagation();
      if (!panel.draft) return;
      if (!(panel.draft.pages && panel.draft.pages.length)) return;   // 跟随岗位，只读
      var arr = panel.draft.pages.slice();
      var i = arr.indexOf(p);
      if (i >= 0) arr.splice(i, 1); else arr.push(p);
      panel.draft.pages = arr;
      renderPanel();
    },
    pScope: function (s) { if (panel.draft) { panel.draft.scope = s; renderPanel(); } },
    pSetPwd: function () {
      var inp = doc.getElementById('njpNewPwd');
      var r = AUTH.setPassword(panel.target, inp ? String(inp.value || '') : '', undefined);
      panel.msg = r.ok ? '口令已更新，请转告该同事' : r.error;
      panel.msgType = r.ok ? 'ok' : 'err';
      renderPanel();
    },
    pClearPwd: function () {
      var r = AUTH.clearPassword(panel.target);
      panel.msg = r.ok ? '已清除口令，该账号暂时无法登录' : r.error;
      panel.msgType = r.ok ? 'ok' : 'err';
      renderPanel();
    },
    pToggleActive: function (name) {
      var a = AUTH.get(name);
      if (!a) return;
      var r = AUTH.update(name, { active: !a.active });
      panel.view = 'list';
      panel.msg = r.ok ? '' : r.error;
      panel.msgType = r.ok ? '' : 'err';
      renderPanel();
    },
    pRemove: function () {
      var r = AUTH.remove(panel.target);
      if (!r.ok) { panel.msg = r.error; panel.msgType = 'err'; renderPanel(); return; }
      panel.view = 'list';
      panel.msg = '已删除账号'; panel.msgType = 'ok';
      renderPanel();
    },
    pSave: function () {
      var d = panel.draft;
      if (!d) return;
      var r = AUTH.update(panel.target, { role: d.role, pages: d.pages, scope: d.scope, admin: d.admin, active: d.active });
      if (!r.ok) { panel.msg = r.error; panel.msgType = 'err'; renderPanel(); return; }
      // 改的是自己 → 立即生效，并可能失去管理权
      if (cur && AUTH.normName(cur.name) === AUTH.normName(panel.target)) {
        cur = AUTH.get(cur.name);
        AUTH.session.set(cur.name, cur.role);
        try { opts.onEnter(cur); } catch (e) {}
      }
      panel.view = 'list';
      panel.msg = ''; panel.msgType = '';
      renderPanel();
    },
    aPick: function (n) { panel.add.name = n; renderPanel(); },
    aRole: function (r) { panel.add.role = r; renderPanel(); },
    aSave: function () {
      var inp = doc.getElementById('njpAddName');
      var name = inp ? String(inp.value || '').trim() : '';
      if (!name) name = panel.add.name;
      var pwdInp = doc.getElementById('njpAddPwd');
      var pwd = pwdInp ? String(pwdInp.value || '') : '';
      var r = AUTH.add(name, panel.add.role, { password: pwd || undefined });
      if (!r.ok) { panel.add.err = r.error; renderPanel(); return; }
      panel.add = { name: '', role: 'REPORTER', err: '' };
      panel.view = 'list';
      panel.msg = '已创建账号「' + name + '」'; panel.msgType = 'ok';
      renderPanel();
    },

    // 自助改口令
    selfSave: function () {
      var o = doc.getElementById('njpSelfOld');
      var n = doc.getElementById('njpSelfNew');
      var n2 = doc.getElementById('njpSelfNew2');
      var vOld = o ? String(o.value || '') : '';
      var vNew = n ? String(n.value || '') : '';
      var vNew2 = n2 ? String(n2.value || '') : '';
      if (!vNew || vNew.length < 4) { panel.self.err = '新口令至少 4 位'; panel.self.ok = ''; renderPanel(); return; }
      if (vNew !== vNew2) { panel.self.err = '两次输入的新口令不一致'; panel.self.ok = ''; renderPanel(); return; }
      var r = AUTH.setPassword(cur.name, vNew, vOld);
      if (!r.ok) { panel.self.err = r.error; panel.self.ok = ''; }
      else { panel.self.err = ''; panel.self.ok = '口令已修改，下次请用新口令登录'; }
      renderPanel();
    },

    // 测试探针（不参与业务路径）
    __probe: {
      loginPool: loginPool,
      gateEl: gateEl,
      panelEl: panelEl,
      draftOf: draftOf,
      setLogin: function (p) { Object.assign(login, p || {}); },
      setBoot: function (p) { Object.assign(boot, p || {}); },
      setMode: function (m) { mode = m; },
      setCur: function (n) { cur = n ? AUTH.get(n) : null; },
      setPanel: function (p) { Object.assign(panel, p || {}); },
      state: function () {
        return {
          mode: mode, cur: cur ? cur.name : null, login: login, boot: boot, rescue: rescue,
          panel: { open: panel.open, kind: panel.kind, view: panel.view, target: panel.target, msg: panel.msg, msgType: panel.msgType }
        };
      },
      html: {
        gate: gateHtml,
        login: loginHtml,
        bootstrap: bootstrapHtml,
        rescue: rescueHtml,
        list: listHtml,
        edit: editHtml,
        add: addHtml,
        self: selfHtml
      }
    }
  };

  if (doc && doc.addEventListener) {
    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && panel.open) closePanel();
    });
  }

  root.NJ_GATE = GATE;
  if (typeof module !== 'undefined' && module.exports) module.exports = GATE;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
