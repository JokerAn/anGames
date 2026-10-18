import test from 'node:test';
import assert from 'node:assert/strict';
import {createRace,stepRace,snapshot} from '../src/simulation.js';
import {syncVehiclePose} from '../src/driving.js';
import {getTrack} from '../src/tracks.js';
import {earnRaceProgress} from './race-fixtures.js';
function setup(){
  const race=createRace({rules:'arcade',players:[{id:'human'},{id:'rival'}]}),track=getTrack(race.trackId),[me,other]=race.racers;
  race.time=15;race.racers.slice(2).forEach(r=>r.finishTime=0);
  earnRaceProgress(race,[[me,track.boostStraight.s+25],[other,track.boostStraight.s+45]]);
  for(const r of [me,other]){Object.assign(r,{x:-4,v:30,headingError:0,input:{throttle:true}});syncVehiclePose(r,track);}
  race.events=[];return {race,track,me,other};
}
test('authoritative pulse forwards hit provenance and shield absorption to both client snapshots',()=>{
  const {race,me,other}=setup();me.item='pulse';me.input={throttle:true,itemPress:1};stepRace(race,1/60);
  assert.ok(other.slow>0);assert.ok(other.v<25);assert.equal(other.validLap,false);
  const hit=race.events.find(e=>e.type==='hit'&&e.racer===other.id);assert.equal(hit.source,'pulse');assert.equal(hit.attacker,me.id);
  const network=snapshot(race);assert.equal(network.racers.find(r=>r.id===other.id).slow,other.slow);assert.ok(network.events.some(e=>e.source==='pulse'));
  const shielded=setup();shielded.me.item='pulse';shielded.me.input={itemPress:1};shielded.other.shield=4;stepRace(shielded.race,1/60);
  assert.equal(shielded.other.slow,0);assert.ok(shielded.other.v>28);assert.ok(shielded.race.events.some(e=>e.racer===shielded.other.id&&e.type==='shield'&&e.source==='pulse'));
});
test('deployed oil never hits its owner, slows an actual follower and releases expired contact keys',()=>{
  const {race,track,me,other}=setup();me.item='oil';me.input={itemPress:1};stepRace(race,1/60);const trap=race.traps[0];assert.ok(trap);
  for(const r of [me,other]){Object.assign(r,{s:trap.s,x:trap.x,v:25,input:{throttle:true}});syncVehiclePose(r,track);}
  other.s-=8;syncVehiclePose(other,track);stepRace(race,1/60);assert.equal(me.slow,0);
  Object.assign(me,{s:trap.s+15});syncVehiclePose(me,track);Object.assign(other,{s:trap.s,x:trap.x});syncVehiclePose(other,track);stepRace(race,1/60);
  assert.ok(other.slow>0);assert.ok(race.events.some(e=>e.racer===other.id&&e.source==='oil'&&e.attacker===me.id));
  race.time=trap.expires+.1;stepRace(race,1/60);assert.equal(race.traps.length,0);assert.equal(me.cooldowns[trap.id],undefined);assert.equal(other.cooldowns[trap.id],undefined);
});
test('a bot with a valid target uses its carried pulse and starts a bounded decision cooldown',()=>{
  const {race,track,me,other}=setup();Object.assign(other,{bot:true,s:me.s-22,item:'pulse',nextItemUse:0});syncVehiclePose(other,track);
  stepRace(race,1/60);assert.equal(other.item,null);assert.ok(me.slow>0);assert.ok(other.nextItemUse>=race.time+11);
  other.item='pulse';me.slow=0;me.impactCooldown=0;stepRace(race,1/60);assert.equal(other.item,'pulse');assert.equal(me.slow,0);
});
test('automatic item tactics never consume the human driver inventory',()=>{
  const {race,me}=setup();me.item='nitro';stepRace(race,1/60);assert.equal(me.item,'nitro');assert.equal(me.boost,0);
});
