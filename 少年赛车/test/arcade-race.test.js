import test from 'node:test';
import assert from 'node:assert/strict';
import {createRace,stepRace,snapshot} from '../src/simulation.js';
import {getTrack} from '../src/tracks.js';
import {syncVehiclePose} from '../src/driving.js';
import {earnRaceProgress} from './race-fixtures.js';
function setup(trackId='coast'){
 const race=createRace({track:trackId,rules:'arcade',players:[{id:'a'},{id:'b'}]}),track=getTrack(trackId),[me,other]=race.racers;race.time=12;
 race.racers.slice(2).forEach(r=>r.finishTime=0);earnRaceProgress(race,[[me,track.boostStraight.s+20],[other,track.boostStraight.s+45]]);
 for(const r of [me,other]){Object.assign(r,{v:30,x:-5,headingError:0,input:{throttle:true}});syncVehiclePose(r,track);}return {race,track,me,other};
}
function advance(race,seconds){for(let i=0;i<Math.round(seconds*60);i++)stepRace(race,1/60);}
test('rocket produces stronger real acceleration than regular nitro and its independent timer expires',()=>{
 const rocket=setup(),nitro=setup();for(const f of [rocket,nitro]){f.other.finishTime=0;f.me.nitro=55;}
 rocket.me.item='rocket';rocket.me.input={throttle:true,itemPress:1};nitro.me.item='nitro';nitro.me.input={throttle:true,itemPress:1};
 advance(rocket.race,.6);advance(nitro.race,.6);
 assert.ok(rocket.me.overdrive>1.5);assert.ok(rocket.me.v>nitro.me.v+2,`rocket ${rocket.me.v} / nitro ${nitro.me.v}`);assert.equal(rocket.me.boosting,true);
 rocket.me.input={brake:true};advance(rocket.race,2);assert.equal(rocket.me.overdrive,0);assert.equal(rocket.me.boosting,false);
});
test('rocket leaves a longer pad boost intact and obeys braking and penalized recovery',()=>{
 const {race,me}=setup();me.item='rocket';me.boost=5;me.input={brake:true,itemPress:1};const initial=me.v;stepRace(race,1/60);
 assert.ok(me.overdrive>2);assert.ok(me.boost>4.9);assert.equal(me.boosting,false);assert.ok(me.v<initial);
 me.input={resetPress:1};stepRace(race,1/60);assert.equal(me.overdrive,0);assert.ok(me.penaltyTime>=3);
});
test('frost strikes a single real target, slows world velocity and synchronizes its timer',()=>{
 const {race,me,other}=setup();me.item='frost';me.input={itemPress:1,throttle:true};stepRace(race,1/60);
 assert.equal(me.item,null);assert.ok(other.frozen>2.3);assert.ok(race.events.some(e=>e.type==='hit'&&e.source==='frost'&&e.attacker===me.id));
 const packet=snapshot(race);assert.equal(packet.racers.find(r=>r.id==='b').frozen,other.frozen);
 other.input={throttle:true};advance(race,.7);assert.ok(other.v<26,`frozen speed ${other.v}`);
 other.item='shield';other.input={itemPress:1};stepRace(race,1/60);assert.equal(other.frozen,0);assert.equal(other.slow,0);assert.ok(other.shield>0);
});
test('arcade track first two supply boxes visibly award rocket then frost and stay optional in circuit',()=>{
 const f=setup('arcade');f.other.finishTime=0;
 for(const kind of ['rocket','frost']){const box=f.track.objects.find(o=>o.type==='box'&&o.itemKind===kind);Object.assign(f.me,{s:box.s,x:box.x,v:0,item:null,input:{}});syncVehiclePose(f.me,f.track);stepRace(f.race,1/60);assert.equal(f.me.item,kind);}
 const quiet=createRace({rules:'circuit',track:'arcade'}),box=f.track.objects.find(o=>o.itemKind==='rocket'),r=quiet.racers[0];quiet.time=1;quiet.racers.slice(1).forEach(o=>o.finishTime=0);Object.assign(r,{s:box.s,x:box.x,v:0,input:{}});syncVehiclePose(r,f.track);stepRace(quiet,1/60);assert.equal(r.item,null);assert.equal(r.v,0);
});
