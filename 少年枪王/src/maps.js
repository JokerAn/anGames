// Immutable map descriptions shared by every browser and every independent room.
// The arena is scaled 2x in each axis (4x in area) versus the original layout;
// obstacle coordinates below are written in original units and expanded by MAP_SCALE.
export const MAP_SCALE = 2;
export const WORLD = 25 * MAP_SCALE;
const scale = list => list.map(o => ({...o, x:o.x*MAP_SCALE, z:o.z*MAP_SCALE, w:o.w*MAP_SCALE, d:o.d*MAP_SCALE}));
const blocks = scale([
  {x:0,z:0,w:6,d:6,h:5.8,color:'#efbe78',type:'tower'},
  {x:-10,z:-6,w:5,d:3,h:2.6,color:'#85bdaf'}, {x:10,z:6,w:5,d:3,h:2.6,color:'#85bdaf'},
  {x:10,z:-7,w:4,d:5,h:3.8,color:'#dca099'}, {x:-10,z:7,w:4,d:5,h:3.8,color:'#86b5ce'},
  {x:-18,z:0,w:3,d:6,h:2.2,color:'#e4c9a5'}, {x:18,z:0,w:3,d:6,h:2.2,color:'#e4c9a5'},
  {x:-5,z:-13,w:4,d:2,h:1.3,color:'#eeaa74'}, {x:5,z:13,w:4,d:2,h:1.3,color:'#eeaa74'},
  {x:7,z:-17,w:3,d:3,h:1.8,color:'#b5bc81'}, {x:-7,z:17,w:3,d:3,h:1.8,color:'#b5bc81'},
  {x:-18,z:-14,w:3,d:3,h:2.2,color:'#aabde0'}, {x:18,z:14,w:3,d:3,h:2.2,color:'#aabde0'},
]);
const harbor = scale([
  {x:-8,z:0,w:4,d:14,h:3.6,color:'#759dad',type:'container'},
  {x:8,z:0,w:4,d:14,h:3.6,color:'#d99979',type:'container'},
  {x:0,z:-11,w:7,d:3,h:2.8,color:'#7fa797',type:'container'},
  {x:0,z:11,w:7,d:3,h:2.8,color:'#7fa797',type:'container'},
  {x:-18,z:-11,w:4,d:7,h:3,color:'#d8b879',type:'container'},
  {x:18,z:11,w:4,d:7,h:3,color:'#d8b879',type:'container'},
  {x:-18,z:10,w:3,d:3,h:1.8,color:'#c99e76',type:'crate'},
  {x:18,z:-10,w:3,d:3,h:1.8,color:'#c99e76',type:'crate'},
  {x:-16,z:1,w:3,d:3,h:2.2,color:'#e3c5a0',type:'crate'},
  {x:16,z:-1,w:3,d:3,h:2.2,color:'#e3c5a0',type:'crate'},
  {x:-8,z:15,w:4,d:2,h:1.4,color:'#d9c79b',type:'crate'},
  {x:8,z:-15,w:4,d:2,h:1.4,color:'#d9c79b',type:'crate'},
  {x:0,z:0,w:2,d:2,h:1.25,color:'#c3a886',type:'crate'},
]);
const desert = scale([
  {x:-5,z:0,w:3,d:9,h:4.6,color:'#d6ad7b',type:'ruin'},
  {x:5,z:0,w:3,d:9,h:4.6,color:'#dfbe8f',type:'ruin'},
  {x:-14,z:-10,w:6,d:3,h:2.8,color:'#cba076',type:'ruin'},
  {x:14,z:10,w:6,d:3,h:2.8,color:'#cba076',type:'ruin'},
  {x:-14,z:9,w:3,d:6,h:3.8,color:'#e3c693',type:'ruin'},
  {x:14,z:-9,w:3,d:6,h:3.8,color:'#e3c693',type:'ruin'},
  {x:0,z:-13,w:5,d:3,h:2.1,color:'#dfb889',type:'ruin'},
  {x:0,z:13,w:5,d:3,h:2.1,color:'#dfb889',type:'ruin'},
  {x:-21,z:0,w:2,d:5,h:3.5,color:'#c3976d',type:'pillar'},
  {x:21,z:0,w:2,d:5,h:3.5,color:'#c3976d',type:'pillar'},
  {x:-8,z:-16,w:3,d:2,h:1.3,color:'#e9c8a3',type:'ruin'},
  {x:8,z:16,w:3,d:2,h:1.3,color:'#e9c8a3',type:'ruin'},
]);
export const MAPS = {
  blocks:{id:'blocks',name:'霓虹前哨',tag:'城市 / 多线交锋',description:'穿过装甲掩体，切断敌人的推进路线。',sky:'#15273a',preview:'#111f2e',ground:'#263544',path:'#344656',trim:'#6ae3d0',accent:'#6ae3d0',obstacles:blocks},
  harbor:{id:'harbor',name:'深蓝港区',tag:'港口 / 侧翼突袭',description:'暮色下的集装箱战场。控住通道，抢占先机。',sky:'#152536',preview:'#101e2d',ground:'#2a3949',path:'#3a4756',trim:'#89c5e8',accent:'#70decf',obstacles:harbor},
  desert:{id:'desert',name:'落日遗迹',tag:'荒漠 / 远近博弈',description:'在夕照与阴影之间，寻找下一条进攻路线。',sky:'#735d55',preview:'#5c4944',ground:'#9f8267',path:'#ad9278',trim:'#ffc78d',accent:'#ffc78d',obstacles:desert},
};
for(const map of Object.values(MAPS)){map.obstacles.forEach(Object.freeze);Object.freeze(map.obstacles);Object.freeze(map);}Object.freeze(MAPS);
export function getMap(id='blocks'){return Object.hasOwn(MAPS,id)?MAPS[id]:MAPS.blocks;}
