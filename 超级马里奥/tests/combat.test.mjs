import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceProjectiles,horizontalImpact,MAX_AMMO,AMMO_PER_PICKUP} from '../combat.js';
import {createLevel,LEVEL_COUNT} from '../levels.js';

const enemy=(x,y=510)=>({x,y,w:38,h:34,dead:false});
const bullet=(x=0,vx=650,y=528,life=.95)=>({x,vx,y,life});
const wall=(x,w=4)=>({x,y:500,w,h:50});

test('fast bullets hit a thin obstacle without tunnelling',()=>{
  const shots=[bullet()],target=enemy(100);
  const hits=advanceProjectiles(shots,[wall(60,2)],[target],.2);
  assert.equal(hits.length,1);assert.equal(hits[0].kind,'wall');assert.equal(hits[0].x,53);
  assert.equal(target.dead,false);assert.equal(shots.length,0);
});
test('wall occlusion works in both directions',()=>{
  const target=enemy(0),shots=[bullet(160,-650)];
  const hits=advanceProjectiles(shots,[wall(70)],[target],.3);
  assert.equal(hits[0].kind,'wall');assert.equal(target.dead,false);assert.equal(shots.length,0);
});
test('a bullet defeats only the nearest enemy, regardless of array order',()=>{
  const near=enemy(40),far=enemy(90),shots=[bullet()];
  const hits=advanceProjectiles(shots,[],[far,near],.3);
  assert.equal(hits.length,1);assert.equal(hits[0].enemy,near);
  assert.equal(near.dead,true);assert.equal(far.dead,false);assert.equal(shots.length,0);
});
test('two bullets cannot award the same kill twice',()=>{
  const target=enemy(60),shots=[bullet(),bullet()];
  const hits=advanceProjectiles(shots,[],[target],.15);
  assert.equal(hits.filter(hit=>hit.kind==='enemy').length,1);assert.equal(shots.length,1);
});
test('separate shots can hit separate targets in one update',()=>{
  const targets=[enemy(35),enemy(95)],shots=[bullet(),bullet()];
  const hits=advanceProjectiles(shots,[],targets,.25);
  assert.equal(hits.length,2);assert.ok(targets.every(e=>e.dead));assert.equal(shots.length,0);
});
test('bullets cannot hit targets above or below their path',()=>{
  const target=enemy(40,400),shots=[bullet()];
  assert.equal(advanceProjectiles(shots,[],[target],.2).length,0);
  assert.equal(target.dead,false);assert.equal(shots.length,1);
});
test('wall wins a collision tie; bullets spawned inside terrain are blocked',()=>{
  const target=enemy(30),shots=[bullet(35)];
  const hits=advanceProjectiles(shots,[wall(30,44)],[target],1/60);
  assert.equal(hits[0].kind,'wall');assert.equal(target.dead,false);
});
test('projectile lifetime bounds travel, then releases expired projectiles',()=>{
  const target=enemy(100),shots=[bullet(0,650,528,.05)];
  assert.equal(advanceProjectiles(shots,[],[target],1).length,0);
  assert.equal(shots.length,0);assert.equal(target.dead,false);
  assert.equal(advanceProjectiles([bullet(105,650,528,0)],[],[target],.1).length,0);
});
test('paused updates leave bullets and enemies untouched',()=>{
  const shots=[bullet()],target=enemy(40),copy=structuredClone(shots);
  assert.deepEqual(advanceProjectiles(shots,[],[target],0),[]);
  assert.deepEqual(shots,copy);assert.equal(target.dead,false);
});
test('sweep handles leftward contact and a stationary projectile',()=>{
  assert.ok(horizontalImpact(160,0,525,enemy(40))>0);
  assert.equal(horizontalImpact(0,0,525,enemy(40)),null);
});
for(const difficulty of ['easy','hard'])test(`${difficulty}: all eight levels have safe ammunition and a refill box`,()=>{
  assert.ok(AMMO_PER_PICKUP[difficulty]<MAX_AMMO);
  for(let i=0;i<LEVEL_COUNT;i++){
    const level=createLevel(i,difficulty);
    assert.equal(level.pickups.length,2,`level ${i+1}`);
    assert.ok(level.pickups[0].x<=360,'first supply is available near the start');
    assert.ok(level.blocks.some(b=>b.kind==='question'&&b.reward==='ammo'));
    for(const p of level.pickups){
      assert.equal(p.amount,AMMO_PER_PICKUP[difficulty]);assert.equal(p.taken,false);
      assert.ok(level.ground.some(g=>p.x-18>=g.x&&p.x+18<=g.x+g.w));
      assert.ok(!level.hazards.some(h=>p.x+22>h.x&&p.x-22<h.x+h.w));
    }
    level.pickups[0].taken=true;
    assert.equal(createLevel(i,difficulty).pickups[0].taken,false);
  }
});

test('spawn sweep hits point-blank enemies behind the drawn muzzle',()=>{
  const target=enemy(399),shots=[{...bullet(447),originX:416}];
  const hits=advanceProjectiles(shots,[],[target],1/60);
  assert.equal(hits.length,1);assert.equal(target.dead,true);assert.equal(shots.length,0);
});
test('spawn sweep cannot jump over a nearby thin wall',()=>{
  const target=enemy(500),shots=[{...bullet(447),originX:416}];
  const hits=advanceProjectiles(shots,[wall(433,6)],[target],1/60);
  assert.equal(hits[0].kind,'wall');assert.equal(target.dead,false);
});
test('spawn sweep works when firing left',()=>{
  const target=enemy(430),shots=[{...bullet(385,-650),originX:416}];
  const hits=advanceProjectiles(shots,[wall(400,6)],[target],1/60);
  assert.equal(hits[0].kind,'wall');assert.equal(target.dead,false);
});
test('initial origin is consumed once and never retraces old space',()=>{
  const shots=[{...bullet(47),originX:16}];advanceProjectiles(shots,[],[],.02);
  assert.equal(shots[0].originX,undefined);
  const target={...enemy(0),w:20};
  assert.equal(advanceProjectiles(shots,[],[target],.02).length,0);assert.equal(target.dead,false);
});
