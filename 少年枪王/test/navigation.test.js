import test from 'node:test';
import assert from 'node:assert/strict';
import { Match, defaultConfig, MAPS, blocked, findPath, visible, sanitizeConfig, sanitizeInput } from '../src/simulation.js';
import { NAVIGATION, groundClear, navigationGoal, navigationStats, clearNavigationCache } from '../src/navigation.js';
const positions=map=>{const result=[];for(let z=-47;z<=47;z+=2)for(let x=-47;x<=47;x+=2)if(!blocked(x,z,.55,map))result.push({x,z});return result;};
function independentDistance(a,b,map){
  const key=p=>`${p.x},${p.z}`,queue=[a],visited=new Map([[key(a),0]]);
  for(let i=0;i<queue.length;i++){
    const p=queue[i],distance=visited.get(key(p));if(key(p)===key(b))return distance;
    for(const [dx,dz] of [[2,0],[-2,0],[0,2],[0,-2]]){
      const next={x:p.x+dx,z:p.z+dz};if(visited.has(key(next))||blocked(next.x,next.z,.55,map))continue;
      // Independently sample the edge against the movement collision system.
      if([.25,.5,.75].some(t=>blocked(p.x+dx*t,p.z+dz*t,.55,map)))continue;
      visited.set(key(next),distance+1);queue.push(next);
    }
  }
  return -1;
}

test('different enemies reuse one reverse shortest-path field without sharing mutable routes',()=>{
  clearNavigationCache();const target={x:0,z:-44};let first;
  for(let x=-40;x<=40;x+=2){const path=findPath({x,z:44},target,'blocks');assert.ok(path.length>0);if(!first)first=path;}
  let stats=navigationStats();assert.equal(stats.builds,1);assert.equal(stats.hits,40);
  first[0].x=999;first.length=0;
  const second=findPath({x:-40,z:44},target,'blocks');assert.ok(second.length>0);assert.ok(second.every(p=>Math.abs(p.x)<=48));assert.equal(navigationStats().builds,1);
});
test('destination movement inside a node reuses its field; crossing nodes selects a different field',()=>{
  clearNavigationCache();const start={x:-45,z:45};findPath(start,{x:45,z:-45},'harbor');findPath(start,{x:44.5,z:-44.5},'harbor');assert.equal(navigationStats().builds,1);
  findPath(start,{x:46,z:-45},'harbor');assert.equal(navigationStats().builds,2);findPath(start,{x:45,z:-45},'harbor');assert.equal(navigationStats().builds,2);
});
test('reverse routes match independent shortest-path BFS on all three maps',()=>{
  for(const map of Object.keys(MAPS)){
    const points=positions(map);
    for(let i=0;i<45;i++){
      const a=points[(i*29)%points.length],b=points[(i*71+111)%points.length],expected=independentDistance(a,b,map),path=findPath(a,b,map);
      assert.equal(path.length,expected,`${map} ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
      let previous=a;for(const p of path){assert.ok(groundClear(previous,p,map));previous=p;}
    }
  }
});
test('map-separated LRU caches have a fixed memory bound and can rebuild evicted goals',()=>{
  clearNavigationCache();
  for(const map of Object.keys(MAPS)){const nodes=positions(map);for(const target of nodes.slice(0,80))findPath(nodes.at(-1),target,map);}
  const stats=navigationStats();assert.equal(stats.maps.length,3);
  for(const entry of stats.maps){assert.equal(entry.fields,NAVIGATION.maxFieldsPerMap);assert.ok(entry.evictions>=16);assert.equal(entry.cacheBytes,640000);}
  const before=stats.builds;const nodes=positions('blocks');findPath(nodes.at(-1),nodes[0],'blocks');assert.equal(navigationStats().builds,before+1);assert.equal(navigationStats().cacheBytes,1920000);
});
test('legal off-grid positions attach without crossing walls, blocked goals fail closed',()=>{
  const start={x:-20,z:-7.5},goal={x:0,z:-44};assert.equal(blocked(start.x,start.z,.48,'blocks'),false);assert.equal(blocked(-20,-8.6,.55,'blocks'),true);
  const path=findPath(start,goal,'blocks');assert.ok(path.length>0);assert.ok(groundClear(start,path[0],'blocks'));assert.ok(navigationGoal(start,'blocks')>=0);
  assert.deepEqual(findPath(start,{x:0,z:0},'blocks'),[]);assert.deepEqual(findPath({x:NaN,z:0},goal,'blocks'),[]);
});
test('ground sweeps reject low crates and diagonal corner cuts even when visibility is clear',()=>{
  const a={x:10,z:32},b={x:10,z:20};assert.equal(visible(a,b,'blocks'),true);assert.equal(groundClear(a,b,'blocks'),false);
  assert.equal(groundClear({x:7.2,z:5},{x:5,z:7.2},'blocks'),false);
  assert.equal(groundClear({x:8,z:8},{x:8,z:16},'blocks'),true);
});
test('an enemy flanks low cover instead of stopping forever on the wrong side',()=>{
  const config={...defaultConfig(),bots:{blue:[],red:[{difficulty:'hard',weapon:'shotgun'}]}};
  const match=new Match(config,[{id:'human',team:'blue',weapon:'blaster'}],()=>.5),bot=match.actors.find(a=>a.bot),human=match.actors.find(a=>!a.bot);
  Object.assign(bot,{x:10,z:34,y:0,cooldown:999});Object.assign(human,{x:10,z:16,y:0,hp:1000000});
  let flanked=false;
  for(let i=0;i<600;i++){match.step(1/60);match.drainEvents();assert.equal(blocked(bot.x,bot.z,.46,config.map),false);if(bot.z<23.04)flanked=true;}
  assert.ok(flanked,`stuck at ${bot.x},${bot.z}`);
});
test('goal changes and defeated targets promptly refresh the selected navigation goal',()=>{
  const m=new Match({...defaultConfig(),rules:'elimination',map:'blocks',bots:{blue:[],red:[{difficulty:'easy',weapon:'shotgun'}]}},[{id:'a',team:'blue',weapon:'blaster'},{id:'b',team:'blue',weapon:'blaster'}],()=>.5);
  const bot=m.actors.find(a=>a.bot),a=m.actors.find(x=>x.id==='a'),b=m.actors.find(x=>x.id==='b');Object.assign(bot,{x:0,z:40});Object.assign(a,{x:0,z:-40});Object.assign(b,{x:0,z:-42});m.step(1/60);
  assert.equal(bot.targetId,'a');const firstGoal=bot.routeGoal;a.x=2;m.step(1/60);assert.notEqual(bot.routeGoal,firstGoal);
  a.hp=0;a.respawn=3;m.step(1/60);assert.equal(bot.targetId,'b');
});
test('invalid weapon names and null payloads cannot reach prototype functions or NaN combat state',()=>{
  for(const weapon of ['constructor','toString','__proto__']){assert.equal(sanitizeInput({weapon}).weapon,undefined);assert.equal(sanitizeConfig({bots:{red:[{weapon}]}}).bots.red[0].weapon,'random');}
  assert.doesNotThrow(()=>sanitizeInput(null));assert.doesNotThrow(()=>sanitizeConfig(null));
  const m=new Match(defaultConfig(),[{id:'a',team:'blue',weapon:'constructor'}]);m.setInput('a',{weapon:'constructor',fire:true});m.step(1/30);assert.equal(m.actors[0].weapon,'blaster');assert.ok(Number.isFinite(m.actors[0].cooldown));
});
test('stopping stale input keeps facing while clearing movement and firing',()=>{
  const m=new Match(defaultConfig(),[{id:'a',team:'red',weapon:'blaster'}]);const a=m.actors[0];Object.assign(a,{yaw:2,pitch:.4});m.setInput(a.id,{yaw:2,pitch:.4,moveX:1,fire:true,jump:true});m.stopInput(a.id);m.step(1/30);
  assert.equal(a.yaw,2);assert.equal(a.pitch,.4);assert.equal(a.input.moveX,0);assert.equal(a.input.fire,false);assert.equal(a.input.jump,false);
});
test('random continuous-position pursuits reach firing range across all three maps',()=>{
  let seed=427;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  for(const map of Object.keys(MAPS))for(let trial=0;trial<30;trial++){
    const sample=()=>{let p;do{p={x:random()*92-46,z:random()*92-46};}while(blocked(p.x,p.z,.48,map));return p;};
    const from=sample(),to=sample(),m=new Match({map,duration:60,target:100,bots:{blue:[],red:[{difficulty:'hard',weapon:'shotgun'}]}},[{id:'human',team:'blue',weapon:'blaster'}],random);
    const a=m.actors.find(a=>a.bot),b=m.actors.find(a=>!a.bot);Object.assign(a,from,{cooldown:999});Object.assign(b,to,{hp:1000000});let reached=false;
    for(let i=0;i<2400;i++){m.step(1/60);m.drainEvents();if(visible(a,b,map,1.22)&&Math.hypot(a.x-b.x,a.z-b.z)<=7.1){reached=true;break;}}
    assert.ok(reached,`${map}: ${JSON.stringify(from)} -> ${JSON.stringify(to)}`);assert.equal(blocked(a.x,a.z,.46,map),false);
  }
});
