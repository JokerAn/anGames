// Immutable map descriptions shared by every browser and every independent room.
export const WORLD = 25;
const blocks = [
  {x:0,z:0,w:6,d:6,h:5.8,color:'#efbe78',type:'tower'},
  {x:-10,z:-6,w:5,d:3,h:2.6,color:'#85bdaf'}, {x:10,z:6,w:5,d:3,h:2.6,color:'#85bdaf'},
  {x:10,z:-7,w:4,d:5,h:3.8,color:'#dca099'}, {x:-10,z:7,w:4,d:5,h:3.8,color:'#86b5ce'},
  {x:-18,z:0,w:3,d:6,h:2.2,color:'#e4c9a5'}, {x:18,z:0,w:3,d:6,h:2.2,color:'#e4c9a5'},
  {x:-5,z:-13,w:4,d:2,h:1.3,color:'#eeaa74'}, {x:5,z:13,w:4,d:2,h:1.3,color:'#eeaa74'},
  {x:7,z:-17,w:3,d:3,h:1.8,color:'#b5bc81'}, {x:-7,z:17,w:3,d:3,h:1.8,color:'#b5bc81'},
  {x:-18,z:-14,w:3,d:3,h:2.2,color:'#aabde0'}, {x:18,z:14,w:3,d:3,h:2.2,color:'#aabde0'},
];
const harbor = [
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
];
const desert = [
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
];
export const MAPS = {
  blocks:{id:'blocks',name:'积木乐园',tag:'经典 · 多路交锋',description:'穿过彩色积木，和伙伴快乐出击。',sky:'#c5dfcf',preview:'#dfe9db',ground:'#b7cba0',path:'#d7d5b3',trim:'#f5e8c9',obstacles:blocks},
  harbor:{id:'harbor',name:'海港仓库',tag:'海风 · 巷道穿梭',description:'绕过集装箱，在海风中并肩作战。',sky:'#c2dce7',preview:'#dce9ed',ground:'#bdc9c9',path:'#e0d9ba',trim:'#e9e5d6',obstacles:harbor},
  desert:{id:'desert',name:'沙漠遗迹',tag:'暖沙 · 石阵探险',description:'探索古老石阵，寻找你的制胜路线。',sky:'#eddcca',preview:'#efe6d5',ground:'#dfc493',path:'#ebd8b2',trim:'#f0dbb0',obstacles:desert},
};
for(const map of Object.values(MAPS)){map.obstacles.forEach(Object.freeze);Object.freeze(map.obstacles);Object.freeze(map);}Object.freeze(MAPS);
export function getMap(id='blocks'){return Object.hasOwn(MAPS,id)?MAPS[id]:MAPS.blocks;}
