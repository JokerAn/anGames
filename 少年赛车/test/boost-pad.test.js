import test from 'node:test';
import assert from 'node:assert/strict';
import {createRace,stepRace,snapshot} from '../src/simulation.js';
import {syncVehiclePose} from '../src/driving.js';
import {TRACKS,CARS,BOOST_PAD,CAR_CONTACT,getTrack} from '../src/tracks.js';
function fixture(t,trackId='coast',players=[{id:'local'}]) {
  const track=getTrack(trackId),objects=track.objects,pad={...objects.find(o=>o.type==='boost')};
  // Isolate contact and duration from the next oil patch or roadside barrier.
  track.objects=[pad];t.after(()=>{track.objects=objects;});
  const race=createRace({track:trackId,rules:'arcade',players});race.time=1;
  race.racers.filter(r=>r.bot).forEach(r=>r.finishTime=0);
  const me=race.racers[0];Object.assign(me,{s:pad.s,x:pad.x,v:20,input:{throttle:false}});
  return {race,me,pad,track};
}
function advance(race,seconds){for(let i=0;i<Math.round(seconds*60);i++)stepRace(race,1/60);}
for(const config of TRACKS)test(`${config.name}：三车型车头、车尾及两侧擦边均当帧加速`,t=>{
  const {pad}=fixture(t,config.id);
  const sides=BOOST_PAD.width/2+CAR_CONTACT.halfWidth-.06;
  const ends=BOOST_PAD.length/2+CAR_CONTACT.halfLength-.06;
  for(const car of CARS)for(const [s,x] of [[0,0],[-ends,0],[ends,0],[0,-sides],[0,sides]]) {
    const race=createRace({track:config.id,rules:'arcade'});race.time=1;race.racers.slice(1).forEach(r=>r.finishTime=0);
    const me=race.racers[0];Object.assign(me,{car:car.id,s:pad.s+s,x:pad.x+x,v:20,input:{throttle:false}});
    stepRace(race,1/60);
    assert.equal(me.boost,3.7,`${car.id} offset (${s},${x})`);assert.equal(me.boosting,true);
    assert.ok(me.v>26,`${car.id} 必须在触碰的同一帧提速`);assert.equal(race.events.filter(e=>e.type==='boost').length,1);
  }
});
test('高速斜向擦过时，终点已离开加速带仍按经过的车身轨迹触发',t=>{
  const {race,me,pad,track}=fixture(t);Object.assign(me,{s:pad.s-2,x:pad.x+3.4,v:95,input:{throttle:false,steer:1}});syncVehiclePose(me,track);me.sideSpeed=100;
  stepRace(race,.05);assert.ok(me.x-pad.x>6);assert.equal(me.boost,3.7);assert.equal(me.boosting,true);assert.ok(race.events.some(e=>e.type==='boost'));
});
test('车身没有接触时不触发，加速带以外的平行车道不会误加速',t=>{
  const {pad}=fixture(t);
  for(const [s,x] of [[0,BOOST_PAD.width/2+CAR_CONTACT.halfWidth+.3],[0,-BOOST_PAD.width/2-CAR_CONTACT.halfWidth-.3],[-BOOST_PAD.length/2-CAR_CONTACT.halfLength-.3,0],[BOOST_PAD.length/2+CAR_CONTACT.halfLength+.3,0]]){
    const race=createRace({rules:'arcade'});race.time=1;race.racers.slice(1).forEach(r=>r.finishTime=0);const me=race.racers[0];Object.assign(me,{s:pad.s+s,x:pad.x+x,v:0,input:{brake:true,park:true,throttle:false}});
    stepRace(race,1/60);assert.equal(me.boost,0);assert.ok(!race.events.some(e=>e.type==='boost'));
  }
});
test('跨起终点接缝擦到加速带仍触发',t=>{
  const {race,me,pad,track}=fixture(t);pad.s=1;Object.assign(me,{s:track.length-5,x:pad.x,v:50});
  stepRace(race,.05);assert.equal(me.boost,3.7);assert.equal(me.boosting,true);
});
test('松开油门也持续提速，效果持续原 1.7 秒加 2 秒，不扣氮气',t=>{
  const {race,me,pad}=fixture(t);const nitro=me.nitro;stepRace(race,1/60);const speed=me.v;
  me.s=pad.s+20;me.x=0;advance(race,.5);assert.ok(me.v>speed);assert.equal(me.boosting,true);assert.ok(me.nitro>=nitro);
  me.input={throttle:false,brake:true,park:true};me.v=0;advance(race,3.1);assert.ok(Math.abs(me.boost-.1)<1e-8);advance(race,.1);assert.ok(me.boost<1e-8);stepRace(race,1/60);assert.equal(me.boosting,false);
});
test('停在加速带上不重复触发，驶离后重新接触可再次触发',t=>{
  const {race,me,pad}=fixture(t);me.input={brake:true,park:true,throttle:false};me.v=0;
  const boosts=new Set();
  for(let i=0;i<240;i++){stepRace(race,1/60);for(const e of race.events)if(e.type==='boost')boosts.add(e.id);}
  assert.equal(race.events.filter(e=>e.type==='boost').length,0); // Original event has aged out of the history window.
  assert.equal(boosts.size,1);assert.equal(me.boost,0);assert.equal(me.v,0);assert.equal(me.boosting,false);assert.ok(Math.abs(me.s-pad.s)<.01);
  me.s=pad.s+20;stepRace(race,1/60);me.s=pad.s;me.input={throttle:false};stepRace(race,1/60);
  for(const e of race.events)if(e.type==='boost')boosts.add(e.id);
  assert.equal(boosts.size,2);assert.equal(me.boost,3.7);assert.equal(me.boosting,true);assert.ok(me.v>=7);
});
test('更长的已有加速不会被加速带或超级氮气缩短',t=>{
  const {race,me}=fixture(t);me.boost=5;stepRace(race,1/60);assert.ok(me.boost>4.9);
  me.item='nitro';me.input={item:true,throttle:false};stepRace(race,1/60);assert.ok(me.boost>4.9);assert.equal(me.item,null);
});
test('双人独立擦边触发，快照当帧携带加速状态，不发送接触锁',t=>{
  const {race,pad}=fixture(t,'coast',[{id:'a'},{id:'b'}]);
  race.racers.slice(0,2).forEach((r,i)=>Object.assign(r,{s:pad.s,x:pad.x+(i?1:-1)*3.4,v:20,input:{throttle:false}}));
  stepRace(race,1/60);const state=snapshot(race);
  for(const me of state.racers.slice(0,2)){assert.equal(me.boost,3.7);assert.equal(me.boosting,true);assert.ok(me.v>26);assert.equal(me.boostContacts,undefined);}
});
