// 舆情监控日志 - 写入助手
// 由"每日 AI 新闻推送"自动化任务调用：将当日舆情汇总
//   (1) upsert 到 Supabase sentiment_log 表（若已建表）
//   (2) 合并进 GitHub 仓库的静态 sentiment-data.json 并推送（无需建表即可展示，兜底通道）
// 用法: node push_sentiment.js <json文件路径>
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SUPABASE_URL = 'https://bbiddukkkxthtairizlk.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJiaWRkdWtra3h0aHRhaXJpemxrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMzNzM4NjIsImV4cCI6MjA5ODk0OTg2Mn0.VBt4kQI-YXJKSw5TRWjH8uNXCljYxO6IW8ACi89wgXo';
const TABLE = 'sentiment_log';
const REPO = 'herman-yan/doc-vault';
const JSON_PATH = 'sentiment-log/sentiment-data.json';
const BRANCH = 'main';

const input = process.argv[2];
if (!input) {
  console.error('用法: node push_sentiment.js <json文件路径>');
  process.exit(1);
}

let record;
try {
  record = JSON.parse(fs.readFileSync(input, 'utf8'));
} catch (e) {
  console.error('读取 JSON 失败:', e.message);
  process.exit(1);
}
if (!record.log_date) {
  console.error('记录缺少 log_date 字段');
  process.exit(1);
}

const normalized = {
  log_date: record.log_date,
  title: record.title || '',
  summary: record.summary || '',
  risk_level: record.risk_level || '低',
  risk_count: record.risk_count || 0,
  sources_count: record.sources_count || 0,
  items: record.items || []
};

// ---------- 通用 https 请求 ----------
function httpReq(opts, bodyStr) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      let out = '';
      res.on('data', c => out += c);
      res.on('end', () => resolve({ status: res.statusCode, body: out }));
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ---------- (1) Supabase upsert ----------
async function pushSupabase() {
  try {
    const r = await httpReq({
      hostname: 'bbiddukkkxthtairizlk.supabase.co',
      path: '/rest/v1/' + TABLE + '?on_conflict=log_date',
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal'
      }
    }, JSON.stringify([normalized]));
    if (r.status >= 200 && r.status < 300) return { ok: true };
    return { ok: false, msg: 'status=' + r.status + ' ' + r.body.slice(0, 200) };
  } catch (e) {
    return { ok: false, msg: e.message };
  }
}

// ---------- 读取本机 GitHub token ----------
function readGithubToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    const cred = fs.readFileSync(path.join(os.homedir(), '.git-credentials'), 'utf8');
    const m = cred.match(/https:\/\/([^:@\n]+)(?::([^@\n]+))?@github\.com/);
    if (m) return m[2] || m[1];
  } catch (e) {}
  return null;
}

// ---------- (2) 合并进静态 JSON 并推送 GitHub ----------
async function pushStaticJson() {
  const token = readGithubToken();
  if (!token) return { ok: false, msg: '未找到 GitHub token（跳过静态 JSON 更新）' };
  const apiHost = 'api.github.com';
  const apiPath = '/repos/' + REPO + '/contents/' + JSON_PATH;
  const ghHeaders = {
    'Authorization': 'token ' + token,
    'User-Agent': 'sentiment-pusher',
    'Accept': 'application/vnd.github.v3+json'
  };
  // GET 现有文件
  let existing = [];
  let sha = null;
  try {
    const g = await httpReq({ hostname: apiHost, path: apiPath + '?ref=' + BRANCH, method: 'GET', headers: ghHeaders });
    if (g.status === 200) {
      const j = JSON.parse(g.body);
      sha = j.sha;
      const content = Buffer.from((j.content || '').replace(/\n/g, ''), 'base64').toString('utf8');
      const parsed = JSON.parse(content);
      existing = Array.isArray(parsed) ? parsed : (parsed.logs || []);
    }
  } catch (e) { /* 文件不存在则新建 */ }
  // 合并去重（按 log_date）
  existing = existing.filter(x => x && x.log_date !== normalized.log_date);
  existing.unshift(normalized);
  existing.sort((a, b) => (b.log_date || '').localeCompare(a.log_date || ''));
  const newContent = Buffer.from(JSON.stringify(existing, null, 2), 'utf8').toString('base64');
  const putBody = { message: '舆情日志更新: ' + normalized.log_date, content: newContent, branch: BRANCH };
  if (sha) putBody.sha = sha;
  try {
    const p = await httpReq({
      hostname: apiHost, path: apiPath, method: 'PUT',
      headers: Object.assign({}, ghHeaders, { 'Content-Type': 'application/json' })
    }, JSON.stringify(putBody));
    if (p.status >= 200 && p.status < 300) return { ok: true, total: existing.length };
    return { ok: false, msg: 'status=' + p.status + ' ' + p.body.slice(0, 200) };
  } catch (e) {
    return { ok: false, msg: e.message };
  }
}

(async () => {
  const sb = await pushSupabase();
  console.log(sb.ok ? '✅ Supabase 写入成功 (' + normalized.log_date + ')' : '⚠ Supabase 未写入: ' + sb.msg);
  const st = await pushStaticJson();
  console.log(st.ok ? '✅ 静态 JSON 已更新并推送 (' + normalized.log_date + '，累计 ' + st.total + ' 天)' : '⚠ 静态 JSON 未更新: ' + st.msg);
  if (sb.ok || st.ok) {
    console.log('✔ 舆情日志已存储，页面可展示。');
    process.exit(0);
  } else {
    console.log('❌ 两条通道均失败，请检查网络/凭据。');
    process.exit(1);
  }
})();
