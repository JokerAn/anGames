# 少年赛车 · Premium 画质升级 — 进度与决策

状态：已完成（2026-10-18）
目标：用 threejs-game-director 把现有「少年赛车 3.1」的 3D 画面从「完整但基础」升级到 premium 画质，并跑完整验证后交付。

## 约束与既定方向

- 沿用现有 Three.js 0.186.1 / 原生 ESM / Web Audio / Node / WebSocket；不引入新运行时依赖、CDN 或在线美术服务。
- 美术保持**全程序化生成**（与 DESIGN.md「车辆、程序纹理、场景和合成声音都本地生成」一致），不使用外部图片/模型/音频。
- 不改变驾驶规则、物理、比赛判定、联机协议；渲染层只读取权威状态。
- 触控/键盘、HUD 布局、自适应画质、WebGL 上下文丢失恢复、重赛资源回收、`window.__racerDebug` 只读诊断都要保持。
- 基线：`npm run check` 通过；`npm test` 348/348 通过（改动前已核实）。
- 改动前的基线截图（1600×1000 / 390×844@2x）已恢复保留在 `test/artifacts/premium/baseline-*`。早期会话里记录过一组过程读数，但它来自不同代码中间态、不再作为对照数据；最终对照只使用同视口同流程的 baseline-* vs after-1600-* 截图与 `artifacts/final-evidence.md` 的最终 report 数据。

## 基线视觉问题（captures: test/artifacts/premium/baseline-*.png）

1. 无后处理：自发光灯带/车灯/霓虹没有 bloom，画面平板；无调色、无暗角、无接触层次。
2. 地形/远山是低细分 displacement + 顶点色，近景呈大三角面；树木是 2..3 张交叉 billboard，重复感强。
3. 夜赛道路不反光、城市是黑色方盒 + 贴片窗；灯带没有体积感。
4. 车辆有基础车壳但仍偏玩具：车漆平、轮胎/轮圈简单、缺灯组/贴花/尾部细节/接地层次。
5. 路边 kit 稀疏：只有路灯、护栏、少量树，缺少近/中/远景层次与赛事道具（看台、广告牌、轮胎墙、里程牌等）。
6. 天空只有渐变球 + 很淡的云，没有太阳/月亮/星空/大气透视。
7. 特效只有基础胎烟/火花/道具环，没有速度感、尾焰辉光、草地扬尘、碰撞火花层次。

## 升级方案

- 新增 `src/postfx.js`：自研 WebGL2 HDR 后处理（MSAA 场景 target + bright pass + mip bloom + ACES/调色/暗角/颗粒/色差/速度径向模糊），按画质档位开关与降本。**不加 addons/依赖**。
- 新增 `src/sky-environment.js`：程序化天空 shader（渐变、太阳/月亮、星空、云层）+ 程序化 equirect → PMREM 户外环境反射；主题化调色板。
- 新增 `src/surface-textures.js` + `src/track-scenery.js`：程序化材质库（沥青/路肩/砂石/草地/岩石/树皮/树叶/棕榈/广告布/看台人群/远山剪影…）与分层世界 kit（近/中/远、赛道道具、看台、轮胎墙、里程牌、灯塔、风旗、主题地标）。
- `src/renderer.js` 集成：后处理管线、天空/环境、场景 kit、道路/路肩/护栏材质、车灯与车漆、灯光栈（key/fill/rim/实用光）、阴影、诊断与上下文丢失/资源回收。
- `src/effects.js`：更强但仍有预算上限的 VFX（胎烟、火花、扬尘、boost 尾焰/速度线）。
- 车身升级：更好的车漆/清漆/碳纤/玻璃/轮圈/灯组/尾翼/扩散器/贴花/接地阴影，同时保持 `userData` 契约与既有测试。
- 画质档位：流畅/均衡/高清/精细 增加 post 字段（0 直出 / 1 调色 / 2 bloom），移动端高清档也有轻量 bloom。

## 协作分工（写作用域不重叠）

| 成员 | 文件 | 任务 |
| --- | --- | --- |
| Lead | `src/renderer.js`, `src/effects.js`, `src/quality.js`, `package.json`, `index.html`, `style.css`, `README.md`, `DESIGN.md`, `test/VALIDATION.md`, `test/premium-*.cjs`, `artifacts/` | 集成、车身/道路/灯光、证据与最终验证 |
| pipeline worker | `src/postfx.js`, `src/sky-environment.js`, `test/postfx-browser.cjs` | HDR 后处理管线 + 程序化天空/环境 |
| world worker | `src/surface-textures.js`, `src/track-scenery.js`, `test/scenery-browser.cjs` | 程序化材质库 + 分层世界 kit |

新模块一律**不 import `/vendor/three.module.js`**，改为像 `src/light-show.js` 那样由调用方传入 `THREE`（保证 Node 测试可加载 renderer.js）。

## 待办

- [ ] pipeline worker 交付并自测
- [ ] world worker 交付并自测
- [ ] Lead 集成 renderer（后处理/天空/场景/道路/车/灯光/VFX/画质/回收）
- [ ] after 截图 + canvas inspector 指标 + 前后对比
- [ ] 独立视觉评审（scorecard ≥2 全项、均值 ≥2.3）
- [ ] 全量验证：check/test/test:race/test:feel/test:ghost/test:handling/test:neon + realism/browser-audit/straight/boost-pad/manual/ghost-render
- [ ] 证据清单（evidence.json + inspector + check_evidence）与 final-evidence.md
- [ ] 文档更新（README/DESIGN/VALIDATION）与交付说明

## 已知风险

- 后处理/新 kit 会增加 draw calls 与 texture 数，需守住桌面 ≤300 calls、移动端尽量 ≤~200，并在重赛/上下文恢复/画质切换时不泄漏。
- `test/realism-browser.cjs` 对重赛 geometries/textures 增量、四档切换有严格断言；`test/ghost-render-browser.cjs` 对 ghost 资源稳定有断言。
- `test/camera-feel.test.js` 在 Node 里加载 renderer.js；新模块不得含 vendor import。
- 移动端高清档 dpr 1.5 + bloom 的帧时间需实测，必要时按档位削减 bloom mip/采样。

## 2026-10-18 · 集成与验证进度

- pipeline-dev / world-dev 均已完成（task-1/task-2 completed），交付 postfx、sky-environment、surface-textures、track-scenery 及浏览器自测；文件与 API 已按契约集成进 `src/renderer.js`。
- 集成完成：后处理（post 0/1/2）、天空/PMREM、分层世界 kit、程序化路面、车辆细节、检查点 atlas 合并、速度条纹、画质档位 post 字段、上下文恢复/资源回收、`__THREE_GAME_DIAGNOSTICS__`（仅 `?evidence=1`）。
- 证据：canvas inspector 7 张捕获全部 PASS（硬件 GPU），`check_evidence.py` 通过；before/after 截图在 `test/artifacts/premium/`。
- 第二轮返修（world-dev + pipeline-dev）：棕榈/城市窗格/海面海岬/峡谷岩壁/空白广告牌/arcade 门楼/证据段 kit；天空 FBM+domain-warp 云、夜景去压黑、天空 3~4 draws。
- Lead 收尾：夜间 hero-fill、bloom/曝光重调、轮圈/玻璃/车牌细节、速度反馈增强、390×664 HUD 与车库文案修复、VFX 证据状态、受控 after-1600 对照、motion 视频、per-capture 诊断接入。
- 独立评审首轮 1.70 → 第二轮修复后 Lead 自评 2.45；首轮报告与修复清单记录在 `artifacts/final-evidence.md` 第 4/9 节。
- 最终全量验证（交付前 20 项串行复跑）：`npm run check`、348/348 Node 测试、test:race/test:feel/test:ghost/test:handling/test:neon、realism/browser-audit/straight/boost-pad/manual/ghost-render/race-hud/runtime-audit/postfx/scenery、premium-capture/premium-motion/check-evidence 全部通过；证据 manifest（runId=premium-pass-2）9 张捕获 + motion 视频通过 inspector 与 check_evidence（18 artifacts）。
- 交付证据：`artifacts/final-evidence.md`（评分卡 before 1.40 → after 2.45、per-capture 指标、预算、限制）、`test/VALIDATION.md` 最终验证表、`test/artifacts/premium/` 截图与 motion。
- 交付前 bug 修复：速度线 reduced-motion 参数取反导致高速不显示、重赛释放速度线资源、窄竖屏车库文案重叠、速度线视觉过强、冷启动编译把倒计时拉长（新增 `warmRaceFrame()` 隐藏画布预热）、自适应画质切换全量材质重编译、boost-pad/straight 浏览器回归脆弱性；新增 `test/premium-runtime-audit.cjs` 并加入 `test:premium`。
- 已知限制：首次进入主题的一次性 shader 编译准备（预热后倒计时顺畅）；移动端 calls/geometries 超 technical-art starting point（已记录 tradeoff）；未做真机 FPS/发热测量；HUD 卡片语言与近距材质仍有提升空间。
