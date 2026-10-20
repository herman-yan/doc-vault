const A = require('../assets/aftersales-guardrails.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('  FAIL: ' + name + (extra ? '  -> ' + extra : '')); }
}
function group(t) { console.log('\n== ' + t); }

const goodQC = () => ({
  items: A.QC_CODES.map(c => ({ code: c, passed: true })),
  insulationMohm: 1200, capacityRecoveryPct: 97.5, voltageDrop72hMv: 12
});
const tech = { name: '刘珍', role: 'TECHNICIAN' };
const lead = { name: '罗永豪', role: 'TECHNICIAN' };
const qi = { name: '马迪', role: 'QUALITY_INSPECTOR' };
const rep = { name: '周字欢', role: 'REPORTER' };
const disp = { name: '王鹏', role: 'DISPATCHER' };
const fin = { name: '赵轩', role: 'FINANCE' };
const aud = { name: '闫', role: 'AUDITOR' };

group('1. 保内状态机全链路（含新补的三级质检与断链终态）');
let o = { id: 'WN-000001', _flowKind: 'WN', status: '未派工', customerName: 'X', audit: [] };
ok('未派工可派单且不可开工', A.actionable('WN', o, disp).map(t => t.action).indexOf('dispatch') >= 0 && A.actionable('WN', o, disp).map(t => t.action).indexOf('start') < 0);
ok('派单缺工程师被拒', A.applyTransition(o, { action: 'dispatch', label: '派单', to: '未开工', roles: ['DISPATCHER'] }, disp, {}).ok === false);
ok('派单成功', A.applyTransition(o, A.allowedTransitions('WN', '未派工')[0], disp, { engineer: '刘珍', requestId: 'r1' }).ok);
o.engineer = '刘珍';
ok('开工->在修', A.applyTransition(o, A.allowedTransitions('WN', '未开工')[0], tech, {}).ok);
const selfT = A.allowedTransitions('WN', '在修').find(t => t.action === 'self_check');
o.status = '在修';
ok('自检缺质检清单被拒', A.applyTransition(o, selfT, tech, { qc: { items: [], insulationMohm: 1 } }).ok === false);
ok('自检通过->待班组复检', A.applyTransition(o, selfT, tech, { qc: goodQC(), requestId: 'r2' }).ok);
ok('自检留痕带模板版本', o.qc.self.templateVersion === A.QC_TEMPLATE_VERSION);
ok('同一人不能复检(责任分离)', A.applyTransition(o, A.allowedTransitions('WN', '待班组复检')[0], tech, {}).ok === false);
ok('换班组长复检通过', A.applyTransition(o, A.allowedTransitions('WN', '待班组复检')[0], lead, {}).ok);
const finalT = A.allowedTransitions('WN', '待质检终检').find(t => t.action === 'final_pass');
ok('终检只允许专职质检员', A.applyTransition(o, finalT, disp, {}).ok === false);
ok('终检通过->已竣工', A.applyTransition(o, finalT, qi, {}).ok);
ok('结算->已结算', A.applyTransition(o, A.allowedTransitions('WN', '已竣工')[0], rep, {}).ok);
ok('补上的结清->已结清', A.applyTransition(o, A.allowedTransitions('WN', '已结算')[0], rep, {}).ok);
ok('终态无终止入口', A.allowedTransitions('WN', '已结清').length === 0);
ok('审计链完整 7 步', o.audit.length === 7, 'got ' + o.audit.length);
ok('审计含岗位与请求号', o.audit[0].roleLabel === '调度' && o.audit[0].requestId === 'r1');

group('2. 幂等：相同请求号不重复入账');
let o2 = { id: 'WN-2', _flowKind: 'WN', status: '未派工', audit: [] };
const dT = A.allowedTransitions('WN', '未派工')[0];
ok('首次提交成功', A.applyTransition(o2, dT, disp, { engineer: '刘珍', requestId: 'same' }).ok);
const dup = A.applyTransition(o2, dT, disp, { engineer: '刘珍', requestId: 'same' });
ok('重复提交被拒且标记 duplicate', dup.ok === false && dup.duplicate === true);
ok('重复提交未追加审计', o2.audit.length === 1);

group('3. 终止流转：必填原因，且只允许非终态');
let o3 = { id: 'WN-3', _flowKind: 'WN', status: '在修', audit: [] };
const cancelT = A.allowedTransitions('WN', '在修').find(t => t.action === 'cancel');
ok('存在终止入口(原实现缺失)', !!cancelT);
ok('终止缺原因被拒', A.applyTransition(o3, cancelT, disp, {}).ok === false);
ok('带原因终止成功', A.applyTransition(o3, cancelT, disp, { reason: '客户撤单' }).ok && o3.status === '已终止');

group('4. 只读岗位与驳回回环');
let o4 = { id: 'WN-4', _flowKind: 'WN', status: '待质检终检', qc: { self: { name: '刘珍' } }, audit: [] };
ok('监管员无可执行动作', A.actionable('WN', o4, aud).length === 0);
ok('质检员可技术否决', A.applyTransition(o4, A.allowedTransitions('WN', '待质检终检').find(t => t.action === 'reject'), qi, { reason: '扭矩标记缺失' }).ok);
ok('驳回到 驳回待重检', o4.status === '驳回待重检');
ok('驳回后可重新自检', A.applyTransition(o4, A.allowedTransitions('WN', '驳回待重检')[0], tech, { qc: goodQC() }).ok);
ok('老数据无自检时终检被阻断', A.applyTransition({ id: 'WN-5', _flowKind: 'WN', status: '待质检终检', audit: [] }, finalT, qi, {}).ok === false);

group('5. 结构化质检 11 项与数值门槛');
ok('完整清单通过', A.validateQC(goodQC()).ok);
let bad = goodQC(); bad.items = bad.items.slice(0, 10);
ok('少一项被拒', A.validateQC(bad).ok === false);
let dupi = goodQC(); dupi.items[3] = Object.assign({}, dupi.items[2]);
ok('重复码被拒', A.validateQC(dupi).ok === false);
let unk = goodQC(); unk.items[0] = { code: 'whatever', passed: true };
ok('未知码被拒', A.validateQC(unk).ok === false);
let unpassed = goodQC(); unpassed.items[5].passed = false;
ok('有未通过项即拒', A.validateQC(unpassed).ok === false);
let low = goodQC(); low.capacityRecoveryPct = 90;
ok('容量恢复率 90% 低于 95 被拒', A.validateQC(low).ok === false);
let high = goodQC(); high.voltageDrop72hMv = 40;
ok('72h 压降 40mV 超 30 被拒', A.validateQC(high).ok === false);
let nan = goodQC(); nan.insulationMohm = '';
ok('绝缘阻值缺失被拒', A.validateQC(nan).ok === false);

group('6. 岗位可见范围（lhrj 口径）');
const mixed = [
  { id: 'A', engineer: '刘珍', status: '已结算', _type: '保内' },
  { id: 'B', engineer: '罗永豪', status: '已结算', _type: '保外' },
  { id: 'C', engineer: '刘珍', status: '在修', _type: '保外' }
];
ok('技师只看指派给自己的', A.visibleOrders('TECHNICIAN', mixed, tech).map(x => x.id).join() === 'A,C');
ok('财务排除保内且排除在修', A.visibleOrders('FINANCE', mixed, fin).map(x => x.id).join() === 'B');
ok('库管只看关联采购单', A.visibleOrders('WAREHOUSE', mixed, { name: 'x', role: 'WAREHOUSE' }, { B: true }).map(x => x.id).join() === 'B');
ok('调度可见全量', A.visibleOrders('DISPATCHER', mixed, disp).length === 3);
ok('财务看不到未识别岗位文案缺失', A.roleLabel('FINANCE') === '财务' && A.roleLabel('BOGUS') === 'BOGUS');

group('7. 页面级权限');
ok('技师无导出页', A.canPage('TECHNICIAN', 'export') === false);
ok('财务无保内页', A.canPage('FINANCE', 'warranty') === false);
ok('管理员全开', A.canPage('ADMIN', 'engineers') && A.canPage('ADMIN', 'oldparts'));

group('8. 旧件生命周期');
let lot = { id: 'OP-1', _flowKind: 'OLDPART', status: '待接收', audit: [] };
const wh = { name: '库房甲', role: 'WAREHOUSE' };
const wh2 = { name: '库房乙', role: 'WAREHOUSE' };
const qi2 = { name: '马迪', role: 'QUALITY_INSPECTOR' };
ok('待接收->待核验', A.applyTransition(lot, A.allowedTransitions('OLDPART', '待接收')[0], wh, {}).ok);
ok('接收人已记录', lot.receivedBy === '库房甲');
ok('核验四种出口齐备', A.allowedTransitions('OLDPART', '待核验').map(t => t.action).sort().join() === 'scrap,verify_damaged,verify_ok,verify_wrong');
ok('接收人不能核验自己的批次(责任分离)', A.applyTransition(lot, A.allowedTransitions('OLDPART', '待核验').find(t => t.action === 'verify_ok'), wh, {}).ok === false);
ok('核验合格->旧件释放可用', A.applyTransition(lot, A.allowedTransitions('OLDPART', '待核验').find(t => t.action === 'verify_ok'), qi2, {}).ok && lot.status === '旧件释放可用');
let lot2 = { id: 'OP-2', _flowKind: 'OLDPART', status: '待核验', audit: [] };
const scrapT = A.allowedTransitions('OLDPART', '待核验').find(t => t.action === 'scrap');
let lot3 = { id: 'OP-3', _flowKind: 'OLDPART', status: '待核验', audit: [] };
ok('历史回填批次无接收人，允许核验', A.applyTransition(lot3, A.allowedTransitions('OLDPART', '待核验').find(t => t.action === 'verify_wrong'), wh, {}).ok && lot3.status === '拒收回库');
ok('报废需调度/管理员且要原因', A.applyTransition(lot2, scrapT, wh, {}).ok === false);
ok('报废需原因', A.applyTransition(lot2, scrapT, disp, {}).ok === false);
ok('带原因报废成功', A.applyTransition(lot2, scrapT, disp, { reason: '客户放弃' }).ok);
ok('终态出口后无可执行动作', A.actionable('OLDPART', lot2, disp).length === 0);

group('9. 导入去重合并（空值不覆盖）');
const exist = [{ id: 'NW-1', vin: 'LSGAB52L7TD000001', signedCustomer: '甲公司', customerName: '张三', plateNumber: '京A12345', quoteTotal: '5000', engineer: '刘珍' }];
const inc = [
  { vin: 'lsgab52l7td000001', signedCustomer: '甲公司', customerName: '张三', plateNumber: '京A12345', quoteTotal: '6800', engineer: '' },
  { vin: 'NEWVIN0000000000000', signedCustomer: '乙公司', customerName: '李四', plateNumber: '京B99999', quoteTotal: '100' }
];
const r = A.mergeImport(exist, inc, A.nwMatchKey);
ok('新增 1 更新 1', r.added.length === 1 && r.updated.length === 1, r.summary);
ok('金额被更新', exist[0].quoteTotal === '6800');
ok('空值不覆盖已有工程师', exist[0].engineer === '刘珍');
ok('VIN 大小写归一后命中同一人', r.preview[0].mode === '更新');
const r2 = A.mergeImport(exist, [Object.assign({}, inc[0])], A.nwMatchKey);
ok('完全重复导入变为无变化（幂等）', r2.added.length === 0 && r2.updated.length === 0 && r2.unchanged.length === 1);
ok('批次内自身重复不产生两条', A.mergeImport([], [inc[1], JSON.parse(JSON.stringify(inc[1]))], A.nwMatchKey).unchanged.length === 1);

group('10. 状态归一与活跃口径');
ok('认不出的状态原样保留（交异常治理，不静默改写）', A.normalizeStatus('WN', '垃圾值') === '垃圾值' && A.isKnownStatus('WN', '垃圾值') === false);
ok('合法状态识别', A.isKnownStatus('WN', '在修') === true);
ok('旧口径 关闭工单 归一为已结清', A.normalizeStatus('WN', '关闭工单') === '已结清');
ok('保外旧口径 关闭工单 归一为已关单（不误计为活跃）', A.normalizeStatus('NW', '关闭工单') === '已关单' && A.isActive('NW', '关闭工单') === false);
ok('旧口径记录取动作时先归一', A.allowedTransitions('WN', '关闭工单').length === 0);
ok('活跃判定', A.isActive('WN', '在修') === true && A.isActive('WN', '已终止') === false);
ok('门户口径统一：活跃=非终态', ['已结清', '已终止'].every(s => !A.isActive('WN', s)));
ok('跨态跳跃被拒（在修不能直接结算）', A.applyTransition({ id: 'WN-9', _flowKind: 'WN', status: '在修', audit: [] }, A.allowedTransitions('WN', '已竣工')[0], rep, {}).illegal === true);

console.log('\n----------------------------------------');
console.log('PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
