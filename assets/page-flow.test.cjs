/*
 * warehouse/index.html 页面级流程回归：旧件生命周期（接收 → 核验 → 处置）、
 * 责任分离、库存与流水联动、历史数据回填、岗位分区、护栏缺失时 fail-closed。
 * 运行：node assets/page-flow.test.cjs
 */
const { loadPage, group, ok, report } = require('./page-harness.cjs');
const A = require('./aftersales-guardrails.js');

const HANDLES = {
  read: ['DB', 'ME', 'curView'],
  write: ['ME'],
  fns: ['renderOld', 'render', 'openOldAction', 'confirmOldAction', 'advanceOrder', 'oldpartOf', 'hasOldLot', 'goOldparts']
};

(async () => {
  const items = [
    { pn: 'PCAR01-00031', name: 'CTP箱体总成', category: '结构件', unit: '个', stock: 3, safe_stock: 2 },
    { pn: 'PCAR01-00088', name: '水冷板', category: '结构件', unit: '个', stock: 5, safe_stock: 1 }
  ];
  const orders = [{
    id: 'PO20261019001', apply_date: '2026-10-19', engineer: '刘珍', project: 'CTP-箱体及水冷板更换',
    items: [{ pn: 'PCAR01-00031', name: 'CTP箱体总成', qty: 2 }, { pn: 'PCAR01-00088', name: '水冷板', qty: 1 }],
    status: '已领料', order_date: '2026-10-16', kit_date: '2026-10-17', pick_date: '2026-10-18',
    old_receive_date: '', old_return_date: '', remark: '', created_at: '2026-10-16T02:00:00.000Z'
  }, {
    // 历史数据：只有旧版「标记接收」的日期字段，没有核验事实
    id: 'PO20260901007', apply_date: '2026-09-01', engineer: '罗永豪', project: '电箱更换',
    items: [{ pn: 'PCAR01-00088', name: '水冷板', qty: 1 }],
    status: '完成', order_date: '2026-09-02', kit_date: '2026-09-03', pick_date: '2026-09-04',
    old_receive_date: '2026-09-05', old_return_date: '', remark: '', created_at: '2026-09-01T02:00:00.000Z'
  }];
  const seed = { wh_cache: { items, orders, txns: [] }, af_identity: { name: '库房甲', role: 'WAREHOUSE', at: '' } };

  group('0. 护栏模块缺失时拒绝写入（fail-closed）');
  const dead = loadPage('warehouse/index.html', Object.assign({ storage: seed, noGuard: true }, HANDLES));
  ok('缺少护栏时页面脚本确实中断', !!dead.runError);
  ok('页面明示已停止写入', (dead.get('statsBar').innerHTML || '').indexOf('停止写入') >= 0);

  const { els, store, T, get } = loadPage('warehouse/index.html', Object.assign({ storage: seed }, HANDLES));
  await new Promise(r => setTimeout(r, 5));

  group('1. 页面加载与历史数据回填');
  ok('内联脚本在伪 DOM 中跑通（库存表已渲染）', els.get('invBody').innerHTML.length > 0);
  ok('本机岗位身份从存储恢复，无需每次重填', T.ME.name === '库房甲' && els.get('identityBar').innerHTML.indexOf('value="库房甲"') >= 0);
  ok('岗位可见范围提示已渲染', els.get('scopeHint').innerHTML.indexOf('库房与采购只能查看') >= 0);
  const legacy = T.DB.orders.find(o => o.id === 'PO20260901007');
  const fresh = T.DB.orders.find(o => o.id === 'PO20261019001');
  ok('历史日期字段回填为「待核验」批次', legacy.oldpart && legacy.oldpart.status === '待核验');
  ok('回填批次标注为历史数据', legacy.oldpart.migrated === true && legacy.oldpart.audit[0].action === 'migrate');
  ok('已领料订单生成待接收批次', fresh.oldpart.status === '待接收');
  ok('旧件在途批次 KPI 统计正确', els.get('stOld').textContent === 2, '实际：' + els.get('stOld').textContent);
  ok('回填结果已落盘（wh_cache 里带 oldpart）', store.wh_cache.indexOf('"oldpart"') >= 0);

  group('2. 旧件接收（入暂存，不计可用库存）');
  T.renderOld();
  ok('待接收批次渲染出「旧件接收」按钮', get('oldList').innerHTML.indexOf("openOldAction('PO20261019001','receive')") >= 0);
  ok('待接收批次不给核验/处置入口', get('oldList').innerHTML.indexOf("openOldAction('PO20261019001','verify") < 0);
  T.openOldAction('PO20261019001', 'receive');
  const modalHtml = els.get('modalBox').innerHTML;
  ok('接收弹窗写明「不增加可用库存」', modalHtml.indexOf('不增加可用库存') >= 0);
  ok('接收弹窗逐行带数量输入', modalHtml.indexOf('id="oldq_0"') >= 0 && modalHtml.indexOf('id="oldq_1"') >= 0);
  get('oldq_0').value = '2'; get('oldq_1').value = '1';
  get('oldLoc').value = '旧件暂存区 A-3'; get('oldNote').value = '换下件外观良好';
  const boxBefore = T.DB.items.find(i => i.pn === 'PCAR01-00031').stock;
  await T.confirmOldAction('PO20261019001', 'receive');
  ok('接收后状态=待核验', fresh.oldpart.status === '待核验');
  ok('接收不增加可用库存', T.DB.items.find(i => i.pn === 'PCAR01-00031').stock === boxBefore);
  ok('接收写入「旧件入库」流水（正数）', T.DB.txns.some(t => t.type === '旧件入库' && t.pn === 'PCAR01-00031' && t.qty === 2));
  ok('流水署名到人+岗位', T.DB.txns.some(t => /库房甲·库管/.test(t.operator || '')));
  ok('接收人记入批次（供责任分离）', fresh.oldpart.receivedBy === '库房甲');
  ok('暂存库位已记录', fresh.oldpart.location === '旧件暂存区 A-3');
  ok('旧版日期字段同步（兼容既有导出）', fresh.old_receive_date === fresh.oldpart.receive_date);
  ok('留痕含动作与署名', fresh.oldpart.audit.some(a => a.action === 'receive' && a.actor === '库房甲'));
  ok('幂等：同一请求号重放不二次入账', A.applyTransition(fresh.oldpart, { action: 'receive', label: '旧件接收', to: '待核验', roles: ['WAREHOUSE'] }, T.ME, { requestId: fresh.oldpart.audit.slice(-1)[0].requestId }).duplicate === true);

  group('3. 核验闸门与责任分离');
  get('oldq_0').value = '2'; get('oldq_1').value = '1'; get('oldNote').value = '';
  await T.confirmOldAction('PO20261019001', 'verify_ok');
  ok('接收人自己核验被拒（状态未变）', fresh.oldpart.status === '待核验');
  ok('被拒时不写释放流水', !T.DB.txns.some(t => t.type === '旧件释放可用'));
  ok('被拒时不写核验结论', !fresh.oldpart.verify);
  T.ME = { name: '马迪', role: 'QUALITY_INSPECTOR' };
  await T.confirmOldAction('PO20261019001', 'verify_ok');
  ok('异人核验合格 → 旧件释放可用', fresh.oldpart.status === '旧件释放可用');
  ok('释放可用计入库存（+2）', T.DB.items.find(i => i.pn === 'PCAR01-00031').stock === boxBefore + 2);
  ok('核验结论落库（验收合格 + 署名）', !!fresh.oldpart.verify && fresh.oldpart.verify.result === '验收合格' && fresh.oldpart.verify.name === '马迪');
  ok('核验动作写入留痕', fresh.oldpart.audit.some(a => a.action === 'verify_ok' && a.role === 'QUALITY_INSPECTOR'));
  T.renderOld();
  ok('闭环批次显示「已闭环」', get('oldList').innerHTML.indexOf('批次已闭环') >= 0);

  group('4. 破损/报废出口与原因必填');
  T.ME = { name: '王鹏', role: 'DISPATCHER' };
  get('oldNote').value = '壳体渗漏';
  await T.confirmOldAction('PO20260901007', 'scrap');
  ok('报废缺原因被状态机拒绝', legacy.oldpart.status === '待核验');
  get('oldReason').value = '客户放弃维修';
  await T.confirmOldAction('PO20260901007', 'scrap');
  ok('带原因报废 → 报废或退回客户', legacy.oldpart.status === '报废或退回客户');
  ok('报废留痕带原因', legacy.oldpart.audit.some(a => a.action === 'scrap' && a.reason === '客户放弃维修'));
  ok('报废写「旧件报废退回」流水（负数核销）', T.DB.txns.some(t => t.type === '旧件报废退回' && t.qty < 0));
  ok('报废后批次无可用出口', A.actionable('OLDPART', legacy.oldpart, { name: '王鹏', role: 'ADMIN' }).length === 0);

  group('5. 只读岗位与页面权限');
  T.ME = { name: '监管员', role: 'AUDITOR' };
  T.renderOld();
  ok('监管员看到只读标记', get('oldList').innerHTML.indexOf('只读岗位') >= 0);
  ok('监管员没有任何操作按钮', get('oldList').innerHTML.indexOf('openOldAction') < 0);
  T.ME = { name: '采购丙', role: 'PURCHASER' };
  ok('采购岗无旧件页面权限，库管有', A.canPage('PURCHASER', 'oldparts') === false && A.canPage('WAREHOUSE', 'oldparts') === true);

  group('6. 领料推进自动生成旧件批次');
  T.ME = { name: '库房甲', role: 'WAREHOUSE' };
  const o3 = { id: 'PO20261019099', apply_date: '2026-10-19', engineer: '刘珍', project: 'MTP换箱体', items: [{ pn: 'PCAR01-00088', name: '水冷板', qty: 1 }], status: '已齐套', created_at: '2026-10-19T01:00:00.000Z' };
  T.DB.orders.push(o3);
  const wpBefore = T.DB.items.find(i => i.pn === 'PCAR01-00088').stock;
  await T.advanceOrder('PO20261019099');
  ok('推进到已领料时扣减库存', T.DB.items.find(i => i.pn === 'PCAR01-00088').stock === wpBefore - 1);
  ok('领料后自动生成旧件批次并留痕', !!o3.oldpart && o3.oldpart.status === '待接收' && o3.oldpart.audit.some(a => a.action === 'generate'));

  process.exit(report('warehouse 页面') ? 1 : 0);
})().catch(e => { console.error('测试异常：', (e && e.stack) || e); process.exit(1); });
