/*
 * 售后运营护栏公共层（Aftersales Guardrails）
 * 供 work-order / warehouse 等页面共用：岗位可见范围、版本化状态机、三级质检、
 * 责任分离、操作留痕、导入去重合并。
 *
 * 定位说明：doc-vault 是静态站点，本层的身份识别与可见范围过滤是「岗位视图分区 + 留痕」，
 * 不是安全边界。真正的访问控制需要统一后端（recruit/ 的 node server.js 是现成样板）。
 */
(function (root) {
  'use strict';

  // ===== 1. 岗位与可见范围 =====
  var ROLES = {
    REPORTER: { label: '报单员', scopeHint: '负责建单、报单与结算信息录入。' },
    DISPATCHER: { label: '调度', scopeHint: '跨保内、保外与待判定工单统一查询、调度、审计和下钻。' },
    TECHNICIAN: { label: '维修技师', scopeHint: '技师只能查看指派给自己的工单。' },
    WAREHOUSE: { label: '库管', scopeHint: '库房与采购只能查看已关联采购单/订货单的工单。' },
    PURCHASER: { label: '采购', scopeHint: '库房与采购只能查看已关联采购单/订货单的工单。' },
    FINANCE: { label: '财务', scopeHint: '财务角色只能查看已竣工、已结算、已结清或已关闭的保外工单；保内工单不产生收费，不在财务可见范围内。' },
    AUDITOR: { label: '监管员', scopeHint: '全量只读：工单合规确认与存档，全量留痕可回放。' },
    QUALITY_INSPECTOR: { label: '专职质检员', scopeHint: '终检签署、技术否决，独立把守交付质量；不参与自检与班组复检。' },
    ADMIN: { label: '管理员', scopeHint: '本站全部工单与配置。' }
  };

  // role -> 可进入的页面（work-order 页 pageId / warehouse 页 tabId）
  var ROLE_PAGES = {
    REPORTER: ['dashboard', 'warranty', 'nonwarranty', 'warehouse', 'export'],
    DISPATCHER: ['dashboard', 'warranty', 'nonwarranty', 'warehouse', 'engineers', 'export', 'orders', 'txns'],
    TECHNICIAN: ['dashboard', 'warranty', 'nonwarranty', 'orders'],
    WAREHOUSE: ['dashboard', 'warehouse', 'orders', 'txns', 'oldparts', 'inventory'],
    PURCHASER: ['dashboard', 'warehouse', 'orders', 'txns', 'inventory'],
    FINANCE: ['dashboard', 'nonwarranty', 'export'],
    AUDITOR: ['dashboard', 'warranty', 'nonwarranty', 'warehouse', 'engineers', 'export', 'orders', 'txns', 'inventory', 'oldparts'],
    QUALITY_INSPECTOR: ['dashboard', 'warranty', 'nonwarranty'],
    ADMIN: ['dashboard', 'warranty', 'nonwarranty', 'warehouse', 'engineers', 'export', 'orders', 'txns', 'inventory', 'oldparts']
  };

  // 只读岗位：能看不能推动流转
  var READONLY_ROLES = { AUDITOR: true };

  function roleLabel(role) { return (ROLES[role] && ROLES[role].label) || role || '未识别岗位'; }
  function canPage(role, page) { return !!(ROLE_PAGES[role] && ROLE_PAGES[role].indexOf(page) >= 0); }
  function isReadonly(role) { return !!READONLY_ROLES[role]; }

  // 数据可见范围（客户端过滤；口径同 lhrj，规则文案对用户可见）
  function visibleOrders(role, orders, actor, linkIndex) {
    var list = orders || [];
    if (role === 'TECHNICIAN') {
      return list.filter(function (o) { return samePerson(o.engineer, actor && actor.name) || samePerson(o.repairEngineer, actor && actor.name); });
    }
    if (role === 'FINANCE') {
      return list.filter(function (o) {
        var s = o.status;
        var settled = s === '维修完成' || s === '待复检' || s === '待终检' || s === '已竣工' || s === '已结算' || s === '已结清' || s === '关闭工单';
        // 保内不产生收费
        return settled && o._type !== '保内' && o.warrantyType !== 'IN_WARRANTY';
      });
    }
    if (role === 'WAREHOUSE' || role === 'PURCHASER') {
      var idx = linkIndex || {};
      return list.filter(function (o) { return idx[o.id]; });
    }
    return list;
  }

  function samePerson(a, b) {
    if (!a || !b) return false;
    return String(a).trim() === String(b).trim();
  }

  // ===== 2. 结构化质检清单（11 项，全true、不重复、不含未知码）=====
  var QC_TEMPLATE_VERSION = 'CETT-QC-COMMON-v2';
  var QC_ITEMS = [
    { code: 'power_ppe', label: '断电隔离与高压防护用品符合要求' },
    { code: 'tools_fod_clear', label: '工具、物料与异物已清点清场' },
    { code: 'repair_per_sop', label: '维修过程按适用 SOP 执行' },
    { code: 'material_assembly_match', label: '物料、料号与装配位置一致' },
    { code: 'torque_marks', label: '紧固扭矩与防松漆标记完整' },
    { code: 'insulation_pass', label: '绝缘测试通过' },
    { code: 'enclosure_sealing_pass', label: '箱体气密测试通过' },
    { code: 'cooling_sealing_pass', label: '水冷气密测试通过' },
    { code: 'diagnostics_clear', label: '控制器与诊断检测无故障' },
    { code: 'appearance_labels', label: '外观、标签与清洁度合格' },
    { code: 'records_parts_complete', label: '记录、照片、报告与旧件齐全' }
  ];
  var QC_CODES = QC_ITEMS.map(function (i) { return i.code; });

  var QC_GATES = {
    insulationMohm: { label: '绝缘阻值(mΩ)', min: 0, finite: true },
    capacityRecoveryPct: { label: '容量恢复率(%)', min: 95, max: 999.99 },
    voltageDrop72hMv: { label: '72小时压降(mV)', min: 0, max: 30 }
  };

  function validateQC(payload) {
    var errors = [];
    var items = (payload && payload.items) || [];
    if (items.length !== QC_CODES.length) {
      errors.push('质检清单必须完整 11 项，当前 ' + items.length + ' 项');
    }
    var seen = {};
    QC_CODES.forEach(function (c) { seen[c] = false; });
    items.forEach(function (it) {
      if (!it || QC_CODES.indexOf(it.code) < 0) { errors.push('未知质检项：' + (it && it.code)); return; }
      if (seen[it.code]) errors.push('质检项重复：' + it.code);
      seen[it.code] = true;
      if (it.passed !== true) errors.push('未通过：' + QC_LABEL(it.code));
    });
    Object.keys(QC_GATES).forEach(function (k) {
      var g = QC_GATES[k], v = payload ? payload[k] : null;
      var n = (v === '' || v === null || v === undefined) ? NaN : Number(v);
      if (!isFinite(n)) { errors.push('缺少或非法：' + g.label); return; }
      if ((g.min !== undefined && n < g.min) || (g.max !== undefined && n > g.max)) {
        errors.push(g.label + ' 超出允许区间 ' + g.min + '~' + g.max + '，当前 ' + n);
      }
    });
    return { ok: errors.length === 0, errors: errors };
  }

  function QC_LABEL(code) {
    for (var i = 0; i < QC_ITEMS.length; i++) if (QC_ITEMS[i].code === code) return QC_ITEMS[i].label;
    return code;
  }

  // ===== 3. 状态机（版本化模板）=====
  // transition: { action 动作标识, label 按钮文案, to 目标状态, roles 允许岗位, stage 质检阶段(可选) }
  var WN_FLOW = {
    version: 'CETT-WN-FLOW-v2', effectiveAt: '2026-10-19',
    states: ['未派工', '未开工', '在修', '待班组复检', '待质检终检', '驳回待重检', '已竣工', '已结算', '已结清', '已终止'],
    terminal: ['已结清', '已终止'],
    entry: '未派工',
    transitions: {
      '未派工': [{ action: 'dispatch', label: '派单', to: '未开工', roles: ['DISPATCHER', 'ADMIN'] }],
      '未开工': [{ action: 'start', label: '开工', to: '在修', roles: ['TECHNICIAN', 'DISPATCHER', 'ADMIN'] }],
      '在修': [{ action: 'self_check', label: '申报竣工(技师自检)', to: '待班组复检', roles: ['TECHNICIAN', 'ADMIN'], stage: 'SELF' }],
      '驳回待重检': [{ action: 'self_check', label: '重新申报竣工', to: '待班组复检', roles: ['TECHNICIAN', 'ADMIN'], stage: 'SELF' }],
      '待班组复检': [
        { action: 'team_review_pass', label: '班组复检通过', to: '待质检终检', roles: ['TECHNICIAN', 'DISPATCHER', 'ADMIN'], stage: 'TEAM' },
        { action: 'reject', label: '驳回重检', to: '驳回待重检', roles: ['TECHNICIAN', 'QUALITY_INSPECTOR', 'ADMIN'], stage: 'TEAM' }
      ],
      '待质检终检': [
        { action: 'final_pass', label: '终检通过', to: '已竣工', roles: ['QUALITY_INSPECTOR'], stage: 'FINAL' },
        { action: 'reject', label: '技术否决·驳回重检', to: '驳回待重检', roles: ['QUALITY_INSPECTOR', 'ADMIN'], stage: 'FINAL' }
      ],
      '已竣工': [{ action: 'settle', label: '结算', to: '已结算', roles: ['REPORTER', 'ADMIN'] }],
      // 补断链：原实现里 已结算→已结清 / →已终止 没有入口
      '已结算': [{ action: 'clear', label: '结清确认', to: '已结清', roles: ['REPORTER', 'FINANCE', 'ADMIN'] }],
      '__any__': [{ action: 'cancel', label: '终止工单', to: '已终止', roles: ['DISPATCHER', 'ADMIN'], requiresReason: true }]
    }
  };

  var NW_FLOW = {
    version: 'CETT-NW-FLOW-v2', effectiveAt: '2026-10-19',
    states: ['待客户确认', '报价确认', '在修', '待班组复检', '待质检终检', '驳回待重检', '维修完成', '已关单', '已终止'],
    terminal: ['已关单', '已终止'],
    entry: '待客户确认',
    transitions: {
      '待客户确认': [{ action: 'quote_confirm', label: '客户确认报价', to: '报价确认', roles: ['REPORTER', 'DISPATCHER', 'ADMIN'] }],
      '报价确认': [{ action: 'start', label: '开工', to: '在修', roles: ['TECHNICIAN', 'DISPATCHER', 'ADMIN'] }],
      '在修': [{ action: 'self_check', label: '申报竣工(技师自检)', to: '待班组复检', roles: ['TECHNICIAN', 'ADMIN'], stage: 'SELF' }],
      '驳回待重检': [{ action: 'self_check', label: '重新申报竣工', to: '待班组复检', roles: ['TECHNICIAN', 'ADMIN'], stage: 'SELF' }],
      '待班组复检': [
        { action: 'team_review_pass', label: '班组复检通过', to: '待质检终检', roles: ['TECHNICIAN', 'DISPATCHER', 'ADMIN'], stage: 'TEAM' },
        { action: 'reject', label: '驳回重检', to: '驳回待重检', roles: ['TECHNICIAN', 'QUALITY_INSPECTOR', 'ADMIN'], stage: 'TEAM' }
      ],
      '待质检终检': [
        { action: 'final_pass', label: '终检通过', to: '维修完成', roles: ['QUALITY_INSPECTOR'], stage: 'FINAL' },
        { action: 'reject', label: '技术否决·驳回重检', to: '驳回待重检', roles: ['QUALITY_INSPECTOR', 'ADMIN'], stage: 'FINAL' }
      ],
      '维修完成': [{ action: 'close', label: '关闭工单', to: '已关单', roles: ['REPORTER', 'FINANCE', 'ADMIN'] }],
      // 兼容历史数据：旧口径里 待客户确认 直接跳到 维修完成
      '__any__': [{ action: 'cancel', label: '终止工单', to: '已终止', roles: ['DISPATCHER', 'ADMIN'], requiresReason: true }]
    }
  };

  // 旧件生命周期（warehouse）
  var OLDPART_FLOW = {
    version: 'CETT-OLDPART-v1', effectiveAt: '2026-10-19',
    states: ['待接收', '待核验', '旧件释放可用', '拒收回库', '旧件返厂', '报废或退回客户'],
    terminal: ['旧件释放可用', '拒收回库', '旧件返厂', '报废或退回客户'],
    entry: '待接收',
    transitions: {
      '待接收': [{ action: 'receive', label: '旧件接收', to: '待核验', roles: ['WAREHOUSE', 'ADMIN'] }],
      '待核验': [
        { action: 'verify_ok', label: '核验合格', to: '旧件释放可用', roles: ['WAREHOUSE', 'QUALITY_INSPECTOR', 'ADMIN'] },
        { action: 'verify_wrong', label: '到错货·拒收', to: '拒收回库', roles: ['WAREHOUSE', 'ADMIN'] },
        { action: 'verify_damaged', label: '破损/质量异常·返厂', to: '旧件返厂', roles: ['WAREHOUSE', 'QUALITY_INSPECTOR', 'ADMIN'] },
        { action: 'scrap', label: '报废或退回客户', to: '报废或退回客户', roles: ['DISPATCHER', 'ADMIN'], requiresReason: true }
      ]
    }
  };

  var RECEIPT_KIND = { ACCEPTED: '验收合格', WRONG_ITEM: '到错货', DAMAGED: '破损/质量异常' };

  var FLOWS = { WN: WN_FLOW, NW: NW_FLOW, OLDPART: OLDPART_FLOW };

  function flowOf(kind) { return FLOWS[kind]; }

  function allowedTransitions(kind, status) {
    var flow = FLOWS[kind];
    if (!flow) return [];
    var st = normalizeStatus(kind, status);
    var list = (flow.transitions[st] || []).slice();
    var term = flow.terminal.indexOf(st) >= 0;
    if (!term && flow.transitions.__any__) list = list.concat(flow.transitions.__any__);
    return list;
  }

  function isActive(kind, status) {
    var flow = FLOWS[kind];
    return !!flow && flow.terminal.indexOf(normalizeStatus(kind, status)) < 0;
  }

  // 返回允许当前岗位执行的动作；只读岗位与非法流转都在这里收敛
  function actionable(kind, order, actor) {
    if (!actor || isReadonly(actor.role)) return [];
    var st = normalizeStatus(kind, order && order.status);
    return allowedTransitions(kind, st).filter(function (t) {
      return t.roles.indexOf(actor.role) >= 0 && !isTerminalStageBlock(order, t);
    });
  }

  // 历史数据（旧状态口径）归一到新状态机，保证不丢单
  var LEGACY_STATUS = {
    WN: { '关闭工单': '已结清' },
    NW: { '关闭工单': '已关单' }
  };
  function normalizeStatus(kind, status) {
    var flow = FLOWS[kind];
    if (!status || !flow) return status || (flow ? flow.entry : status);
    if (flow.states.indexOf(status) >= 0) return status;
    var m = (LEGACY_STATUS[kind] || {})[status];
    return m || status; // 认不出的状态原样保留，交给异常治理，不静默改写
  }

  function isKnownStatus(kind, status) {
    var flow = FLOWS[kind];
    return !!flow && flow.states.indexOf(normalizeStatus(kind, status)) >= 0;
  }

  // 老数据没有质检事实：只能由质检员补录终检，不允许当"已通过"
  function isTerminalStageBlock(order, t) {
    if (t.stage !== 'FINAL') return false;
    return !(order && order.qc && order.qc.self);
  }

  // 执行一次流转：校验岗位、幂等键、质检事实、责任分离；返回 {ok, error, order}
  function applyTransition(order, t, actor, payload) {
    if (!order || !t) return { ok: false, error: '缺少工单或动作' };
    if (isReadonly(actor && actor.role)) return { ok: false, error: roleLabel(actor.role) + ' 为只读岗位，不能推动流转' };
    if (t.roles.indexOf(actor && actor.role) < 0) {
      return { ok: false, error: '当前岗位「' + roleLabel(actor && actor.role) + '」不能执行「' + t.label + '」；允许岗位：' + t.roles.map(roleLabel).join('/') };
    }
    var from = normalizeStatus(order._flowKind || 'WN', order.status);
    if (t.requiresReason && !(payload && payload.reason)) return { ok: false, error: '该操作必须填写原因' };
    if (t.action === 'dispatch' && !(payload && payload.engineer)) return { ok: false, error: '派单必须指定责任工程师' };

    var rid = payload && payload.requestId;
    if (rid && Array.isArray(order.audit) && order.audit.some(function (a) { return a.requestId === rid; })) {
      return { ok: false, duplicate: true, error: '该操作已提交过（相同请求号已入账），未重复执行' };
    }

    var kind = order._flowKind || 'WN';
    var legal = allowedTransitions(kind, from).some(function (x) { return x.action === t.action; });
    if (!legal) {
      return { ok: false, illegal: true, error: '「' + from + '」状态不允许执行「' + (t.label || t.action) + '」，请刷新后以服务端/台账当前状态为准' };
    }
    if (isTerminalStageBlock(order, t)) {
      return { ok: false, error: '该单没有技师自检事实（历史数据），需先补录自检或由质检员走异常治理，不能直接判定终检通过' };
    }

    if (t.stage === 'SELF') {
      var v = validateQC(payload && payload.qc);
      if (!v.ok) return { ok: false, error: '结构化质检未通过：' + v.errors.join('；') };
    }
    if (t.stage === 'TEAM' || t.stage === 'FINAL') {
      var duty = assertDistinctActor(order, t.stage, actor);
      if (!duty.ok) return { ok: false, error: duty.error };
    }
    // 旧件批次：接收人与核验人必须异人（历史回填的批次无接收人，不受限）
    if (kind === 'OLDPART' && /^verify_/.test(t.action) && samePerson(order.receivedBy, actor && actor.name)) {
      return { ok: false, error: '责任分离：旧件批次由「' + order.receivedBy + '」接收，本人不能核验自己接收的批次，请改由其他库管或质检员核验' };
    }

    order.status = t.to;
    stampQc(order, t, actor, payload);
    if (kind === 'OLDPART' && t.action === 'receive') order.receivedBy = actor && actor.name;
    appendAudit(order, { action: t.action, from: from, to: t.to, actor: actor, note: payload && payload.note, reason: payload && payload.reason, requestId: rid });
    return { ok: true, order: order };
  }

  // 责任分离：同一人不能在同一工单上兼任自检与复检/终检
  var STAGE_PRECEDENCE = { SELF: ['self'], TEAM: ['self', 'team'], FINAL: ['self', 'team'] };
  function assertDistinctActor(order, stage, actor) {
    var prev = STAGE_PRECEDENCE[stage] || [];
    var qc = (order && order.qc) || {};
    for (var i = 0; i < prev.length; i++) {
      var p = qc[prev[i]];
      if (p && samePerson(p.name, actor && actor.name)) {
        return { ok: false, error: '责任分离：「' + actor.name + '」已在该工单承担过「' + stageName(prev[i]) + '」，不能同一人复核' };
      }
    }
    return { ok: true };
  }
  function stageName(s) { return s === 'self' ? '技师自检' : s === 'team' ? '班组复检' : '质检终检'; }

  function stampQc(order, t, actor, payload) {
    order.qc = order.qc || {};
    var at = nowIso();
    if (t.stage === 'SELF') order.qc.self = { name: actor.name, role: actor.role, at: at, qc: payload.qc, templateVersion: QC_TEMPLATE_VERSION };
    else if (t.stage === 'TEAM') order.qc.team = { name: actor.name, role: actor.role, at: at, result: t.action };
    else if (t.stage === 'FINAL') order.qc.final = { name: actor.name, role: actor.role, at: at, result: t.action };
    if (t.action === 'reject') { order.qc.rejectedBy = { name: actor.name, stage: t.stage, at: at, reason: payload && payload.reason }; }
  }

  // ===== 4. 操作留痕（append-only）=====
  function appendAudit(order, entry) {
    order.audit = order.audit || [];
    order.audit.push({
      at: nowIso(),
      action: entry.action,
      from: entry.from,
      to: entry.to,
      actor: entry.actor ? entry.actor.name : '',
      role: entry.actor ? entry.actor.role : '',
      roleLabel: entry.actor ? roleLabel(entry.actor.role) : '',
      note: entry.note || '',
      reason: entry.reason || '',
      requestId: entry.requestId || ''
    });
    order.updatedAt = nowIso();
    return order.audit[order.audit.length - 1];
  }

  function newRequestId() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    return 'req-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  // ===== 5. 导入去重合并（空值不覆盖已有值）=====
  function nwMatchKey(o) {
    return [norm(o.vin), norm(o.signedCustomer), norm(o.customerName), norm(o.plateNumber)].join('|');
  }
  function wnMatchKey(o) { return norm(o.vehicleInfo) + '|' + norm(o.customerName) + '|' + norm(o.registerDate); }
  function norm(v) { return String(v === undefined || v === null ? '' : v).trim().toLowerCase(); }

  function mergeImport(existing, incoming, keyFn, fields) {
    var index = {}, added = [], updated = [], unchanged = [], dupIncoming = {}, preview = [];
    existing.forEach(function (o) { var k = keyFn(o); if (k && k.replace(/\|+$/, '') !== '') index[k] = o; });
    incoming.forEach(function (raw) {
      var k = keyFn(raw);
      if (!k || /^(\|\s*)+$/.test(k)) { added.push(raw); preview.push({ key: k, mode: '新增（无有效匹配键）', changes: [] }); return; }
      if (dupIncoming[k]) { unchanged.push(raw); return; }
      dupIncoming[k] = true;
      var cur = index[k];
      if (!cur) { added.push(raw); index[k] = raw; preview.push({ key: k, mode: '新增', changes: [] }); return; }
      var changes = [];
      (fields || Object.keys(raw)).forEach(function (f) {
        if (f === 'id' || f === 'audit' || f === 'qc') return;
        var nv = raw[f];
        if (nv === undefined || nv === null || String(nv).trim() === '') return; // 空值不覆盖
        if (norm(cur[f]) !== norm(nv)) { changes.push({ field: f, from: cur[f], to: nv }); cur[f] = nv; }
      });
      if (changes.length) { updated.push(cur); preview.push({ key: k, mode: '更新', changes: changes }); }
      else { unchanged.push(cur); preview.push({ key: k, mode: '无变化', changes: [] }); }
    });
    return { added: added, updated: updated, unchanged: unchanged, preview: preview, merged: existing, summary: '新增 ' + added.length + ' 条、更新 ' + updated.length + ' 条、无变化 ' + unchanged.length + ' 条' };
  }

  // ===== 6. 未保存草稿守卫 / 岗位身份 =====
  var IDENTITY_KEY = 'af_identity';
  function getIdentity(storage) {
    try {
      var raw = (storage || root.localStorage).getItem(IDENTITY_KEY);
      if (!raw) return null;
      var id = JSON.parse(raw);
      if (!id || !ROLES[id.role]) return null;
      return id;
    } catch (e) { return null; }
  }
  function setIdentity(name, role, storage) {
    var id = { name: name, role: role, at: nowIso() };
    try { (storage || root.localStorage).setItem(IDENTITY_KEY, JSON.stringify(id)); } catch (e) {}
    return id;
  }

  function nowIso() { return new Date().toISOString(); }

  var AFG = {
    VERSION: 'guardrails.v1',
    ROLES: ROLES, ROLE_PAGES: ROLE_PAGES, QC_ITEMS: QC_ITEMS, QC_CODES: QC_CODES,
    QC_GATES: QC_GATES, QC_TEMPLATE_VERSION: QC_TEMPLATE_VERSION,
    WN_FLOW: WN_FLOW, NW_FLOW: NW_FLOW, OLDPART_FLOW: OLDPART_FLOW, RECEIPT_KIND: RECEIPT_KIND,
    roleLabel: roleLabel, canPage: canPage, isReadonly: isReadonly, visibleOrders: visibleOrders,
    validateQC: validateQC, allowedTransitions: allowedTransitions, actionable: actionable,
    applyTransition: applyTransition, isActive: isActive, normalizeStatus: normalizeStatus,
    isKnownStatus: isKnownStatus,
    appendAudit: appendAudit, newRequestId: newRequestId, assertDistinctActor: assertDistinctActor,
    nwMatchKey: nwMatchKey, wnMatchKey: wnMatchKey, mergeImport: mergeImport,
    getIdentity: getIdentity, setIdentity: setIdentity, flowOf: flowOf
  };

  root.AFG = AFG;
  if (typeof module !== 'undefined' && module.exports) module.exports = AFG;
})(typeof globalThis !== 'undefined' ? globalThis : this);
