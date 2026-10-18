import test from 'node:test';
import assert from 'node:assert/strict';
import {cornerAdvice} from '../src/driving.js';
import {getTrack,TRACKS} from '../src/tracks.js';
const synthetic=(curvature,slope=0)=>({curvature,slope:()=>slope});

test('a tightening bend is called at its limiting section, not the fast entry',()=>{
 const t=synthetic(s=>s<40?0:s<70?.006:s<110?.03:0),a=cornerAdvice(t,0,{v:42,car:'comet'});
 assert.equal(a.direction,'left');assert.ok(a.speed<22,`advised ${a.speed*3.6}km/h for a tight bend`);assert.ok(a.distance>=70&&a.distance<110);assert.ok(a.entryDistance>=35&&a.entryDistance<=45);
});
test('braking is called according to available stopping distance rather than current speed alone',()=>{
 const t=synthetic(s=>s>=120&&s<165?.025:0),far=cornerAdvice(t,0,{v:42,car:'comet'}),near=cornerAdvice(t,90,{v:42,car:'comet'});
 assert.ok(far.speed<42);assert.equal(far.brakeNow,false);assert.ok(far.brakeIn>30);assert.equal(near.brakeNow,true);assert.ok(near.brakeIn<0);
});
test('going faster increases the braking distance and downhill braking warns earlier',()=>{
 const t=synthetic(s=>s>=100&&s<145?-.025:0),slow=cornerAdvice(t,0,{v:30,car:'comet'}),fast=cornerAdvice(t,0,{v:50,car:'comet'}),down=cornerAdvice(synthetic(t.curvature,-.15),0,{v:50,car:'comet'});
 assert.equal(fast.direction,'right');assert.ok(fast.brakingDistance>slow.brakingDistance+20);assert.ok(down.brakingDistance>fast.brakingDistance);assert.ok(down.brakeIn<fast.brakeIn);
});
test('vehicle grip affects advice and a parked car is never told to brake now',()=>{
 const t=synthetic(s=>s<90?.024:0),bolt=cornerAdvice(t,0,{v:35,car:'bolt'}),gt=cornerAdvice(t,0,{v:35,car:'titan'}),idle=cornerAdvice(t,0,{v:0});
 assert.ok(bolt.speed>gt.speed);assert.ok(bolt.brakingDistance<gt.brakingDistance);assert.equal(idle.brakeNow,false);assert.equal(idle.brakingDistance,0);
});
test('separate opposite bends keep their direction unless a later one needs braking already',()=>{
 const t=synthetic(s=>s>=65&&s<80?.006:s>=90&&s<140?-.035:0);
 assert.equal(cornerAdvice(t,0,{v:20}).direction,'left');const urgent=cornerAdvice(t,0,{v:60});assert.equal(urgent.direction,'right');assert.equal(urgent.brakeNow,true);
});
test('the real tightening coast bend no longer receives the entry-only 166km/h advice',()=>{
 const a=cornerAdvice(getTrack('coast'),995,{v:40,car:'comet'});assert.ok(a.speed*3.6<85);assert.equal(a.brakeNow,true);
});
test('all tracks yield finite bounded advice and the query never changes a racer',()=>{
 for(const config of TRACKS){const track=getTrack(config.id);for(let s=-20;s<track.length;s+=25){const me=Object.freeze({v:48,car:'comet'}),a=cornerAdvice(track,s,me);for(const key of ['speed','distance','entryDistance','brakingDistance','brakeIn','approachSpeed'])assert.ok(Number.isFinite(a[key]),`${config.id}/${s}/${key}`);assert.ok(a.speed>0&&a.speed<=70);assert.ok(a.distance>=0&&a.distance<=260);}}
});
