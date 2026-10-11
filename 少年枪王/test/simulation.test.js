import test from 'node:test';
import assert from 'node:assert/strict';
import { Match, defaultConfig, sanitizeConfig, sanitizeInput, blocked, findPath, wallDistance, WEAPONS, MAX_HP, MAPS, getMap, cameraPose, aimAngles, viewDirection, traceRay } from '../src/simulation.js';
const humans=[{id:'a',name:'A',team:'blue',weapon:'blaster'},{id:'b',name:'B',team:'red',weapon:'blaster'}];
const config=()=>({duration:60,target:10,bots:{blue:[],red:[]}});
const fixed=()=>.5;
function readyMatch(){const m=new Match(config(),humans,fixed);Object.assign(m.actors[0],{x:30,z:16,y:0,yaw:0,pitch:0,shield:0,cooldown:0});Object.assign(m.actors[1],{x:30,z:0,y:0,yaw:Math.PI,pitch:0,shield:0,cooldown:0});Object.assign(m.actors[0],aimAngles(m.actors[0],{x:30,y:1.2,z:0}));return m;}
test('mixed bot rosters retain per-bot difficulty and specified weapons',()=>{
  for(const [easy,hard] of [[10,1],[1,5]]){const c=defaultConfig();c.bots.red=[...Array.from({length:easy},()=>({difficulty:'easy',weapon:'smg'})),...Array.from({length:hard},()=>({difficulty:'hard',weapon:'sniper'}))];const m=new Match(c,[humans[0]]);assert.equal(m.actors.filter(a=>a.team==='red'&&a.difficulty==='easy').length,easy);assert.equal(m.actors.filter(a=>a.team==='red'&&a.difficulty==='hard').length,hard);assert.equal(m.actors.filter(a=>a.team==='red'&&a.weapon==='sniper').length,hard);assert.equal(m.actors.filter(a=>a.team==='blue').length,3);}
});
test('untrusted config and input are bounded',()=>{const c=sanitizeConfig({duration:Infinity,target:-12,bots:{red:Array.from({length:80},()=>({difficulty:'hacker',weapon:'invalid'}))}});assert.equal(c.bots.red.length,24);assert.equal(c.bots.red[0].difficulty,'easy');assert.equal(c.target,5);assert.equal(c.duration,180);const i=sanitizeInput({yaw:Infinity,pitch:999,moveX:80,moveZ:NaN,fire:'yes'});assert.equal(i.yaw,0);assert.equal(i.pitch,1.2);assert.equal(i.moveX,1);assert.equal(i.moveZ,0);assert.equal(i.fire,false);});
test('shots score once, never hurt friendlies, and shields prevent hits',()=>{const m=readyMatch(),a=m.actors[0],b=m.actors[1];m.shoot(a,false);assert.equal(b.hp,MAX_HP-44);b.team='blue';m.shoot(a,false);assert.equal(b.hp,MAX_HP-44);b.team='red';b.shield=2;m.shoot(a,false);assert.equal(b.hp,MAX_HP-44);b.shield=0;for(let i=0;i<12;i++)m.shoot(a,false);assert.equal(b.hp,0);assert.equal(a.kills,1);assert.equal(m.score.blue,1);assert.equal(b.respawn,3);});
test('walls block shots and grounded movement',()=>{const m=readyMatch(),a=m.actors[0],b=m.actors[1];a.x=0;a.z=16;b.x=0;b.z=-16;m.shoot(a,false);assert.equal(b.hp,MAX_HP);assert.equal(wallDistance({x:0,y:1.4,z:16},{x:0,y:0,z:-1},30),10);assert.equal(blocked(0,0),true);assert.equal(blocked(60,0),true);});
test('eliminated players respawn with protection and regenerate health',()=>{const m=readyMatch(),a=m.actors[0];a.hp=0;a.respawn=.01;a.deaths=1;m.step(1/30);assert.equal(a.hp,MAX_HP);assert.equal(a.shield,2);assert.equal(a.deaths,1);a.hp=MAX_HP/2;a.lastHit=-10;m.step(1/30);assert.ok(a.hp>MAX_HP/2);});
test('random weapon selection is preserved across respawn',()=>{const m=readyMatch(),a=m.actors[0];a.weaponChoice='random';a.input.weapon='blaster';m.spawn(a);assert.equal(a.weaponChoice,'random');assert.equal(a.input.weapon,undefined);assert.ok(WEAPONS[a.weapon]);});
test('navigation finds walkable waypoints around central obstacles',()=>{const path=findPath({x:0,z:20},{x:0,z:-20});assert.ok(path.length>8);assert.ok(path.every(p=>!blocked(p.x,p.z,.48)));assert.ok(Math.hypot(path.at(-1).x,path.at(-1).z+20)<2);});
test('bots navigate and generate real shots during a full timed match',()=>{let seed=17;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};const c=defaultConfig();c.duration=150;c.target=100;const m=new Match(c,[humans[0]],random);let shots=0,pops=0;for(let i=0;i<9200&&!m.ended;i++){m.step(1/60);for(const e of m.drainEvents()){if(e.type==='shot')shots++;if(e.type==='pop')pops++;}}assert.ok(m.ended);assert.ok(shots>20,`shots=${shots}`);assert.ok(pops>0,`pops=${pops}`);assert.ok(m.actors.every(a=>Number.isFinite(a.x)&&Number.isFinite(a.z)&&!blocked(a.x,a.z,.46)));});
test('target score ends the match and further stepping does not change state',()=>{const m=readyMatch();m.score.blue=10;m.step(1/30);assert.equal(m.ended,true);assert.equal(m.winner,'blue');const t=m.time;m.step(1/30);assert.equal(m.time,t);});

test('three maps have independent collision and navigation layouts',()=>{
  assert.equal(Object.keys(MAPS).length,3);
  assert.equal(blocked(16,0,.48,'blocks'),false);assert.equal(blocked(16,0,.48,'harbor'),true);assert.equal(blocked(16,0,.48,'desert'),false);
  assert.equal(sanitizeConfig({map:'unknown'}).map,'blocks');assert.equal(sanitizeConfig({map:'harbor'}).map,'harbor');
  for(const map of Object.keys(MAPS)){
    const path=findPath({x:0,z:42},{x:0,z:-42},map);assert.ok(path.length>10,map);assert.ok(path.every(p=>!blocked(p.x,p.z,.48,map)),map);assert.ok(Math.hypot(path.at(-1).x,path.at(-1).z+42)<2,map);
    const c={...defaultConfig(),map};const m=new Match(c,humans);assert.equal(m.snapshot().config.map,map);assert.ok(m.actors.every(a=>!blocked(a.x,a.z,.48,map)));
  }
});
test('third-person camera keeps its orbit outside expanded walls and above ground',()=>{
  for(const map of Object.keys(MAPS))for(const o of getMap(map).obstacles){
    const a={x:o.x,y:0,z:o.z+o.d/2+.6};if(blocked(a.x,a.z,.48,map))continue;
    for(const yaw of [0,Math.PI/2,Math.PI,Math.PI*1.5])for(const pitch of [-1,0,1]){
      const p=cameraPose(a,yaw,pitch,false,map);assert.ok(p.y>=.299,map);
      assert.ok(!getMap(map).obstacles.some(w=>Math.abs(p.x-w.x)<w.w/2+.19&&Math.abs(p.z-w.z)<w.d/2+.19&&p.y<w.h+.19),`${map}: ${JSON.stringify(p)}`);
    }
  }
});
test('third-person reticle and muzzle agree at near and far distances, scoped and unscoped',()=>{
  for(const aim of [false,true])for(const distance of [3,8,22]){
    const m=readyMatch(),a=m.actors[0],b=m.actors[1];a.x=b.x=44;a.z=24;b.z=24-distance;
    Object.assign(a,aimAngles(a,{x:b.x,y:1.2,z:b.z},aim));const camera=cameraPose(a,a.yaw,a.pitch,aim,m.config.map);
    assert.equal(traceRay(camera,viewDirection(a.yaw,a.pitch),60,m.actors,a,m.config.map).victim?.id,b.id);
    m.shoot(a,aim);assert.equal(b.hp,MAX_HP-44,`distance=${distance}, aim=${aim}`);
  }
});
test('over-the-shoulder view cannot fire through cover at the muzzle',()=>{
  const m=readyMatch(),a=m.actors[0],b=m.actors[1];a.x=7;a.z=0;b.x=-12;b.z=0;
  Object.assign(a,aimAngles(a,{x:b.x,y:1.2,z:b.z}));m.shoot(a,false);assert.equal(b.hp,MAX_HP);
});
test('bots complete real matches in the harbor and desert without entering obstacles',()=>{
  for(const map of ['harbor','desert']){
    let seed=73;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
    const m=new Match({...defaultConfig(),map,duration:150,target:100},[humans[0]],random);let shots=0;
    for(let i=0;i<9200&&!m.ended;i++){m.step(1/60);shots+=m.drainEvents().filter(e=>e.type==='shot').length;}
    assert.ok(m.ended);assert.ok(shots>20,map);assert.ok(m.actors.every(a=>!blocked(a.x,a.z,.46,map)),map);
  }
});
test('camera can see over low cover without letting the muzzle shoot through it',()=>{
  const m=readyMatch(),a=m.actors[0],b=m.actors[1];Object.assign(a,{x:10,z:30});Object.assign(b,{x:10,z:20});
  Object.assign(a,aimAngles(a,{x:b.x,y:1.2,z:b.z}));const camera=cameraPose(a,a.yaw,a.pitch,false,'blocks');
  assert.equal(traceRay(camera,viewDirection(a.yaw,a.pitch),60,m.actors,a,'blocks').victim?.id,b.id);
  m.shoot(a,false);assert.equal(b.hp,MAX_HP);
});
