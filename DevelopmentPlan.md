# 投资监控系统 — 开发计划与框架

> 基于 [Features.md](Features.md) 整理。本文档为初稿,用于在开发启动前对齐技术路线、模块边界与里程碑。
> **关键决策(2026-05-06 起,2026-05-07 修订)**:
> - 技术栈:Next.js 15 全栈 + Prisma + BullMQ + Vercel AI SDK
> - 部署:**纯自用,本机 Docker Compose 跑 localhost**,暂不上 VPS
> - 用户:单用户、MVP 跳过注册,无需 Auth
> - 模型:**全模块统一 DeepSeek V4 Pro**(纯文本任务;实测 DeepSeek 公开 API 不支持图像输入,所以不再使用视觉模型)
> - 模块一入口:**导入 CSV / Excel / 手动录入**(图片识别延后,等视觉 API 可用时再加)
> - 行情:纯 Node HTTP(天天基金估值 + 新浪指数),不需要 Python

---

## 1. 产品定位

一个**面向个人投资者的 Web 端投资监控系统**,以「截图 → AI 自动识别 → 结构化台账」为入口,向上叠加可视化、AI 分析、板块跟踪与定投提醒,形成数据 — 洞察 — 行动的闭环。

核心特征:
- **AI 优先**:识别、分类、分析、提醒规则的生成均由多模态/大语言模型驱动,尽量降低用户手工配置成本。
- **个人台账**:以用户为中心存储持仓、分析报告与提醒规则,支持长期追踪与复盘。
- **轻交互、强可视**:双栏对照、卡片看板、颜色化板块涨跌等使信息一目了然。

---

## 2. 系统架构总览

```
┌────────────────────────────────────────────────────────────────┐
│                          浏览器 (Web)                          │
│   Next.js 15 App Router · React Server Components              │
│   Tailwind + shadcn/ui + ECharts/Recharts                      │
└──────────────▲─────────────────────────────────────▲───────────┘
               │ Server Actions / Route Handlers     │ SSE (流式)
┌──────────────┴─────────────────────────────────────┴───────────┐
│            Next.js 服务端 (同一仓库,统一部署)                  │
│   ├─ Route Handlers (/app/api/*) — REST 接口                   │
│   ├─ Server Actions — 表单提交、表格保存                       │
│   ├─ AI 编排 (Vercel AI SDK · DeepSeek V4 Pro,纯文本)         │
│   ├─ Prisma ORM — 台账 / 报告 / 规则 CRUD                      │
│   └─ 行情代理 / 缓存(纯 Node HTTP)                            │
│   (单用户、纯自用 localhost:3000,无需 Auth)                  │
└──────┬─────────────┬────────────────┬───────────────┬──────────┘
       │             │                │               │
   ┌───▼─────┐ ┌─────▼─────┐    ┌─────▼─────┐   ┌─────▼─────┐
   │ Postgres│ │ 对象存储  │    │ AI 模型层 │   │ 行情数据源│
   │ (Prisma)│ │ (截图报告)│    │ GPT-4o 等 │   │ 第三方 API│
   └─────────┘ └───────────┘    └───────────┘   └───────────┘
                                       ▲
                              ┌────────┴────────┐
                              │  后台任务        │
                              │  BullMQ Worker  │
                              │  (Node 进程)     │
                              └─────────────────┘
```

**关键解释:**
- **Next.js 一体化**:前端、API、Server Actions 同一仓库与运行时,无需独立 BFF。Server Components 直接读 Prisma,客户端组件通过 Route Handlers 或 Server Actions 调用。
- **后台 Worker 独立进程**:截图识别、AI 报告生成、每日批量行情、规则扫描这些耗时任务,放在 BullMQ Worker(独立 Node 进程,共用同一 `lib/` 代码),避免占用 Next.js 请求线程或触发 Serverless 超时。
- **流式 AI 输出**:模块三的报告生成、模块四的解读使用 Vercel AI SDK 的 `streamText` / `streamObject`,通过 Route Handler 以 SSE 回传前端,首字延迟更好。
- **对象存储**保存原始截图与归档报告,Postgres 只保存元数据与结构化字段。

---

## 3. 技术选型(Next.js 全栈)

| 层次 | 选型 | 备注 |
| --- | --- | --- |
| 全栈框架 | **Next.js 15(App Router)+ TypeScript** | RSC + Server Actions,前后端同语言同仓库 |
| UI / 样式 | Tailwind CSS + shadcn/ui + Radix Primitives | 一键拷贝组件,样式可控 |
| 状态管理 | RSC 默认 + Zustand(客户端轻状态)+ TanStack Query(数据获取与缓存) | 表格编辑等局部状态用 Zustand |
| 表格 | TanStack Table v8 | 模块一双栏对照、单元格编辑 |
| 文件解析 | **SheetJS (`xlsx`)** + **Papaparse** | 模块一 Excel/CSV 导入,纯 Node 解析,无需 Python |
| 图表 | ECharts(`echarts-for-react`)优先,Recharts 备选 | ECharts 对国内场景更友好 |
| 鉴权 | **MVP 阶段跳过**(单用户硬编码 `userId`),后期再接 Auth.js v5 | 数据库仍保留 `userId` 字段,以便日后改造为多用户;若需公网访问,加一层 Basic Auth / 简单密码即可 |
| ORM / 数据库 | **Prisma + PostgreSQL 15+** | `JSONB` 用 Prisma `Json` 字段 |
| 数据校验 | **Zod**(共享给 Server Action 与前端表单) | 与 RHF / `next-safe-action` 配合 |
| 表单 | React Hook Form + Zod resolver | |
| 缓存 / 队列 | **Redis + BullMQ** | 行情缓存、识图/分析异步任务 |
| 调度 | BullMQ Repeatable Job(收盘后定时跑) | 取代 Celery beat |
| 对象存储 | S3 兼容(MinIO 自托管 / 阿里云 OSS / R2) | 截图、报告归档 |
| AI SDK | **Vercel AI SDK** + `ai/rsc` | 用于 `generateObject` 结构化输出 + `streamText` 流式;模块一调用列映射,模块三/四/五调用文本生成 |
| AI 模型 | **DeepSeek V4 Pro**(全模块统一,纯文本) | 通过 OpenAI 兼容端点接入(2026-05-07 实测 DeepSeek 公开 API 不支持图像输入);`lib/ai/` 保留 Provider 抽象,后期想接 Qwen-VL 等视觉模型可平滑加入 |
| 行情数据 | **纯 Node HTTP**:天天基金估值 + 新浪/东方财富指数 | MVP 不需要 Python sidecar;Tushare/AkShare 等冷门数据后期再评估 |
| 日志 / 监控 | Sentry(免费额度)+ 应用内简单日志 | |
| 部署 | **本机 Docker Compose**(Next.js + Worker + Postgres + Redis + MinIO 同机)| 纯自用,跑在用户自己电脑的 localhost;手机/平板访问可绑 `0.0.0.0` 走家里 WiFi 局域网 IP。后期若要异地访问再考虑租 VPS |
| 包管理 | pnpm + monorepo(可选 Turborepo) | 若 Worker 与 Web 拆 package 用 monorepo |

> **关于 AkShare/Tushare**:这两个库是 Python 生态。若模块四的行情非走它们不可,可起一个极简 FastAPI sidecar 只暴露行情接口,Next.js 内部调用。优先尝试纯 Node 方案(东方财富、新浪财经的非官方 HTTP 接口)以保持单语言。

---

## 4. 仓库结构(建议)

```
investment-v2/
├─ app/                       # Next.js App Router
│  ├─ (auth)/                 # 登录注册
│  ├─ (dashboard)/
│  │  ├─ ledger/              # 模块一:台账 + 导入双栏对照
│  │  ├─ portfolio/           # 模块二:可视化看板
│  │  ├─ analyses/            # 模块三:AI 分析助手
│  │  ├─ sectors/             # 模块四:板块涨跌看板
│  │  └─ alerts/              # 模块五:提醒规则
│  ├─ api/
│  │  ├─ imports/             # CSV/Excel 上传 + 列映射
│  │  ├─ holdings/            # 台账 CRUD
│  │  ├─ analyses/            # 分析任务
│  │  ├─ quotes/              # 行情代理
│  │  └─ alerts/              # 规则与事件
│  └─ layout.tsx
├─ components/                # 共享组件 (shadcn/ui)
├─ lib/
│  ├─ ai/                     # Vercel AI SDK 封装、提示词、Schema
│  ├─ db/                     # Prisma client
│  ├─ queue/                  # BullMQ 队列定义
│  ├─ storage/                # S3 客户端
│  └─ market/                 # 行情 Provider 抽象
├─ worker/                    # BullMQ Worker 入口 (独立进程)
│  └─ index.ts
├─ prisma/
│  └─ schema.prisma
├─ tests/
└─ package.json
```

---

## 5. 数据模型(Prisma 草稿)

```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String
  createdAt    DateTime @default(now())
  imports      ImportBatch[]
  holdings     Holding[]
  analyses     AnalysisReport[]
  alertRules   AlertRule[]
}

model ImportBatch {                   // 一次导入(CSV / Excel / 手动录入)的批次记录
  id             String   @id @default(cuid())
  userId         String
  format         ImportFormat
  fileUrl        String?              // 手动录入时为 null
  status         ImportStatus @default(PENDING)
  columnMapping  Json?                // LLM 推断或用户确认的列名映射
  rawHeaders     Json?                // 原始列头数组,便于复盘
  createdAt      DateTime @default(now())
  user           User     @relation(fields: [userId], references: [id])
  holdings       Holding[]
}

enum ImportFormat { CSV XLSX MANUAL }
enum ImportStatus { PENDING PARSED CONFIRMED FAILED }

model Holding {
  id            String   @id @default(cuid())
  userId        String
  importBatchId String?
  fundCode      String?
  fundName      String
  amount        Decimal  @db.Decimal(18, 2)
  profit        Decimal  @db.Decimal(18, 2)
  profitRate    Decimal  @db.Decimal(8, 4)
  sector        String?
  editedByUser  Boolean  @default(false)
  updatedAt     DateTime @updatedAt
  user          User         @relation(fields: [userId], references: [id])
  importBatch   ImportBatch? @relation(fields: [importBatchId], references: [id])
}

model AnalysisReport {
  id               String   @id @default(cuid())
  userId           String
  promptRaw        String
  promptOptimized  String
  holdingsSnapshot Json     // 当时持仓快照,保证可复盘
  resultMd         String
  createdAt        DateTime @default(now())
  user             User     @relation(fields: [userId], references: [id])
}

model MarketQuote {                  // 日级:收盘后持久化
  fundCode   String
  date       DateTime @db.Date
  nav        Decimal  @db.Decimal(12, 4)
  changePct  Decimal  @db.Decimal(8, 4)
  fetchedAt  DateTime @default(now())
  @@id([fundCode, date])
}

model NavEstimate {                  // 模块四:盘中估值 + 偏离统计
  fundCode      String
  date          DateTime @db.Date
  estimateClose Decimal  @db.Decimal(12, 4)   // 当日 15:00 时刻估值
  actualNav     Decimal? @db.Decimal(12, 4)   // 次日由 nav-reconcile 回填
  deviationPct  Decimal? @db.Decimal(8, 4)    // (actualNav - estimateClose) / estimateClose
  @@id([fundCode, date])
}

model SectorInsight {                // 模块四:AI 当日板块解读缓存
  sector    String
  date      DateTime @db.Date
  insight   String                                // 一句话归因
  createdAt DateTime @default(now())
  @@id([sector, date])
}

model AlertRule {
  id        String   @id @default(cuid())
  userId    String
  source    AlertSource     // AI_SUGGESTED / USER
  scope     AlertScope      // FUND / SECTOR
  targetId  String          // fundCode 或 sector 名
  condition Json            // {type: "drop_pct", value: 5, baseline: "today"}
  enabled   Boolean  @default(true)
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id])
  events    AlertEvent[]
}

enum AlertSource { AI_SUGGESTED USER }
enum AlertScope  { FUND SECTOR }

model AlertEvent {
  id          String   @id @default(cuid())
  ruleId      String
  triggeredAt DateTime @default(now())
  payload     Json
  read        Boolean  @default(false)
  rule        AlertRule @relation(fields: [ruleId], references: [id])
}
```

---

## 6. 模块开发拆解(Next.js 落地方式)

### 模块一:投资台账导入与维护(地基,优先级最高)

> **范围调整(2026-05-07)**:取消原计划的截图多模态识图。原因:实测 DeepSeek 公开 API 不支持图像输入,继续做截图方向需引入第二个视觉模型(Qwen-VL 等),增加成本与运维。改为「**导入结构化文件 + 手动录入**」,数据精度更高、工程更简单、覆盖来源更广(支付宝、天天基金、券商、自维护 Excel 都能接入)。截图识别保留为后期 P2 扩展点,等视觉 API 成熟时再接。

#### 1.1 三种入口

1. **上传 / 拖入文件:`.csv` 或 `.xlsx`** —— 主路径
2. **粘贴 CSV 文本** —— 快速路径(从其他工具复制粘贴)
3. **手动加行** —— 任何路径都可在表格底部「+ 添加一行」补录,作为最终回退

#### 1.2 整体流程

```
用户提供文件 / 粘贴 / 手动
         ↓
本地解析(SheetJS / Papaparse)
         ↓
抽取列头 + 前 5 行示例数据
         ↓
调 DeepSeek V4 Pro 一次,做「列名 → 标准字段」语义映射
返回:{ fundName: "产品名称", amount: "持仓金额", profit: "累计盈亏", ... }
         ↓
前端双栏对照:
  左 = 原始数据预览(只读,带列头)
  右 = 按映射解析后的标准化台账(可编辑)
         ↓
用户可改:列映射 / 单元格 / 删除汇总行(如「合计」「总计」)
         ↓
确认 → 批量写入 Holding,ImportBatch.status = CONFIRMED
```

**「双栏对照」的交互价值保留了**,只是左侧从图片换成原始数据表 —— 用户依然能逐项比对源数据和标准化结果。

#### 1.3 前端

- `app/(dashboard)/ledger/page.tsx` 是 RSC,从 Prisma 读最新的 `ImportBatch` 列表与该批次的 `Holding`。
- 上传组件:客户端 `react-dropzone`(`.csv` / `.xlsx`),小文件(< 5 MB)直接 base64 走 Server Action,大文件再考虑预签名直传 MinIO。
- 解析:**SheetJS (`xlsx`)** 处理 Excel,**Papaparse** 处理 CSV,都在浏览器端跑(Node 也可跑,但浏览器端解析对小文件更快、不占服务器内存)。
- 双栏视图:左侧只读 TanStack Table 展示原始数据;右侧可编辑 TanStack Table 展示按映射解析后的标准化台账。
- 列映射 UI:头部一行下拉选单,显示「原始列头 → 标准字段」映射,可手动改;改完点「重新映射」即时刷新右侧表。
- 单元格编辑通过 `next-safe-action` 触发 Server Action `updateHolding`,带 Zod 校验。

#### 1.4 后端

- `POST /api/imports`:接收已解析后的「列头 + 样本行」JSON,创建 `ImportBatch`,入队 BullMQ `infer-mapping` 任务(短任务,但走队列保留可观察性)。
- Worker 调用 Vercel AI SDK `generateObject`,Zod schema:
  ```ts
  const ColumnMappingSchema = z.object({
    fundName:   z.string().describe('原始列名,对应基金名称'),
    fundCode:   z.string().nullable().describe('原始列名,对应六位基金代码;无则 null'),
    amount:     z.string().describe('原始列名,对应持仓金额(单位:元)'),
    profit:     z.string().describe('原始列名,对应累计盈亏'),
    profitRate: z.string().nullable().describe('原始列名,对应收益率;无则 null'),
    junkRowIndices: z.array(z.number()).describe('应跳过的行索引(汇总行/标题行/空行),0-based'),
    notes: z.string().nullable(),
  });
  ```
- 提示词:把列头数组 + 前 5 行样本拼成 prompt,要求模型只在已有列头中选(不要发明列名)。
- `POST /api/imports/:id/confirm`:用户在前端完成校对,后端按确认后的 mapping 批量插入 `Holding`,标记 `editedByUser` 为 true 的字段不可被后续覆盖。

#### 1.5 AI 工程要点

- 列映射调用是**短文本**任务,DeepSeek V4 Pro 完全够用,延迟 < 2 秒。
- 提示词强调:**只能从给定列头中选**;遇到合并单元格、英文列名、缩写都尽量映射,无法映射的字段返回 null,不要瞎猜。
- 失败兜底:LLM 失败或返回 null 比例过高 → 前端直接进入「手动选列」模式,用户从下拉里指定每一列对应什么。**始终能完成导入**,LLM 只是省事的优化项。

#### 1.6 后期扩展点(明确不做的 MVP 之外)

- 截图多模态识别(等视觉 API 成熟,优先评估 Qwen-VL)
- PDF 导入(支付宝/天天基金的持仓 PDF)
- XML / JSON 导入(等具体来源出现再加)
- 自动定时拉取(对接券商/天天基金账户 API,合规风险高,暂不考虑)

### 模块二:投资组合可视化看板

- `app/(dashboard)/portfolio/page.tsx` 为 RSC,服务端聚合后返回 props,首屏无 loading。
- 行业分类:`lib/sector/classify.ts`,先用基金代码/名称关键词规则,命中失败再调 LLM(`generateObject` 返回 sector 枚举)。结果写 `Holding.sector`,允许手工改并锁定。
- 图表组件为客户端组件(ECharts 需 DOM),从 RSC 接收数据 props。
- **总收益率必须按金额加权**,不能简单平均。

### 模块三:AI 投资分析助手

- 流程页 `app/(dashboard)/analyses/new/page.tsx`:
  1. 用户输入 prompt → Server Action 调 LLM 优化,返回优化版 + 解释 diff。
  2. 用户确认 → `POST /api/analyses` 创建记录,入队 BullMQ `generate-analysis`,前端 SSE 流式渲染报告。
  3. 完成后写入 `AnalysisReport.resultMd` + 当时的 `holdingsSnapshot`(JSONB)。
- 报告模板固定:`概况 / 风险 / 机会 / 建议`,便于历史比对。
- 历史列表 `/analyses` 是 RSC + Markdown 渲染(`react-markdown`)。

### 模块四:盘中实时板块与基金估值看板(参考养基宝)

> **目标修订(2026-05-06):用户的核心诉求是「在基金净值未公布前,通过实时板块行情判断今天大致的浮盈浮亏」**。基金每日只公布一次净值(通常 20:00 之后),但 A 股交易时段(09:30–15:00)持有人就想知道「今天大概赚还是亏」。所以模块四的重点不是收盘后的日级涨跌,而是**盘中实时**的板块行情 + 基金估值。养基宝就是把这一类信息聚合得最干净的代表,可对标。

#### 4.1 数据维度(三层并列)

1. **基金盘中估值**:每只持仓基金的当日「估算涨跌幅」与「估算最新净值」,在交易时段每 30–60 秒刷新一次。
2. **关联板块/指数实时行情**:基金所属 sector 的代表指数与 ETF(如「沪深 300」「中证 500」「恒生科技」「纳指 100」)的实时点位、涨跌幅、分时迷你图。
3. **同领域代表基金对比**:模块二自动分类后,显示同 sector 下其他典型基金当日估值,作为参照(养基宝里「同类对比」)。

#### 4.2 数据来源策略

- **首选纯 Node HTTP 公开接口**(无需 Python 依赖):
  - 天天基金盘中估值:`https://fundgz.1234567.com.cn/js/{fundCode}.js` → 返回 `gsz`(估算净值)、`gszzl`(估算涨跌幅)、`gztime`(估算时间)。**这是养基宝同款数据源**。
  - 新浪财经实时行情:`https://hq.sinajs.cn/list=sh000300,sz399006,...` → 指数/ETF 实时报价(Referer 需设为 `https://finance.sina.com.cn`)。
  - 东方财富实时:`https://push2.eastmoney.com/api/qt/...` → 备份数据源,稳定但接口非官方。
- **抽象一层 Provider**:`lib/market/provider.ts` 暴露 `getFundEstimate(code)`、`getIndexQuote(code)`、`getIntradayKline(code, period)` 三个方法,内部可换源。
- **明确合规风险**:这些都是非官方接口,任何时候都可能改;失败回退到「上次已知值 + 灰显」,不阻塞页面。

#### 4.3 刷新调度(交易时段才工作)

- 把原计划「每日 15:30 一次」改为**两层任务**:
  1. **`intraday-tick` 任务**:BullMQ Repeatable,每 **30–60 秒**触发一次,**仅在交易时段内有效**(否则空跑直接 return)。批量拉取「所有活跃用户持仓基金的估值」+「所有出现过的 sector 代表指数」,写入 **Redis**(键 `quote:{code}`,TTL 5 分钟)。日级数据不进 Postgres,避免写放大。
  2. **`market-close` 任务**:每交易日 15:05 跑一次,把当日最后一次估值持久化为 `MarketQuote`(日级表),清理 Redis 中的当日临时键。
  3. **`nav-reconcile` 任务**:次日 09:00 跑,从天天基金抓取昨日真实净值,与昨日 15:00 估值对比写入 `NavEstimate.deviation`,用于评估「该基金估值偏离度」的可信度(养基宝有这个指标)。
- **交易时段判定**:封装 `lib/market/calendar.ts`,A 股「周一至周五 09:30–11:30 / 13:00–15:00」+ 节假日跳过(数据可走 `chinese-workday` 之类的小库,或维护一份 JSON)。多市场后续扩展(港股 09:30–12:00 / 13:00–16:00,美股 21:30–04:00 北京时间)。

#### 4.4 前端(实时性优先)

- `app/(dashboard)/sectors/page.tsx` 是 RSC,首屏从 Redis 读最新值直接渲染,不等待客户端 JS。
- 客户端组件订阅 **SSE 端点 `/api/quotes/stream`**:`intraday-tick` 任务每次写完 Redis 后通过 Redis pub/sub 推送,Route Handler 透传给客户端,卡片局部更新涨跌幅与分时图(无需整页刷新)。
- 卡片布局(每个 sector 一张):
  - 顶部:sector 名 + 代表指数当前点位/涨跌幅(大字号,涨绿跌红可在设置切换为 A 股习惯涨红跌绿)。
  - 中部:你持有的该 sector 基金列表,显示**估算涨跌幅**与**估算最新净值**,标注 `gztime`(数据时间)。
  - 底部:同领域代表基金的估算涨跌幅,横向对比是否跑赢。
- **「估值偏离」徽标**:在每只基金名旁标记其历史平均偏离幅度(如「±0.3%」),让用户知道估值仅供参考。
- 非交易时段:整页变灰、显示「收盘 · 数据时间 15:00」,避免误导。

#### 4.5 AI 解读(轻量,不要每秒调)

- AI 解读触发条件:某 sector 当日累计涨跌幅 |z| > 2 σ 或绝对值超阈值时,**异步**触发一次 `interpret-sector` 任务。
- 结果按 `(sector, date)` 缓存到 Postgres `SectorInsight` 表,同一天内不重复调用 LLM。
- 输出极简:一句话归因(「医药板块今日 +2.5%,主因 XX 政策预期」),不要长篇分析(那是模块三的事)。

#### 4.6 与养基宝的差异化

养基宝偏「监控聚合」,我们额外提供:
- 模块二的可视化分布(它较弱);
- 模块三的 AI 自定义分析报告(它没有);
- 模块五的 AI 主动建议提醒规则(它是手动设阈值)。
所以模块四对齐养基宝即可,不必在该模块上做差异化。

### 模块五:AI 驱动的定投提醒与规则生成

- BullMQ Repeatable Job `daily-alert-scan`(每日收盘后):
  1. 计算每只持仓基金 / 每个 sector 的连续下跌天数、累计跌幅、相对历史波动百分位。
  2. 命中触发条件 → 调 LLM `generateObject` 返回 `{ message: string, suggestedRule: AlertRuleCondition }`。
  3. 写入「待用户确认建议」表(独立小表 `AlertSuggestion`,或复用 `AlertRule.enabled = false`)。
- 前端 `/alerts` 展示卡片 + 同意/拒绝按钮,Server Action 同意后将建议升级为 `AlertRule`。
- 规则引擎:同一 Repeatable Job 末尾扫描所有 `AlertRule.enabled=true`,达到条件写 `AlertEvent` + 站内通知(后期接邮件/微信)。
- **设计原则:不自动下单,所有触发只是提醒。**

---

## 7. 开发里程碑(建议 6–10 周 MVP)

| 阶段 | 周 | 交付物 |
| --- | --- | --- |
| **0. 基建** | W1 | Next.js 仓库、Prisma schema 落地、Auth.js 登录注册、Tailwind/shadcn 基础布局、Docker Compose(Postgres + Redis + MinIO)、BullMQ Worker 骨架 |
| **1. 模块一 MVP** | W2–W3 | CSV/Excel 导入 → SheetJS/Papaparse 解析 → DeepSeek 列映射 → 双栏对照(原始 vs 标准化)→ 单元格校对 + 手动加行 → 保存。**地基,所有后续模块依赖** |
| **2. 模块二** | W4 | 行业分类 + ECharts 饼图/柱图 + 指标卡 |
| **3. 模块三** | W5 | Prompt 优化 + 流式报告生成 + 归档列表 |
| **4. 行情接入 + 模块四** | W6–W7 | Market Provider(天天基金估值 + 新浪指数)+ 交易日历 + `intraday-tick`(30–60s)+ Redis pub/sub + SSE 推送 + sector 看板 + 估值偏离统计 + AI 一句话解读 |
| **5. 模块五** | W8 | 每日扫描任务 + 建议卡片 + 规则引擎 + 站内通知 |
| **6. 打磨** | W9–W10 | 性能、错误处理、移动端适配、内测反馈 |

---

## 8. 关键风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| LLM 列映射不准 | 用户首次导入体验差 | 用户始终可手动改列映射(下拉选单);双栏对照让映射错一眼可见;保存时标 `editedByUser`,后续不被覆盖;最坏情况退化为「全手动选列」,LLM 只是优化项 |
| 用户文件格式千奇百怪 | 列头中文/英文/合并单元格/有汇总行 | 提示词要求 LLM 给出 `junkRowIndices` 跳过汇总行;Excel 解析跳过空行;列名极端时让用户手选 |
| 行情数据源(尤其 Python 生态) | 影响模块四、五 | Provider 抽象;优先纯 Node HTTP 源;必要时起 Python sidecar;结果做日级缓存 |
| 实时数据接口为非官方(天天基金/新浪) | 模块四盘中估值会随时失效 | Provider 多源容错(主源失败切备源);失败时显示「上次值 + 灰显」不阻塞;每日 `nav-reconcile` 监控偏离度,异常时告警 |
| 盘中高频拉取的成本与限频 | 30s 一次 × N 只基金,可能被对方 IP 封 | 批量化(单次请求拉多支)+ 仅在交易时段跑 + 用户活跃度过滤(7 天未登录的账户跳过)+ Redis 缓存命中优先 |
| 长任务执行(识图、AI 报告、每日扫描) | HTTP 请求阻塞或超时 | 一律走 BullMQ Worker(独立 Node 进程,与 Next.js 同机 Docker Compose);Route Handler 只做提交入队;前端通过 SSE / 轮询取结果 |
| LLM 调用成本 | 报告/解读频繁触发会贵 | 缓存当日 sector 解读;长报告改为按需生成;每用户配额 |
| 用户对 AI 建议过度依赖 | 投资风险 | UI 明确「仅供参考、不构成投资建议」;不提供自动下单 |
| 个人金融数据隐私 | 合规与信任 | 截图与持仓加密存储;支持一键导出/删除;个人部署版优先 |

---

## 9. 已确认决策与下一步行动

### 9.1 已确认

| 决策项 | 结论 | 确认日期 |
| --- | --- | --- |
| 技术栈 | Next.js 15 全栈(已固化于第 3 节) | 2026-05-06 |
| 部署形态 | **本机 Docker Compose,跑 localhost**。Docker 已就绪。手机/平板访问 → compose 监听 `0.0.0.0`,走家里 WiFi 用本机局域网 IP。**不租 VPS,不上 Vercel,不挂域名,不做备案** | 2026-05-06 |
| 用户模型 | 单用户、跳过注册,**完全不接 Auth**。`userId` 硬编码 `"me"` | 2026-05-06 |
| AI 模型 | **DeepSeek V4 Pro**(全模块文本任务)。**实测公开 API 不支持图像输入**,模块一不再走视觉路线 | 2026-05-07 修订 |
| 模块一入口 | **CSV / Excel 导入 + 手动录入**(SheetJS + Papaparse 解析,DeepSeek 做列映射)。截图识别延后到 P2 | 2026-05-07 |
| 行情数据 | 纯 Node HTTP:天天基金估值 + 新浪/东方财富指数,不需要 Python sidecar | 2026-05-06 |

### 9.2 阻塞项已清除

所有关键决策全部确认,无遗留阻塞项。可直接进入 W1 基建。

### 9.3 W1 基建第一周可立刻动手的事

1. 初始化 Next.js 15 仓库(`npm create next-app`,App Router + TS + Tailwind)。
2. `prisma/schema.prisma` 落地第 5 节模型,本地起 Postgres 容器跑 `prisma migrate dev`。
3. 写 `docker-compose.yml`:`postgres` + `redis` + `minio` 三个 service,Next.js 与 Worker 先本地 `npm run dev` 跑,等基础打通再容器化。
4. `lib/ai/deepseek.ts` 封装 DeepSeek 调用(OpenAI 兼容端点 + Vercel AI SDK 的 `createOpenAICompatible`),先做一个 `inferColumnMapping(headers, sampleRows)` 函数 + Zod schema,跑通真实 CSV/Excel 作为冒烟测试。
5. 模块一 UI 骨架:`/ledger` 页面 + `react-dropzone` 上传 + SheetJS/Papaparse 浏览器端解析 + 双栏对照(假数据先打通布局)。

### 9.4 进入开发后的顺序

W1 基建 → W2–W3 **模块一(导入台账)** → W4 模块二 → W5 模块三 → W6–W7 **模块四(盘中实时)** → W8 模块五 → W9–W10 打磨。

> 模块一是地基,列映射准确率与单元格编辑体验达不到时不要急着推后面。宁可在提示词、双栏交互上多打磨 3–5 天,也比后面所有模块都建在不可靠的数据上好。

---

> 文档版本:v0.6 · 2026-05-07 · 模块一改为「CSV / Excel 导入 + 手动录入」,DeepSeek 转纯文本
