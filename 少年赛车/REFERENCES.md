# 设计参考

调研日期：2026-10-10。

- Jake Gordon — Javascript Racer： https://github.com/jakesgordon/javascript-racer
  - 参考弯道／坡度、速度反馈、路边物体与街机赛车的组织方式。
  - 原项目为伪 3D 教学演示，本项目使用 Three.js 三维网格和相机，未复制其实现。
  - 原仓库明确注明音乐及占位精灵存在独立使用限制，因此没有使用这些素材。
- Matthew Boyea — WebGL Racer： https://github.com/mboyea/game-webgl-racer
  - 参考浏览器 3D 赛车的可运行项目形态。未复制源码或资产。
- SuperTuxKart 官方玩法介绍： https://supertuxkart.net/Discover
  - 完成后对照成品街机赛车的电脑竞速、局域网多人、不同车型／赛道与道具竞速规则，核验本作的玩法闭环。
  - 本作的四种道具和具体数值独立设计，未移植其游戏代码、角色或资源。
- Three.js 官方文档： https://threejs.org/docs/pages/WebGLRenderer.html
  - 渲染器、三维场景与移动端分辨率控制；依赖版本固定为 0.186.1（MIT）。
- ws 官方仓库： https://github.com/websockets/ws
  - Node WebSocket 服务、广播和心跳检测；依赖版本固定为 8.18.3（MIT）。

比赛圈数、AI、道具数值、车辆差异、赛道几何、局域网房间协议与手机控制由本项目定义和实现。它是一款独立的街机风格赛车，不是上述演示项目的直接移植，也不使用 QQ 飞车的素材或品牌。

## 3.0 手动竞速规则参考（2026-10-17）

本轮查阅官方公开材料，借鉴机制目的，不照搬商业游戏的具体参数、物理实现或判罚算法：

- Forza Motorsport — In the Garage: Forza Race Regulations AMA： https://forza.net/news/in-the-garage-frr-discord-ama
  - 公开说明碰撞 / 驶出赛道的判罚与计时成绩关系。本作采用可解释的简化连续越界宽容、按时长罚时和干净最快圈规则，不声称复刻 FRR 或责任裁决。
- EA / Criterion — Under the Hood: Show Up and Show Off： https://forums.ea.com/discussions/need-for-speed-unbound-discussion-en/under-the-hood-show-up-and-show-off/9398276
  - 公开说明抓地 / 漂移、转向灵敏度、牵引控制和手刹漂移的操控选择。本作使用明确手动油门 / 转向、抓地上限、手刹滑移和主动氮气，不保留隐形自动代驾。
- EA / Criterion — Under the Hood: The Handling Model： https://www.ea.com/games/battlefield/news/under-the-hood-the-handling-model
  - 参考可控漂移、转向 / 制动 / 轮胎响应需要一起传达的体验原则。本作车辆为受限简化世界物理，未使用 EA 物理代码。
- Trackmania 官方 waypoint 文档： https://doc.trackmania.com/create/nadeo-importer/07-how-to-make-a-waypoint-item/
  - 区分起点、检查点、终点、多圈起终点与重生位置。本作用八个有序门和最后合法检查点救车，不允许直接搬到终点制造完赛。
- Trackmania Formula E 官方规则： https://blog.trackmania.com/uploads/2024/03/TM-FE-RULE-BOOK-2024.pdf
  - 公开比赛要求按正确次序通过检查点完成有效圈。本作采用顺序验证、合法完整圈与实际帧内越线计时；漏点恢复、罚时、奖牌目标均是本作自定。
