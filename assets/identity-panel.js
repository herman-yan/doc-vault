/*
 * 岗位身份切换面板（Identity Panel）
 * 供 work-order / report-center 共用。
 *
 * 为什么不用两个原生下拉：
 *   1) 220px 侧栏里塞两个 100% 宽下拉，岗位 9 项 + 姓名 20+ 项全靠滚动翻找；
 *   2) 岗位下拉只显示名称、看不到职责，容易选错；
 *   3) 姓名下拉在报表页曾因读不到名单只剩一个人。
 * 本组件把侧栏收敛成一行「姓名 · 岗位 + 切换」，点开弹窗后：
 *   - 姓名：可搜索的 chips，点选即高亮
 *   - 岗位：卡片网格，带职责说明与「是否可进入本页」提示
 *   - 底部实时预览「将切换为…」+ 应用
 *   - 名单管理：手动补充 / 隐藏（名单 = 台账提取 ∪ 手动补充 − 手动隐藏）
 *
 * 依赖：AFG（assets/aftersales-guardrails.js）
 * 注意：本机岗位识别仅用于视图分区与操作留痕，不是安全边界。
 */
(function (root) {
  'use strict';

  var doc = root.document;
  var AFG = root.AFG;

  function esc(v) {
    return String(v === undefined || v === null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function roleLabel(r) {
    if (AFG && AFG.roleLabel) return AFG.roleLabel(r);
    return r || '未识别岗位';
  }

  var CSS = [
    '#identityBar { padding: 10px 12px !important; background: #172033 !important; border-bottom: 1px solid #334155 !important; }',
    '.idp-bar { display: flex; align-items: center; gap: 9px; cursor: pointer; border-radius: 8px; padding: 6px 8px; transition: background .15s; }',
    '.idp-bar:hover { background: rgba(255,255,255,.07); }',
    '.idp-bar:focus { outline: 2px solid #3b82f6; outline-offset: 1px; }',
    '.idp-avatar { width: 30px; height: 30px; border-radius: 50%; background: linear-gradient(135deg,#2563eb,#60a5fa); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; flex: 0 0 auto; }',
    '.idp-meta { flex: 1; min-width: 0; }',
    '.idp-name { font-size: 13px; font-weight: 600; color: #e2e8f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '.idp-role { font-size: 11px; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }',
    '.idp-switch { font-size: 11px; color: #93c5fd; border: 1px solid #334155; border-radius: 6px; padding: 3px 7px; flex: 0 0 auto; white-space: nowrap; }',
    '.idp-bar:hover .idp-switch { border-color: #3b82f6; background: rgba(59,130,246,.15); }',

    '.idp-overlay { display: none; position: fixed; inset: 0; background: rgba(15,23,42,.55); z-index: 2000; align-items: flex-start; justify-content: center; padding: 48px 16px; overflow-y: auto; }',
    '.idp-overlay.show { display: flex; }',
    '.idp-modal { background: #fff; border-radius: 14px; width: 100%; max-width: 660px; box-shadow: 0 24px 64px rgba(0,0,0,.3); overflow: hidden; }',
    '.idp-head { display: flex; align-items: flex-start; justify-content: space-between; padding: 18px 22px 14px; border-bottom: 1px solid #e2e8f0; }',
    '.idp-title { font-size: 16px; font-weight: 700; color: #0f172a; }',
    '.idp-sub { font-size: 12px; color: #64748b; margin-top: 3px; }',
    '.idp-x { background: none; border: none; font-size: 22px; line-height: 1; cursor: pointer; color: #94a3b8; padding: 0 4px; }',
    '.idp-x:hover { color: #475569; }',
    '.idp-body { padding: 16px 22px 4px; max-height: 62vh; overflow-y: auto; }',
    '.idp-sec { margin-bottom: 18px; }',
    '.idp-sec-h { display: flex; align-items: center; font-size: 13px; font-weight: 600; color: #334155; margin-bottom: 9px; }',
    '.idp-step { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; background: #2563eb; color: #fff; font-size: 11px; font-weight: 700; margin-right: 7px; }',
    '.idp-link { margin-left: auto; background: none; border: none; color: #2563eb; font-size: 12px; cursor: pointer; padding: 2px 4px; }',
    '.idp-link:hover { text-decoration: underline; }',
    '.idp-search { width: 100%; font-size: 13px; padding: 8px 11px; border: 1px solid #cbd5e1; border-radius: 8px; margin-bottom: 9px; color: #0f172a; }',
    '.idp-search:focus { outline: none; border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,.12); }',
    '.idp-chips { display: flex; flex-wrap: wrap; gap: 7px; }',
    '.idp-chip { position: relative; font-size: 12px; padding: 6px 12px; border: 1px solid #cbd5e1; border-radius: 999px; cursor: pointer; color: #334155; background: #fff; transition: all .12s; user-select: none; }',
    '.idp-chip:hover { border-color: #2563eb; color: #2563eb; background: #eff6ff; }',
    '.idp-chip.on { background: #2563eb; border-color: #2563eb; color: #fff; font-weight: 600; }',
    '.idp-chip .idp-hide { margin-left: 5px; color: #94a3b8; font-weight: 700; }',
    '.idp-chip .idp-hide:hover { color: #dc2626; }',
    '.idp-chip-h { border-style: dashed; color: #94a3b8; }',
    '.idp-chip-x { border-color: #fca5a5; color: #b91c1c; background: #fef2f2; }',
    '.idp-roles { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 8px; }',
    '@media (max-width: 560px) { .idp-roles { grid-template-columns: 1fr; } }',
    '.idp-rolecard { text-align: left; border: 1px solid #cbd5e1; background: #fff; border-radius: 10px; padding: 9px 11px; cursor: pointer; transition: all .12s; }',
    '.idp-rolecard:hover { border-color: #2563eb; background: #f8fafc; }',
    '.idp-rolecard.on { border-color: #2563eb; background: #eff6ff; box-shadow: 0 0 0 1px #2563eb inset; }',
    '.idp-rolecard .rc-t { font-size: 13px; font-weight: 600; color: #0f172a; display: flex; align-items: center; gap: 6px; }',
    '.idp-rolecard .rc-d { font-size: 11px; color: #64748b; line-height: 1.5; margin-top: 3px; }',
    '.idp-tag { font-size: 10px; font-weight: 500; padding: 1px 6px; border-radius: 999px; }',
    '.idp-tag.ro { background: #fef3c7; color: #92400e; }',
    '.idp-tag.no { background: #fee2e2; color: #b91c1c; }',
    '.idp-empty { font-size: 12px; color: #94a3b8; padding: 10px 0; }',
    '.idp-note { font-size: 11px; color: #64748b; background: #f8fafc; border-left: 3px solid #cbd5e1; padding: 8px 11px; border-radius: 4px; line-height: 1.6; margin-bottom: 14px; }',
    '.idp-note b { color: #475569; }',
    '.idp-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 22px; border-top: 1px solid #e2e8f0; background: #f8fafc; flex-wrap: wrap; }',
    '.idp-pend { font-size: 12px; color: #64748b; }',
    '.idp-pend b { color: #0f172a; }',
    '.idp-same { color: #94a3b8; }',
    '.idp-acts { display: flex; gap: 8px; }',
    '.idp-btn { font-size: 13px; padding: 7px 16px; border-radius: 8px; border: 1px solid #cbd5e1; background: #fff; color: #334155; cursor: pointer; }',
    '.idp-btn:hover { background: #f1f5f9; }',
    '.idp-btn-p { background: #2563eb; border-color: #2563eb; color: #fff; font-weight: 600; }',
    '.idp-btn-p:hover { background: #1d4ed8; }',
    '.idp-btn-p:disabled { background: #cbd5e1; border-color: #cbd5e1; cursor: not-allowed; }',
    '.idp-manage { background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 10px; padding: 11px; margin-bottom: 11px; }',
    '.idp-mrow { display: flex; gap: 8px; }',
    '.idp-mrow .idp-search { margin-bottom: 0; }',
    '.idp-mlabel { font-size: 11px; color: #94a3b8; margin: 10px 0 6px; }',
    '.idp-mhint { font-size: 11px; color: #94a3b8; margin-top: 10px; line-height: 1.5; }'
  ].join('\n');

  var styled = false;
  function injectStyle() {
    if (styled || !doc || !doc.head) return;
    var s = doc.createElement('style');
    s.textContent = CSS;
    if (doc.head.appendChild) doc.head.appendChild(s);
    styled = true;
  }

  // ===== 状态 =====
  var opts = {
    getNames: function () { return []; },
    onChange: function () {},
    canEnter: function () { return true; },
    pageName: ''
  };
  var cur = { name: '', role: 'ADMIN' };   // 已生效
  var pend = { name: '', role: 'ADMIN' };  // 弹窗内待应用
  var state = { names: [], filtered: [], q: '', manage: false };
  var ov = null;
  var isOpen = false;

  function ensureOverlay() {
    if (ov) return ov;
    if (!doc || !doc.createElement) return null;
    ov = doc.createElement('div');
    ov.className = 'idp-overlay';
    ov.id = 'idpOverlay';
    if (ov.addEventListener) {
      ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    }
    var host = doc.body || doc.documentElement;
    if (host && host.appendChild) host.appendChild(ov);
    return ov;
  }

  // ===== 折叠态：侧栏一行 =====
  function barHtml() {
    var initial = (cur.name || '?').slice(0, 1);
    var ro = AFG && AFG.isReadonly && AFG.isReadonly(cur.role) ? ' · 只读' : '';
    return '' +
      '<div class="idp-bar" role="button" tabindex="0" onclick="IDP.open()" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();IDP.open();}" aria-label="切换岗位身份">' +
        '<div class="idp-avatar">' + esc(initial) + '</div>' +
        '<div class="idp-meta">' +
          '<div class="idp-name">' + esc(cur.name || '未署名') + '</div>' +
          '<div class="idp-role">' + esc(roleLabel(cur.role)) + ro + '</div>' +
        '</div>' +
        '<div class="idp-switch">切换</div>' +
      '</div>';
  }

  function renderBar() {
    injectStyle();
    var bar = doc && doc.getElementById ? doc.getElementById('identityBar') : null;
    if (bar) bar.innerHTML = barHtml();
  }

  // ===== 弹窗内容 =====
  function chipsHtml(list) {
    list = list || [];
    var q = state.q.trim();
    if (!list.length) {
      return '<div class="idp-empty">' +
        (state.names.length ? '没有匹配「' + esc(q) + '」的姓名' :
          '台账暂无可用姓名，可点右上角「管理名单」手动补充') +
        '</div>';
    }
    return list.map(function (n, i) {
      var hide = state.manage ? '<span class="idp-hide" onclick="event.stopPropagation();IDP.hideNameAt(' + i + ')">×</span>' : '';
      return '<span class="idp-chip' + (n === pend.name ? ' on' : '') + '" onclick="IDP.pickNameAt(' + i + ')">' + esc(n) + hide + '</span>';
    }).join('');
  }

  function visibleNames() {
    var q = state.q.trim();
    return state.names.filter(function (n) { return !q || n.indexOf(q) >= 0; });
  }

  function rolesHtml() {
    var roles = (AFG && AFG.ROLES) ? Object.keys(AFG.ROLES) : [];
    return roles.map(function (r) {
      var def = AFG.ROLES[r] || {};
      var ro = (AFG.isReadonly && AFG.isReadonly(r)) ? '<span class="idp-tag ro">只读</span>' : '';
      var ok = true;
      try { ok = opts.canEnter(r); } catch (e) { ok = true; }
      var no = ok ? '' : '<span class="idp-tag no">不可进入本页</span>';
      return '<button class="idp-rolecard' + (r === pend.role ? ' on' : '') + '" onclick="IDP.pickRole(\'' + esc(r) + '\')">' +
        '<div class="rc-t">' + esc(def.label || r) + ro + no + '</div>' +
        '<div class="rc-d">' + esc(def.scopeHint || '') + '</div>' +
        '</button>';
    }).join('');
  }

  function manageHtml() {
    if (!state.manage) return '';   // 默认收起，点「管理名单」才展开
    if (!AFG || !AFG.getNameBook) return '';
    var book = AFG.getNameBook();
    var html = '<div class="idp-manage">' +
      '<div class="idp-mrow">' +
        '<input class="idp-search" id="idpNewName" placeholder="新增姓名（如新入职同事）" onkeydown="if(event.key===\'Enter\'){IDP.addName();}">' +
        '<button class="idp-btn" onclick="IDP.addName()">添加</button>' +
      '</div>';
    if (book.extra.length) {
      html += '<div class="idp-mlabel">手动补充（点按移除）</div><div class="idp-chips">' +
        book.extra.map(function (n, i) {
          return '<span class="idp-chip idp-chip-x" onclick="IDP.delExtra(' + i + ')">' + esc(n) + ' ×</span>';
        }).join('') + '</div>';
    }
    if (book.hidden.length) {
      html += '<div class="idp-mlabel">已隐藏（点按恢复）</div><div class="idp-chips">' +
        book.hidden.map(function (n, i) {
          return '<span class="idp-chip idp-chip-h" onclick="IDP.restoreName(' + i + ')">' + esc(n) + '</span>';
        }).join('') + '</div>';
    }
    html += '<div class="idp-mhint">名单 = 台账自动提取 ∪ 手动补充 − 手动隐藏</div></div>';
    return html;
  }

  function dirty() { return pend.name !== cur.name || pend.role !== cur.role; }

  function modalHtml() {
    var ro = (AFG && AFG.isReadonly && AFG.isReadonly(cur.role)) ? ' · 只读' : '';
    return '' +
      '<div class="idp-modal" role="dialog" aria-label="切换岗位身份">' +
        '<div class="idp-head">' +
          '<div>' +
            '<div class="idp-title">切换岗位身份</div>' +
            '<div class="idp-sub">当前：' + esc(cur.name || '未署名') + ' · ' + esc(roleLabel(cur.role)) + ro + '</div>' +
          '</div>' +
          '<button class="idp-x" onclick="IDP.close()" aria-label="关闭">×</button>' +
        '</div>' +
        '<div class="idp-body">' +
          '<div class="idp-sec">' +
            '<div class="idp-sec-h"><span class="idp-step">1</span>选择姓名' +
              '<button class="idp-link" onclick="IDP.toggleManage()">' + (state.manage ? '收起名单管理' : '管理名单') + '</button>' +
            '</div>' +
            manageHtml() +
            '<input class="idp-search" id="idpSearch" placeholder="🔍 输入姓名快速筛选…" value="' + esc(state.q) + '" oninput="IDP.filter(this.value)">' +
            '<div class="idp-chips" id="idpNames">' + chipsHtml(visibleNames()) + '</div>' +
          '</div>' +
          '<div class="idp-sec">' +
            '<div class="idp-sec-h"><span class="idp-step">2</span>选择岗位</div>' +
            '<div class="idp-roles">' + rolesHtml() + '</div>' +
          '</div>' +
          '<div class="idp-note">本机岗位识别，用于视图分区与操作留痕，<b>不是安全边界</b>；正式权限需由统一后端校验。</div>' +
        '</div>' +
        '<div class="idp-foot">' +
          '<div class="idp-pend">将切换为：<b>' + esc(pend.name || '未署名') + '</b> · ' + esc(roleLabel(pend.role)) +
            (dirty() ? '' : ' <span class="idp-same">（未改动）</span>') + '</div>' +
          '<div class="idp-acts">' +
            '<button class="idp-btn" onclick="IDP.close()">取消</button>' +
            '<button class="idp-btn idp-btn-p"' + (dirty() ? '' : ' disabled') + ' onclick="IDP.apply()">应用</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function paint() {
    var el = ensureOverlay();
    if (!el) return;
    state.filtered = visibleNames();
    el.innerHTML = modalHtml();
  }

  // ===== 对外 API =====
  var IDP = {
    init: function (options) {
      options = options || {};
      if (options.getNames) opts.getNames = options.getNames;
      if (options.onChange) opts.onChange = options.onChange;
      if (options.canEnter) opts.canEnter = options.canEnter;
      if (options.pageName) opts.pageName = options.pageName;
      if (AFG && AFG.getIdentity) {
        var id = AFG.getIdentity();
        if (id) cur = { name: id.name || '', role: id.role || 'ADMIN' };
      }
      // cur.name 允许为空：空时只作展示占位「未署名」，不写进名单、不占用选项索引
      pend = { name: cur.name, role: cur.role };
      renderBar();
      return IDP;
    },
    current: function () { return { name: cur.name, role: cur.role }; },
    refresh: function () { renderBar(); },
    isOpen: function () { return isOpen; },
    el: function () { return ensureOverlay(); },
    names: function () { return state.names.slice(); },
    filtered: function () { return state.filtered.slice(); },

    open: function () {
      if (!AFG) return;
      state.names = (opts.getNames() || []).slice();
      // 当前姓名若不在名单里（如手填过），补到最前，避免选不回来；空名不补
      if (cur.name && state.names.indexOf(cur.name) < 0) state.names.unshift(cur.name);
      state.q = '';
      state.manage = false;
      pend = { name: cur.name, role: cur.role };
      state.filtered = visibleNames();
      paint();
      var el = ensureOverlay();
      if (el && el.classList) el.classList.add('show');
      isOpen = true;
    },
    close: function () {
      var el = ensureOverlay();
      if (el && el.classList) el.classList.remove('show');
      isOpen = false;
    },
    filter: function (q) {
      state.q = String(q === undefined || q === null ? '' : q);
      var list = visibleNames();
      state.filtered = list;
      var box = doc && doc.getElementById ? doc.getElementById('idpNames') : null;
      if (box) box.innerHTML = chipsHtml(list);
    },
    pickNameAt: function (i) {
      var n = state.filtered[i];
      if (n === undefined) return;
      pend.name = n;
      paint();
    },
    pickRole: function (r) {
      if (!AFG || !AFG.ROLES || !AFG.ROLES[r]) return;
      pend.role = r;
      paint();
    },
    toggleManage: function () {
      state.manage = !state.manage;
      paint();
    },
    addName: function () {
      var inp = doc && doc.getElementById ? doc.getElementById('idpNewName') : null;
      var v = inp ? String(inp.value || '').trim() : '';
      if (!v || !AFG || !AFG.isRealName || !AFG.isRealName(v)) return;
      var book = AFG.getNameBook();
      var n = AFG.normName(v);
      book.extra = book.extra.filter(function (x) { return AFG.normName(x) !== n; });
      book.hidden = book.hidden.filter(function (x) { return x !== n; });
      book.extra.push(v);
      AFG.setNameBook(book);
      state.names = (opts.getNames() || []).slice();
      state.q = '';
      paint();
    },
    delExtra: function (i) {
      var book = AFG.getNameBook();
      book.extra.splice(i, 1);
      AFG.setNameBook(book);
      state.names = (opts.getNames() || []).slice();
      paint();
    },
    hideNameAt: function (i) {
      var n = state.filtered[i];
      if (!n) return;
      IDP.hideName(n);
    },
    hideName: function (n) {
      var book = AFG.getNameBook();
      var key = AFG.normName(n);
      if (book.hidden.indexOf(key) < 0) book.hidden.push(key);
      book.extra = book.extra.filter(function (x) { return AFG.normName(x) !== key; });
      AFG.setNameBook(book);
      state.names = (opts.getNames() || []).slice();
      if (pend.name === n) pend.name = state.names[0] || '';
      paint();
    },
    restoreName: function (i) {
      var book = AFG.getNameBook();
      book.hidden.splice(i, 1);
      AFG.setNameBook(book);
      state.names = (opts.getNames() || []).slice();
      paint();
    },
    apply: function () {
      if (!dirty() || !AFG) { IDP.close(); return; }
      cur = { name: pend.name, role: pend.role };
      AFG.setIdentity(cur.name, cur.role);
      renderBar();
      IDP.close();
      try { opts.onChange(cur.name, cur.role); } catch (e) {}
    }
  };

  if (doc && doc.addEventListener) {
    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen) IDP.close();
    });
  }

  root.IDP = IDP;
  if (typeof module !== 'undefined' && module.exports) module.exports = IDP;
})(typeof window !== 'undefined' ? window : this);
