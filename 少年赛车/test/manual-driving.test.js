import test from 'node:test';
import assert from 'node:assert/strict';
import {createRace,stepRace,cleanInput} from '../src/simulation.js';
import {TRACKS,getTrack,shortDistance,steeringLimit} from '../src/tracks.js';
function isolated(track){const race=createRace({track});race.time=1;race.racers.slice(1).forEach(r=>r.finishTime=0);return race;}
function advance(race,seconds){for(let i=0;i<seconds*60;i++)stepRace(race,1/60);}
test('空输入不会暗中踩油门，新玩家无人操作保持起跑位置',()=>{
  for(const input of [undefined,{},null,[],{steer:0}])assert.equal(cleanInput(input).throttle,false);
  for(const config of TRACKS){const race=isolated(config.id),me=race.racers[0],start=me.s;advance(race,8);assert.equal(me.s,start);assert.equal(me.v,0);assert.equal(me.finishTime,null);}
});
for(const config of TRACKS){
  test(`${config.name}：只踩油门不转向会偏离弯道、碰墙，不能自动跑完整圈`,()=>{
    const race=isolated(config.id),me=race.racers[0];Object.assign(me,{x:0,input:{throttle:true}});advance(race,8);
    assert.ok(Math.abs(me.x)>6);assert.ok(Math.abs(me.headingError)>.2);assert.ok(race.eventSeq>0);advance(race,30);assert.ok(me.s<getTrack(config.id).length);assert.equal(me.finishTime,null);
  });
  test(`${config.name}：直线松开转向保持车头朝向，不会主动吸回道路中心`,()=>{
    const race=isolated(config.id),me=race.racers[0],track=getTrack(config.id);Object.assign(me,{s:track.boostStraight.s+20,x:5,v:30,input:{throttle:false}});advance(race,.8);assert.ok(Math.abs(me.x-5)<.02);assert.ok(Math.abs(me.headingError)<1e-8);assert.ok(me.v<30&&me.v>0);
    Object.assign(me,{headingError:.15,x:0,input:{throttle:false}});advance(race,.3);assert.ok(me.x>.3);assert.ok(Math.abs(me.headingError-.15)<1e-8);
  });
  test(`${config.name}：方向输入真实转动车头，主动修正才可沿弯道走线`,()=>{
    const race=isolated(config.id),me=race.racers[0],track=getTrack(config.id);Object.assign(me,{s:20,x:0,v:25});
    const worldYaw=()=>track.sample(me.s).yaw+me.headingError,original=worldYaw();me.input={throttle:true};advance(race,.2);
    assert.ok(Math.abs(shortDistance(worldYaw(),original,Math.PI*2))<.025,'没有转向时车头不能直接跟着道路旋转');
    for(let i=0;i<360;i++) {
      const maxSteer=steeringLimit(me.v),desired=track.curvature(me.s)*me.v+(Math.atan2(-me.x,14)-me.headingError)*4;
      const steer=Math.max(-1,Math.min(1,Math.atan(2.8*desired/Math.max(5,me.v))/maxSteer));
      me.input={throttle:me.v<28,brake:me.v>30,steer};stepRace(race,1/60);
    }
    assert.ok(Math.abs(me.x)<2);assert.ok(me.s>120);assert.equal(me.hit,0);
  });
}
