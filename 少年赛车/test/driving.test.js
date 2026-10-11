import test from 'node:test';
import assert from 'node:assert/strict';
import {createRace,stepRace,cleanInput} from '../src/simulation.js';
import {getTrack,TRACKS,ROAD_HALF} from '../src/tracks.js';
function isolated(rules='circuit',track='coast'){const race=createRace({rules,track});race.time=1;race.racers.slice(1).forEach(r=>r.finishTime=0);return race;}
function advance(race,seconds){for(let i=0;i<Math.round(seconds*60);i++)stepRace(race,1/60);}
test('默认竞速启用加速带，但不会触发道具、路障或油污',()=>{
  const race=isolated(),me=race.racers[0];assert.equal(createRace().rules,'circuit');assert.equal(createRace({rules:'invalid'}).rules,'circuit');
  for(const o of getTrack('coast').objects){Object.assign(me,{s:o.s,x:o.x,v:20,input:{throttle:false},slow:0,boost:0,boostContacts:{}});stepRace(race,1/60);assert.equal(me.item,null);assert.equal(me.slow,0);if(o.type==='boost'){assert.equal(me.boost,3.7);assert.equal(me.boosting,true);}else assert.equal(me.boost,0);}
  assert.ok(!race.events.some(e=>e.type==='pickup'));assert.ok(race.events.some(e=>e.type==='boost'));
});
test('刹车比松油门更快降速，同时覆盖油门与氮气',()=>{
  const coast=isolated(),brake=isolated();for(const race of [coast,brake])Object.assign(race.racers[0],{s:0,x:0,v:40});
  coast.racers[0].input={throttle:false};brake.racers[0].input={throttle:true,brake:true,nitro:true};advance(coast,.4);advance(brake,.4);
  assert.ok(brake.racers[0].v<coast.racers[0].v-8);assert.equal(brake.racers[0].boosting,false);assert.equal(brake.racers[0].braking,true);assert.equal(cleanInput({brake:true}).throttle,false);
});
test('高速弯道抓地极限降低速度；坡度、换挡、转速状态有限',()=>{
  for(const config of TRACKS){const race=isolated('circuit',config.id),me=race.racers[0],track=getTrack(config.id);let corner=0;for(let s=0;s<track.length;s+=3)if(Math.abs(track.curvature(s))>Math.abs(track.curvature(corner)))corner=s;
    Object.assign(me,{s:corner,x:0,v:55,input:{throttle:true}});stepRace(race,1/60);assert.ok(me.gripUsage>1);assert.ok(me.acceleration<0);assert.ok(Number.isFinite(me.rpm+me.gear+me.acceleration+track.slope(corner)));assert.ok(me.gear>=1&&me.gear<=6);
  }
});
test('纯竞速漂移没有释放奖励，电驱保持单挡',()=>{
  const race=isolated(),me=race.racers[0];Object.assign(me,{s:20,x:0,v:30,engine:'electric',driftCharge:1,input:{throttle:false}});stepRace(race,1/60);
  assert.equal(me.gear,1);assert.equal(me.boost,0);assert.equal(me.driftCharge,0);assert.ok(!race.events.some(e=>e.type==='drift'));
});
for(const config of TRACKS)test(`${config.name}两种规则下六辆 AI 均可完成比赛`,()=>{
  for(const rules of ['circuit','arcade']){const race=createRace({track:config.id,rules,laps:2,players:[]});advance(race,180);assert.equal(race.status,'finished');assert.equal(race.finishOrder.length,6,`${rules} 必须全员完赛`);for(const r of race.racers)assert.ok(Number.isFinite(r.s+r.x+r.v+r.rpm));}
});

test('自动换挡迟滞避免临界速度反复跳挡，换挡时转速合理回落',()=>{
  const race=isolated('arcade'),me=race.racers[0];Object.assign(me,{s:0,x:0,v:22.5,gear:2,input:{throttle:false}});stepRace(race,1/60);assert.equal(me.gear,2);const rpm=me.rpm;
  me.v=23;stepRace(race,1/60);assert.equal(me.gear,3);assert.ok(me.rpm<rpm&&me.rpm>2500);
  me.v=21.8;stepRace(race,1/60);assert.equal(me.gear,3);me.v=19.7;stepRace(race,1/60);assert.equal(me.gear,2);
});

test('三条赛道坡度与弯道半径适合公路驾驶，内侧护栏留有空间',()=>{
  for(const config of TRACKS){const t=getTrack(config.id);for(let s=0;s<t.length;s+=2){assert.ok(Math.abs(t.slope(s))<.22,`${config.id} slope at ${s}`);assert.ok(Math.abs(t.curvature(s))<1/(ROAD_HALF+3),`${config.id} radius at ${s}`);}}
});
