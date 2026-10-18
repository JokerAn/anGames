import test from 'node:test';
import assert from 'node:assert/strict';
import {createRace,stepRace,snapshot,cleanInput} from '../src/simulation.js';
import {getTrack,TRACKS} from '../src/tracks.js';
import {driverInput,syncVehiclePose} from '../src/driving.js';
import {earnRaceProgress} from './race-fixtures.js';
function advance(race,seconds){for(let i=0;i<Math.ceil(seconds*60);i++)stepRace(race,1/60);}
for(const track of TRACKS)test(`${track.name}: the public race loop rejects hands-off autopilot and terminal-position shortcuts`,()=>{
 const race=createRace({track:track.id,rules:'timeattack'}),r=race.racers[0];advance(race,12);assert.equal(r.v,0);assert.ok(Math.abs(r.s+12)<1e-8);assert.equal(r.checkpointsPassed,0);
 r.input={throttle:true};advance(race,12);assert.ok(Math.abs(r.x)>8);assert.equal(r.completedLaps,0);assert.equal(r.finishTime,null);
 r.s=getTrack(track.id).length*2-.3;r.v=60;r.x=0;r.headingError=0;r.input={throttle:true};stepRace(race,1/60);assert.equal(r.finishTime,null);assert.equal(r.resultTime,null);assert.equal(r.completedLaps,0);
});
test('a single sequenced reset pays once and snapshots preserve independent vehicle state without input internals',()=>{
 const race=createRace({rules:'timeattack'}),r=race.racers[0];race.time=1;r.input={resetPress:1};stepRace(race,1/60);assert.equal(r.resetCount,1);assert.equal(r.penaltyTime,3);advance(race,1);assert.equal(r.resetCount,1);assert.equal(r.penaltyTime,3);
 const s=snapshot(race),v=s.racers[0];assert.equal(v.input,undefined);assert.ok(!Object.keys(v).some(key=>key.startsWith('_')));assert.ok([v.worldX,v.worldZ,v.heading,v.forwardSpeed].every(Number.isFinite));assert.equal(v.resetCount,1);
 for(const value of [-1,NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER+1])assert.equal(cleanInput({resetPress:value}).resetPress,0);
});
for(const config of TRACKS)test(`${config.name}: deliberate sampled controls can finish every checkpoint with a valid challenge result`,()=>{
 const race=createRace({track:config.id,rules:'timeattack',laps:2}),r=race.racers[0],track=getTrack(config.id);let ticks=0;
 for(;ticks<60*160&&race.status!=='finished';ticks++){if(ticks%5===0)r.input=driverInput(race,r,track);stepRace(race,1/60);}
 assert.equal(race.status,'finished');assert.equal(r.completedLaps,2);assert.equal(r.cleanLaps,2);assert.ok(r.bestLap>0);assert.ok(r.resultTime>0);assert.ok(['gold','silver','bronze'].includes(r.medal));assert.equal(r.penaltyTime,0);assert.equal(r.collisions,0);
});
test('parking after connection input times out cannot reverse or earn checkpoints',()=>{
 const race=createRace({rules:'timeattack'}),r=race.racers[0];race.time=1;r.input={throttle:false,brake:true,park:true};advance(race,4);assert.equal(r.v,0);assert.equal(r.reversing,false);assert.ok(Math.abs(r.s+12)<1e-8);assert.equal(r.completedLaps,0);
});

test('car-to-car impacts apply a real lateral velocity impulse rather than telemetry alone',()=>{
 const race=createRace({rules:'arcade',players:[{id:'a'},{id:'b'}]}),[a,b]=race.racers;race.time=1;
 for(const r of race.racers.slice(2))r.finishTime=0;
 const t=getTrack(race.trackId),straight=t.boostStraight.s+20;
 Object.assign(a,{s:straight,x:0,v:25,input:{}});Object.assign(b,{s:straight+1,x:.5,v:25,input:{}});
 stepRace(race,1/60);assert.ok(a.sideSpeed<-.5,`a physical side speed ${a.sideSpeed}`);assert.ok(b.sideSpeed>.5,`b physical side speed ${b.sideSpeed}`);
});

test('an AI that misses a gate recovers through the same checkpoint-reset penalty as a human',()=>{
 const race=createRace({track:'coast',players:[]}),r=race.racers[0],track=getTrack(race.trackId);race.time=1;
 r.s=track.length/8+5;r.x=0;r.v=0;r._missedCheckpoint=true;stepRace(race,1/60);
 assert.equal(r.resetCount,1);assert.equal(r.penaltyTime,3);assert.ok(r.s<0);assert.ok(race.events.some(e=>e.racer===r.id&&e.type==='reset'));assert.equal(r.validLap,false);
});

test('rubbing traffic cannot add the same lateral collision kick on every simulation tick',()=>{
 const race=createRace({rules:'arcade',players:[]});race.time=1;let maximum=0;
 for(let i=0;i<240;i++){stepRace(race,1/60);maximum=Math.max(maximum,...race.racers.map(r=>Math.abs(r.sideSpeed)));}
 assert.ok(maximum<10,`repeated contacts built ${maximum.toFixed(2)} m/s lateral speed`);
});


test('overlapping cars already moving apart do not receive another outward collision impulse',()=>{
 const race=createRace({rules:'arcade',players:[{id:'a'},{id:'b'}]}),[a,b]=race.racers;race.time=1;for(const r of race.racers.slice(2))r.finishTime=0;
 const track=getTrack(race.trackId),s=track.boostStraight.s+20;Object.assign(a,{s,x:0,v:25,input:{}});Object.assign(b,{s:s+1,x:.5,v:25,input:{}});syncVehiclePose(a,track);syncVehiclePose(b,track);a.sideSpeed=-3;b.sideSpeed=3;
 stepRace(race,1/60);assert.ok(Math.abs(a.sideSpeed)<=3,`a separating velocity grew to ${a.sideSpeed}`);assert.ok(Math.abs(b.sideSpeed)<=3,`b separating velocity grew to ${b.sideSpeed}`);
});

test('a pulse hit before the victim movement step still invalidates its clean lap',()=>{
 const race=createRace({rules:'arcade',players:[{id:'a'},{id:'b'}]}),[a,b]=race.racers;race.time=1;for(const r of race.racers.slice(2))r.finishTime=0;
 const track=getTrack(race.trackId),s=track.boostStraight.s+20;
 earnRaceProgress(race,[[a,s],[b,s+20]]);assert.equal(b.validLap,true);
 Object.assign(a,{v:20,item:'pulse',input:{item:true}});Object.assign(b,{v:20,input:{}});syncVehiclePose(a,track);syncVehiclePose(b,track);
 stepRace(race,1/60);assert.ok(b.slow>0);assert.equal(b.validLap,false);assert.equal(b._cleanLap,false);
});
