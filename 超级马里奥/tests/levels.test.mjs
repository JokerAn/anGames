import test from 'node:test';
import assert from 'node:assert/strict';
import {createLevel, LEVEL_COUNT, LEVELS, THEMES, MODES} from '../levels.js';

const overlaps=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x;
test('default mode preserves the original three routes and health',()=>{
  for(let i=0;i<3;i++){
    const l=createLevel(i);
    assert.equal(l.difficulty,'easy');assert.equal(l.maxHealth,3);
    assert.deepEqual(l.gaps,LEVELS[i].gaps);assert.equal(l.enemies.length,LEVELS[i].clusters.length);
    assert.equal(l.hazards.length,0);assert.equal(l.time,180+i*20);
    assert.equal(Math.abs(l.enemies[0].vx),42+i*15);
  }
});
test('eight distinct destinations; invalid levels fail explicitly',()=>{
  assert.equal(LEVEL_COUNT,8);assert.equal(new Set(THEMES.map(t=>t.name)).size,8);
  for(const index of [-1,8,Infinity,1.5])assert.throws(()=>createLevel(index),RangeError);
});
for(const difficulty of Object.keys(MODES))for(let i=0;i<LEVEL_COUNT;i++){
  test(`${difficulty} ${i+1}: geometry, rewards, respawn and finish safety`,()=>{
    const l=createLevel(i,difficulty);
    const grounded=(x,w)=>l.ground.some(g=>x>=g.x&&x+w<=g.x+g.w);
    assert.equal(l.stars.length,3);assert.ok(l.time>100);
    assert.ok(grounded(120,32));assert.ok(grounded(l.checkpoint.x,70));assert.ok(grounded(l.goal.x,32));
    assert.ok(l.gaps.every(([a,b])=>b>a&&b-a<=260));
    assert.ok(l.ground.every(g=>g.w>0));
    for(const e of l.enemies)assert.ok(grounded(e.x,e.w),'enemy must not spawn in air');
    for(const b of l.blocks)assert.ok(grounded(b.x,b.w),'block must not obstruct gap crossing');
    for(const h of l.hazards){
      assert.ok(grounded(h.x-60,h.w+120),'spikes require landing space');
      assert.ok(!overlaps(h,{x:l.checkpoint.x-30,w:160}),'safe respawn');
      assert.ok(!l.blocks.some(b=>overlaps(h,{x:b.x-40,w:b.w+80})),'no spike / low ceiling trap');
      assert.ok(!l.coins.some(c=>c.y>455&&c.x>h.x&&c.x<h.x+h.w),'coins must not lure into spikes');
    }
    for(const p of l.platforms){assert.ok(p.w>=80);assert.ok(Number.isFinite(p.speed));assert.equal(p.hiddenFor,0);}
  });
}
test('hard increases challenge without changing jump physics',()=>{
  for(let i=0;i<LEVEL_COUNT;i++){
    const easy=createLevel(i),hard=createLevel(i,'hard');
    assert.equal(hard.maxHealth,2);assert.ok(hard.time<easy.time);
    assert.ok(hard.enemies.length>easy.enemies.length);
    assert.ok(Math.abs(hard.enemies[0].vx)>Math.abs(easy.enemies[0].vx));
    assert.ok(hard.gaps.every(([a,b],j)=>b-a===easy.gaps[j][1]-easy.gaps[j][0]+(i===0?20:i===1?25:40)));
  }
});
test('new stages contain distinct playable mechanics',()=>{
  assert.ok(createLevel(3).platforms.some(p=>p.crumble));
  assert.ok(createLevel(4).hazards.length>=2);
  assert.ok(createLevel(5).ground.every(g=>g.ice));
  assert.ok(createLevel(6).platforms.some(p=>p.moving&&p.axis==='x'));
  const last=createLevel(7);assert.ok(last.hazards.length>0);assert.ok(last.platforms.some(p=>p.crumble));assert.ok(last.platforms.some(p=>p.axis==='x'&&p.moving));
});
test('retries and modes never share mutable level objects',()=>{
  const a=createLevel(3,'hard'),b=createLevel(3,'hard');
  a.coins[0].taken=true;a.platforms[0].hiddenFor=4;a.checkpoint.active=true;a.gaps[0][1]=99999;
  assert.equal(b.coins[0].taken,false);assert.equal(b.platforms[0].hiddenFor,0);assert.equal(b.checkpoint.active,false);assert.ok(b.gaps[0][1]<99999);
});
