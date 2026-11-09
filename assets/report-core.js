/*
 * 服务站报表中心核心引擎（Report Core）
 * 供 work-order / report-center 共用：周期口径、指标聚合、环比、流程节点时效、人效排名。
 *
 * 口径来源：
 *  - 《服务站运营周报_0706新版》15 项核心指标（含 4 项派生指标与环比列）
 *  - 《1接单、派单流程--保内 / 2接单、报价、派单流程--保外 / 3保内维修流程 / 4保外维修流程》节点链
 *
 * 定位说明：本层是纯计算，不读写存储、不碰 DOM，可在 Node 下直接单测。
 * 所有金额单位：元；所有比率：小数（0.85 = 85%），展示层自行乘 100。
 */
(function (root) {
  'use strict';

  var VERSION = 'report-core.v1';

  // ===== 1. 基础：空值、数值、日期 =====
  var BLANK_WORDS = { '': 1, '无': 1, '-': 1, '—': 1, 'null': 1, 'undefined': 1, 'nan': 1, '/': 1, 'n/a': 1 };

  function isBlank(v) {
    if (v === null || v === undefined) return true;
    if (v instanceof Date) return isNaN(v.getTime());
    var s = String(v).trim();
    return s === '' || BLANK_WORDS[s.toLowerCase()] === 1;
  }

  function num(v) {
    if (isBlank(v)) return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var s = String(v).replace(/[,\s¥￥元]/g, '').replace(/[（(][^)）]*[)）]/g, '');
    var n = parseFloat(s);
    return isFinite(n) ? n : 0;
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // 兼容：2026-03-15 / 2026.01.01 / 2026/1/1 / 2026年1月1日 / Excel 序列号 / Date
  function parseDate(v) {
    if (v instanceof Date) {
      return isNaN(v.getTime()) ? null : new Date(v.getFullYear(), v.getMonth(), v.getDate());
    }
    if (typeof v === 'number' && v > 20000 && v < 90000) {
      var d0 = new Date(Math.round((v - 25569) * 86400 * 1000));
      return isNaN(d0.getTime()) ? null : new Date(d0.getFullYear(), d0.getMonth(), d0.getDate());
    }
    if (isBlank(v)) return null;
    var s = String(v).trim().replace(/[年月]/g, '-').replace(/日/g, '').replace(/[./]/g, '-');
    var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!m) return null;
    var y = +m[1], mo = +m[2], da = +m[3];
    if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
    var d = new Date(y, mo - 1, da);
    return (d.getFullYear() === y && d.getMonth() === mo - 1 && d.getDate() === da) ? d : null;
  }

  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function addDays(d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
  function dayDiff(a, b) { return Math.round((b - a) / 86400000); }

  // ===== 2. 周期口径 =====
  // 服务站运营周报实际填报周期为「周日至周六」（0706 版样本：6月28日(周日) ~ 7月4日(周六)）。
  var WEEK_START_DOW = 0;

  function periodOf(anchor, kind) {
    var d = parseDate(anchor) || new Date();
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (kind === 'day') return mkPeriod(d, d, 'day');
    if (kind === 'week') {
      var st = addDays(d, -(((d.getDay() - WEEK_START_DOW) % 7 + 7) % 7));
      return mkPeriod(st, addDays(st, 6), 'week');
    }
    if (kind === 'month') {
      return mkPeriod(new Date(d.getFullYear(), d.getMonth(), 1), new Date(d.getFullYear(), d.getMonth() + 1, 0), 'month');
    }
    throw new Error('未知周期类型：' + kind);
  }

  function mkPeriod(st, en, kind) {
    return {
      kind: kind, start: ymd(st), end: ymd(en), key: ymd(st),
      label: labelOf(st, en, kind), startDate: st, endDate: en
    };
  }

  function labelOf(st, en, kind) {
    if (kind === 'day') return ymd(st);
    if (kind === 'month') return st.getFullYear() + '年' + (st.getMonth() + 1) + '月';
    var sameMonth = st.getMonth() === en.getMonth();
    return st.getFullYear() + '-' + pad(st.getMonth() + 1) + '-' + pad(st.getDate()) +
      ' ~ ' + (sameMonth ? pad(en.getDate()) : pad(en.getMonth() + 1) + '-' + pad(en.getDate()));
  }

  // 注意：n 允许为 0（趋势序列的末位就是当前周期），不能用 n || 1 兜底
  function prevPeriod(p, n) {
    n = (n === undefined || n === null) ? 1 : num(n);
    if (p.kind === 'day') return periodOf(addDays(p.startDate, -n), 'day');
    if (p.kind === 'week') return periodOf(addDays(p.startDate, -7 * n), 'week');
    if (p.kind === 'month') return periodOf(new Date(p.startDate.getFullYear(), p.startDate.getMonth() - n, 1), 'month');
    throw new Error('未知周期类型：' + p.kind);
  }

  function nextPeriod(p, n) {
    n = (n === undefined || n === null) ? 1 : num(n);
    if (p.kind === 'day') return periodOf(addDays(p.startDate, n), 'day');
    if (p.kind === 'week') return periodOf(addDays(p.startDate, 7 * n), 'week');
    if (p.kind === 'month') return periodOf(new Date(p.startDate.getFullYear(), p.startDate.getMonth() + n, 1), 'month');
    throw new Error('未知周期类型：' + p.kind);
  }

  function inPeriod(p, d) {
    if (!d || !p) return false;
    return d >= p.startDate && d <= p.endDate;
  }

  // 环比：任一侧缺失或上期为 0 时返回 null（不报 ±∞），由展示层渲染为「—」
  function pct(cur, prev) {
    if (cur === null || cur === undefined || prev === null || prev === undefined) return null;
    var c = Number(cur), p = Number(prev);
    if (!isFinite(c) || !isFinite(p)) return null;
    if (p === 0) return c === 0 ? 0 : null;
    return (c - p) / p;
  }

  // ===== 3. 字段映射（保内 / 保外 差异在此收敛）=====
  var FIELDS = {
    WN: {
      label: '保内',
      in: 'registerDate', start: 'startDate', complete: 'completeDate',
      report: 'submitDate', submit: 'orderSubmitDate', settle: '',
      engineer: 'engineer', reporter: 'reporter', status: 'status',
      // 保内营收 = 工时 + 里程 + 宁德时代给付的外出作业补贴（表内以 GSS 总费用 / 总费用承载）
      revenue: function (o) { return num(o.totalFee) || num(o.gssFee) || num(o.engineerOutput); },
      received: function (o) { return num(o.totalFee) || num(o.gssFee); }
    },
    NW: {
      label: '保外',
      in: 'requestDate', start: '', complete: 'dealDate',
      report: '', submit: '', settle: 'paymentDate',
      engineer: 'repairEngineer', reporter: 'bizContact', status: 'status',
      // 保外营收 = 工时 + 配件（无明细时退回报价总额）
      revenue: function (o) { var v = num(o.laborFee) + num(o.partsSale); return v > 0 ? v : num(o.quoteTotal); },
      received: function (o) { return num(o.receivedAmount); }
    }
  };

  // 状态归桶：以护栏状态机 CETT-WN-FLOW-v2 / CETT-NW-FLOW-v2 为准，另兼容历史口径别名
  var LEGACY_ALIAS = { '关闭工单': '已关单', '维修中': '在修', '已完成': '维修完成', '待派工': '未派工' };

  var STATUS_BUCKET = {
    WN: {
      done: ['已竣工', '已结算', '已结清'],
      settled: ['已结算', '已结清'],
      active: ['未开工', '在修', '待班组复检', '待质检终检', '驳回待重检'],
      pending: ['未派工'],
      terminated: ['已终止']
    },
    NW: {
      done: ['维修完成', '已关单'],
      settled: ['已关单'],
      active: ['报价确认', '在修', '待班组复检', '待质检终检', '驳回待重检'],
      pending: ['待客户确认'],
      terminated: ['已终止']
    }
  };

  function canonStatus(type, status) {
    var s = String(status === undefined || status === null ? '' : status).trim();
    if (!s) return '';
    return LEGACY_ALIAS[s] || s;
  }

  function inBucket(type, status, bucket) {
    var b = STATUS_BUCKET[type];
    if (!b || !b[bucket]) return false;
    return b[bucket].indexOf(canonStatus(type, status)) >= 0;
  }

  function person(v) { return String(v === undefined || v === null ? '' : v).replace(/[\s\u3000]/g, ''); }

  // 单条工单 → 统一记录
  function normalize(order, type) {
    var f = FIELDS[type];
    if (!f || !order) return null;
    var rec = {
      _type: type,
      id: String(order.id || order.orderNo || order.seq || ''),
      inDate: parseDate(order[f.in]),
      startDate: f.start ? parseDate(order[f.start]) : null,
      completeDate: f.complete ? parseDate(order[f.complete]) : null,
      reportDate: f.report ? parseDate(order[f.report]) : null,
      submitDate: f.submit ? parseDate(order[f.submit]) : null,
      settleDate: f.settle ? parseDate(order[f.settle]) : null,
      engineer: person(order[f.engineer]),
      reporter: person(order[f.reporter]),
      status: canonStatus(type, order[f.status]),
      statusRaw: String(order[f.status] === undefined || order[f.status] === null ? '' : order[f.status]).trim(),
      revenue: f.revenue(order),
      received: f.received(order),
      raw: order
    };
    // 产值归属日：优先竣工/成交，缺则退回建单日（保外成交时间普遍缺失）
    rec.attrDate = rec.completeDate || rec.inDate;
    return rec;
  }

  function normalizeAll(wnOrders, nwOrders) {
    var out = [];
    (wnOrders || []).forEach(function (o) { var r = normalize(o, 'WN'); if (r) out.push(r); });
    (nwOrders || []).forEach(function (o) { var r = normalize(o, 'NW'); if (r) out.push(r); });
    return out;
  }

  // ===== 4. 指标聚合 =====
  // cfg: { headcount, engineers, complaints: {periodKey: n}, valueAdded: {periodKey: n}, gssScore }
  function aggregate(records, period, cfg) {
    cfg = cfg || {};
    var headcount = num(cfg.headcount);
    var engCount = num(cfg.engineers);
    var inP = function (d) { return inPeriod(period, d); };

    var opened = [], completed = [], settled = [], terminated = [];
    var revenue = 0, revenueWn = 0, revenueNw = 0, received = 0, valueAdded = 0;
    var wnPendingSettle = 0;
    var engSet = {}, repSet = {};

    records.forEach(function (r) {
      var isDone = inBucket(r._type, r.status, 'done');
      if (inP(r.inDate)) {
        opened.push(r);
        if (r.engineer) engSet[r.engineer] = 1;
        if (r.reporter) repSet[r.reporter] = 1;
      }
      if (isDone && inP(r.completeDate || r.attrDate)) {
        completed.push(r);
        revenue += r.revenue;
        if (r._type === 'WN') revenueWn += r.revenue; else revenueNw += r.revenue;
      }
      if (inBucket(r._type, r.status, 'settled') && inP(r.completeDate || r.attrDate)) settled.push(r);
      if (inBucket(r._type, r.status, 'terminated') && inP(r.inDate)) terminated.push(r);
      // 回款 = 保外客户回款；保内由宁德按 GSS 结算，不产生客户回款（口径见护栏 FINANCE 说明）
      if (r._type === 'NW' && inP(r.settleDate)) received += r.received;
      // 保内待结算：已竣工未结算的产值，即「等待宁德付款」金额
      if (r._type === 'WN' && isDone && !inBucket(r._type, r.status, 'settled')) wnPendingSettle += r.revenue;
    });

    // 当月累计回款：以「周期结束日」所属自然月为准（周报跨月时，如 6/28~7/4 应计入 7 月），
    // 当月 1 号起累加，下月清零
    var monthP = periodOf(period.end, 'month');
    var monthReceived = 0;
    records.forEach(function (r) {
      if (r._type !== 'NW') return;
      if (inPeriod(monthP, r.settleDate)) monthReceived += r.received;
    });

    // 快照类指标（不随周期变化，取台账当前态）
    var activeNow = records.filter(function (r) { return inBucket(r._type, r.status, 'active'); });
    var pendingNow = records.filter(function (r) { return inBucket(r._type, r.status, 'pending'); });
    var doneUnsettled = records.filter(function (r) {
      return inBucket(r._type, r.status, 'done') && !inBucket(r._type, r.status, 'settled');
    });

    // 增值产值：按周期 key 取，缺则退回当月 key（0 视为有效值，不回退）
    var kpi = cfg.valueAdded || {};
    if (!isBlank(kpi[period.key])) valueAdded = num(kpi[period.key]);
    else if (!isBlank(kpi[monthP.key])) valueAdded = num(kpi[monthP.key]);
    else valueAdded = 0;

    var orders = opened.length, done = completed.length;

    return {
      period: period,
      // 1-2 人力
      headcount: headcount,
      engineers: engCount,
      activeEngineers: Object.keys(engSet).length,
      activeReporters: Object.keys(repSet).length,
      // 3-6 工单量
      orders: orders,
      ordersWn: opened.filter(function (r) { return r._type === 'WN'; }).length,
      ordersNw: opened.filter(function (r) { return r._type === 'NW'; }).length,
      perCapitaOrders: engCount > 0 ? orders / engCount : 0,
      completed: done,
      completedWn: completed.filter(function (r) { return r._type === 'WN'; }).length,
      completedNw: completed.filter(function (r) { return r._type === 'NW'; }).length,
      completionRate: orders > 0 ? done / orders : 0,
      // 7-11 产值
      revenue: revenue,
      revenueWn: revenueWn,
      revenueNw: revenueNw,
      settledCount: settled.length,
      doneUnsettled: doneUnsettled.length,
      valueAdded: valueAdded,
      totalOutput: revenue + valueAdded,
      perCapitaOutput: headcount > 0 ? (revenue + valueAdded) / headcount : 0,
      // 12 回款（保外客户回款；保内由宁德结算，单列待结算金额）
      received: received,
      monthReceived: monthReceived,
      wnPendingSettle: wnPendingSettle,
      monthLabel: monthP.label,
      // 13-15
      complaints: num((cfg.complaints || {})[period.key]),
      activeNow: activeNow.length,
      pendingNow: pendingNow.length,
      terminated: terminated.length,
      gssScore: cfg.gssScore === undefined || cfg.gssScore === null ? null : num(cfg.gssScore),
      // 结构
      byStatus: countBy(records, function (r) { return r.status || '未填写'; }, inP),
      byEngineer: countBy(records, function (r) { return r.engineer || '未指派'; }, inP),
      byProject: countBy(records, function (r) { return String(r.raw.projectType || r.raw.repairType || r.raw.orderType || '未分类').trim(); }, inP)
    };
  }

  function countBy(records, keyFn, filterFn) {
    var m = {}, order = [];
    records.forEach(function (r) {
      if (filterFn && !filterFn(r.inDate)) return;
      var k = keyFn(r);
      if (!k) k = '未填写';
      if (m[k] === undefined) { m[k] = 0; order.push(k); }
      m[k]++;
    });
    return order.map(function (k) { return { name: k, value: m[k] }; })
      .sort(function (a, b) { return b.value - a.value; });
  }

  // 环比：对 15 项核心指标逐项算
  var KPI_ROWS = [
    { key: 'headcount', label: '站内总人数', unit: '人', note: '含站长、行政、财务等全员' },
    { key: 'engineers', label: '工程师人数', unit: '人', note: '含持证维修技师、普通技师、实习生' },
    { key: 'orders', label: '本周总接单数（宁德）', unit: '单', note: '含保内/保外/专项工单' },
    { key: 'perCapitaOrders', label: '人均接单数（系统建单）', unit: '单/人', note: '按工程师人数计算' },
    { key: 'completed', label: '本周完成工单总数', unit: '单', note: '本周提交审核的工单数' },
    { key: 'completionRate', label: '工单完成率', unit: '%', note: '完成总工单数 / 总接单数', ratio: true },
    { key: 'revenue', label: '本周竣工已结算产值', unit: '元', note: '本周达成竣工状态的维修单全口径收入' },
    { key: 'doneUnsettled', label: '已竣工未结算单量', unit: '单', note: '已申请完成报单、等待宁德付款' },
    { key: 'valueAdded', label: '增值产值', unit: '元', note: '非保内保外维修业务的产值' },
    { key: 'totalOutput', label: '总产值', unit: '元', note: '竣工产值 + 增值产值' },
    { key: 'perCapitaOutput', label: '人均产值', unit: '元/人', note: '（基础维修产值+增值产值）/ 门店总人数' },
    { key: 'monthReceived', label: '当月累计回款情况', unit: '元', note: '当月 1 号开始计数，下个月清零' },
    { key: 'complaints', label: '投诉数量', unit: '起', note: '本周是否有投诉' },
    { key: 'activeNow', label: '当前在修单', unit: '单', note: '台账当前处于维修中的工单' },
    { key: 'gssScore', label: '当前 GSS 绩效评分', unit: '分', note: '由 GSS 系统人工填报' }
  ];

  function kpiTable(cur, prev) {
    return KPI_ROWS.map(function (row) {
      var c = cur ? cur[row.key] : null;
      var p = prev ? prev[row.key] : null;
      if (typeof c !== 'number') c = c === null || c === undefined ? null : num(c);
      if (typeof p !== 'number') p = p === null || p === undefined ? null : num(p);
      return {
        key: row.key, label: row.label, unit: row.unit, note: row.note, ratio: !!row.ratio,
        current: c, previous: p, change: pct(c, p)
      };
    });
  }

  // ===== 5. 流程节点时效 =====
  // 节点定义来自 4 张流程图的节点链（保留可计算段）
  var NODE_DEFS = [
    { key: 'intake', label: '接单响应（登记→开工）', from: 'inDate', to: 'startDate', type: 'both', hint: '流程图 1/2：业务登记 → 派单 → 开工' },
    // 保外普遍不填开工日，用需求提出日兜底，否则保外维修时长恒为 0 样本
    { key: 'repair', label: '维修时长（开工→完工）', from: 'startDate', fallbackFrom: 'inDate', to: 'completeDate', type: 'both', hint: '流程图 3/4：到达现场 → 检测 → 维修作业 → 完工复检' },
    { key: 'report', label: '报单时长（建单→提交）', from: 'reportDate', to: 'submitDate', type: 'WN', hint: '流程图 1：建单日期 → 工单提交时间' },
    { key: 'settle', label: '结算时长（完工→结算）', from: 'completeDate', to: 'settleDate', type: 'NW', hint: '流程图 4：竣工签字 → 审核报价 → 结算' },
    { key: 'cycle', label: '全周期（登记→完工）', from: 'inDate', to: 'completeDate', type: 'both', hint: '流程图 1→3 / 2→4 全链路' }
  ];

  function nodeTimeliness(records, period, opts) {
    opts = opts || {};
    var scope = opts.all ? records : records.filter(function (r) { return inPeriod(period, r.inDate); });
    return NODE_DEFS.map(function (def) {
      var spans = [];
      scope.forEach(function (r) {
        if (def.type !== 'both' && def.type !== r._type) return;
        var a = r[def.from] || (def.fallbackFrom ? r[def.fallbackFrom] : null);
        var b = r[def.to];
        if (!a || !b) return;
        var d = dayDiff(a, b);
        if (d < 0 || d > 3650) return;
        spans.push(d);
      });
      spans.sort(function (x, y) { return x - y; });
      var sum = spans.reduce(function (s, v) { return s + v; }, 0);
      return {
        key: def.key, label: def.label, hint: def.hint, type: def.type,
        samples: spans.length, missing: scope.length - spans.length,
        avg: spans.length ? sum / spans.length : 0,
        median: spans.length ? (spans.length % 2 ? spans[(spans.length - 1) / 2] : (spans[spans.length / 2 - 1] + spans[spans.length / 2]) / 2) : 0,
        max: spans.length ? spans[spans.length - 1] : 0,
        overdue: spans.filter(function (v) { return v > (opts.threshold || 7); }).length
      };
    });
  }

  // ===== 6. 趋势与人效 =====
  function trend(records, kind, count, anchor, cfg) {
    var p = periodOf(anchor || new Date(), kind);
    var out = [];
    for (var i = count - 1; i >= 0; i--) {
      var pp = prevPeriod(p, i);
      var a = aggregate(records, pp, cfg);
      out.push({
        key: pp.key, label: pp.label, short: shortLabel(pp),
        orders: a.orders, completed: a.completed, revenue: a.revenue,
        completionRate: a.completionRate, perCapitaOutput: a.perCapitaOutput
      });
    }
    return out;
  }

  function shortLabel(p) {
    if (p.kind === 'day') return p.start.slice(5);
    if (p.kind === 'week') return p.start.slice(5) + '周';
    return (p.startDate.getMonth() + 1) + '月';
  }

  function engineerRanking(records, period, cfg) {
    var inP = function (d) { return inPeriod(period, d); };
    var m = {};
    records.forEach(function (r) {
      var name = r.engineer || '未指派';
      if (!m[name]) m[name] = { name: name, orders: 0, completed: 0, revenue: 0, spans: [], complaints: 0 };
      var e = m[name];
      if (inP(r.inDate)) e.orders++;
      if (inBucket(r._type, r.status, 'done') && inP(r.completeDate || r.attrDate)) {
        e.completed++;
        e.revenue += r.revenue;
      }
      if (r.startDate && r.completeDate) {
        var d = dayDiff(r.startDate, r.completeDate);
        if (d >= 0 && d <= 3650) e.spans.push(d);
      }
    });
    var list = Object.keys(m).map(function (k) { return m[k]; });
    list.forEach(function (e) {
      e.completionRate = e.orders > 0 ? e.completed / e.orders : 0;
      e.avgRepair = e.spans.length ? e.spans.reduce(function (s, v) { return s + v; }, 0) / e.spans.length : 0;
      delete e.spans;
    });
    list.sort(function (a, b) { return b.revenue - a.revenue || b.completed - a.completed; });
    return list;
  }

  // ===== 7. 数据完备度（用于提示口径风险）=====
  function completeness(records) {
    var defs = [
      { key: 'inDate', label: '建单/需求日期' },
      { key: 'startDate', label: '开工日期' },
      { key: 'completeDate', label: '完工/成交日期' },
      { key: 'engineer', label: '责任工程师' },
      { key: 'revenue', label: '产值金额', numeric: true }
    ];
    var n = records.length || 1;
    return defs.map(function (d) {
      var c = records.filter(function (r) {
        var v = r[d.key];
        if (d.numeric) return num(v) > 0;
        if (v instanceof Date) return true;
        return !!v;
      }).length;
      return { key: d.key, label: d.label, filled: c, total: records.length, rate: c / n };
    });
  }

  var RPT = {
    VERSION: VERSION,
    WEEK_START_DOW: WEEK_START_DOW,
    FIELDS: FIELDS,
    STATUS_BUCKET: STATUS_BUCKET,
    NODE_DEFS: NODE_DEFS,
    KPI_ROWS: KPI_ROWS,
    isBlank: isBlank, num: num, parseDate: parseDate, ymd: ymd, addDays: addDays, dayDiff: dayDiff,
    periodOf: periodOf, prevPeriod: prevPeriod, nextPeriod: nextPeriod, inPeriod: inPeriod,
    pct: pct, canonStatus: canonStatus, inBucket: inBucket,
    normalize: normalize, normalizeAll: normalizeAll,
    aggregate: aggregate, kpiTable: kpiTable,
    nodeTimeliness: nodeTimeliness, trend: trend, engineerRanking: engineerRanking,
    completeness: completeness, countBy: countBy
  };

  root.RPT = RPT;
  if (typeof module !== 'undefined' && module.exports) module.exports = RPT;
})(typeof globalThis !== 'undefined' ? globalThis : this);
