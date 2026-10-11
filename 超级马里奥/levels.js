import { AMMO_PER_PICKUP } from './combat.js';

export const THEMES = [
  { name:'微风原野', subtitle:'BREEZE MEADOW', sky:['#dceee6','#f3efd1'], mountain:'#aecdb9', mountainBack:'#c5dace', hill:'#8ab698', hillFront:'#70a17e', grass:'#85ab64', grassLight:'#c7d99a', soil:'#b69464', soilDark:'#9b7c53', leaf:'#739e76', leafDark:'#4e8060', accent:'#ecb165', mist:'#e5ecd2' },
  { name:'落日峡谷', subtitle:'SUNSET CANYON', sky:['#ecd9c8','#f8eac5'], mountain:'#d3b2a2', mountainBack:'#e1c5b5', hill:'#c1ad86', hillFront:'#a69b70', grass:'#b3b176', grassLight:'#e2d5a2', soil:'#b98765', soilDark:'#9a6d53', leaf:'#b99765', leafDark:'#937c54', accent:'#edac68', mist:'#f3e2c6' },
  { name:'星月之森', night:true, subtitle:'MOONLIT WOODS', sky:['#344d65','#899793'], mountain:'#526f7d', mountainBack:'#466477', hill:'#668c89', hillFront:'#527d75', grass:'#83a68b', grassLight:'#b1cab1', soil:'#6c8073', soilDark:'#58695f', leaf:'#658e83', leafDark:'#3e6a63', accent:'#e8d69a', mist:'#a9b8a2' },
  { name:'蘑菇湿地', subtitle:'MUSHROOM MARSH', sky:['#cce7dd','#e6e8c8'], mountain:'#a0c1ae', mountainBack:'#bdd6c4', hill:'#84ae99', hillFront:'#689a82', grass:'#8bb681', grassLight:'#cde1a7', soil:'#a48c69', soilDark:'#82755a', leaf:'#71a084', leafDark:'#4b7b66', accent:'#e7b47c', mist:'#d9e9cc' },
  { name:'琥珀沙丘', subtitle:'AMBER DUNES', sky:['#f0d9bf','#f9e9be'], mountain:'#d6b18a', mountainBack:'#e4c6a4', hill:'#ccb17c', hillFront:'#b9a06c', grass:'#bdad71', grassLight:'#eaddab', soil:'#ccaa75', soilDark:'#ac8a5b', leaf:'#ab9d6c', leafDark:'#847b50', accent:'#e8a959', mist:'#f0ddbd' },
  { name:'霜雪山径', subtitle:'FROSTY PASS', sky:['#d7e8ee','#ecf1ed'], mountain:'#aec8d2', mountainBack:'#c6d9e1', hill:'#9fbfc8', hillFront:'#87adb5', grass:'#c4dee0', grassLight:'#f3faf3', soil:'#9dbbc1', soilDark:'#7f9fa9', leaf:'#a9cacf', leafDark:'#719da8', accent:'#f4d59b', mist:'#e5f0ed' },
  { name:'云海浮岛', subtitle:'CLOUD ISLANDS', sky:['#cfdfe9','#f5eee0'], mountain:'#bbc9db', mountainBack:'#d3dce6', hill:'#a9c1cb', hillFront:'#8db0b3', grass:'#a9c9b1', grassLight:'#e7edce', soil:'#a49e8c', soilDark:'#878977', leaf:'#97bcb0', leafDark:'#6c958e', accent:'#f1d393', mist:'#e9ecdf' },
  { name:'晨曦灯塔', subtitle:'DAWN LIGHTHOUSE', sky:['#dfd4e5','#f8e5ce'], mountain:'#c4b5c8', mountainBack:'#d7cad8', hill:'#b1b5b4', hillFront:'#8ca7a1', grass:'#b4be92', grassLight:'#efdfb4', soil:'#b49a82', soilDark:'#907d6d', leaf:'#a1b49b', leafDark:'#748e7c', accent:'#f4c583', mist:'#f2e1d4' }
];

export const MODES = {
  easy: { name:'简单', hearts:3, enemyScale:1, timeScale:1, gapExtra:0, crumbleDelay:1.1, platformScale:1 },
  hard: { name:'困难', hearts:2, enemyScale:1.6, timeScale:.65, gapExtra:32, crumbleDelay:.5, platformScale:1.5 }
};

// Hand-authored routes. The original first three easy layouts remain unchanged.
export const LEVELS = [
  { length:4300, gaps:[[1080,1220],[1800,1940],[2890,3050],[3680,3810]], clusters:[460,1370,2160,3180], stars:[725,2380,3420], spring:2040, checkpoint:2050, time:180, hint:'向右出发 · 长按跳跃可以跳得更高' },
  { length:4800, gaps:[[900,1050],[1560,1720],[2450,2620],[3360,3520],[4110,4270]], clusters:[400,1160,1930,2770,3640], stars:[660,2200,3900], spring:1830, checkpoint:2680, time:200, hint:'落日峡谷 · 把握浮台升降的节奏' },
  { length:5350, gaps:[[820,980],[1500,1670],[2230,2390],[3130,3300],[3900,4070],[4600,4770]], clusters:[370,1120,1800,2510,3460,4230], stars:[640,2760,4480], spring:2460, checkpoint:2420, time:220, hint:'星月之森 · 追着月光跨过连续沟壑' },
  { length:5500, gaps:[[960,1140],[1760,1940],[2740,2930],[3760,3950],[4680,4870]], clusters:[400,1320,2180,3170,4110], stars:[690,2450,4430], spring:2040, checkpoint:3020, time:230, bridges:'crumble', hint:'蘑菇湿地 · 裂纹浮台踩后会坍塌，别停太久' },
  { length:5900, gaps:[[1040,1230],[2050,2240],[3130,3320],[4210,4400],[5100,5300]], clusters:[400,1430,2500,3550,4520], stars:[700,2790,4840], spring:2360, checkpoint:3380, time:240, spikes:[870,1810,2890,3910,4900], hint:'琥珀沙丘 · 红色尖刺不能踩，提前起跳' },
  { length:6200, gaps:[[1000,1170],[2040,2220],[3100,3290],[4160,4340],[5190,5380]], clusters:[400,1400,2460,3520,4590], stars:[710,2770,4900], spring:2350, checkpoint:3360, time:250, ice:true, spikes:[1830,3950], hint:'霜雪山径 · 冰面刹车更慢，反向移动可以减速' },
  { length:6550, gaps:[[990,1210],[2110,2330],[3270,3490],[4430,4650],[5590,5810]], clusters:[400,1460,2580,3740,4900,6020], stars:[730,2860,5200], spring:2450, checkpoint:3550, time:260, bridges:'moving', hint:'云海浮岛 · 随浮台移动，看准落点再起跳' },
  { length:7000, gaps:[[1000,1200],[2120,2320],[3300,3510],[4480,4690],[5670,5880]], clusters:[400,1470,2590,3770,4950,6150], stars:[710,2880,6460], spring:2450, checkpoint:3590, time:280, bridges:'mixed', spikes:[1850,3050,4220,5390], hint:'晨曦灯塔 · 尖刺与浮台交错，最后一段挑战' }
];
export const LEVEL_COUNT = LEVELS.length;

export function createLevel(index, difficulty='easy') {
  if(!Number.isInteger(index)||!LEVELS[index])throw new RangeError('关卡编号超出范围');
  const mode=MODES[difficulty]||MODES.easy, route=LEVELS[index], hard=mode===MODES.hard;
  const length=route.length;
  const gapExtra=hard?(index===0?20:index===1?25:mode.gapExtra):0;
  const gaps=route.gaps.map(([a,b])=>[a,b+gapExtra]);
  const ground=[];let edge=0;
  for(const [start,end] of gaps){ground.push({x:edge,y:550,w:start-edge,h:500,kind:'ground',ice:!!route.ice});edge=end;}
  ground.push({x:edge,y:550,w:length-edge+400,h:500,kind:'ground',ice:!!route.ice});
  const blocks=[],platforms=[],coins=[],stars=[],enemies=[],springs=[],hazards=[],pickups=[];
  // Widened pits need a little extra runway before an overhead block row.
  const clusters=route.clusters.map(x=>{
    if(!hard)return x;
    const previous=gaps.filter(([,end])=>end<x).at(-1);
    return previous?Math.max(x,previous[1]+140):x;
  });
  const addPlatform=(x,y,w,options={})=>{
    const platform={x,y,w,h:22,kind:'platform',baseX:x,baseY:y,previousX:x,previousY:y,moving:false,axis:'y',amplitude:48,speed:1.4*mode.platformScale,phase:0,crumble:false,triggered:false,remaining:mode.crumbleDelay,hiddenFor:0,...options};
    platforms.push(platform);return platform;
  };
  const addEnemy=(x,phase,range=75)=>{
    const g=ground.find(g=>x>=g.x+8&&x+38<=g.x+g.w-8);if(!g)return;
    enemies.push({x,y:516,w:38,h:34,origin:x,range,vx:-(42+Math.min(index,5)*15)*mode.enemyScale,dead:false,phase});
  };
  clusters.forEach((x,i)=>{
    for(let j=0;j<3;j++)blocks.push({x:x+j*46,y:405-(i%2)*20,w:44,h:44,kind:j===1?'question':'brick',used:false,bump:0,reward:['coin','ammo','shield','star','mushroom'][(i+j)%5]});
    for(let j=0;j<4;j++)coins.push({x:x-5+j*44,y:343-(i%2)*20,taken:false});
    addEnemy(x+155,i);
    if(hard&&i%2===0)addEnemy(x+260,i+.5,48);
  });
  for(const [start,end] of gaps){
    for(let j=0;j<5;j++)coins.push({x:start-30+j*(end-start+60)/4,y:445-Math.sin(j/4*Math.PI)*48,taken:false});
  }
  for(let x=230;x<length-220;x+=125){
    if(!gaps.some(([a,b])=>x>a-40&&x<b+40)&&!clusters.some(v=>x>v-40&&x<v+240))coins.push({x,y:493,taken:false});
  }
  route.stars.forEach((x,i)=>{
    addPlatform(x-48,395,hard?104:128,{moving:index>0&&i===1});
    stars.push({x:x+14,y:340,taken:false});
  });
  if(route.bridges)gaps.forEach(([a,b],i)=>{
    const crumble=route.bridges==='crumble'||(route.bridges==='mixed'&&i%2===0);
    addPlatform((a+b)/2-(hard?40:52),465,hard?80:104,{crumble,moving:!crumble,axis:'x',amplitude:hard?52:38,speed:(.95+i*.06)*mode.platformScale,phase:i*.8});
  });
  const candidates=[...(route.spikes||[])];
  if(hard)for(const [a]of gaps)candidates.push(a-220);
  for(const x of candidates){
    const w=hard?64:46;
    // Keep safe landing / checkpoint space, avoid low ceilings and duplicate patches.
    if(!ground.some(g=>x>g.x+70&&x+w<g.x+g.w-(hard?120:170)))continue;
    if(Math.abs(x-route.checkpoint)<150||Math.abs(x-route.spring)<85)continue;
    if(blocks.some(b=>x<b.x+b.w+45&&x+w>b.x-45))continue;
    if(platforms.some(p=>x<p.x+p.w+35&&x+w>p.x-35))continue;
    if(hazards.some(h=>Math.abs(h.x-x)<130))continue;
    hazards.push({x,y:528,w,h:22,kind:'spikes'});
  }
  // Coin trails lead above the spikes, never directly into them.
  for(const coin of coins)if(hazards.some(h=>coin.x>h.x-15&&coin.x<h.x+h.w+15)&&coin.y>455)coin.y=435;
  springs.push({x:route.spring,y:520,w:48,h:30,bounce:0});
  const checkpointGround=ground.find(g=>route.checkpoint>=g.x+25&&route.checkpoint+100<g.x+g.w)||ground.find(g=>g.x>route.checkpoint);
  const checkpoint={x:Math.max(route.checkpoint,checkpointGround.x+50),y:550,active:false};
  // Place two readable supplies on safe ground, outside enemy patrols and spikes.
  for(const anchor of [300,checkpoint.x+70]){
    for(let offset=0;offset<=360;offset+=30){
      const x=anchor+offset;
      if(!ground.some(g=>x-18>=g.x+45&&x+18<=g.x+g.w-45))continue;
      if(hazards.some(h=>x+22>h.x-30&&x-22<h.x+h.w+30))continue;
      if(enemies.some(e=>x>e.origin-e.range-50&&x<e.origin+e.range+e.w+50))continue;
      pickups.push({kind:'ammo',x,y:519,amount:AMMO_PER_PICKUP[hard?'hard':'easy'],taken:false});break;
    }
  }
  return {index,difficulty:hard?'hard':'easy',length,gaps,ground,blocks,solids:[...ground,...blocks],platforms,coins,stars,enemies,springs,hazards,pickups,checkpoint,goal:{x:length-170,y:550},theme:THEMES[index],ice:!!route.ice,hint:route.hint,time:Math.round(route.time*mode.timeScale),maxHealth:mode.hearts};
}
