/**
 * 智能合同管理 —— 钉钉连接器后端代理（零依赖，无需模型）
 * --------------------------------------------------------------
 * 三种接入「智能合同」的通道（连接平台），主路径为方式三：
 *   方式三（主路径·默认）：本机 dws CLI 直连，零凭证；只要 dws 可用且已登录即自动选用
 *   方式一（备用）：连接流「同步调用地址」直接 POST，无需 AppKey/Secret
 *   方式二（备用）：企业内部应用 AppKey/Secret 换 token，再调 /connector/instances/invoke
 * 三者均未配置时自动进入 demo 模式（前端使用内置演示数据）。
 *
 * 多组织：dws 的每个 profile = 一个已授权的「钉钉组织 + 账号」（dws profile list 可查）。
 *   业务命令统一带 --profile <corpId>:<userId>，列表缓存、详情缓存、补全台账全部按 corpId 分键，
 *   因此一个页面一次只呈现一个组织的台账，绝不跨组织合并（合同 ID 只在组织内唯一）。
 *   新组织需用户自己执行 `dws auth login` 完成扫码授权；未登录的组织会明确报错，不回退成当前组织。
 *
 * 环境变量：
 *   DINGTALK_SOURCE                dws（默认·主路径）/ sync / openapi，用于强制切换通道
 *   OWN_COMPANY                    我方主体别名。语法「A,B」= 全局；「corpId=A,B;corpId2=C」= 按组织。
 *                                  各组织自己的 corpName 会自动计入我方，无需配置。
 *   【方式一】DINGTALK_SYNC_URL          连接流同步调用地址
 *             （形如 https://connector.dingtalk.com/webhook/subflow/xxxx，需连接流已发布）
 *   【方式二】DINGTALK_APP_KEY           企业内部应用 AppKey
 *            DINGTALK_APP_SECRET        企业内部应用 AppSecret
 *            DINGTALK_CONNECTOR_LIST_URI    分页查询合同详情 执行动作的 connectAssetUri
 *            DINGTALK_CONNECTOR_DETAIL_URI  （可选）查询合同详情
 *            DINGTALK_CONNECTOR_ARCHIVE_URI （可选）归档
 *            DINGTALK_CONNECTOR_TRANSFER_URI（可选）转交
 *            DINGTALK_CONNECTOR_COMPLETE_URI （可选）完结
 *   PORT                              监听端口，默认 8787
 *
 * 启动： node server.js   （建议放在项目目录，与 index.html 同级）
 */
import http from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// 零依赖 .env 加载：在读取下方 process.env 之前执行，使 `node server.js` 开箱即用
(function loadEnv() {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const text = readFileSync(path.join(here, '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (!m) continue; // 跳过注释与空行
      const key = m[1];
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch { /* 无 .env 不报错，走环境变量或 demo 模式 */ }
})();

const PORT = Number(process.env.PORT) || 8787;
const SYNC_URL = process.env.DINGTALK_SYNC_URL || '';
const APP_KEY = process.env.DINGTALK_APP_KEY || '';
const APP_SECRET = process.env.DINGTALK_APP_SECRET || '';
const C_LIST = process.env.DINGTALK_CONNECTOR_LIST_URI || '';
const C_DETAIL = process.env.DINGTALK_CONNECTOR_DETAIL_URI || '';
const C_ARCHIVE = process.env.DINGTALK_CONNECTOR_ARCHIVE_URI || '';
const C_TRANSFER = process.env.DINGTALK_CONNECTOR_TRANSFER_URI || '';
const C_COMPLETE = process.env.DINGTALK_CONNECTOR_COMPLETE_URI || '';

// dws 直连优先；其次方式一（同步地址）；其次方式二（OpenAPI）
// 方式一的本组织连接流仍未发布，配置了 DINGTALK_SYNC_URL 也需显式 DINGTALK_SOURCE=sync 才会启用
const DWS_BIN = process.env.DWS_BIN || 'dws';
let DWS_AVAILABLE = false;
try { execFileSync(DWS_BIN, ['--version'], { stdio: 'ignore', timeout: 8000 }); DWS_AVAILABLE = true; } catch {}
const FORCE_SOURCE = (process.env.DINGTALK_SOURCE || '').toLowerCase();
const USE_DWS = FORCE_SOURCE === 'dws' || (FORCE_SOURCE !== 'sync' && FORCE_SOURCE !== 'openapi' && DWS_AVAILABLE);
const USE_SYNC = Boolean(SYNC_URL) && !USE_DWS;
const LIVE = Boolean(USE_DWS || SYNC_URL || (APP_KEY && APP_SECRET && C_LIST));
const ENRICH_OFF = process.env.ENRICH_OFF === '1';
const ENRICH_MAX = Number(process.env.ENRICH_MAX || '0');
// 我方主体别名：用于从合同名里剔除「自己」，避免把我方当成相对方。
// 多组织下必须按组织归属：A 组织的「我方」在 B 组织里可能就是相对方，
// 因此默认别名绑定到组织自己的 corpId，而非全局生效。
// OWN_COMPANY 语法：
//   「A,B」              → 全局别名（对所有组织生效）
//   「corpId=A,B;corpId2=C」→ 按组织别名
const OWN_ALIASES_GLOBAL = [];
const OWN_ALIASES_BY_CORP = new Map();
(function parseOwnAliases() {
  const raw = process.env.OWN_COMPANY
    || 'dingexamplecorp000000000000000001=北京云帆科技集团有限公司,安捷(北京)汽车服务有限公司,云帆';
  for (const seg of raw.split(';').map(s => s.trim()).filter(Boolean)) {
    const eq = seg.indexOf('=');
    const names = (eq < 0 ? seg : seg.slice(eq + 1)).split(',').map(s => s.trim()).filter(Boolean);
    if (eq < 0) OWN_ALIASES_GLOBAL.push(...names);
    else OWN_ALIASES_BY_CORP.set(seg.slice(0, eq).trim(), names);
  }
})();
// 本组织的 corpName 天然是「我方」，无需再配别名
function ownAliasesFor(corpId, corpName) {
  const list = [...OWN_ALIASES_GLOBAL, ...(OWN_ALIASES_BY_CORP.get(corpId) || [])];
  if (corpName) list.push(corpName);
  return list.filter(Boolean);
}
function makeOwnMatcher(aliases) {
  return function isOwnName(s) {
    if (!s) return false;
    const v = String(s).trim();
    return aliases.some(a => a.includes(v) || v.includes(a));
  };
}

const normName = s => String(s || '').replace(/\s+/g, '').replace(/[()（）]/g, '');
// 判断「相对方」是否其实是我方盖章主体，规则比 isOwnName 严：
// 用印表单里的相对方常写成简称（大同恒远 / 北京易联），必须允许包含匹配；
// 但按名称推断出的碎片（「新能源」）会同时包含在十几家自家公司的全称里，
// 一律包含匹配会把真实外部相对方也吃掉，所以非全称命中要求长度 >= 4。
function makeOwnPartyMatcher(names) {
  const set = new Set(names.map(normName).filter(Boolean));
  return function isOwnParty(s) {
    const v = normName(s);
    if (!v || !set.has(v) && v.length < 4) return false;
    for (const n of set) if (n === v || n.includes(v) || v.includes(n)) return true;
    return false;
  };
}

/* ---------------- token 缓存（方式二） ---------------- */
let tokenCache = { token: '', exp: 0 };

async function getAccessToken() {
  if (tokenCache.token && Date.now() < tokenCache.exp) return tokenCache.token;
  // 新版规范：POST /v1.0/oauth2/accessToken
  const resp = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appKey: APP_KEY, appSecret: APP_SECRET }),
  });
  const data = await resp.json().catch(() => ({}));
  const token = data.accessToken || data.access_token;
  if (!token) throw new Error('获取 access_token 失败：' + JSON.stringify(data));
  tokenCache = { token, exp: Date.now() + (Number(data.expireIn) || 7200) * 1000 - 60000 };
  return token;
}

/* ---------------- 方式二：连接器调用 ---------------- */
async function invokeConnector(assetUri, inputObj) {
  const token = await getAccessToken();
  const resp = await fetch('https://api.dingtalk.com/v1.0/connector/instances/invoke', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-acs-dingtalk-access-token': token,
    },
    body: JSON.stringify({
      connectAssetUri: assetUri,
      instanceKey: 'smart-contract-web',
      inputJsonString: JSON.stringify(inputObj || {}),
    }),
  });
  const data = await resp.json().catch(() => ({}));
  // outputJson 是字符串，需二次解析
  if (typeof data.outputJson === 'string') {
    try { return JSON.parse(data.outputJson); } catch { return data.outputJson; }
  }
  return data;
}

/* ---------------- 方式一：连接流同步调用地址 ---------------- */
let lastSyncRaw = '(尚未调用)';
async function invokeSyncFlow(inputObj) {
  const resp = await fetch(SYNC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(inputObj || {}),
  });
  const text = await resp.text();
  lastSyncRaw = text;
  let data = {};
  try { data = JSON.parse(text); } catch { data = { _unparseable: text }; }
  return data;
}

/* ---------------- 方式三：dws CLI 直连「智能合同」（官方，无需连接流） ---------------- */
const execFileP = promisify(execFile);
// 多组织：dws 的每个 profile = 一个已授权的「组织 + 账号」。所有缓存/台账按组织分键，
// 否则两个组织的合同会混成一份台账，合同 ID 也可能跨组织串用。
const DEFAULT_ORG = { profile: '', corpId: '', corpName: '', userId: '', userName: '' };
const dwsCache = new Map();    // orgProfile -> { at, data }
const dwsInflight = new Map(); // orgProfile -> Promise，缓存过期时的并发请求共享同一次拉取

// dws 是官方 Go 二进制，并发过高会崩溃；用信号量把并发调用限制在安全上限内
const DWS_MAX_CONCURRENCY = 6;
let dwsActive = 0;
const dwsWaiters = [];
function dwsAcquire() {
  return new Promise(res => {
    if (dwsActive < DWS_MAX_CONCURRENCY) { dwsActive++; res(); }
    else dwsWaiters.push(res);
  });
}
function dwsRelease() {
  dwsActive--;
  if (dwsWaiters.length) { dwsActive++; dwsWaiters.shift()(); }
}

// 注意：信号量只包住「真正 spawn 子进程」的那一步，绝不包住递归/等待子调用的函数，
// 否则父调用会持槽等待子调用 → 槽位耗尽即死锁。
async function dwsJSON(args, timeout = 60000) {
  let lastErr;
  // 重试：dws 偶发崩溃/超时，最多重试 3 次，指数退避
  for (let attempt = 0; attempt < 3; attempt++) {
    await dwsAcquire();
    try {
      const { stdout } = await execFileP(DWS_BIN, args, { maxBuffer: 64 * 1024 * 1024, timeout });
      dwsRelease();
      return JSON.parse(stdout);
    } catch (e) {
      dwsRelease();
      lastErr = e;
      // 连子进程都起不来（不是 dws 自己报错）时重试没有意义，直接给出可操作的提示
      if (e.code === 'ENOENT' || e.code === 'UNKNOWN') {
        e.message = `无法启动 dws（${DWS_BIN}）：` + (e.code === 'ENOENT'
          ? '未找到可执行文件，请重新安装 DWS 运行时或用 DWS_BIN 指定路径'
          : '系统拒绝执行该程序（常见于 Windows Device Guard / 应用控制策略或杀毒拦截），请重装 DWS 运行时或联系 IT 放行');
        throw e;
      }
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastErr;
}
// 业务命令统一走这里：带上 --profile 才能打到指定组织，否则只会读到当前默认组织
function dwsBiz(org, args, timeout) {
  return dwsJSON(org?.profile ? [...args, '--profile', org.profile] : args, timeout);
}

/* ---------------- 组织（dws profile）清单 ---------------- */
let orgsCache = { at: 0, data: null };
async function dwsOrgs() {
  if (orgsCache.data && Date.now() - orgsCache.at < 60000) return orgsCache.data;
  const j = await dwsJSON(['profile', 'list', '--format', 'json'], 30000);
  const list = (j?.profiles || []).map(x => ({
    profile: `${x.corpId}:${x.userId}`,
    corpId: x.corpId || '', corpName: x.corpName || '',
    userId: x.userId || '', userName: x.userName || '',
    isCurrent: !!x.isCurrent, isPrimary: !!x.isPrimary,
  }));
  orgsCache = { at: Date.now(), data: list };
  return list;
}
// 未指定 org 时用 dws 当前组织；指定了但没登录过则明确报错，绝不静默回退成当前组织
// （否则前端会以为看到的是第二个组织的数据）
async function resolveOrg(orgQuery) {
  const list = await dwsOrgs();
  if (!orgQuery) return list.find(x => x.isCurrent) || list[0] || DEFAULT_ORG;
  const hit = list.find(x => x.corpId === orgQuery || x.profile === orgQuery || x.corpName === orgQuery);
  if (hit) return hit;
  throw new Error(`组织「${orgQuery}」在本机 dws 尚未登录，无法读取其合同。`
    + `请你自己执行 dws auth login 完成该组织的扫码授权（已登录：${list.map(x => x.corpName).join('、') || '无'}）`);
}

async function dwsRecordRange(org, start, end, status, stats) {
  const args = ['contract', 'record', 'list', '--start', start, '--end', end, '--format', 'json'];
  if (status) args.push('--status', status);
  const j = await dwsBiz(org, args);
  // 顶层窗口的 totalCount 即钉钉侧合同总数，供前端做「总数 vs 已接入」对账
  if (stats) stats.sourceTotal = Number(j?.result?.totalCount || 0);
  return Array.isArray(j?.result?.data) ? j.result.data : [];
}
// 递归二分：单窗口达到 40 条封顶则对半切，直到每窗口 < 40（record list 无页码参数，封顶 40/页）
async function dwsFetchAll(org, curStart, curEnd, depth, stats, status) {
  const arr = await dwsRecordRange(org, curStart, curEnd, status, depth === 0 ? stats : null);
  stats.calls++;
  if (arr.length >= 40 && depth < 8) {
    const midMs = (new Date(curStart).getTime() + new Date(curEnd).getTime()) / 2;
    const mid = new Date(midMs).toISOString();
    const [a, b] = await Promise.all([
      dwsFetchAll(org, curStart, mid, depth + 1, stats, status),
      dwsFetchAll(org, mid, curEnd, depth + 1, stats, status),
    ]);
    return [...a, ...b];
  }
  return arr;
}
async function dwsFetchSubjects(org) {
  let page = 1; const out = [];
  while (page <= 20) {
    const j = await dwsBiz(org, ['contract', 'subject', 'list', '--page-size', '50', '--current-page', String(page), '--format', 'json']);
    const data = j?.result?.data || [];
    out.push(...data);
    const total = Number(j?.result?.totalCount || 0);
    if (out.length >= total || data.length === 0) break;
    page++;
  }
  return out;
}
function fmtDate(ms) {
  if (!ms) return '';
  const d = new Date(Number(ms));
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}
function archiveFromStatus(s) {
  if (s === 'archived') return '已归档';
  if (s === 'not-archive') return '待归档';
  if (s === 'archive-confirming') return '归档确认中';
  return '未归档';
}
function normalizeDwsContract(raw, org) {
  const id = String(raw.contractNo || raw.contractId || '');
  const name = raw.contractName || '（未命名合同）';
  const opp = Array.isArray(raw.oppositeParties) ? raw.oppositeParties[0] : null;
  const our = Array.isArray(raw.ourParties) ? raw.ourParties[0] : null;
  let party = (opp?.name) || (our?.name) || '';
  let partyInferred = false;
  if (!party || party === '—') {
    const guessed = partyFromName(raw.contractName, our?.name, ownAliasesFor(org.corpId, org.corpName));
    if (guessed) { party = guessed; partyInferred = true; }
    else party = '—';
  }
  const amount = toNum(raw.contractAmount);
  const currency = raw.currencyCode === 'CNY' ? '¥' : (raw.currencyCode || '¥');
  // 合同「状态」应取履行状态（effectiveStatus），归档状态单独放在 archive 字段，
  // 否则列表里会把「待归档」当成合同状态，出现「履行中 0 份」这类误导
  const status = mapStatus(raw.effectiveStatus || raw.contractStatus);
  const owner = raw.ownerName || raw.committerName || '—';
  const files = Array.isArray(raw.contractContentFiles)
    ? raw.contractContentFiles.map(f => ({ name: f.fileName, url: f.fileDownloadUrl })) : [];
  return {
    id, no: raw.contractNo || '', cid: raw.contractId, name, party, partyInferred, amount, currency,
    sign: fmtDate(raw.gmtCreate), start: '', end: '',
    status, owner, archive: archiveFromStatus(raw.contractStatus),
    standard: '—', flag: false, clauses: [], archiveCheck: [], live: true, files,
    corpId: org.corpId, orgName: org.corpName || '当前组织',
    // 分类三个字段的来源不同：dir/dept 列表接口就有，sealCompany/usage 要逐份详情才有
    dir: raw.directoryName || '', dept: raw.deptName || '', sealCompany: '', usage: '',
  };
}
async function fetchDwsData(org) {
  const stats = { calls: 0, sourceTotal: 0 };
  const raw = await dwsFetchAll(org, '2020-01-01T00:00:00+08:00', '2027-12-31T23:59:59+08:00', 0, stats);
  const seen = new Set();
  const contracts = raw.filter(c => {
    if (!c.contractId) return false; // 剔除列表接口偶发的空记录
    if (seen.has(c.contractId)) return false;
    seen.add(c.contractId); return true;
  }).map(c => classifyContract(normalizeDwsContract(c, org), org));
  const ledgerHits = applyLedger(org.corpId, contracts);
  // 台账回填了用印公司/用途后要重新归类，否则重启首轮会把已识别成公司的合同退回按部门分
  for (const c of contracts) classifyContract(c, org);
  const own = markOwnParties(org, contracts);
  const subjects = await dwsFetchSubjects(org);
  const partyMap = new Map();
  for (const c of contracts) {
    // 本方盖章主体不算相对方，否则「相对方」里会混进自家子公司
    if (!c.party || c.party === '—' || c.partyOwn) continue;
    partyMap.set(c.party, (partyMap.get(c.party) || 0) + 1);
  }
  // 主体库里的「我方主体」不计入相对方清单（避免把我方当成相对方统计）
  const parties = subjects.filter(s => !own.isOwnParty(s.name)).map(s => ({
    name: s.name, type: '相对方', code: s.code || '—', level: '—',
    reasons: ['实时数据：工商风险维度需对接第三方工商库（天眼查/启信宝等）补充'],
    contracts: partyMap.get(s.name) || 0,
  }));
  for (const [name, n] of partyMap) {
    if (own.isOwnParty(name)) continue;
    if (!parties.find(p => p.name === name)) {
      parties.push({ name, type: '相对方', code: '—', level: '—', reasons: ['（合同台账中出现的相对方，未单独登记）'], contracts: n });
    }
  }
  const borrows = contracts.filter(c => c.archive && c.archive !== '未归档').map(c => ({ contract: c.name, status: c.archive }));
  const result = {
    mode: 'live', channel: 'dws', contracts, parties, accounting: [], borrows,
    org: { corpId: org.corpId, corpName: org.corpName, userName: org.userName },
    cats: CAT_RULES.map(r => r[0]).concat(CAT_OTHER),
    ownCompanies: [...new Set(own.names.filter(n => !/^(—|-)$/.test(String(n).trim())))],
    stats: { dwsCalls: stats.calls, sourceTotal: stats.sourceTotal, loaded: contracts.length, ledgerHits, partyOwnContracts: own.marked },
  };
  // 后台懒补全：逐合同补起止日期与相对方（详情接口），不阻塞首次返回
  if (!ENRICH_OFF) enrichAllContracts(org, contracts).catch(() => {});
  return result;
}

/* ---------------- 方式三增强：逐合同详情补全（起止日期/相对方/文件/账款/表单） ---------------- */
const dwsDetailCache = new Map(); // `${corpId}:${cid}` -> { at, data }
const DETAIL_TTL = 10 * 60 * 1000;
// 补全进度（供前端/排查用）：running/done/total/filled 可实时查询。
// 同一时刻只跑一个组织的补全，org 字段说明这一轮属于哪个组织。
const enrichState = { running: false, org: '', corpId: '', total: 0, done: 0, filled: 0, errors: 0, startedAt: 0, finishedAt: 0 };
let enrichPending = null; // 补全进行中又重新拉取了列表 → 记下最新一轮（含组织），本轮结束后补跑

// 补全结果台账。列表接口本身不返回起止日期，全靠逐合同详情补全写进内存缓存；
// 而列表缓存 5 分钟过期后重新拉取会拿到一批「没有日期」的新对象，
// 导致「90天内到期 / 已逾期」等统计每轮重拉（以及每次重启）都清零。
// 因此把补全到的字段按 cid 记账，重拉时直接贴回，并落盘以挺过重启。
const LEDGER_FILE = path.join(HERE, '.enrich-ledger.json');
const enrichLedger = new Map(); // corpId -> Map(cid -> { start, end, party })
function orgLedger(corpId) {
  let m = enrichLedger.get(corpId);
  if (!m) { m = new Map(); enrichLedger.set(corpId, m); }
  return m;
}
// 文件格式：{ corpId: { cid: { start, end, party, sealCompany, usage } } }。合同 ID 只在组织内唯一，
// 不分组织记账会让 A 组织的日期贴到 B 组织的同号合同上。
try {
  const j = JSON.parse(readFileSync(LEDGER_FILE, 'utf8'));
  for (const [corpId, byCid] of Object.entries(j || {})) {
    for (const [cid, v] of Object.entries(byCid || {})) {
      if (v && (v.start || v.end || v.party || v.sealCompany)) orgLedger(corpId).set(String(cid), v);
    }
  }
} catch { /* 首次运行还没有台账文件 */ }

let ledgerSaving = false;
function saveLedger() {
  if (ledgerSaving) return;
  ledgerSaving = true;
  setTimeout(() => {
    ledgerSaving = false;
    const nested = Object.fromEntries([...enrichLedger].map(([corpId, m]) => [corpId, Object.fromEntries(m)]));
    try { writeFileSync(LEDGER_FILE, JSON.stringify(nested)); } catch { /* 目录只读时仅丢本次落盘 */ }
  }, 1500);
}
function applyLedger(corpId, contracts) {
  const ledger = enrichLedger.get(corpId);
  if (!ledger) return 0;
  let hit = 0;
  for (const c of contracts) {
    const l = ledger.get(String(c.cid));
    if (!l) continue;
    hit++;
    if (l.start) c.start = l.start;
    if (l.end) c.end = l.end;
    if (l.party && l.party !== '—') { c.party = l.party; c.partyInferred = false; }
    if (l.sealCompany) c.sealCompany = l.sealCompany;
    if (l.usage) c.usage = l.usage;
  }
  return hit;
}

/* ---------------- 分类：我方公司 + 细分（合作协议 / 证照 …） ---------------- */
// 「请选择印章的公司名称」是权威的我方主体：实测存在 deptName=产品部-陕西道同谦合科技发展有限公司
// 而用印公司=沧州玺归科技有限公司 的跨主体盖章，只按部门分会归错公司。
function extractSealCompany(formData) {
  const f = (formData || []).find(x => /印章的公司名称|用印主体|我方主体|我方单位/.test(String(x.label || '')));
  return f ? String(f.value || '').trim() : '';
}
function extractUsage(formData) {
  const f = (formData || []).find(x => /用印用途|用途说明/.test(String(x.label || '')));
  return f ? String(f.value || '').trim() : '';
}
// 部门名形如「售后服务事业部-北京易联新能源汽车技术服务有限公司」，末段才是公司；
// 也有「财务部」「人力资源部」这种不带公司的，返回 '' 交给用印公司兜底
function companyFromDept(deptName) {
  const segs = String(deptName || '').split(/[-－—>/、]+/).map(s => s.trim()).filter(Boolean);
  for (let i = segs.length - 1; i >= 0; i--) {
    if (/(公司|集团|厂|研究院|设计院|事务所|中心|基地)$/.test(segs[i])) return segs[i];
  }
  return '';
}
// 钉钉侧台账分类（directoryName）抽样 83/83 全是「未分类」，分类树没人挂，
// 所以细分主要靠名称+用印用途推断，页面上可人工改判（改判结果落盘，优先级最高）。
// 顺序即优先级：先具体后宽泛，「合同/协议」这类词放最后，否则人事、证照全被吞成合作协议。
const CAT_RULES = [
  ['证照资质', /证照|营业执照|登记|备案|许可证|资质|授权|委托书|认证|公函|开户|章程|印章|签章|鲜章|工商|证明|复印件|身份证/],
  ['人事劳动', /劳动|劳务|入职|离职|转正|用工|实习|返聘|保密|竞业|聘用|聘书|社保|公积金|员工|工伤|调岗|绩效|录用|健康承诺/],
  ['财务结算', /发票|开票|结算|对账|索赔|理赔|付款|收款|回款|还款|借款|担保|税|费用|赔偿|保证金|分红/],
  ['采购供应', /采购|供应|委外|外包|入库|出库|领料|调拨|询价/],
  ['销售租赁', /销售|租赁|出租|租金|加盟|订单|安装|维保|延保|报价单|验收单/],
  ['招投标', /招标|投标|中标|比选|竞争性/],
  ['安全消防', /消防|安全|应急预案|环保|生产安全|隐患|特种作业/],
  ['公文制度', /通知|规定|指南|制度|调查表|情况说明|会议纪要|公示|公告|举报|信访/],
  ['合作协议', /合同|协议|约定|合作|框架|补充|确认书|确认函|备忘录|意向书|承诺书|投保单|保单|保险/],
];
const CAT_OTHER = '其他';
const CAT_NON_LEAF = new Set(['未分类', '合同', '']);
function inferCat(text) {
  // 「补 充 协 议」这类字间空格是扫描件/手工录入的常态，不去空格会整批漏判
  const s = String(text || '').replace(/\s+/g, '');
  for (const [cat, re] of CAT_RULES) if (re.test(s)) return cat;
  return CAT_OTHER;
}
// 人工改判：{ corpId: { cid: { cat, company } } }，独立于补全台账（后者是钉钉的回填值，
// 这个是人的判断，重新补全绝不能覆盖它）
const CLASS_FILE = path.join(HERE, '.contract-classes.json');
const classOverrides = new Map();
function orgOverrides(corpId) {
  let m = classOverrides.get(corpId);
  if (!m) { m = new Map(); classOverrides.set(corpId, m); }
  return m;
}
try {
  const j = JSON.parse(readFileSync(CLASS_FILE, 'utf8'));
  for (const [corpId, byCid] of Object.entries(j || {})) {
    for (const [cid, v] of Object.entries(byCid || {})) {
      if (v && (v.cat || v.company)) orgOverrides(corpId).set(String(cid), { cat: v.cat || '', company: v.company || '' });
    }
  }
} catch { /* 还没人工改判过 */ }
function saveOverrides() {
  const nested = Object.fromEntries([...classOverrides].map(([corpId, m]) => [corpId, Object.fromEntries(m)]));
  try { writeFileSync(CLASS_FILE, JSON.stringify(nested, null, 1)); } catch { /* 目录只读时仅丢本次改判 */ }
}
function classifyContract(c, org) {
  const ov = orgOverrides(org.corpId).get(String(c.cid)) || {};
  c.company = ov.company || c.sealCompany || companyFromDept(c.dept) || '';
  c.companySrc = ov.company ? '人工' : (c.sealCompany ? '用印' : (c.company ? '部门' : ''));
  const dd = String(c.dir || '');
  if (ov.cat) { c.cat = ov.cat; c.catSrc = '人工'; }
  else if (!CAT_NON_LEAF.has(dd)) { c.cat = dd; c.catSrc = '钉钉'; }
  else { c.cat = inferCat(`${c.name} ${c.usage || ''}`); c.catSrc = '推断'; }
  return c;
}

// 「用印公司」就是本方盖章主体。集团内互盖章时钉钉把它填在相对方栏，
// 只按 OWN_COMPANY 别名会把自家子公司算成外部相对方（实测 22 家盖章节里有 18 家同时出现在相对方里）。
// 部门推断出来的公司不可靠，故只采信用印表单与人工改判两个来源。
function markOwnParties(org, contracts) {
  const names = ownAliasesFor(org.corpId, org.corpName);
  for (const c of contracts) if (c.company && c.companySrc !== '部门') names.push(c.company);
  for (const v of orgOverrides(org.corpId).values()) if (v.company) names.push(v.company);
  const isOwnParty = makeOwnPartyMatcher(names);
  let marked = 0;
  for (const c of contracts) {
    c.partyOwn = isOwnParty(c.party);
    if (c.partyOwn) marked++;
  }
  return { isOwnParty, names, marked };
}

function extractDates(formData) {
  let start = '', end = '';
  const startKw = ['生效日期', '开始日期', '合同开始', '签订日期', '签署日期', '起始日期', '生效'];
  const endKw = ['终止日期', '到期日期', '结束日期', '合同止', '截止日期', '到期'];
  for (const f of formData || []) {
    const lab = String(f.label || '');
    const val = String(f.value || '');
    if (!/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(val)) continue;
    if (!start && startKw.some(k => lab.includes(k))) start = val.slice(0, 10);
    else if (!end && endKw.some(k => lab.includes(k))) end = val.slice(0, 10);
  }
  return { start, end };
}
function extractParty(formData) {
  const our = (formData || []).find(f => /印章的公司名称|用印主体|我方主体|我方单位/.test(f.label || ''));
  const ourName = our ? String(our.value || '') : '';  const kw = ['相对方', '乙方', '客户名称', '客户', '供应商', '对方单位', '合作方', '付款方', '收款方', '交易对方', '甲方', '乙方名称'];
  const found = [];
  for (const f of formData || []) {
    const lab = String(f.label || '');
    const val = String(f.value || '');
    if (!val || !/公司|厂|所|局|院|中心|银行|合伙|集团/.test(val)) continue;
    if (!kw.some(k => lab.includes(k))) continue;
    found.push({ label: lab, value: val });
  }
  if (!found.length) return '';
  const ext = found.find(x => x.value !== ourName && !ourName.includes(x.value) && !x.value.includes(ourName)
    && /相对方|乙方|客户|供应商|付款方|甲方/.test(x.label));
  const pick = ext || found.find(x => x.value !== ourName && !ourName.includes(x.value) && !x.value.includes(ourName)) || found[0];
  return pick.value;
}
// 兜底：从合同名称推断相对方。台账里大量记录是「用印申请」表单，
// 只有用印信息、没有相对方字段，真实相对方往往写在合同/文件名称里，
// 如「某财产保险股份有限公司_投保单_501…」「TFS…-塞北绿源新能源科技有限公司2025.1.22」
// 「劳动合同--张某某」「理赔确认书 -北京易联」；也可能正相反：「钉钉企业组织认证申请公函--云帆」。
function partyFromName(name, ourName, aliases) {
  if (!name) return '';
  const clean = String(name)
    .replace(/^\s*\d+([._]\d+)*\s*[_]?\s*/, '')                       // 去掉开头编号：15_ / 3.2_
    .replace(/\.(doc|docx|pdf|xlsx?|wps|jpg|jpeg|png)\d*\s*$/i, '')   // 去掉扩展名
    .replace(/\s*[（(][^（）()]*[)）]\s*$/, '')                        // 去掉结尾括号：(1) （终版）
    .trim();
  if (!clean) return '';
  const ours = [ourName, ...(aliases || OWN_ALIASES_GLOBAL)].filter(Boolean);
  const notOurs = v => !ours.some(a => a.includes(v) || v.includes(a));

  // ① 最强信号：名称里直接出现「…公司/集团/院…」形态的主体（取首个）
  const m = clean.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,18}?(?:有限公司|股份公司|集团|公司|研究所|设计院|学院|大学|医院|银行|中心|商行|工作室|厂|院)/);
  if (m && notOurs(m[0])) return m[0];

  // ② 无分隔符时，名称整体就是一个「文件标题」，无法可靠切出相对方 → 放弃
  const parts = clean.split(/\s*[—–\-－_]+\s*|\s*[，,]\s*/).map(p => p.trim()).filter(Boolean);
  if (parts.length < 2) return '';
  const cand = parts[parts.length - 1];
  const c = cand.replace(/(委托|协议书?|合同|确认书|确认函|告知函|申请公函|投保单|采购单|方案|通知|模版|模板|扫描件|盖章|明细|清单|服务|更换|采购|销售|租赁)\s*$/i, '').trim();
  if (!c) return '';
  if (/^(劳动|租赁|安装|采购|销售|服务|保密|借调)?(合同|协议|确认书|模板|模版)$/.test(c)) return '';
  // 明确带机构后缀：直接采用
  if (/(公司|集团|厂|研究所|设计院|局|中心|银行|合伙|股份|工作室|商行|大学|学院|学校|医院|委会|协会)$/.test(c) && notOurs(c)) return c;
  // 末段短串（2~6 字，不含类型词）：人名或简称（张某某 / 城东公交 / 北京易联）
  if (c.length >= 2 && c.length <= 6 && !/合同|协议|确认|公司|委托|服务|租赁|采购|销售|方案|通知/.test(c) && notOurs(c)) return c;
  return '';
}
async function dwsContractDetail(org, contractId) {
  if (!contractId) return null;
  const key = `${org?.corpId || ''}:${contractId}`;
  const cached = dwsDetailCache.get(key);
  if (cached && Date.now() - cached.at < DETAIL_TTL) return cached.data;
  const j = await dwsBiz(org, ['contract', 'record', 'get', '--contract-id', String(contractId), '--format', 'json'], 60000);
  const rec = Array.isArray(j?.result) ? j.result[0] : null;
  if (!rec) return null;
  const fd = rec.formData || [];
  const { start, end } = extractDates(fd);
  const party = extractParty(fd);
  // 金额：优先顶层 contractAmount；为 0 时回退到表单「合同金额/总金额/价款」
  let amount = toNum(rec.contractAmount);
  if (!amount) {
    const amtF = (fd || []).find(f => /合同金额|总金额|价款|合同总价|金额/.test(f.label || ''));
    if (amtF) amount = toNum(amtF.value);
  }
  const files = [
    ...(rec.contractContentFiles || []),
    ...(rec.contractArchiveFiles || []),
    ...(rec.contractAttachmentFiles || []),
  ].filter(f => f && f.fileDownloadUrl).map(f => ({ name: f.fileName, url: f.fileDownloadUrl, type: f.fileType || '', size: f.fileSize || 0 }));
  const formFields = fd.filter(f => f.value !== '' && f.value !== null && f.value !== undefined)
    .slice(0, 40).map(f => ({ label: String(f.label || ''), value: String(f.value) }));
  const data = {
    cid: rec.contractId, no: rec.contractNo, name: rec.contractName,
    start, end, party,
    sealCompany: extractSealCompany(fd), usage: extractUsage(fd), dir: rec.directoryName || '',
    amount: toNum(rec.contractAmount), currency: rec.currencyCode === 'CNY' ? '¥' : (rec.currencyCode || '¥'),
    status: mapStatus(rec.contractStatus), owner: rec.ownerName || rec.committerName || '',
    dept: rec.deptName || '', signers: rec.signers || [], committer: rec.committerName || '',
    archivers: (rec.archivers || []).map(a => a.name),
    accounting: {
      restAmount: rec.restAmount, executedAmount: rec.executedAmount,
      restInvoice: rec.restInvoice, executedInvoice: rec.executedInvoice,
      receive: rec.otherReceiveFinishedAmount, pay: rec.otherPayFinishedAmount,
    },
    files, formFields,
  };
  dwsDetailCache.set(key, { at: Date.now(), data });
  return data;
}
async function enrichAllContracts(org, contracts) {
  // 同一时刻只跑一轮，避免叠加请求压垮 dws；本轮跑完再补最新一份
  if (enrichState.running) { enrichPending = { org, contracts }; return; }
  const targets = (ENRICH_MAX > 0 ? contracts.slice(0, ENRICH_MAX) : contracts).filter(c => c.cid);
  // 空台账（例如新组织还没有合同）不能占用这一轮：否则 running=false 后进度仍写着别的组织，
  // 前端会把「0/0」当成那个组织的补全结果
  if (!targets.length) return;
  Object.assign(enrichState, {
    running: true, org: org.corpName, corpId: org.corpId,
    total: targets.length, done: 0, filled: 0, errors: 0, startedAt: Date.now(), finishedAt: 0,
  });
  const ledger = orgLedger(org.corpId);
  let idx = 0;
  const worker = async () => {
    while (idx < targets.length) {
      const c = targets[idx++];
      const before = { start: c.start, end: c.end, party: c.party, company: c.company };
      try {
        const d = await dwsContractDetail(org, c.cid);
        if (d) {
          if (d.start) c.start = d.start;
          if (d.end) c.end = d.end;
          // 表单里的相对方是权威值，覆盖按名称推断的结果
          if (d.party && d.party !== '—') { c.party = d.party; c.partyInferred = false; }
          if (d.sealCompany) c.sealCompany = d.sealCompany;
          if (d.usage) c.usage = d.usage;
          if (d.dir) c.dir = d.dir;
          classifyContract(c, org);
          if ((c.start && c.start !== before.start) || (c.end && c.end !== before.end)
            || c.party !== before.party || c.company !== before.company) enrichState.filled++;
          if (c.start || c.end || c.party || c.sealCompany) {
            ledger.set(String(c.cid), {
              start: c.start || '', end: c.end || '', party: c.party || '',
              sealCompany: c.sealCompany || '', usage: c.usage || '',
            });
            if (enrichState.done % 100 === 0) saveLedger();
          }
        }
      } catch (e) { enrichState.errors++; }
      enrichState.done++;
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(10, targets.length) }, worker));
  } finally {
    enrichState.running = false;
    enrichState.finishedAt = Date.now();
    saveLedger();
    console.log(`[enrich] ${enrichState.org}：完成 ${enrichState.done}/${enrichState.total} 条，补全 ${enrichState.filled} 条，失败 ${enrichState.errors} 条，耗时 ${((Date.now() - enrichState.startedAt) / 1000).toFixed(0)}s`);
    if (enrichPending) {
      const next = enrichPending; enrichPending = null;
      enrichAllContracts(next.org, next.contracts).catch(() => {});
    }
  }
}

/* ---------------- 相对方工商信息 / 风险检测（dws） ---------------- */
async function dwsSubjectBaseInfo(org, name) {
  if (!name) return null;
  const j = await dwsBiz(org, ['contract', 'subject', 'base-info', '--subject-name', String(name), '--format', 'json'], 60000);
  return j?.result ?? j ?? null;
}
async function dwsSubjectRisk(org, name) {
  if (!name) return null;
  const j = await dwsBiz(org, ['contract', 'subject', 'detect-risk', '--subject-name', String(name), '--format', 'json'], 60000);
  return j?.result ?? j ?? null;
}

/* ---------------- 字段归一化（容忍不同字段名） ---------------- */
const STATUS_MAP = {
  approving: '待审批', signing: '签署中', canceled: '已作废', withdraw: '已撤销',
  refused: '已拒绝', 'not-archive': '待归档', 'archive-confirming': '归档确认中', archived: '已归档',
};
const EFFECT_MAP = {
  'not-effective': '未生效', 'pre-effective': '待生效', effective: '履行中',
  expired: '已到期', ineffective: '已完结', canceled: '已作废',
};
function pick(obj, keys) {
  for (const k of keys) { if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k]; }
  return undefined;
}
function toNum(v) {
  if (typeof v === 'number') return v;
  if (!v) return 0;
  const n = Number(String(v).replace(/[^\d.]/g, ''));
  return isNaN(n) ? 0 : n;
}
function mapStatus(raw) {
  if (!raw) return '履行中';
  const s = String(raw).trim().toLowerCase();
  if (STATUS_MAP[s]) return STATUS_MAP[s];
  if (EFFECT_MAP[s]) return EFFECT_MAP[s];
  // 已是中文则原样返回
  if (/履行中|待审批|已完结|已作废|签署中|待归档|已归档|已逾期/.test(s)) return raw;
  return '履行中';
}
function mapArchive(raw, status) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (/^1$|^true$|^y$|^yes$/i.test(s) || /archived|已归档/.test(s)) return '已归档';
  if (/^0$|^false$|^n$|^no$/i.test(s) || /not-archive|待归档/.test(s)) return '待归档';
  if (/confirming|确认中/.test(s)) return '归档确认中';
  if (status === '已归档') return '已归档';
  return '未归档';
}

function normalizeContract(raw) {
  const id = pick(raw, ['contractNo', 'contractNumber', 'htNo', 'contractId', 'id']) || '';
  const name = pick(raw, ['contractName', 'name', 'title', 'htName']) || '（未命名合同）';
  const party = pick(raw, ['partyName', 'secondParty', 'partyB', 'customerName', 'relativeName', 'partyBName'])
    || pick(raw, ['firstParty', 'partyA']) // 兜底
    || '—';
  const amount = toNum(pick(raw, ['amount', 'contractAmount', 'money', 'totalMoney', 'htMoney', 'totalAmount']));
  const status = mapStatus(pick(raw, ['contractStatus', 'status', 'htStatus']) || pick(raw, ['effectiveStatus']));
  const start = pick(raw, ['startTime', 'startDate', 'beginDate', 'effectDate']) || '';
  const end = pick(raw, ['endTime', 'endDate', 'expireDate', 'expireTime']) || '';
  const sign = pick(raw, ['signTime', 'signDate', 'createTime', 'gmtCreate']) || start || '';
  const owner = pick(raw, ['ownerName', 'owner', 'responsible', 'charger', 'chargeUserName']) || '—';
  const archive = mapArchive(pick(raw, ['archiveStatus', 'archived']), status);
  return {
    id, name, party, amount, currency: '¥',
    sign: String(sign).slice(0, 10), start: String(start).slice(0, 10), end: String(end).slice(0, 10),
    status, owner, archive, standard: '—', flag: false,
    clauses: [], archiveCheck: [], live: true,
  };
}

function buildParties(contracts) {
  const map = new Map();
  for (const c of contracts) {
    if (!c.party || c.party === '—') continue;
    map.set(c.party, (map.get(c.party) || 0) + 1);
  }
  return [...map.entries()].map(([name, n]) => ({
    name, type: '合作方', code: '—', level: '—',
    reasons: ['实时数据：工商风险维度需对接第三方工商库（天眼查/启信宝等）补充'], contracts: n,
  }));
}

async function fetchLiveData(orgQuery) {
  if (USE_DWS) {
    const org = await resolveOrg(orgQuery);
    // 缓存：首次拉取约 50s（需递归二分翻页），之后 5 分钟内直接返回。
    // 缓存过期时的多个并发请求共享同一次拉取，否则会各拉一遍、彼此拖慢。
    const key = org.profile || 'default';
    const hit = dwsCache.get(key);
    if (hit && hit.data && Date.now() - hit.at < 300000) return hit.data;
    const flying = dwsInflight.get(key);
    if (flying) return flying;
    const p = fetchDwsData(org)
      .then(d => { dwsCache.set(key, { at: Date.now(), data: d }); return d; })
      .finally(() => { dwsInflight.delete(key); });
    dwsInflight.set(key, p);
    return p;
  }
  let rawList;
  if (USE_SYNC) {
    // 连接流入参声明的 currentPage/pageSize 为 number 类型，须传数字
    rawList = await invokeSyncFlow({ currentPage: 1, pageSize: 50 });
  } else {
    rawList = await invokeConnector(C_LIST, { currentPage: '1', pageSize: '50' });
  }
  // 兼容多种返回结构（不同连接器/连接流的出参形态不一）
  let arr = [];
  const candidates = [
    rawList,
    rawList?.data,
    rawList?.data?.list,
    rawList?.data?.data?.list,
    rawList?.result?.list,
    rawList?.result?.data?.list,
    rawList?.list,
    rawList?.records,
    rawList?.output?.list,
    rawList?.output?.data?.list,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) { arr = c; break; }
  }

  const contracts = arr.map(normalizeContract).filter(c => c.id);
  const parties = buildParties(contracts);
  const result = {
    mode: 'live',
    contracts,
    parties,
    accounting: [], // 实时数据未含账款明细，前端展示空态并提示
    borrows: [],    // 实时数据未含借阅记录
  };
  // 实时返回 0 条时附带钉钉原始响应，便于前端直接诊断（无需再开调试面板）
  if (contracts.length === 0) {
    result.empty = true;
    result.rawResponse = lastSyncRaw;
  }
  return result;
}

/* ---------------- HTTP 服务 ---------------- */
function send(res, code, obj, cors = true) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    ...(cors ? { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } : {}),
  });
  res.end(body);
}

const NO_SERVER = process.env.NO_SERVER === '1';
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { send(res, 204, {}); return; }
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  try {
    if (p === '/api/health') return send(res, 200, { status: 'ok' });

    if (p === '/api/dingtalk/status') {
      return send(res, 200, {
        mode: !LIVE ? 'demo' : (USE_DWS ? 'live-dws' : (USE_SYNC ? 'live-sync' : 'live')),
        configured: LIVE,
        channel: USE_DWS ? 'dws' : (USE_SYNC ? 'sync' : (LIVE ? 'openapi' : 'none')),
      });
    }

    // 已授权的钉钉组织清单（= dws profile）。前端据此渲染组织切换器，多一个授权就多一个选项
    if (p === '/api/dingtalk/orgs') {
      if (!USE_DWS) return send(res, 501, { message: '仅 dws 模式支持多组织' });
      try { return send(res, 200, { orgs: await dwsOrgs() }); }
      catch (e) { return send(res, 502, { message: String(e && e.message || e) }); }
    }

    if (p === '/' || p === '/index.html') {
      // 直接托管前端页面，`node server.js` 后打开 http://localhost:8787 即可用，无需另起静态服务
      try {
        const page = readFileSync(path.join(HERE, 'index.html'));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(page);
      } catch { return send(res, 404, { message: 'index.html 不存在（请与 server.js 放同级目录）' }); }
    }

    if (p === '/api/dingtalk/enrich-status') {
      return send(res, 200, enrichState);
    }

    if (p === '/api/dingtalk/bootstrap') {
      if (!LIVE) return send(res, 501, { mode: 'demo', message: '未配置钉钉凭证，前端使用本地演示数据' });
      const data = await fetchLiveData(url.searchParams.get('org'));
      return send(res, 200, data);
    }

    if (p === '/api/dingtalk/raw') {
      if (!USE_SYNC) return send(res, 501, { message: '仅「同步调用模式」支持 /raw，请配置 DINGTALK_SYNC_URL' });
      try {
        const parsed = await invokeSyncFlow({ currentPage: 1, pageSize: 50 });
        return send(res, 200, { raw: lastSyncRaw, parsed });
      } catch (e) {
        return send(res, 200, { raw: lastSyncRaw, error: String(e && e.message || e) });
      }
    }

    if (p.startsWith('/api/dingtalk/contract/')) {
      if (!USE_DWS) return send(res, 501, { message: '仅 dws 模式支持合同详情补全' });
      const cid = p.split('/').pop();
      if (!/^\d+$/.test(cid)) return send(res, 400, { message: '合同 ID 无效' });
      try {
        // 合同 ID 只在组织内唯一，详情必须按当前台账所属组织去查
        const d = await dwsContractDetail(await resolveOrg(url.searchParams.get('org')), Number(cid));
        return send(res, d ? 200 : 404, d || { message: '未找到合同详情' });
      } catch (e) { return send(res, 502, { message: String(e && e.message || e) }); }
    }

    if (p === '/api/dingtalk/subject-info') {
      if (!USE_DWS) return send(res, 501, { message: '仅 dws 模式支持' });
      const name = url.searchParams.get('name');
      if (!name) return send(res, 400, { message: '缺少 name 参数' });
      try { return send(res, 200, await dwsSubjectBaseInfo(await resolveOrg(url.searchParams.get('org')), name)); }
      catch (e) { return send(res, 502, { message: String(e && e.message || e) }); }
    }

    if (p === '/api/dingtalk/subject-risk') {
      if (!USE_DWS) return send(res, 501, { message: '仅 dws 模式支持' });
      const name = url.searchParams.get('name');
      if (!name) return send(res, 400, { message: '缺少 name 参数' });
      try { return send(res, 200, await dwsSubjectRisk(await resolveOrg(url.searchParams.get('org')), name)); }
      catch (e) { return send(res, 502, { message: String(e && e.message || e) }); }
    }

    // 人工改判「公司 / 细分」。只写本地 .contract-classes.json，不回写钉钉。
    if (p === '/api/dingtalk/classify' && req.method === 'POST') {
      if (!USE_DWS) return send(res, 501, { message: '仅 dws 模式支持改判分类' });
      let body = '';
      for await (const ch of req) body += ch;
      let input;
      try { input = JSON.parse(body || '{}'); } catch { return send(res, 400, { message: '请求体不是合法 JSON' }); }
      const cid = String(input.cid || '');
      if (!/^\d+$/.test(cid)) return send(res, 400, { message: '合同 ID 无效' });
      let org;
      try { org = await resolveOrg(input.org || url.searchParams.get('org')); }
      catch (e) { return send(res, 400, { message: String(e && e.message || e) }); }
      const m = orgOverrides(org.corpId);
      const next = { ...(m.get(cid) || {}) };
      if ('cat' in input) next.cat = String(input.cat ?? '');
      if ('company' in input) next.company = String(input.company ?? '');
      if (!next.cat && !next.company) m.delete(cid); else m.set(cid, next);
      saveOverrides();
      // 立刻作用到内存缓存里的那一份，否则要等 5 分钟列表缓存过期才看得到改动
      const cached = dwsCache.get(org.profile || 'default');
      const list = cached?.data?.contracts || [];
      let hit = null;
      for (const c of list) if (String(c.cid) === cid) hit = classifyContract(c, org);
      // 改判的我方公司会改变「哪些相对方其实是自家盖章主体」，重算一遍标记
      if (list.length) markOwnParties(org, list);
      return send(res, 200, {
        ok: true, cid, cat: hit?.cat || '', company: hit?.company || '',
        companySrc: hit?.companySrc || '', overrides: m.size,
      });
    }

    if (p === '/api/dingtalk/proxy' && req.method === 'POST') {
      if (!LIVE) return send(res, 501, { message: '未配置钉钉凭证' });
      // 写操作（归档/转交/完结）需要方式二凭证；方式一同步地址通常为只读查询
      if (USE_SYNC && !(APP_KEY && APP_SECRET)) {
        return send(res, 501, {
          message: '当前为「同步调用只读模式」，写操作（归档/转交/完结）需配置方式二：DINGTALK_APP_KEY/SECRET 与对应动作 assetUri',
        });
      }
      let body = '';
      for await (const ch of req) body += ch;
      const { assetUri, input, action } = JSON.parse(body || '{}');
      const uri = assetUri || ({ archive: C_ARCHIVE, transfer: C_TRANSFER, complete: C_COMPLETE, detail: C_DETAIL }[action] || '');
      if (!uri) return send(res, 400, { message: '缺少连接器 assetUri 或未配置对应动作环境变量' });
      const out = await invokeConnector(uri, input || {});
      return send(res, 200, { output: out });
    }

    return send(res, 404, { message: 'not found' });
  } catch (e) {
    return send(res, 500, { message: String(e && e.message || e) });
  }
});

if (!NO_SERVER) {
  server.listen(PORT, () => {
    console.log(`智能合同连接器后端已启动： http://localhost:${PORT}`);
    console.log(LIVE
      ? `模式：LIVE（${USE_DWS ? 'dws 直连智能合同（推荐）' : (USE_SYNC ? '连接流同步调用地址' : 'OpenAPI 直连')}）`
      : '模式：DEMO（未配置钉钉凭证，前端使用本地演示数据）');
    if (USE_DWS) {
      dwsOrgs()
        .then(list => console.log(`已授权组织（dws profile）：${list.map(o => o.corpName + (o.isCurrent ? '（当前）' : '')).join(' | ') || '无'}`))
        .catch(() => console.log('已授权组织：读取失败（dws profile list）'));
    }
  });
}

export { fetchLiveData, invokeSyncFlow, normalizeContract, buildParties, enrichAllContracts, dwsContractDetail, extractDates, extractParty, partyFromName };
