/**
 * 纯离线单元测试（不联网、不调用 dws，毫秒级）
 * 运行： node verify-unit.mjs
 *
 * 覆盖最容易出错、也最影响数据可信度的一环：从合同名称推断相对方。
 * 台账里大量记录是「用印申请」表单，没有相对方字段，真实相对方只写在名称里；
 * 这里的用例取自真实台账形态，但主体名已脱敏为占位名，左侧是脱敏后的合同名，右侧是期望结果。
 * 原则：宁可为空（显示「未识别」），也不要把文件标题、我方简称当成相对方。
 */
// 必须先置 NO_SERVER，再动态载入 server.js，否则模块顶层会真的起一个监听端口的服务
process.env.NO_SERVER = '1';
// 下面「应保持为空」的用例依赖「我方简称不得当相对方」，而别名来自 .env / OWN_COMPANY；
// 仓库里没有 .env，这里显式给出，保证用例在任何人机器上都能复现。
process.env.OWN_COMPANY = '北京云帆科技集团有限公司,安捷(北京)汽车服务有限公司,云帆';
const { partyFromName } = await import('./server.js');

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}  →  ${JSON.stringify(got)}${ok ? '' : '   (期望 ' + JSON.stringify(want) + ')'}`);
};

console.log('=== 相对方名称推断（应正确识别）===');
const shouldFind = [
  ['某财产保险股份有限公司_投保单_20250001000000000000', '某财产保险股份有限公司'],
  ['BD20250001-塞北绿源新能源科技有限公司2025.1.22', '塞北绿源新能源科技有限公司'],
  ['15_哈尔滨鑫达汽车销售服务有限公司委托更换电池服务', '哈尔滨鑫达汽车销售服务有限公司'],
  ['理赔确认书 -北京易联', '北京易联'],
  ['劳动合同--张某某', '张某某'],
];
for (const [inp, want] of shouldFind) eq(`«${inp}»`, partyFromName(inp), want);

console.log('\n=== 相对方名称推断（应保持为空，避免误报）===');
const shouldMiss = [
  '北京直营站汽车租赁合同.doc1',      // 行业词不等于主体
  '信息安全保密协议书',                // 文件标题
  '放假通知',                          // 文件标题
  '告知函(2)',                         // 文件标题（含序号）
  '正定装车确认函',                    // 地名+业务，非主体
  '易联新能源2024年度分红方案',      // 无主体后缀，宁可留空
  '钉钉企业组织认证申请公函--云帆',    // 「云帆」是我方简称，不得当相对方
  '安捷服务标准物料采购单',            // 我方品牌
  '劳动合同（李四）',                  // 去括号后只剩类型词
];
for (const inp of shouldMiss) eq(`«${inp}»`, partyFromName(inp), '');

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
