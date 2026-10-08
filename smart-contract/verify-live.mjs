/**
 * 端到端验证（真实 dws 直连，约 3 分钟）：  node verify-live.mjs
 *
 * 会真实启动 server.js，走「钉钉智能合同」的 dws 命令行通道拉取全部合同，
 * 并验证：全量拉取、逐合同详情补全、详情接口、以及付费能力「如实返回空」而非伪造数据。
 *
 * 前置：本机已安装并登录 dws（dws --version 可用），且 .env 中 DINGTALK_SOURCE=dws
 *
 * 注意：本副本已脱敏，下方三处 REPLACE_CID_* 与示例相对方名是占位值，
 * 运行前请换成本组织台账里的真实合同 cid / 相对方名（其余断言与数据无关，可直接跑）。
 */
import { spawn, execSync } from 'node:child_process';

const PORT = '8787';
const BASE = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const chk = (label, cond, extra) => { if (cond) { pass++; console.log('  PASS  ' + label); } else { fail++; console.log('  FAIL  ' + label + (extra !== undefined ? '  → ' + String(extra).slice(0, 300) : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 清掉占用端口的遗留进程，否则新实例会 EADDRINUSE 静默失败、验证打到旧代码上
try {
  const out = execSync(`netstat -ano | findstr :${PORT}`, { encoding: 'utf8', shell: 'cmd.exe' });
  const pids = new Set(out.split(/\r?\n/).map(l => l.trim().split(/\s+/).pop()).filter(p => /^\d+$/.test(p)));
  for (const pid of pids) { try { execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore', shell: 'cmd.exe' }); } catch {} }
  if (pids.size) { console.log(`已清理占用 ${PORT} 的进程: ${[...pids].join(', ')}`); await sleep(1500); }
} catch { /* 端口空闲 */ }

console.log('=== 启动 server.js（ENRICH_MAX=0 全量后台补全）===');
const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT, ENRICH_MAX: '0', DINGTALK_SOURCE: 'dws' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });
const stop = () => { try { srv.kill('SIGKILL'); } catch {} };
process.on('exit', stop);

let up = false;
for (let i = 0; i < 30; i++) { try { const r = await fetch(BASE + '/api/health'); if (r.ok) { up = true; break; } } catch {} await sleep(500); }
chk('服务启动成功', up, log);
if (!up) { console.log(log); stop(); process.exit(1); }

const st = await (await fetch(BASE + '/api/dingtalk/status')).json();
chk('数据源为 dws 直连', st.mode === 'live-dws', JSON.stringify(st));

const pageRes = await fetch(BASE + '/');
const pageHtml = await pageRes.text();
chk('后端同时托管前端页面', pageRes.ok && /合同台账/.test(pageHtml), `${pageRes.status} / ${pageHtml.length}B`);

console.log('\n=== 全量拉取 /bootstrap（递归二分翻页，约 40~60s）===');
const t0 = Date.now();
const b1 = await (await fetch(BASE + '/api/dingtalk/bootstrap')).json();
console.log(`  耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
chk('返回合同集合', Array.isArray(b1.contracts) && b1.contracts.length > 0, b1.contracts?.length);
chk('mode=live / channel=dws', b1.mode === 'live' && b1.channel === 'dws', `${b1.mode}/${b1.channel}`);
chk('合同状态取自履行状态（非归档状态）', b1.contracts.every(c => /履行中|未生效|待生效|已到期|已完结|已作废|待审批/.test(c.status)), [...new Set(b1.contracts.map(c => c.status))].join(','));
chk('每份合同都有 party 占位（不留空串）', b1.contracts.every(c => typeof c.party === 'string' && c.party.length > 0));
chk('相对方清单不含我方主体', !b1.parties.some(p => /云帆|北京云帆/.test(p.name)));
chk('accounting 为数组', Array.isArray(b1.accounting));
const firstStart = b1.contracts.filter(c => c.start).length;
console.log(`  首轮：相对方 ${b1.contracts.filter(c => c.party !== '—').length} 份（推断 ${b1.contracts.filter(c => c.partyInferred).length}）、含起始日期 ${firstStart} 份、相对方清单 ${b1.parties.length} 条`);

console.log('\n=== 等待逐合同后台补全（轮询 enrich-status）===');
let es = null;
for (let i = 0; i < 150; i++) {
  es = await (await fetch(BASE + '/api/dingtalk/enrich-status')).json();
  if (i % 10 === 0) console.log(`  进度 ${es.done}/${es.total}  已补全 ${es.filled}  失败 ${es.errors}`);
  if (es.total > 0 && !es.running) break;
  await sleep(2000);
}
console.log('  最终:', JSON.stringify(es));
chk('补全任务已结束', es?.total > 0 && !es.running, JSON.stringify(es));
chk('补全确实写回数据（filled>0）', es.filled > 0, JSON.stringify(es));
chk('失败率 < 5%', es.errors / Math.max(es.total, 1) < 0.05, JSON.stringify(es));

const b2 = await (await fetch(BASE + '/api/dingtalk/bootstrap')).json();
chk('二次请求命中缓存（同批合同）', b2.contracts.length === b1.contracts.length, `${b1.contracts.length} → ${b2.contracts.length}`);
chk('补全结果已反映到列表', b2.contracts.filter(c => c.start).length > firstStart, `${firstStart} → ${b2.contracts.filter(c => c.start).length}`);
const uniq = new Set(b2.contracts.filter(c => c.party !== '—').map(c => c.party));
console.log(`  二轮：含起止日期 ${b2.contracts.filter(c => c.start).length} 份、含终止日期 ${b2.contracts.filter(c => c.end).length} 份、唯一相对方 ${uniq.size} 个、未识别相对方 ${b2.contracts.filter(c => c.party === '—').length} 份`);

console.log('\n=== 单合同详情接口（含边界）===');
const dA = await (await fetch(BASE + '/api/dingtalk/contract/REPLACE_CID_WITH_DATE')).json();   // 劳动合同：含生效/终止日期
chk('劳动合同详情含生效日期', dA.start === '2026-09-16', dA.start);
chk('劳动合同详情含终止日期', dA.end === '2029-09-15', dA.end);
chk('详情返回表单字段列表', Array.isArray(dA.formFields) && dA.formFields.length > 0, dA.formFields?.length);

const dB = await (await fetch(BASE + '/api/dingtalk/contract/REPLACE_CID_WITH_PARTY')).json();   // 借调协议：含相对方
chk('借调协议详情含生效日期', dB.start === '2026-09-20', dB.start);
chk('借调协议详情含权威相对方', dB.party === '塞北绿源新能源科技有限公司', dB.party);

const dC = await (await fetch(BASE + '/api/dingtalk/contract/REPLACE_CID_NO_DATE')).json();    // 分红方案：表单确无日期字段
chk('表单无日期时如实返回空（不猜测）', dC.start === '' && dC.end === '', `${dC.start}|${dC.end}`);

chk('非法合同 ID 返回 400', (await fetch(BASE + '/api/dingtalk/contract/abc')).status === 400);

console.log('\n=== 付费能力应如实返回为空/受限，不得伪造 ===');
const ri = await (await fetch(BASE + '/api/dingtalk/subject-info?name=' + encodeURIComponent('塞北绿源新能源科技有限公司'))).json();
const rr = await (await fetch(BASE + '/api/dingtalk/subject-risk?name=' + encodeURIComponent('塞北绿源新能源科技有限公司'))).json();
console.log('  subject-info:', JSON.stringify(ri), '| subject-risk:', JSON.stringify(rr));
chk('工商信息未伪造（本组织该能力未开通）', ri && typeof ri === 'object' && !ri.unifiedSocialCreditCode, JSON.stringify(ri));
chk('风险检测未伪造', rr && typeof rr === 'object' && !rr.riskList, JSON.stringify(rr));

console.log('\n=== 服务端日志（尾部）===');
console.log(log.split('\n').slice(-6).join('\n') || '(无输出)');
stop();
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
