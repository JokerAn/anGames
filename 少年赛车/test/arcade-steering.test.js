import test from 'node:test';
import assert from 'node:assert/strict';
import {TRACKS,getTrack,steeringLimit,shortDistance} from '../src/tracks.js';
import {stepVehicle,syncVehiclePose,VEHICLE_GRIP} from '../src/driving.js';
const track=getTrack('coast');
function turn(speed,direction=1){
  const r={car:'comet',engine:'balanced',s:track.boostStraight.s+120,x:0,v:speed,headingError:0,steerAngle:0};syncVehiclePose(r,track);const heading=r.heading;
  for(let i=0;i<24;i++)stepVehicle(r,{steer:.65*direction,throttle:true},track,1/60);
  return {r,angle:shortDistance(r.heading,heading,Math.PI*2)};
}
test('steering lock is visibly larger at parking and road speeds while remaining bounded',()=>{
 for(const speed of [0,6,12,25,40,55,90]){
  const previous=.52/(1+.03*speed+.0006*speed*speed);
  assert.ok(steeringLimit(speed)>=previous*1.6,`${speed}: ${steeringLimit(speed)}`);
  assert.ok(steeringLimit(speed)>0&&steeringLimit(speed)<=.95);
 }
 assert.ok(VEHICLE_GRIP>=20,'increasing wheel lock alone cannot overcome the old yaw cap');
});
test('the same 0.4 second steering input turns the actual world heading at least 45 percent farther',()=>{
 const baseline=[[6,.2712159056],[12,.2661822002],[25,.1758651793],[40,.1168962726],[55,.0865025024]];
 for(const [v,legacy] of baseline)for(const side of [-1,1]){
  const result=turn(v,side);assert.equal(Math.sign(result.angle),side);
  assert.ok(Math.abs(result.angle)>legacy*1.45,`${v}/${side}: actual ${result.angle}, baseline ${legacy}`);
  assert.ok(Number.isFinite(result.r.worldX+result.r.worldZ+result.r.v));assert.equal(result.r.offRoad,false);
 }
});
test('opposite steering produces symmetric driver control on a straight and leaves high speed grip finite',()=>{
 for(const speed of [12,25,40,55]){
  const left=turn(speed,1),right=turn(speed,-1);assert.ok(Math.abs(left.angle+right.angle)<1e-7);
  assert.ok(Math.abs(left.r.x+right.r.x)<.01);assert.ok(Math.abs(left.r.yawRate)<1.6);
 }
});
test('malformed speed does not poison steering and reverse receives the same mechanical lock',()=>{
 for(const speed of [NaN,Infinity,-Infinity,undefined])assert.ok(Number.isFinite(steeringLimit(speed)));
 assert.equal(steeringLimit(-12),steeringLimit(12));
});
test('new arcade circuit is a distinct selectable night course with readable boost and attack pickups',()=>{
 const config=TRACKS.find(t=>t.id==='arcade');assert.ok(config,'new arcade course must be selectable');
 const t=getTrack('arcade');assert.equal(t.id,'arcade');assert.equal(t.night,true);assert.equal(t.lightShow,true);
 assert.ok(t.length>1500&&t.length<2300);assert.deepEqual(t.sample(0),t.sample(t.length));
 assert.ok(t.objects.some(o=>o.type==='box'&&o.itemKind==='rocket'));
 assert.ok(t.objects.some(o=>o.type==='box'&&o.itemKind==='frost'));
 assert.ok(Math.abs(t.length-getTrack('neon').length)>30);
 for(let s=0;s<t.length;s+=4){assert.ok(Math.abs(t.slope(s))<.22);assert.ok(Math.abs(t.curvature(s))<.08);}
});
