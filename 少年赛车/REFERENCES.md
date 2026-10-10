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
