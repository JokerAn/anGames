# 参考与依赖

本项目的游戏规则、房间协议、手机 UI、地图、角色、武器模型及音效均独立编写，没有复制参考仓库的源码或美术资源。未使用「和平精英」「我是枪王」的名称、美术、音乐或私有资源。

实现前查看了以下公开参考，用于了解浏览器 FPS、手机控制与联机结构；未将其代码并入本项目：

- Three.js FPS 示例：https://github.com/mohsenheydari/three-fps
- Three.js 多人 / 手机控制结构参考：https://github.com/luketurnbull/threejs-multiplayer-starter
- Three.js Raycaster 官方文档：https://threejs.org/docs/pages/Raycaster.html
- WebSocket ws 官方仓库及文档：https://github.com/websockets/ws

运行依赖：

- `three` 0.186.1：MIT 许可证，3D 渲染。完整许可证位于 `node_modules/three/LICENSE`。
- `ws` 8.18.3：MIT 许可证，Node.js WebSocket 服务。完整许可证位于 `node_modules/ws/LICENSE`。

确切依赖版本锁定于 `package-lock.json`。游戏本身不依赖这些参考仓库的在线服务。

## 第三人称与多地图迭代参考

本次参考了 PUBG 官方对 TPP（从角色身后看到角色）的说明，以及 Three.js 官方射线检测文档。镜头、角色和地图仍为本项目独立实现，不使用商业游戏模型或资源。

- PUBG 官方视角说明：https://support.pubg.com/hc/es/articles/115004198834--C%C3%B3mo-jugar-PUBG
- Three.js 官方 Raycaster 文档：https://threejs.org/docs/pages/Raycaster.html

实现中通过共享的镜头位置计算、相机到掩体的碰撞检测，以及相机准星和枪口两次射线检测，保持单人 / 联机的一致性。自由观察独立于角色和枪口的朝向。

## 寻路复查与缓存优化参考

- Red Blob Games，Flow Field Pathfinding for Tower Defense：https://www.redblobgames.com/pathfinding/tower-defense/

参考其多起点、同终点共享距离表的说明。本项目独立实现了按地图隔离的反向 BFS、受限 LRU 缓存、连续坐标连接、身体半径扫掠和独立 BFS 回归验证。

## 准星视觉参考（2026-10-11）

- CrossFire 官方入门页面：https://crossfire.z8games.com/guides_start.html
- CrossFire 官方社区关于十字、中心点与颜色的讨论：https://forum.z8games.com/discussion/comment/6258686/

本次仅参考经典绿色细线十字的视觉思路，准星由本项目 CSS 独立绘制，未使用 CF 图片或其他游戏资源。
