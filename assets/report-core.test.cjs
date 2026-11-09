/*
 * report-core 单元测试（Node，无外部依赖）
 * 运行：node report-core.test.cjs
 */
'use strict';
var RPT = require('./report-core.js');
var path = require('path');
var fs = require('fs');

var pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.log('  ✗ ' + msg); } }
function eq(a, b, msg) { ok(a === b, msg + '  (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function near(a, b, msg, tol) { tol = tol === undefined ? 1e-6 : tol; ok(Math.abs(a - b) <= tol, msg + '  (got ' + a + ', want ' + b + ')'); }
function sec(t) { console.log('\n== ' + t + ' =='); }

// ---------- 1. 日期解析 ----------
sec('parseDate 多格式兼容');
eq(RPT.ymd(RPT.parseDate('2026-03-15')), '2026-03-15', 'ISO 横线');
eq(RPT.ymd(RPT.parseDate('2026.01.01')), '2026-01-01', '点分隔（保外实际格式）');
eq(RPT.ymd(RPT.parseDate('2026/1/1')), '2026-01-01', '斜杠 + 单位数');
eq(RPT.ymd(RPT.parseDate('2026年1月1日')), '2026-01-01', '中文年月日');
eq(RPT.parseDate('无'), null, '占位词「无」→ null');
eq(RPT.parseDate(''), null, '空串 → null');
eq(RPT.parseDate('-'), null, '占位符「-」→ null');
eq(RPT.parseDate('2026-13-01'), null, '非法月份 → null');
eq(RPT.parseDate('2026-02-30'), null, '非法日 → null');
eq(RPT.ymd(RPT.parseDate(new Date(2026, 6, 4))), '2026-07-04', 'Date 对象');
eq(RPT.ymd(RPT.parseDate(46207)), '2026-07-04', 'Excel 序列号');

// ---------- 2. 周期口径 ----------
sec('周期口径：周日至周六（对齐 0706 周报样本 6/28~7/4）');
var wk = RPT.periodOf('2026-07-04', 'week');
eq(wk.start, '2026-06-28', '周六锚点 → 周日开始');
eq(wk.end, '2026-07-04', '周六锚点 → 周六结束');
eq(wk.kind, 'week', 'kind=week');
var wk2 = RPT.periodOf('2026-06-28', 'week');
eq(wk2.start, '2026-06-28', '周日锚点 → 同一天开始');
eq(wk2.end, '2026-07-04', '周日锚点 → 周六结束');
var wk3 = RPT.periodOf('2026-07-01', 'week');
eq(wk3.start, '2026-06-28', '周中锚点（周三）→ 回溯到周日');
eq(RPT.periodOf('2026-07-01', 'week').key, '2026-06-28', 'week key 为开始日');
var d = RPT.periodOf('2026-07-04', 'day');
eq(d.start, '2026-07-04', 'day 周期');
var mo = RPT.periodOf('2026-07-04', 'month');
eq(mo.start, '2026-07-01', 'month 开始 = 1 号');
eq(mo.end, '2026-07-31', 'month 结束 = 月末');
eq(RPT.periodOf('2026-02-10', 'month').end, '2026-02-28', '平年 2 月末');
eq(RPT.periodOf('2024-02-10', 'month').end, '2024-02-29', '闰年 2 月末');

sec('前后周期');
eq(RPT.prevPeriod(wk, 1).start, '2026-06-21', '上周开始');
eq(RPT.prevPeriod(wk, 1).end, '2026-06-27', '上周结束');
eq(RPT.nextPeriod(wk, 1).start, '2026-07-05', '下周开始');
eq(RPT.prevPeriod(mo, 1).start, '2026-06-01', '上月');
eq(RPT.prevPeriod(mo, 1).end, '2026-06-30', '上月末');
eq(RPT.prevPeriod(RPT.periodOf('2026-01-05', 'month'), 1).start, '2025-12-01', '跨年上月');

sec('inPeriod 边界');
var p = RPT.periodOf('2026-07-04', 'week');
ok(RPT.inPeriod(p, RPT.parseDate('2026-06-28')), '含开始日');
ok(RPT.inPeriod(p, RPT.parseDate('2026-07-04')), '含结束日');
ok(!RPT.inPeriod(p, RPT.parseDate('2026-06-27')), '不含前一日');
ok(!RPT.inPeriod(p, RPT.parseDate('2026-07-05')), '不含后一日');
ok(!RPT.inPeriod(p, null), 'null 不在周期内');

// ---------- 3. 环比 ----------
sec('环比计算');
near(RPT.pct(100, 50), 1, '翻倍 → +100%');
near(RPT.pct(50, 100), -0.5, '腰斩 → -50%');
eq(RPT.pct(0, 0), 0, '0→0 记为 0');
eq(RPT.pct(10, 0), null, '上期为 0 → null（不报无穷）');
eq(RPT.pct(null, 5), null, '本期缺失 → null');
eq(RPT.pct(5, null), null, '上期缺失 → null');
eq(RPT.pct(undefined, 5), null, 'undefined → null');

// ---------- 4. 状态归桶 ----------
sec('状态归桶与历史别名');
eq(RPT.canonStatus('NW', '关闭工单'), '已关单', '保外旧口径 关闭工单 → 已关单');
eq(RPT.canonStatus('NW', '维修中'), '在修', '保外「维修中」→ 在修');
ok(RPT.inBucket('WN', '已竣工', 'done'), '保内已竣工 ∈ done');
ok(RPT.inBucket('WN', '已结清', 'settled'), '保内已结清 ∈ settled');
ok(RPT.inBucket('WN', '已竣工', 'settled') === false, '已竣工 ∉ settled（未结算）');
ok(RPT.inBucket('WN', '未派工', 'pending'), '保内未派工 ∈ pending');
ok(RPT.inBucket('NW', '维修完成', 'done'), '保外维修完成 ∈ done');
ok(RPT.inBucket('NW', '待客户确认', 'pending'), '保外待客户确认 ∈ pending');
ok(RPT.inBucket('WN', '已终止', 'terminated'), '已终止 ∈ terminated');
ok(RPT.inBucket('WN', '已终止', 'done') === false, '已终止 ∉ done');

// ---------- 5. 数值清洗 ----------
sec('数值清洗');
eq(RPT.num('1,234.56'), 1234.56, '去千分位');
eq(RPT.num('¥ 500 元'), 500, '去货币符号与单位');
eq(RPT.num('无'), 0, '占位词 → 0');
eq(RPT.num(''), 0, '空 → 0');
eq(RPT.num(null), 0, 'null → 0');
eq(RPT.num('0.0'), 0, '0.0 → 0');
eq(RPT.num('abc'), 0, '非数字 → 0');
eq(RPT.num(31189.85), 31189.85, '数字直通');

// ---------- 6. 聚合：构造可控样本 ----------
sec('aggregate 15 项指标（构造样本）');
var mk = function (o) { return o; };
var WN = [
  // 建单在周期内、已竣工有产值
  mk({ id: 'W1', registerDate: '2026-06-29', startDate: '2026-06-30', completeDate: '2026-07-01', submitDate: '2026-07-02', orderSubmitDate: '2026-07-03', engineer: '张三', status: '已竣工', totalFee: '1000', reporter: 'A' }),
  // 建单在周期内、在修
  mk({ id: 'W2', registerDate: '2026-06-30', startDate: '2026-07-01', engineer: '李四', status: '在修', totalFee: '0' }),
  // 建单在周期内、未派工
  mk({ id: 'W3', registerDate: '2026-07-01', engineer: '', status: '未派工' }),
  // 建单在周期内、已结清（含结算日）
  mk({ id: 'W4', registerDate: '2026-06-28', startDate: '2026-06-29', completeDate: '2026-07-03', engineer: '张三', status: '已结清', totalFee: '2000' }),
  // 建单在周期外（应被排除出接单）
  mk({ id: 'W5', registerDate: '2026-06-01', completeDate: '2026-06-02', engineer: '王五', status: '已竣工', totalFee: '5000' }),
  // 已终止
  mk({ id: 'W6', registerDate: '2026-07-02', engineer: '张三', status: '已终止' })
];
var NW = [
  mk({ seq: '1', requestDate: '2026.06.29', dealDate: '2026-07-02', repairEngineer: '赵六', status: '维修完成', laborFee: '300', partsSale: '200', receivedAmount: '500', paymentDate: '2026-07-03' }),
  mk({ seq: '2', requestDate: '2026.07.01', repairEngineer: '赵六', status: '待客户确认', quoteTotal: '800' }),
  mk({ seq: '3', requestDate: '2026.05.01', dealDate: '2026-05-10', repairEngineer: '孙七', status: '已关单', laborFee: '100', partsSale: '100', receivedAmount: '200', paymentDate: '2026-05-20' })
];
var recs = RPT.normalizeAll(WN, NW);
eq(recs.length, 9, '归一化条数');
var agg = RPT.aggregate(recs, p, { headcount: 36, engineers: 24, valueAdded: { '2026-06-28': 100 } });

// 周期内建单：W1,W2,W3,W4,W6（保内 5）+ NW1,NW2（保外 2）= 7
eq(agg.orders, 7, '接单数=周期内建单 7');
eq(agg.ordersWn, 5, '保内接单 5');
eq(agg.ordersNw, 2, '保外接单 2');
eq(agg.completed, 3, '完成数=周期内竣工（W1,W4,NW1）');
eq(agg.revenueWn, 3000, '保内产值 1000+2000');
eq(agg.revenueNw, 500, '保外产值 300+200');
eq(agg.revenue, 3500, '竣工产值合计');
eq(agg.completionRate, 3 / 7, '完成率 = 完成/接单', 1e-6);
eq(agg.settledCount, 1, '已结算=周期内结算（仅 W4 已结清）');
eq(agg.doneUnsettled, 3, '已竣工未结算=台账当前态（W1 已竣工 + W5 已竣工 + NW1 维修完成）');
eq(agg.valueAdded, 100, '增值产值');
eq(agg.totalOutput, 3600, '总产值 = 竣工 + 增值');
near(agg.perCapitaOutput, 3600 / 36, '人均产值');
eq(agg.monthReceived, 500, '当月累计回款（7月保外回款：NW1 500）');
eq(agg.wnPendingSettle, 6000, '保内待结算金额（W1 1000 + W5 5000，均为已竣工未结算）');
eq(agg.received, 500, '周期内保外回款');
eq(agg.activeNow, 1, '当前在修（W2）');
eq(agg.pendingNow, 2, '当前待派工（W3 + NW2 待客户确认）');
eq(agg.terminated, 1, '已终止 1');
near(agg.perCapitaOrders, 7 / 24, '人均接单 = 接单/工程师数');

sec('aggregate 空周期不报错');
var emptyAgg = RPT.aggregate(recs, RPT.periodOf('2020-01-01', 'week'), { headcount: 36, engineers: 24 });
eq(emptyAgg.orders, 0, '空周期接单 0');
eq(emptyAgg.completionRate, 0, '除零保护 → 0');
eq(emptyAgg.perCapitaOrders, 0, '工程师数为分母保护');
eq(emptyAgg.revenue, 0, '空周期产值 0');

sec('aggregate 缺人力配置不报错');
var noCfg = RPT.aggregate(recs, p, {});
eq(noCfg.headcount, 0, 'headcount 缺省 0');
eq(noCfg.perCapitaOutput, 0, '人均产值除零保护');

// ---------- 7. KPI 表 ----------
sec('kpiTable 15 项');
var prevAgg = RPT.aggregate(recs, RPT.prevPeriod(p, 1), { headcount: 36, engineers: 24 });
var tbl = RPT.kpiTable(agg, prevAgg);
eq(tbl.length, 15, 'KPI 行数 = 15');
eq(tbl[0].label, '站内总人数', '第 1 项');
eq(tbl[2].label, '本周总接单数（宁德）', '第 3 项');
eq(tbl[6].label, '本周竣工已结算产值', '第 7 项');
eq(tbl[10].label, '人均产值', '第 11 项');
eq(tbl[14].label, '当前 GSS 绩效评分', '第 15 项');
ok(tbl[5].ratio === true, '完成率标记为比率型');
eq(tbl[2].current, 7, '接单数当前值');
eq(tbl[2].previous, 0, '上周接单数 0（W5=6/01、NW3=5/01 均不在 6/21~6/27）');
eq(tbl[2].change, null, '上期为 0 → 环比 null，展示层渲染为「—」');
// 补一条上周建单，验证环比可算
var recs2 = RPT.normalizeAll(WN.concat([mk({ id: 'W7', registerDate: '2026-06-22', engineer: '王五', status: '未派工' })]), NW);
var agg2 = RPT.aggregate(recs2, p, { headcount: 36, engineers: 24 });
var tbl2 = RPT.kpiTable(agg2, RPT.aggregate(recs2, RPT.prevPeriod(p, 1), { headcount: 36, engineers: 24 }));
eq(tbl2[2].current, 7, '补数后当期接单仍 7');
eq(tbl2[2].previous, 1, '补数后上周接单 1');
near(tbl2[2].change, 6, '补数后环比 +600%');

// ---------- 8. 节点时效 ----------
sec('nodeTimeliness 流程节点');
var nodes = RPT.nodeTimeliness(recs, p, { threshold: 2 });
var byKey = {};
nodes.forEach(function (n) { byKey[n.key] = n; });
eq(nodes.length, 5, '5 个节点定义');
ok(byKey.intake.samples > 0, '接单响应有样本');
eq(byKey.intake.samples, 3, '接单响应样本数（W1,W2,W4）');
near(byKey.intake.avg, (1 + 1 + 1) / 3, '接单响应均值 1 天');
eq(byKey.intake.overdue, 0, '阈值 2 天内无超期');
eq(byKey.repair.samples, 3, '维修时长样本数');
near(byKey.repair.avg, (1 + 4 + 3) / 3, '维修时长均值');
eq(byKey.report.type, 'WN', '报单时长仅保内');
eq(byKey.report.samples, 1, '报单时长样本（W1）');
eq(byKey.settle.type, 'NW', '结算时长仅保外');
eq(byKey.settle.samples, 1, '结算时长样本（NW1）');
ok(byKey.cycle.samples >= 3, '全周期样本');

sec('nodeTimeliness 缺日期不计入且不报错');
var sparse = RPT.normalizeAll([{ id: 'X', registerDate: '2026-06-29', status: '在修' }], []);
var sn = RPT.nodeTimeliness(sparse, p, {});
eq(sn[0].samples, 0, '缺开工日 → 0 样本');
eq(sn[0].avg, 0, '0 样本均值 0');
eq(sn[0].missing, 1, '记录缺项数');

// ---------- 9. 趋势 ----------
sec('trend 多周期序列');
var tr = RPT.trend(recs, 'week', 4, '2026-07-04', { headcount: 36, engineers: 24 });
eq(tr.length, 4, '返回 4 个周期');
eq(tr[3].key, '2026-06-28', '末项为当前周期');
eq(tr[0].key, '2026-06-07', '首项为 3 周前');
eq(tr[3].orders, 7, '当前周期接单数');
eq(tr[3].completed, 3, '当前周期完成数');
ok(typeof tr[3].completionRate === 'number', '完成率为数值');
var trM = RPT.trend(recs, 'month', 3, '2026-07-04', {});
eq(trM.length, 3, '月趋势 3 期');
eq(trM[2].key, '2026-07-01', '末项当月');
var trD = RPT.trend(recs, 'day', 3, '2026-07-04', {});
eq(trD.length, 3, '日趋势 3 期');
eq(trD[2].key, '2026-07-04', '末项当日');

// ---------- 10. 人效排名 ----------
sec('engineerRanking');
var rank = RPT.engineerRanking(recs, p, {});
var rk = {};
rank.forEach(function (e) { rk[e.name] = e; });
eq(rank[0].name, '张三', '按产值排序首位=张三(3000)');
eq(rk['张三'].revenue, 3000, '张三产值');
eq(rk['张三'].completed, 2, '张三完成 2');
eq(rk['赵六'].revenue, 500, '赵六产值');
near(rk['张三'].avgRepair, (1 + 4) / 2, '张三平均维修时长');
ok(rk['未指派'] !== undefined, '未指派归入独立分组');

// ---------- 11. 完备度 ----------
sec('completeness 数据完备度');
var comp = RPT.completeness(recs);
eq(comp.length, 5, '5 项检查');
var cm = {};
comp.forEach(function (c) { cm[c.key] = c; });
eq(cm.inDate.total, 9, '总条数');
ok(cm.inDate.rate > 0.9, '建单日期完备率高');
ok(cm.startDate.rate < cm.inDate.rate, '开工日期完备率低于建单日期');

// ---------- 12. 真实数据回归 ----------
sec('真实台账回归（data_wn.json + data_nw.json）');
var base = path.join(__dirname, '..', 'work-order');
var wnReal = JSON.parse(fs.readFileSync(path.join(base, 'data_wn.json'), 'utf8'));
var nwReal = JSON.parse(fs.readFileSync(path.join(base, 'data_nw.json'), 'utf8'));
eq(wnReal.length, 1018, '保内真实条数 1018');
eq(nwReal.length, 400, '保外真实条数 400');
var realRecs = RPT.normalizeAll(wnReal, nwReal);
eq(realRecs.length, 1418, '归一化总数 1418');
var realIn = realRecs.filter(function (r) { return r.inDate; }).length;
ok(realIn > 1100, '可解析建单日期 > 1100（实际 ' + realIn + '）');
var realDone = realRecs.filter(function (r) { return RPT.inBucket(r._type, r.status, 'done'); }).length;
eq(realDone, 890, '竣工态 = 保内(549已竣工+124已结算+44已结清) + 保外(168维修完成+5已关单)');
var realSettled = realRecs.filter(function (r) { return RPT.inBucket(r._type, r.status, 'settled'); }).length;
eq(realSettled, 173, '已结算态 = 保内124+44 + 保外5');

// 保外历史状态「维修中」应归一为「在修」
var legacyRenamed = realRecs.filter(function (r) { return r._type === 'NW' && r.statusRaw === '维修中'; }).length;
eq(legacyRenamed, 10, '保外「维修中」10 条已归一到在修');
ok(realRecs.filter(function (r) { return r._type === 'NW' && r.statusRaw === '维修中' && r.status === '在修'; }).length === 10, '归一结果确为「在修」');

// 全周期产值在合理区间（真实数据 revenue 为 0 的工单较多，只校验非负与有限）
var realAgg = RPT.aggregate(realRecs, RPT.periodOf('2026-07-04', 'week'), { headcount: 36, engineers: 24 });
ok(isFinite(realAgg.revenue) && realAgg.revenue >= 0, '真实周期产值有限且非负');
ok(realAgg.orders >= 0, '真实接单数非负');
ok(realAgg.completionRate >= 0 && realAgg.completionRate <= 3, '完成率在合理区间');

// 全量时间跨度覆盖（真实数据跨 2026-01 ~ 2026-08）
var months = {};
realRecs.forEach(function (r) { if (r.inDate) months[RPT.ymd(r.inDate).slice(0, 7)] = 1; });
ok(Object.keys(months).length >= 6, '真实数据覆盖 ≥6 个月（实际 ' + Object.keys(months).length + '）');

var realNodes = RPT.nodeTimeliness(realRecs, RPT.periodOf('2026-07-04', 'week'), {});
eq(realNodes.length, 5, '真实数据节点计算不报错');
realNodes.forEach(function (n) { ok(isFinite(n.avg) && n.avg >= 0, '节点 ' + n.key + ' 均值有限'); });

var realRank = RPT.engineerRanking(realRecs, RPT.periodOf('2026-07-04', 'week'), {});
ok(realRank.length > 5, '真实工程师排名 > 5 人（实际 ' + realRank.length + '）');

// 性能：全量多周期聚合
sec('性能');
var t0 = Date.now();
for (var i = 0; i < 12; i++) RPT.aggregate(realRecs, RPT.prevPeriod(RPT.periodOf('2026-07-04', 'week'), i), { headcount: 36, engineers: 24 });
var dt = Date.now() - t0;
ok(dt < 3000, '12 周期全量聚合 < 3s（实际 ' + dt + 'ms）');

console.log('\n' + '='.repeat(52));
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('='.repeat(52));
process.exit(fail ? 1 : 0);
