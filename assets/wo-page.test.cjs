/*
 * work-order/index.html 页面级流程回归：保内/保外状态机、三级质检闸门、责任分离、
 * 断链终态（结清/终止）、岗位可见范围、只读岗位、历史状态归一、留痕与落盘。
 * 运行：node assets/wo-page.test.cjs
 */
const { loadPage, group, ok, report } = require('./page-harness.cjs');
const A = require('./aftersales-guardrails.js');

const HANDLES = {
  read: ['APP', 'ME', 'currentPage'],
  write: ['ME', 'currentPage'],
  fns: ['renderPage', 'switchPage', 'afCommit', 'afOpenAction', 'afConfirmAction', 'afOpenQcModal', 'afSubmitQc',
    'afActionButtons', 'afWarranty', 'afNonWarranty', 'renderWarrantyList', 'renderNonWarrantyList',
    'confirmDispatchWarranty', 'confirmSettleWarranty', 'afApplyNavPermission', 'viewWarranty', 'afScopeHint',
    'afNormalizeIncoming', 'afAssignIncomingStatus', 'afMergeInto', 'afStatusPill']
};

const seedData = {
  warrantyOrders: [
    { id: 'WN-000001', registerDate: '2026-10-10', customerName: '测试客户甲', vehicleInfo: '京A00001 / 车型X', faultDesc: 'CTP箱体进水', status: '未派工', engineer: '', reporter: '' },
    { id: 'WN-000002', registerDate: '2026-10-11', customerName: '测试客户乙', vehicleInfo: '京A00002 / 车型Y', faultDesc: '水冷板渗漏', status: '在修', engineer: '罗永豪', reporter: '' },
    { id: 'WN-000003', registerDate: '2026-09-01', customerName: '历史客户', vehicleInfo: '京A00003', faultDesc: '旧口径数据', status: '关闭工单', engineer: '刘珍', reporter: '周字欢' }
  ],
  nonWarrantyOrders: [
    { id: 'NW-000001', registerDate: '2026-10-12', signedCustomer: '甲公司', customerName: '张三', customerPhone: '13800000000', plateNumber: '京B00001', vin: 'LSGAB52L7TD000001', status: '待客户确认', quoteTotal: '10000', quoteReceivable: '10000', receivedAmount: '0', engineer: '刘珍' },
    { id: 'NW-000002', registerDate: '2026-08-01', signedCustomer: '乙公司', customerName: '李四', plateNumber: '京B00002', vin: 'LSGAB52L7TD000002', status: '关闭工单', quoteTotal: '5000', quoteReceivable: '5000', receivedAmount: '5000', engineer: '罗永豪' }
  ],
  engineers: ['刘珍', '罗永豪', '马迪'],
  reporters: ['周字欢', '王鹏'],
  warehouseLogs: [{ id: 'WH-0001', relatedOrder: 'NW-000001', type: '申领', material: '水冷板', quantity: 1 }],
  idCounters: { wn: 3, nw: 2, wh: 1 }
};
const seed = { station_mgmt_data: seedData, af_identity: { name: '王鹏', role: 'DISPATCHER', at: '' } };
const statusMsg = get => get('uploadStatusBar').innerHTML;
const find = (T, kind, id) => (kind === 'WN' ? T.APP.warrantyOrders : T.APP.nonWarrantyOrders).find(x => x.id === id);

(async () => {
  group('0. 护栏模块缺失时拒绝运行（fail-closed）');
  const dead = loadPage('work-order/index.html', Object.assign({ storage: seed, noGuard: true }, HANDLES));
  ok('缺少护栏时页面脚本确实中断', !!dead.runError);
  ok('页面明示已停止写入', (dead.get('mainContent').innerHTML || '').indexOf('停止写入') >= 0);

  const { els, store, T, get } = loadPage('work-order/index.html', Object.assign({ storage: seed }, HANDLES));
  ok('页面脚本在伪 DOM 中完整跑通', !T.APP ? false : true, T.APP ? '' : 'APP 未初始化');

  group('1. 岗位身份与分区');
  ok('身份从本机存储恢复', T.ME.name === '王鹏' && T.ME.role === 'DISPATCHER');
  ok('侧栏身份条已渲染', els.get('identityBar').innerHTML.indexOf('王鹏') >= 0);
  T.currentPage = 'warranty'; T.renderPage();
  ok('保内列表带岗位范围提示', els.get('mainContent').innerHTML.indexOf('跨保内、保外与待判定工单') >= 0);
  ok('列表副标题公示流转模板版本', els.get('mainContent').innerHTML.indexOf(A.WN_FLOW.version) >= 0);
  T.ME = { name: '刘珍', role: 'TECHNICIAN' };
  ok('技师只看指派给自己的工单', T.afWarranty().map(o => o.id).join() === 'WN-000003' && T.afWarranty().every(o => o.engineer === '刘珍'));
  T.ME = { name: '闫', role: 'AUDITOR' };
  ok('监管员对保内单只有只读标记', T.afActionButtons('WN', find(T, 'WN', 'WN-000001')).indexOf('只读岗位') >= 0 && T.afActionButtons('WN', find(T, 'WN', 'WN-000001')).indexOf('afOpenAction') < 0);
  T.ME = { name: '库管甲', role: 'WAREHOUSE' };
  ok('库房只看已关联领料/订货记录的保外单', T.afNonWarranty().map(o => o.id).join() === 'NW-000001');
  T.ME = { name: '赵轩', role: 'FINANCE' };
  T.currentPage = 'warranty';
  T.afApplyNavPermission();
  ok('财务无保内页权限，被弹回工作台', T.currentPage === 'dashboard');
  T.ME = { name: '王鹏', role: 'DISPATCHER' };

  group('2. 历史状态归一（不静默改写）');
  ok('旧口径「关闭工单」保内单归一为已结清', A.normalizeStatus('WN', '关闭工单') === '已结清' && A.isActive('WN', '关闭工单') === false);
  ok('旧口径「关闭工单」保外单归一为已关单且为终态', A.normalizeStatus('NW', '关闭工单') === '已关单' && A.isActive('NW', '关闭工单') === false);
  ok('认不出的脏状态原样保留、标记为未知', A.normalizeStatus('WN', '已完工??') === '已完工??' && A.isKnownStatus('WN', '已完工??') === false);
  ok('归一后终态单不再给操作按钮', T.afActionButtons('NW', find(T, 'NW', 'NW-000002')).indexOf('afOpenAction') < 0);

  group('3. 保内全链路：派单→开工→自检→复检→终检→结算→结清');
  T.afOpenAction('WN', 'WN-000001', 'dispatch');
  get('dispatch_eng').value = '';
  T.confirmDispatchWarranty('WN-000001');
  ok('派单不选工程师不生效', find(T, 'WN', 'WN-000001').status === '未派工');
  get('dispatch_eng').value = '刘珍';
  T.confirmDispatchWarranty('WN-000001');
  const o1 = find(T, 'WN', 'WN-000001');
  ok('派单后=未开工且写入责任工程师', o1.status === '未开工' && o1.engineer === '刘珍');
  ok('流转模板版本随单据落库', o1.flowTemplateVersion === A.WN_FLOW.version && !!o1.flowTemplateEffectiveAt);
  ok('派单动作留痕含岗位', o1.audit.some(a => a.action === 'dispatch' && a.actor === '王鹏' && a.roleLabel === '调度'));
  T.ME = { name: '刘珍', role: 'TECHNICIAN' };
  T.afCommit('WN', 'WN-000001', 'start', {});
  ok('开工后=在修并记录开工日期', o1.status === '在修' && !!o1.startDate);
  T.afOpenQcModal('WN', 'WN-000001');
  const qcHtml = els.get('modalContent').innerHTML;
  ok('自检弹窗列出 11 项清单与模板版本', A.QC_ITEMS.every(i => qcHtml.indexOf('qc_' + i.code) >= 0) && qcHtml.indexOf(A.QC_TEMPLATE_VERSION) >= 0);
  A.QC_CODES.forEach(c => { get('qc_' + c).checked = true; });
  get('qc_insulationMohm').value = '';
  T.afSubmitQc('WN', 'WN-000001');
  ok('缺数值门槛时阻断申报', o1.status === '在修' && get('afQcErr').innerHTML.length > 0);
  get('qc_insulationMohm').value = '1200';
  get('qc_capacityRecoveryPct').value = '97.5';
  get('qc_voltageDrop72hMv').value = '12';
  get('comp_date').value = '2026-10-19';
  get('comp_note').value = '更换箱体并做扭矩标记';
  get('comp_output').value = '1200';
  T.afSubmitQc('WN', 'WN-000001');
  ok('清单+门槛齐备后进入待班组复检', o1.status === '待班组复检');
  ok('自检事实带模板版本与11项', o1.qc.self.templateVersion === A.QC_TEMPLATE_VERSION && o1.qc.self.qc.items.length === 11);
  ok('自检事实记录申报人与完工信息', o1.qc.self.name === '刘珍' && o1.completeDate === '2026-10-19' && o1.engineerNote === '更换箱体并做扭矩标记');
  T.afCommit('WN', 'WN-000001', 'team_review_pass', {});
  ok('自检人不能兼任复检（责任分离）', o1.status === '待班组复检' && statusMsg(get).indexOf('责任分离') >= 0);
  T.ME = { name: '罗永豪', role: 'TECHNICIAN' };
  T.afCommit('WN', 'WN-000001', 'team_review_pass', {});
  ok('班组他人复检通过', o1.status === '待质检终检');
  T.ME = { name: '刘珍', role: 'TECHNICIAN' };
  T.afCommit('WN', 'WN-000001', 'final_pass', {});
  ok('终检不允许非专职质检员', o1.status === '待质检终检' && statusMsg(get).indexOf('不能执行') >= 0);
  T.ME = { name: '马迪', role: 'QUALITY_INSPECTOR' };
  T.afCommit('WN', 'WN-000001', 'final_pass', {});
  ok('专职质检员终检通过 → 已竣工', o1.status === '已竣工');
  T.ME = { name: '周字欢', role: 'REPORTER' };
  T.confirmSettleWarranty('WN-000001');
  ok('结算后=已结算并采集报单员与费用', o1.status === '已结算' && o1.settledDate);
  T.ME = { name: '赵轩', role: 'FINANCE' };
  T.afCommit('WN', 'WN-000001', 'clear', {});
  ok('补上的断链：已结算 → 已结清', o1.status === '已结清');
  ok('结清后无后续动作（终态）', A.actionable('WN', o1, { name: '任意', role: 'ADMIN' }).length === 0);
  ok('全链路留痕按顺序累积', o1.audit.map(a => a.action).join('>') === 'dispatch>start>self_check>team_review_pass>final_pass>settle>clear');
  ok('留痕与模板版本已写入 localStorage', store.station_mgmt_data.indexOf('"flowTemplateVersion"') >= 0 && store.station_mgmt_data.indexOf('"audit"') >= 0);

  group('4. 非法跳转 / 终止必填原因 / 幂等');
  const o2 = find(T, 'WN', 'WN-000002');
  T.ME = { name: '周字欢', role: 'REPORTER' };
  T.afCommit('WN', 'WN-000002', 'final_pass', {});
  ok('在修单直接跳终检被拒', o2.status === '在修' && statusMsg(get).indexOf('没有该操作') >= 0);
  T.ME = { name: '王鹏', role: 'DISPATCHER' };
  T.afCommit('WN', 'WN-000002', 'cancel', {});
  ok('终止不填原因被拒', o2.status === '在修' && statusMsg(get).indexOf('必须填写原因') >= 0);
  T.afCommit('WN', 'WN-000002', 'cancel', { reason: '客户撤销报修' });
  ok('填写原因后可终止（非终态通用出口）', o2.status === '已终止' && o2.cancelledDate);
  ok('终止原因入留痕', o2.audit.some(a => a.action === 'cancel' && a.reason === '客户撤销报修'));
  T.ME = { name: '刘程程', role: 'REPORTER' };
  T.afCommit('NW', 'NW-000001', 'quote_confirm', {});
  const n1 = find(T, 'NW', 'NW-000001');
  ok('保外：客户确认报价 → 报价确认', n1.status === '报价确认');
  const rid = n1.audit.slice(-1)[0].requestId;
  const before = n1.audit.length;
  T.afCommit('NW', 'NW-000001', 'start', { requestId: 'dup-1' });
  ok('报单员不能开工（岗位校验）', n1.status === '报价确认' && statusMsg(get).indexOf('不能执行') >= 0);
  T.ME = { name: '刘珍', role: 'TECHNICIAN' };
  T.afCommit('NW', 'NW-000001', 'start', { requestId: 'dup-1' });
  T.afCommit('NW', 'NW-000001', 'start', { requestId: 'dup-1' });
  ok('同一请求号重复提交不重复流转', n1.status === '在修' && n1.audit.filter(a => a.requestId === 'dup-1').length === 1 && n1.audit.length === before + 1);

  group('5. 质检驳回回环与详情留痕展示');
  T.afCommit('NW', 'NW-000001', 'self_check', { qc: { items: A.QC_CODES.map(c => ({ code: c, passed: true })), insulationMohm: 1000, capacityRecoveryPct: 96, voltageDrop72hMv: 5 } });
  ok('技师自检申报（在修→待班组复检）', n1.status === '待班组复检');
  T.afCommit('NW', 'NW-000001', 'team_review_pass', {});
  ok('自检人不能复检（责任分离）', n1.status === '待班组复检' && statusMsg(get).indexOf('责任分离') >= 0);
  T.ME = { name: '罗永豪', role: 'TECHNICIAN' };
  T.afCommit('NW', 'NW-000001', 'reject', { reason: '扭矩标记缺失' });
  ok('复检驳回 → 驳回待重检并记录否决人', n1.status === '驳回待重检' && n1.qc.rejectedBy.name === '罗永豪');
  T.ME = { name: '刘程程', role: 'REPORTER' };
  T.renderPage();
  T.viewWarranty('WN-000001');
  const detail = els.get('modalContent').innerHTML;
  ok('详情页展示质检事实与操作留痕', detail.indexOf('质检事实与操作留痕') >= 0 || detail.indexOf('操作留痕') >= 0);
  ok('详情页可回放责任链（含岗位署名）', detail.indexOf('调度') >= 0 && detail.indexOf('专职质检员') >= 0);

  group('6. 导入状态口径与去重合并（不静默改写、不倒退流转）');
  const mid = { vehicleInfo: '京C00001', customerName: '导入客户', registerDate: '2026-10-18', status: '待班组复检', engineer: '刘珍' };
  T.afAssignIncomingStatus('WN', mid, mid.status);
  ok('模板内的中间态原样保留（复检中的单不被打回入口态）', mid.status === '待班组复检' && !mid.statusRaw);
  const alias = { vehicleInfo: '京A00001 / 车型X', customerName: '测试客户甲', registerDate: '2026-10-10', status: '在修', engineer: '', faultDesc: '表内新描述' };
  T.afAssignIncomingStatus('WN', alias, alias.status);
  const dirty = { vehicleInfo: '京C00002', customerName: '脏数据客户', registerDate: '2026-10-18', status: '已完工??' };
  T.afAssignIncomingStatus('WN', dirty, dirty.status);
  ok('认不出的状态退回入口态、留原值并写导入留痕', dirty.status === '未派工' && dirty.statusRaw === '已完工??' && dirty.audit.some(a => a.action === 'import' && /需人工确认/.test(a.note)));
  const beforeMerge = T.APP.warrantyOrders.length;
  const res = T.afMergeInto(T.APP.warrantyOrders, [alias, mid, dirty], A.wnMatchKey);
  T.APP.warrantyOrders = res.merged.concat(res.added);
  const existed = T.APP.warrantyOrders.find(o => o.id === 'WN-000001');
  ok('命中已有单据：表里的旧状态不倒退本机流转', existed.status === '已结清');
  ok('非空字段合并、空值不覆盖', existed.faultDesc === '表内新描述' && existed.engineer === '刘珍');
  ok('未命中的行作为新增入库', res.added.length === 2 && T.APP.warrantyOrders.length === beforeMerge + 2);
  ok('合并结果如实汇报新增/更新/无变化', /新增 2 条/.test(res.summary) && /更新 1 条/.test(res.summary), res.summary);
  ok('台账徽标暴露归一前的原状态', T.afStatusPill('WN', { status: '已结清', statusRaw: '关闭工单' }).indexOf('原「关闭工单」') >= 0);
  ok('模板认不出的状态在徽标上提示待确认', T.afStatusPill('WN', { status: '已完工??' }).indexOf('状态待确认') >= 0);
  ok('徽标转义状态值，不把表格内容当 HTML 注入', T.afStatusPill('WN', { status: '<img src=x onerror=alert(1)>' }).indexOf('<img') < 0);

  console.log('');
  process.exit(report('work-order 页面') ? 1 : 0);
})().catch(e => { console.error('测试异常：', (e && e.stack) || e); process.exit(1); });
