# 智能合同管理系统（补齐钉钉标准版缺失的中级/高级能力）

纯前端、规则驱动、**不调用任何大模型**的网页应用，用于补齐钉钉「智能合同」标准版未开通的中级 / 高级能力：审批比对、归档比对、智能风控、到期提醒、账款发票、相对方管理、模板与编号、批量归档/转交/完结、借阅归还、统计看板。

> **本副本已脱敏**：文中的组织名、公司名、合同编号、corpId 与合同份数都是占位或概数；`.env`、真实合同补全台账 `.enrich-ledger.json`、人工改判文件 `.contract-classes.json` 不入库。真实数据只存在于经办者本机。
> **静态托管说明**：GitHub Pages 只能托管静态文件，本页从 Pages 打开时没有本机后端，会自动落到内置演示数据；接入真实合同需在本人机器上运行 `node server.js`（见下文）。

- `index.html` —— 单文件离线网页，**双击即可在浏览器打开**，默认演示模式（内置数据，无需联网/密钥）。
- `server.js` —— 可选的零依赖 Node 后端，用于**接入真实钉钉智能合同**，把真实合同数据拉回网页；同时**直接托管前端页面**。

```bash
node server.js          # 然后浏览器打开 http://localhost:8787 即可使用
```
（也支持双击 `index.html` 离线打开：此时把「后端地址」填成 `http://localhost:8787` 后点「连接」。）

---

## 一、如何连接到钉钉的智能合同（关键说明）

钉钉「智能合同」的数据**不是**一套裸露的 CRUD 接口，而是通过**「连接平台 → 智能合同官方连接器」**（背后 ISV 为签小侠）暴露。本项目三种方式都已支持，**主路径 = 方式三（本机 dws CLI 直连）**，已确认采用；方式一、方式二保留为备用通道，不配置即不启用。

### 方式一：连接流「同步调用」（低代码，备用通道 · 本项目已搁置）
1. 钉钉开发者后台 → **开放能力 → 连接平台 → 我的连接流 → 创建连接流**。
2. 触发事件选「内置工具 — 子流程 — 当被调用时触发」，设置入参。
3. 执行动作节点选「**官方连接器 → 智能合同 → 分页查询合同详情**」（该连接器目前只暴露这一个查询动作 + 归档，**没有**叫「查询合同列表」的动作）。入参 `staffId` **必须映射**（如接「流程参数 → 当前员工 UserId」），否则服务端抛未捕获异常，表现为 `success:false` + 通用错误码 + `errorMsg` 为空。
4. **打开「同步调用开关」** → 触发事件会显示「同步调用地址」，发布后即可用 POST + 该地址调用。
   - 本项目 `server.js` 已原生支持方式一：把该地址填入 `.env` 的 `DINGTALK_SYNC_URL`，启动后即走此通道，**无需 AppKey / Secret**。

> 现状：本组织已按上述步骤建好连接流并调通到 `success:true`，但**未发布**、同步调用地址不可用，数据也仍不完整。既然方式三已稳定取到全量合同，这条通道**暂时搁置**，需要时再补发布与出参映射。

### 方式二：OpenAPI 直接调用连接器执行动作（备用通道）
所有动作统一走一个接口：

```
POST https://api.dingtalk.com/v1.0/connector/instances/invoke
Header: x-acs-dingtalk-access-token: <access_token>
Body:
{
  "connectAssetUri": "dca://<连接器域名>/<连接器ID>/action/<动作ID>",  // 如「分页查询合同详情」的 AssetUri
  "instanceKey": "smart-contract-web",
  "inputJsonString": "{\"currentPage\":\"1\",\"pageSize\":\"50\"}"
}
```
返回 `outputJson`（字符串，需二次 JSON 解析）即结果。`分页查询合同详情` 支持的筛选入参：`currentPage`、`pageSize`、`staffId`（**必填**）、`corpId`、`contractName`、`contractNo`、`contractStatusList`（审批中/签署中/已作废/已撤销/已拒绝/待归档/归档确认中/已归档）、`effectiveStatusList`（未生效/待生效/生效中/已到期/已完结/已作废）、`createStartTime` 等。**没有** `pageNumber` 这个字段。

### 方式三（主路径·零配置）：本机 dws CLI 直连

无需建连接流、无需 AppKey/Secret。只要本机已登录 `dws`（钉钉官方 Workspace CLI，`dws auth login` 完成授权），`server.js` 会自动调用 `dws contract` 直接拉取真实合同台账、相对方、归档等数据。

```bash
# 1) 安装并登录 dws（首次）
npm i -g dingtalk-workspace-cli
dws auth login            # 浏览器完成钉钉 OAuth 授权

# 2) 配置（二选一）
export DINGTALK_SOURCE=dws          # 显式指定走 dws
#   或不设 DINGTALK_SOURCE，只要 dws 可用且已登录，server 自动选用

# 3) 启动（其余变量可留空）
node server.js            # 自动识别 dws 模式，拉取真实合同
```

> 优势：绕过「连接流」画布配置，直接命中钉钉智能合同数据；支持 `dws contract` 的台账/相对方/账款/归档/审查等全套能力。拉取采用时间递归二分翻页，可一次取全量（实测数百份约半分钟，结果内存缓存 5 分钟）。

### 鉴权（拿 access_token）
用**企业内部应用**的 AppKey / AppSecret：

```
POST https://api.dingtalk.com/v1.0/oauth2/accessToken
Body: { "appKey": "<AppKey>", "appSecret": "<AppSecret>" }
→ 返回 { "accessToken": "...", "expireIn": 7200 }
```
把 `accessToken` 放到后续每个请求的 `x-acs-dingtalk-access-token` 头（有效期 7200 秒，需缓存；本项目后端已自动缓存）。

> 注意：电子签（E签宝）相关接口在 `api.dingtalk.com/v2.0/esign/...`（权限「E签宝数据管理权限」），合同**审批**走钉钉审批 OpenAPI（智能合同审批表单为控件组）。本项目聚焦「智能合同连接器」拿到的合同台账与管理数据。

---

## 二、接入步骤（本项目）

1. **建应用并授权**
   - 钉钉开发者后台 → 应用开发 → 创建**企业内部应用（H5 微应用）**，记录 AppKey、AppSecret。
   - 在「连接平台」确认已启用「智能合同」官方连接器；记录你要用的各个**执行动作的 connectAssetUri**（在连接器详情/连接流节点里可复制）。

2. **配置后端环境变量**（复制后填值，**三种方式任选其一**）
   ```bash
   cp .env.example .env

   # 方式三（主路径·零配置）：本机 dws 已登录即可，其余行可全部留空
   export DINGTALK_SOURCE=dws

   # 方式一（低代码）：只填同步调用地址，无需 AppKey/Secret
   #   注意：只要本机 dws 可用，server 会优先走 dws；要强制走连接流须同时设 DINGTALK_SOURCE=sync
   export DINGTALK_SOURCE=sync
   export DINGTALK_SYNC_URL=https://connector.dingtalk.com/webhook/subflow/你的地址

   # 方式二（OpenAPI 直连）：填 AppKey/Secret + 连接器动作地址
   export DINGTALK_SOURCE=openapi
   export DINGTALK_APP_KEY=你的AppKey
   export DINGTALK_APP_SECRET=你的AppSecret
   export DINGTALK_CONNECTOR_LIST_URI=分页查询合同详情的AssetUri
   export DINGTALK_CONNECTOR_DETAIL_URI=查询合同详情的AssetUri   # 可选
   export DINGTALK_CONNECTOR_ARCHIVE_URI=归档的AssetUri          # 可选（写操作）
   export DINGTALK_CONNECTOR_TRANSFER_URI=转交的AssetUri         # 可选（写操作）
   export DINGTALK_CONNECTOR_COMPLETE_URI=完结的AssetUri         # 可选（写操作）
   ```

3. **启动后端**
   ```bash
   node server.js
   # 默认监听 http://localhost:8787
   # 未配置凭证时自动进入 demo 模式，前端仍可用本地演示数据
   ```

4. **网页接入**
   - 浏览器直接打开 `http://localhost:8787`（后端已托管页面，无需另起静态服务）；若是双击打开 `index.html`，则把右上角「后端地址」填成 `http://localhost:8787`。
   - 「数据来源」选 **钉钉实时**，点击 **连接**。
   - 连接成功后即展示真实合同台账，并复用规则引擎生成到期提醒、风控基线、统计与批量操作。
   - dws 模式下页面顶部会显示 `钉钉实时 · 补全中 x/y`，逐合同补全跑完后**自动刷新**并提示「共 N 份合同中 M 份含起止日期」。

---

## 三、能力边界（哪些实时、哪些需补充）

下表「实测」列为本组织数百份真实合同的实测结果（dws 直连）：

| 能力 | 实时数据下表现 | 实测 |
|------|----------------|------|
| 合同台账 / 状态 / 统计看板 | ✅ 基于真实合同数据驱动；状态取**履行状态**（履行中/未生效/…），归档状态单列 | 数百份 |
| 我方公司 / 细分分类 | ✅ 本系统推导（见「四、接口清单 · 分类」），钉钉台账目录不可用 | 用印公司几乎全覆盖，识别出 20 余个我方主体；细分「其他」约占 12% |
| 合同起止日期 | ✅ 由 `dws contract record get` 的表单字段（合同生效/终止日期）解析 | **约三成**（其余多为「用印申请」表单，本身未登记合同期限，网页如实显示「该合同表单未登记生效/终止日期」） |
| 逐合同相对方 | ✅ 优先取表单里的权威相对方（付款方/收款方/乙方…）；表单没有时按合同名称推断并标注「推断」 | **约四成**（权威字段少数 + 名称推断为主），唯一相对方百余个 |
| 合同文件 | ✅ 详情接口返回下载链接（投保单、费率告知单等真实附件） | ✅ |
| 账款信息 | ✅ 详情接口返回应收余额/已执行金额/收付款（部分合同为「—」属正常） | 多数为 0（用印类记录不带账款） |
| 相对方管理 / 工商风险 | ⚠️ 由合同相对方自动聚合；工商信息/风险检测属钉钉**付费能力**，未开通时如实显示空态（亦可接天眼查/启信宝补充） | 本组织未开通，接口返回 `{}` / `{"freeBenefitRestEnough":false}` |
| 智能风控（基线） | ✅ 到期/状态/金额驱动；条款级风险需补充条款文本 | ✅ |
| 审批比对 / 归档比对 | ⚠️ 需在网页粘贴「定稿条款」与「扫描件条款」文本，由本地规则引擎比对（实时接口不返回条款原文） | — |
| 批量归档 / 转交 / 完结 | 前端状态更新；真实写操作需配置对应连接器动作 AssetUri（走 `/api/dingtalk/proxy`） | — |
| 借阅归还 | 前端台账；真实借阅记录需连接器提供对应动作 | — |

> 关于「相对方来自推断」：本组织的主体库（`dws contract subject list`）里只有我方自己一条记录，没有相对方名册，且列表接口的 `oppositeParties` 为 `null`，因此相当一部分相对方只能从合同/文件名称中解析。为避免污染台账，解析遵循**宁可为空**原则：只在名称中出现明确的机构后缀（…公司/集团/院…）或分隔符后的明确主体时才采用，纯文件标题一律留空显示「未识别」。被推断出的值在界面上都带「推断」标记，打开详情后会以表单里的权威值自动覆盖。

> 字段名对齐：不同企业「智能合同」实例返回的合同对象字段名可能略有差异。`server.js` 内 `normalizeContract()` 已做多别名容错；若你的返回字段名特殊，按该函数提示补充别名即可。

---

## 四、接口清单（后端）

- `GET  /` — 托管前端页面（`index.html`），无需另起静态服务
- `GET  /api/health` — 健康检查
- `GET  /api/dingtalk/status` — `{ mode: 'live-dws'|'live-sync'|'live'|'demo', configured, channel: 'dws'|'sync'|'openapi'|'none' }`
- `GET  /api/dingtalk/orgs` — 本机 dws 已授权的**组织清单**（即 `dws profile list`）：`{ orgs: [{ profile, corpId, corpName, userId, userName, isCurrent }] }`，前端据此渲染组织下拉；仅 dws 模式
- `GET  /api/dingtalk/bootstrap?org=` — 拉取并归一化真实数据（demo 模式返回 501）。`org` 传 `corpId` 或 `corpId:userId`，留空则用 dws 当前组织；`stats` 里含 `{ dwsCalls, sourceTotal, loaded, ledgerHits }`：`sourceTotal` 取钉钉 `record list` 顶层窗口的 `totalCount`（即该组织合同总数），前端概览据此渲染**数据源对账**卡片（总数 vs 已接入 + 覆盖率进度条，缺份时给出重试指引；演示模式下不显示）。响应另含 `org: { corpId, corpName, userName }`
- `GET  /api/dingtalk/enrich-status` — 后台逐合同补全进度 `{ running, org, corpId, total, done, filled, errors, startedAt, finishedAt }`
- `GET  /api/dingtalk/contract/:cid?org=` — **逐合同详情补全**（方式三 dws）：返回起止日期、相对方、合同文件下载链接、账款、表单字段（前端打开合同详情时自动调用）。`cid` 只在组织内唯一，故必须带 `org`
- `GET  /api/dingtalk/subject-info?name=&org=` — 相对方工商信息（需钉钉智能合同工商库能力）
- `GET  /api/dingtalk/subject-risk?name=&org=` — 相对方风险检测（需钉钉智能合同风险检测能力，**付费**）
- `POST /api/dingtalk/classify` — **人工改判分类**：`{ org, cid, cat?, company? }`（空串=交回自动判定），写入本机 `.contract-classes.json` 并同步更新内存缓存里那份合同，返回 `{ ok, cid, cat, company, companySrc, overrides }`；**不回写钉钉**
- `POST /api/dingtalk/proxy` — 转发连接器写操作：`{ assetUri? , action?, input }`

### 多组织（同一钉钉账号授权了多家公司）
`dws` 的一个 profile 就是一个「组织 + 账号」，因此多组织不需要第二套凭证：

1. 在终端执行 `dws auth login` 并选择另一个组织（**登录是身份动作，需你自己完成**）；`dws profile list` 可核对。
2. 打开页面点「连接」，右上角出现组织下拉，切换即重取该组织的台账（首次约 1 分钟上下）。
3. 后端所有 dws 业务调用都显式带 `--profile <corpId>:<userId>`，**列表缓存、详情缓存、补全台账一律按 corpId 分键**，页面上方「数据源对账」卡片与到期/逾期统计只统计当前组织，绝不跨组织合并（合同 ID 只在组织内唯一，合并会串数据）。
4. 选了未登录的组织会直接报错并列出可用组织，不会静默回退成当前组织的数据；前端随即把下拉拨回页面真实数据所属的组织。

> 实测（两个组织）：北京云帆科技集团有限公司 `sourceTotal = loaded = ledgerHits`（全量取到、全量命中补全台账）；安捷(北京)汽车服务有限公司连接正常但 `totalCount 0`，页面按「该组织暂无可读合同」如实提示（不再挂连接器失败清单）。

> 我方主体别名必须按组织归属：某组织的「我方」在另一组织里可能正是相对方。因此 `OWN_COMPANY` 支持 `corpId=A,B;corpId2=C` 的分组织写法，且**各组织自身的 `corpName` 自动算作我方**，第二个组织一般无需配置。

### 分类：我方公司 + 细分（两级）
钉钉标准版的台账没有可用的第二级分类（`directoryName` 实测全是「未分类」），所以分类由本机推导，**不回写钉钉**：

- **我方公司（`company`）**：优先级 `人工改判 > 表单「请选择印章的公司名称」（`companySrc='用印'`）> 部门路径末段的公司名（`'部门'`）。用印公司与部门所属公司可能不同（一份合同由 A 公司经办、盖 B 公司的章），以印章为准。
- **细分（`cat`）**：优先级 `人工改判 > 钉钉台账目录（非「未分类」时）> 按 `CAT_RULES` 关键词推断（`'推断'`）`。规则顺序即优先级：证照资质 → 人事劳动 → 财务结算 → 采购供应 → 销售租赁 → 招投标 → 安全消防 → 公文制度 → 合作协议 → 其他。推断前会去掉全部空白（扫描件/手工录入常见「补 充 协 议」这种字间空格，不去空格会整批漏判）。
- **人工改判落盘 `.contract-classes.json`**：`{ corpId: { cid: { cat, company } } }`，前端合同详情里的「分类」卡片即可改判（仅实时模式可见），改动立刻作用于当前缓存并持久化，重启后仍生效。
- **前端呈现**：合同台账是**两级筛选** —— 先按公司（chips 带份数），细分 chips 只在当前公司范围内统计；相对方管理按**用印公司分组**（列内 `公司 ×N` 展开该相对方在各主体的用印次数）。

> 实测（北京云帆，数百份）：`companySrc` 几乎全为「用印」（人工改判只个别），识别出 20 余个我方盖章主体；`catSrc` 以「推断」为主；「其他」约占 12%；相对方可按用印公司拆分筛选。

**用印公司不算相对方**：本组织是**用印登记台账**，集团内子公司互盖章时，钉钉把「盖的章」（=我方另一家主体）填在相对方栏。因此后端把 `companySrc` 为「用印/人工」的公司全部视为我方主体（`OWN_COMPANY` 别名之外自动生效，无需手工维护），在合同上打 `partyOwn=true` 并从 `parties` 中剔除；台账给这类相对方显示「集团内」标记，相对方面板排除它们并在右上角注明排除份数（`stats.partyOwnContracts`）。
命中规则比 `OWN_COMPANY` 的包含匹配更严：全称完全相等直接算我方；否则要求相对方名长度 ≥4 才允许包含匹配。原因 —— 用印表单里常写简称（`大同恒远` → `大同恒远新能源科技有限公司`），而按合同名推断出的碎片（`新能源`）会同时命中十几家自家公司全称，一律包含匹配会误伤真实外部相对方。简称短于 4 字的（如 两字简称）会漏判、仍显示为外部相对方，属可接受的保守偏差。

> 实测：该规则把约一成合同的「相对方」识别为集团内用印主体并排除，外部相对方名单中不再有自家子公司全称。

### 后台列表补全（方式三）
为让合同台账/到期看板也具备起止日期与相对方，`server.js` 在拉取全量合同后会在**后台**逐份调用详情接口补全（并发 10，不阻塞首次返回，结果随内存缓存生效，进度见 `/api/dingtalk/enrich-status`）。可用环境变量控制：
- `ENRICH_OFF=1` — 关闭后台补全（首次返回更快，但台账日期/相对方为空，需打开详情才补全）
- `ENRICH_MAX=200` — 仅补全前 N 份（默认 0 = 全部）
- `OWN_COMPANY` — 我方主体别名，避免把我方当作相对方（默认值里给了一个示例 corpId 的主体，换成本组织的即可；见上文多组织说明）

> 实测：数百份合同全量补全约 **1~2 分钟、0 失败**。`dws` 是 Go 二进制，并发过高会崩溃，因此所有 dws 调用都经过一个并发上限为 6 的信号量，并带 3 次重试；信号量只包住「真正启动子进程」的那一步，不会包住递归函数（否则父调用持槽等子调用会死锁）。

> **补全结果台账 `.enrich-ledger.json`**：列表接口本身不返回起止日期，补全结果原先只存在于内存缓存里 —— 缓存 5 分钟过期后重新拉取（以及任何一次重启）会让全部合同的日期同时清零，表现为「90天内到期 / 已逾期 / 到期提醒」突然全部变 0，约 2~3 分钟后才随新一轮补全恢复。现在补全到的字段会按 `corpId + cid` 记账并落盘（文件 `.enrich-ledger.json` 形如 `{ corpId: { cid: {start,end,party,sealCompany,usage} } }`；每 100 条与每轮结束时各写一次），重拉时先贴回，因此**重启和缓存过期都不再丢日期**；`/api/dingtalk/bootstrap` 的 `stats.ledgerHits` 即本轮命中台账的条数。台账删除后会自动重建。若合同在钉钉侧改过日期，下一轮补全会覆盖台账里的旧值。

---

## 五、自检（可复现的验证脚本）

三层验证，从快到慢，均可直接运行、无需额外依赖：

| 脚本 | 耗时 | 覆盖 |
|------|------|------|
| `node verify-unit.mjs` | <1s | 相对方名称推断的单元用例（含 9 个「必须留空、不得误报」的反例） |
| `node verify-frontend.cjs` | <1s | 用 Node `vm` + DOM 桩把 `index.html` 的内联脚本跑起来，用**实时数据形态**（无到期日、推断相对方、账款为空、孤儿账款）逐面板断言渲染结果与「无 NaN/undefined」 |
| `node verify-live.mjs` | ~3min | 真实启动后端，走 dws 全量拉取 → 后台补全 → 详情接口 → 付费能力如实返回空；含非法入参等边界 |

> 为什么前端要用「实时数据形态」测：`NaN 天`、`回款进度 NaN%`、单个面板抛异常导致整页空白这类缺陷，用内置演示数据完全测不出来（演示数据的字段总是齐的）。`verify-frontend.cjs` 就是为了把这类只在真实数据下暴露的问题固定在回归测试里。
>
> 说明：页面用 `renderAll()` 逐个渲染并**隔离异常**（单个面板出错只记 `console.warn`，不再拖垮其余面板）；日期无效时 `daysBetween()` 返回 `null` 而非 `NaN`，调用方一律判空。

> 说明：`dws contract subject base-info`（工商信息）与 `detect-risk`（风险检测）均属钉钉智能合同**付费能力**。若本组织未开通，接口会返回空或 `{"freeBenefitRestEnough":false}`，网页会如实显示「未开通/无数据」，不会伪造风险结论。

后端不依赖任何 npm 包（仅用 Node 内置 `http` / `fetch`），但也**不调用任何大模型**，符合「无需模型」的要求。
