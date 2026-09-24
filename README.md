# 《淬火壁垒》（Tempered Bastion） · Canvas 2D Tower Defense

一个**全栈网页塔防小游戏**：React + TypeScript + Vite 前端，自建 Canvas 2D 渲染（不依赖任何游戏引擎）；
FastAPI + SQLAlchemy + SQLite 后端提供**关卡配置**、**账号（注册 / 登录）**与**自动存档 / 战绩**接口。

> 所有战斗数值（网格、路径、塔、敌人、波次、经济、规则、关卡）的**唯一真源**是
> `server/config/level.json`。前端不硬编码任何战斗数值——改这个文件并刷新页面即生效，无需重启后端。

---

## 1. 前置条件

| 依赖 | 版本要求 | 说明 |
| --- | --- | --- |
| Node.js | **≥ 22**（含 npm） | 前端构建与开发服务器 |
| Python | **3.11+**（实测 3.13） | 后端运行时 |

后端 Python 依赖（`fastapi` / `uvicorn` / `sqlalchemy` / `pydantic` / `pytest` / `httpx` 等）
已固定在 `server/requirements.txt`。安装方式（任选其一）：

```bash
# 方式 A：仓库内建虚拟环境（推荐）
python -m venv .venv
.venv/Scripts/python -m pip install -r server/requirements.txt     # Windows
.venv/bin/python     -m pip install -r server/requirements.txt     # macOS / Linux

# 方式 B：用已有的解释器（无需建 venv）
python -m pip install -r server/requirements.txt
```

若解释器不在 `.venv/` 或 `PATH` 上，用环境变量显式指定：

```bash
TD_PYTHON=/absolute/path/to/python npm run dev
```

---

## 2. 一条命令启动（前后端一起）

```bash
npm run dev
```

`npm run dev` 会（见 `scripts/dev.mjs`）：

1. 解析可用的 Python 解释器（`TD_PYTHON` → `repo/.venv` → `../artifacts/.venv` → `PATH` 上的 `python`）；
2. 检查后端依赖，缺失时打印修复命令；
3. 若 `client/node_modules` 不存在则**自动执行 `npm install`**（真正一键）；
4. 并发拉起 **后端 uvicorn（127.0.0.1:8000）** 与 **前端 Vite（localhost:5173）**，日志带 `[backend]` / `[frontend]` 前缀；
5. `Ctrl+C`（Windows 下用 `taskkill /T`）一并回收两个进程树。

启动后打开 → **http://localhost:5173**

只起一端 / 只装依赖：

```bash
npm run dev:server     # 仅后端 :8000
npm run dev:client     # 仅前端 :5173
npm run setup          # 只确保依赖就绪，不启服务
```

前端通过 Vite 的开发代理把 `/api/**` 转发到 `127.0.0.1:8000`（见 `client/vite.config.ts`），
因此前端只用同源相对路径，不存在硬编码的后端地址，也不需要 CORS。

---

## 3. 怎么玩

| 操作 | 鼠标 | 键盘 |
| --- | --- | --- |
| 选择塔型 | 点击右侧「建塔」卡片 | `1` / `2` / `3` |
| 建造 | 悬停棋盘空格（绿色=可建，红色叉=不可建）→ 左键 | — |
| 查看 / 升级 / 出售 | 点击已建成的塔 → 面板内操作 | `U` 升级 / `S` 出售 |
| 切换索敌策略 | 面板内单选 | `Q` 最前 / `W` 最后 / `E` 最强 / `R` 最近 |
| 开始波次 | 点击「开始下一波」 | `空格` / `Enter` |
| 暂停 / 继续 | 点击「暂停」 | `P` |
| 倍速 | 点击 `1x` / `2x` | `F` = 2x ｜ `N` = 1x |
| 取消选择 | 棋盘上右键 | `Esc` |

目标：守住基地清空当前关卡全部波次即过关；生命归零则失败。两种结局都会自动登记一条战绩记录。

**战役模式**：共 **10 个关卡**（关卡数据在 `server/config/level.json` 的 `levels[]`，热更新即生效）。每过一关地图布局更换、难度递增（波数 5→10、敌人数量与血量成长逐关提升）；胜利后点「进入第 N+1 关」继续，通关第 10 关即战役通关；失败可「重试本关」。**账号与自动保存**：进入游戏需注册 / 登录（进度按账号隔离）；进度每 5 秒 + 关键节点（波次推进 / 关卡切换 / 页面隐藏）自动保存，关闭页面后再打开会从上次进度继续。手动存档已取消，无需任何手动操作。

---

## 4. 目录导览

```
repo/
├── package.json                 根脚本：dev / dev:server / dev:client / setup / test:core / build
├── scripts/dev.mjs              跨平台一键启动（依赖检查 + 并发拉起 + 信号回收）
├── server/                      后端（FastAPI + SQLAlchemy + SQLite）
│   ├── requirements.txt         后端依赖（与实测版本一致）
│   ├── config/level.json        ★ 唯一数值真源
│   ├── app/
│   │   ├── main.py              FastAPI 实例、CORS、异常处理器（统一错误信封）、启动钩子
│   │   ├── db.py                SQLite engine / SessionLocal / Base（TD_DB_PATH 可覆盖）
│   │   ├── models.py            用户 / 会话 / 自动存档 / 战绩 / 配置审计 等 ORM
│   │   ├── schemas.py           Pydantic 契约（extra="forbid"）
│   │   ├── config_loader.py     mtime+size 缓存热读 + sha256 版本哈希 + 校验
│   │   ├── seed.py              启动时把配置版本同步进审计表
│   │   ├── auth.py              口令哈希（PBKDF2）+ 会话令牌 + require_user 依赖
│   │   └── routers/             health / config / auth / autosave / records
│   └── tests/                   pytest：契约形状、热读生效、认证与隔离、自动存档往返、战绩排序
└── client/                      前端（React + TS + Vite）
    ├── vite.config.ts           dev proxy: /api → 127.0.0.1:8000
    ├── vitest.config.ts         environment: node（纯逻辑内核测试，不引 jsdom）
    └── src/
        ├── core/                ★ 纯逻辑内核：零依赖、零浏览器 API，可在 Node 直接单测
        │   ├── types.ts config.ts economy.ts path.ts placement.ts targeting.ts
        │   ├── combat.ts spawn.ts waveStateMachine.ts simulation.ts game.ts serialize.ts
        │   └── __tests__/       AC-5 必测三块 + 减速叠加 / 护甲 / 序列化往返 / 确定性 / 性能预算
        │                        + 两个自建静态守护：core.boundary / no-hardcoded-balance
        ├── engine/              GameStore（拥有内核+主循环）/ loop（固定步长+插值）/ input / pools
        ├── render/              CanvasRenderer（编排三层+dpr+resize）
        │   ├── layers/          staticLayer（网格+路径，离屏一次绘制）
        │   │                    entityLayer（塔/敌人/血条/减速标识/子弹）
        │   │                    effectsLayer（池化命中特效）
        │   ├── overlay.ts       塔位合法/非法悬停 + 射程预览
        │   └── sprites/         绘制原语（精灵素材优先，程序化绘制兜底）
        ├── ui/                  Hud / BuildPanel / TowerDetail / WaveControls /
        │                        AuthView（登录/注册） / RecordsPanel / EndGameDialog / LoadingView / ErrorView
        │                        primitives/ Button·Panel·Tooltip·Modal（语义化 + 令牌 + a11y）
        ├── api/                 REST 适配（统一错误信封归一化 + zod 校验）
        ├── config/              ConfigProvider（三态）+ schema.ts（zod）
        ├── theme/               ★ tokens.css（权威源）+ tokens.ts（Canvas 镜像，一致性测试守护）
        └── styles/app.css       布局与组件样式（只引用令牌，无颜色字面量）
```

### 架构要点：Functional Core / Imperative Shell

- `client/src/core/**` 是**纯函数内核**：不 import react / engine / render / ui / api / theme / zod，
  不触碰 `document` / `window` / `canvas` / `requestAnimationFrame` / `performance` / `fetch` / `localStorage`。
  → 金币结算、波次状态机、塔位合法性等**无需浏览器即可单测**（`npm run test:core`）。
  边界由 `core.boundary.test.ts` 静态扫描守护，防退化。
- `engine` / `render` / `ui` 是**命令式外壳**：唯一可变世界状态在 `GameStore`，
  React 只是 HUD 宿主（`useSyncExternalStore` 只订阅投影快照，60Hz 不重渲染）。

---

## 5. 改配置（唯一真源）

编辑 **`server/config/level.json`**，前端**刷新页面**即生效（后端按 mtime+size 热读，无需重启）。

```jsonc
{
  "version": "…",                         // 由内容 sha256 派生，配置一变版本就变
  "grid":   { "cols": 20, "rows": 12, "tileSizePx": 40 },
  "canvas": { "logicWidthPx": 800, "logicHeightPx": 480 },
  "map":    { "pathWaypoints": [[-1,1], …], "spawnTile": [-1,1], "baseTile": [20,1] },
  "economy":{ "initialGold": 150, "initialLives": 20, "sellRefundRatio": 0.7,
              "waveClearBonus": 20, "hpScalePerWave": 0.1, "speedScalePerWave": 0 },
  "rules":  { "maxTowerLevel": 3, "slowCapRatio": 0.7, "armorFloorRatio": 0.2,
              "prepCountdownSec": 5, "defaultTargeting": "FIRST",
              "speedOptions": [1, 2], "pauseFreezesAll": true },
  "towers": [ { "id": "arrow", "role": "single_target", "cost": 50,
                "levels": [ { "level": 1, "damage": 12, "range": 110, … }, … ],
                "upgradeCostToNext": [60, 90] }, … ],
  "enemies":[ { "id": "normal", "hp": 100, "speed": 60, "armor": 0,
                "bounty": 8, "leakDamage": 1 }, … ],
  "waves":  [ { "wave": 1, "groups": [ { "enemy": "normal", "count": 6,
                "spawnIntervalSec": 1.2, "startDelaySec": 0 } ] }, … ]
}
```

常见改动：

| 想改什么 | 改哪里 |
| --- | --- |
| 初始金币 / 生命 | `economy.initialGold` / `economy.initialLives` |
| 波数 | 增删 `waves[]` 数组元素（HUD 的「n / 总波数」自动跟随） |
| 塔的伤害 / 射程 / 价格 | `towers[].levels[]` / `towers[].cost` |
| 减速强度 | `towers[].levels[].slowFactor`（同时受 `rules.slowCapRatio` 封顶） |
| 敌人强度 | `enemies[].hp` / `speed` / `armor` / `bounty` |
| 每波强度递增 | `economy.hpScalePerWave`（血量）/ `speedScalePerWave`（速度） |
| 行军路线 | `map.pathWaypoints`（格子坐标折线，首尾可以落在画布外表示"从外面来 / 走到外面去"） |
| 棋盘尺寸 | `grid.cols` / `grid.rows` / `grid.tileSizePx` 与 `canvas.logicWidthPx/HeightPx` 保持一致 |

改坏了会怎样：后端 `/api/config` 返回 `500 CONFIG_INVALID`（缺文件 / JSON 语法错 / schema 不合法），
前端显示可重试的错误页并给出原因，**不会静默用错数值**。

---

## 6. 跑测试

### 前端内核单测（无浏览器，environment=node）

```bash
cd client && npm install      # 首次
npm test                      # = vitest run --environment node（全部 12 个测试文件）
npm run test:core             # 只跑 src/core 下的内核测试
```

覆盖内容：

| 测试文件 | 覆盖的验收点 |
| --- | --- |
| `economy.test.ts` | 金币结算、不透支、出售返还、升级费 |
| `waveStateMachine.test.ts` | 状态迁移 IDLE→PREP→SPAWNING→ACTIVE→(PREP/VICTORY)；生命≤0 → DEFEAT |
| `placement.test.ts` | 路径格 / 占用 / 越界 / 出生基地 → 非法（含原因优先级） |
| `combat.slow.test.ts` | AC-7 减速**不叠加取最强**、同源只刷新时长、封顶、到期恢复 |
| `combat.armor.test.ts` | 护甲最低伤害比例 |
| `serialize.test.ts` | AC-4 存档快照**深度相等**往返 |
| `simulation.determinism.test.ts` | AC-6 帧率无关 / 固定步长确定性 |
| `simulation.fullgame.test.ts` | AC-2 headless 整局：10 波打通到 VICTORY **且** 生命耗尽触发 DEFEAT |
| `perf.stress.test.ts` | AC-6 对照：60 敌 + 20 塔稳态单步耗时预算 |
| `no-hardcoded-balance.test.ts` | AC-3(b) 前端（core/ + render/）无战斗数值字面量守护 |
| `core.boundary.test.ts` | AC-5 内核边界守护（禁 import / 禁浏览器全局） |

### 前端类型检查与构建

```bash
cd client
npm run typecheck             # tsc --noEmit
npm run build                 # tsc --noEmit && vite build → client/dist
```

### 后端测试

```bash
cd server
python -m pytest -q           # 23 passed
```

### 端到端冒烟（手工）

```bash
npm run dev
curl -s http://127.0.0.1:8000/api/health     # {"status":"ok"}
curl -s http://127.0.0.1:8000/api/config     # 完整配置（含 version / campaign）
curl -s http://127.0.0.1:8000/api/autosave   # 未登录 → 401 UNAUTHENTICATED
curl -s -X POST http://127.0.0.1:8000/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"username":"demo","password":"secret-123"}' -c /tmp/jar  # 注册即登录（Cookie）
curl -s -b /tmp/jar http://127.0.0.1:8000/api/records  # {"total":0,"items":[]}（按账号隔离）
```

### 接口一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| GET | `/api/config?level=N` | 关卡配置（唯一真源，热读；缺省第 1 关） |
| POST | `/api/auth/register` | 注册（自动登录，下发 HttpOnly 会话 Cookie；用户名唯一，不区分大小写） |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/logout` | 登出（清会话） |
| GET | `/api/auth/me` | 当前用户（未登录 → 401） |
| GET | `/api/autosave` | 读取自动存档（每账号一行；无档 → 404）**需登录** |
| PUT | `/api/autosave` | 写入自动存档（单行 upsert，随玩随存）**需登录** |
| GET | `/api/records?limit=1..200` | 战绩列表（newest first，含 `total`）**需登录** |
| POST | `/api/records` | 登记一条战绩（201）**需登录** |

错误统一信封：`{"error":{"code":"…","message":"…"}}`。

多用户化迁移：旧版本（无账号时代）的战绩会由**首位注册用户**继承；旧手动存档槽保留在库中但不再使用。

---

## 7. 素材与许可

- 游戏内精灵与地形素材来自 [Kenney](https://kenney.nl) 的《Tower Defense (Top-Down)》素材包（**CC0**，公共领域，可商用），文件位于 `client/public/td/`，许可原文见 `client/public/td/LICENSE.txt`。
- 渲染层在素材不可用（加载失败/未就绪）时自动回落为程序化绘制（`src/render/sprites`），保证离线可玩、无硬依赖。

## 8. 已知边界与技术债

- **Canvas 渲染无自动化测试**：逻辑内核有 104 条 Node 单测，但绘制正确性靠人工/截图复核
  （`perf.stress.test.ts` 只覆盖逻辑侧预算，浏览器帧时需在参考环境实测）。
- 索敌是每塔对范围内敌人的平方距离早退（O(T×E)=1200 次比较/步），**未引入空间哈希**；
  规模翻倍时需要（已列为技术债）。
- 手动存档槽已移除（改为自动保存）；旧的 `save_state` 表保留在库中仅作历史数据。
- SQLite 单文件存储，无并发写保护——单机 / 小规模多用户场景下够用。
- 注册无邀请码与速率限制：公网部署意味着知道链接的人都能注册（如需限制可加白名单）。
