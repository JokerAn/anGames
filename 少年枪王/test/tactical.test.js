import test from 'node:test';
import assert from 'node:assert/strict';
import {Match,MAX_HP,WEAPONS,OBJECTIVES,defaultConfig,sanitizeInput,sanitizeConfig,blocked,aimAngles,cameraPose,traceRay,viewDirection} from '../src/simulation.js';
function arena(rules='elimination',map='blocks'){
  const m=new Match({map,rules,duration:300,target:100,bots:{blue:[],red:[]}},[{id:'a',team:'blue',weapon:'blaster'},{id:'b',team:'red',weapon:'blaster'}],()=>.5);
  for(const a of m.actors)Object.assign(a,{x:44,z:a.id==='a'?30:10,y:0,shield:0,cooldown:0});
  return m;
}
function advance(m,seconds){for(let i=0;i<Math.ceil(seconds*60);i++)m.step(1/60);}
test('distinct weapon cadence and finite magazines prevent firing during reload',()=>{
  assert.equal(new Set(Object.values(WEAPONS).map(w=>w.interval)).size,4);
  const m=arena(),a=m.actors[0];a.ammo.blaster=1;m.setInput('a',{fire:true,yaw:0,pitch:0});advance(m,.4);
  assert.equal(a.ammo.blaster,0);assert.ok(a.reloadTime>0);const shots=m.drainEvents().filter(e=>e.type==='shot').length;assert.equal(shots,1);
  m.setInput('a',{fire:false});advance(m,2);assert.equal(a.ammo.blaster,30);assert.equal(a.reloadTime,0);
});
test('switching weapons preserves spent magazines and cancels active reload',()=>{
  const m=arena(),a=m.actors[0];a.ammo.blaster=9;m.setInput('a',{reload:true});m.step(1/60);assert.ok(a.reloadTime>0);
  m.setInput('a',{weapon:'smg'});m.step(1/60);assert.equal(a.reloadTime,0);assert.equal(a.ammo.smg,36);
  m.setInput('a',{weapon:'blaster'});m.step(1/60);assert.equal(a.ammo.blaster,9);
});
test('manual reload is a press action and firing removes spawn protection',()=>{
  const m=arena(),a=m.actors[0];a.ammo.blaster=18;m.setInput('a',{reload:true});advance(m,2);assert.equal(a.ammo.blaster,30);
  a.ammo.blaster=29;m.step(1/60);assert.equal(a.reloadTime,0);
  a.shield=2;m.setInput('a',{fire:true});m.step(1/60);assert.equal(a.shield,0);
});
test('directional dash consumes resources, respects cooldown and cannot tunnel through any map',()=>{
  for(const map of Object.keys(OBJECTIVES)){
    const m=arena('elimination',map),a=m.actors[0],o=m.config.map==='harbor'?{x:16,z:0,w:8,d:28}:m.config.map==='desert'?{x:10,z:0,w:6,d:18}:{x:0,z:0,w:12,d:12};
    Object.assign(a,{x:o.x+o.w/2+.6,z:o.z,yaw:0});m.setInput('a',{dash:true,moveX:-1});advance(m,.4);
    assert.ok(!blocked(a.x,a.z,.46,map),map);assert.ok(a.x>=o.x+o.w/2+.47,map);assert.ok(a.stamina<100);assert.ok(a.dashCooldown>0);
    const cooldown=a.dashCooldown;m.step(1/60);assert.ok(a.dashCooldown<cooldown);assert.ok(a.dashTime===0);
  }
});
test('sprint spends stamina and idle restores it; dash is rejected with insufficient resources',()=>{
  const m=arena(),a=m.actors[0];m.setInput('a',{sprint:true,moveZ:-1});advance(m,1);assert.ok(a.stamina<80);
  m.setInput('a',{});advance(m,2);assert.equal(a.stamina,100);a.stamina=0;m.setInput('a',{dash:true});m.step(1/60);assert.equal(a.dashTime,0);
});
test('control points capture, stop scoring when contested, transfer and rotate',()=>{
  const m=arena('control','harbor'),[a,b]=m.actors,o=m.objective;Object.assign(a,{x:o.x,z:o.z});Object.assign(b,{x:44,z:-44});advance(m,3.1);
  assert.equal(m.objective.owner,'blue');advance(m,2);assert.ok(m.score.blue>=2);
  const score=m.score.blue;Object.assign(b,{x:o.x+1,z:o.z});advance(m,2);assert.equal(m.objective.contested,true);assert.equal(m.score.blue,score);
  Object.assign(a,{x:44,z:44});advance(m,6.1);assert.equal(m.objective.owner,'red');advance(m,1.1);assert.ok(m.score.red>0);
  m.time=49.99;m.step(1/30);assert.equal(m.objective.index,1);assert.equal(m.objective.owner,null);assert.equal(m.objective.progress,0);
  for(const [map,points] of Object.entries(OBJECTIVES))assert.ok(points.every(p=>!blocked(p.x,p.z,.48,map)),map);
});
test('team elimination does not accidentally award objective score',()=>{const m=arena();advance(m,5);assert.equal(m.snapshot().objective,null);assert.deepEqual(m.score,{blue:0,red:0});});
test('objective squads navigate without nonfinite positions or synthetic enemy shots',()=>{
  for(const map of Object.keys(OBJECTIVES)){
    let seed=123;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
    const m=new Match({...defaultConfig(),map,target:100,duration:300},[{id:'human',team:'blue',weapon:'blaster'}],random);
    advance(m,45);assert.ok(m.score.blue+m.score.red>0,map);
    for(const a of m.actors){assert.ok([a.x,a.y,a.z,a.pitch,a.yaw].every(Number.isFinite),`${map}/${a.id}`);assert.ok(!blocked(a.x,a.z,.46,map));}
    assert.ok(m.actors.some(a=>a.objectiveTime>0),map);
  }
});
test('first person and left shoulder preserve actual reticle-to-muzzle hit alignment',()=>{
  for(const viewMode of ['third','first'])for(const shoulder of [-1,1])for(const aim of [false,true])for(const viewAspect of [.46,16/9]){
    const m=arena(),[a,b]=m.actors;Object.assign(a,{viewMode,shoulder,viewAspect});Object.assign(a,aimAngles(a,{x:b.x,y:1.2,z:b.z},aim));
    const pose=cameraPose(a,a.yaw,a.pitch,aim,m.config.map);assert.equal(traceRay(pose,viewDirection(a.yaw,a.pitch),60,m.actors,a,m.config.map).victim?.id,'b');
    m.shoot(a,aim);assert.equal(b.hp,MAX_HP-22,`${viewMode}/${shoulder}/${aim}/${viewAspect}`);
  }
});
test('range falloff rewards fighting within a weapon working range',()=>{
  const damageAt=z=>{const m=arena(),[a,b]=m.actors;b.z=z;Object.assign(a,aimAngles(a,{x:b.x,y:1.2,z:b.z}));m.shoot(a,false);return MAX_HP-b.hp;};
  assert.ok(damageAt(20)>damageAt(-20));
});
test('network resource fields are sanitized and snapshots do not share mutable magazines',()=>{
  const input=sanitizeInput({reload:'yes',dash:1,sprint:true,shoulder:99,viewMode:'hack',viewAspect:Infinity});assert.equal(input.reload,false);assert.equal(input.dash,false);assert.equal(input.shoulder,1);assert.equal(input.viewMode,'third');
  assert.equal(sanitizeConfig({rules:'hack'}).rules,'elimination');const m=arena();const state=m.snapshot();state.actors[0].ammo.blaster=999;assert.equal(m.actors[0].ammo.blaster,30);
});
test('helmet hits require head-level aim and ground stops downward projectiles',()=>{
  const m=arena(),[a,b]=m.actors;Object.assign(a,aimAngles(a,{x:b.x,y:1.6,z:b.z}));m.shoot(a,false);assert.equal(b.hp,MAX_HP-44);assert.ok(m.drainEvents().some(e=>e.type==='hit'&&e.head));
  const ray=traceRay({x:44,y:1,z:20},{x:0,y:-1,z:0},60,m.actors,a,'blocks');assert.equal(ray.distance,1);assert.equal(ray.victim,null);
});
