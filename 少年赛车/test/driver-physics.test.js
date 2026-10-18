import test from 'node:test';
import assert from 'node:assert/strict';
import {getTrack,TRACKS,shortDistance} from '../src/tracks.js';
const api=await import('../src/driving.js').catch(()=>({}));
const need=name=>{assert.equal(typeof api[name],'function',`${name} must exist`);return api[name];};
function car(track='coast',s=-12,x=0){const r={id:'a',car:'comet',engine:'balanced',s,x,v:0,headingError:0,steerAngle:0,boost:0,impactCooldown:0};need('syncVehiclePose')(r,getTrack(track));return r;}
function drive(r,t,input,seconds,hz=60){for(let i=0;i<Math.round(seconds*hz);i++)need('stepVehicle')(r,input,t,1/hz,{maxSpeed:60,baseMaxSpeed:60});}

test('world projection recovers position, signed lateral distance and an unwrapped lap on all tracks',()=>{
 const project=need('projectTrack');for(const config of TRACKS){const t=getTrack(config.id);for(const s of [-12,0,80,t.length-.8,t.length+40])for(const x of [-8,0,8]){const p=t.sample(s,x),q=project(t,p.x,p.z,s);assert.ok(Math.abs(q.s-s)<.1,`${config.id}/${s}/${x}: ${q.s}`);assert.ok(Math.abs(q.x-x)<.05);}}
});
test('zero input stays parked and a moving car preserves independent world heading with no steering',()=>{
 for(const config of TRACKS){const t=getTrack(config.id),r=car(config.id);drive(r,t,{},5);assert.equal(r.v,0);assert.ok(Math.abs(r.s+12)<.001);
 r.v=25;need('syncVehiclePose')(r,t);const yaw=r.heading;drive(r,t,{},.5);assert.ok(Math.abs(shortDistance(r.heading,yaw,Math.PI*2))<1e-8);}
});
test('holding throttle alone on every track leaves the racing line and cannot complete the lap',()=>{
 for(const config of TRACKS){const t=getTrack(config.id),r=car(config.id);drive(r,t,{throttle:true},30);assert.ok(Math.abs(r.x)>7,`${config.id} remained centred`);assert.ok(r.s<t.length*.4,`${config.id} auto-completed the circuit`);assert.ok(r.collisions>0);}
});
test('steering changes true world heading; releasing steering never turns the car back onto the road',()=>{
 const t=getTrack('coast'),r=car('coast',t.boostStraight.s+30,3);r.v=22;need('syncVehiclePose')(r,t);const yaw=r.heading;
 drive(r,t,{throttle:true,steer:.35},.35);assert.ok(Math.abs(r.heading-yaw)>.04);const turned=r.heading;
 drive(r,t,{},.6);assert.ok(Math.abs(r.heading-turned)<.12);assert.ok(Math.abs(r.x)>3.2);
});
test('high speed turning has a finite grip limit and a real cost for understeer',()=>{
 const t=getTrack('coast'),r=car('coast',t.boostStraight.s+30);r.v=55;need('syncVehiclePose')(r,t);
 drive(r,t,{throttle:true,steer:1},.4);assert.ok(r.gripUsage>1);assert.ok(Math.abs(r.yawRate)<.6);assert.ok(r.v<55);
});
test('service braking dominates throttle and nitro; holding brake at rest enables bounded reverse',()=>{
 const t=getTrack('coast'),r=car('coast',t.boostStraight.s+30);r.v=25;need('syncVehiclePose')(r,t);drive(r,t,{throttle:true,brake:true,nitro:true},.5);assert.ok(r.v<15);assert.equal(r.boosting,false);
 r.v=0;need('syncVehiclePose')(r,t);const start=r.s;drive(r,t,{brake:true},2);assert.ok(r.forwardSpeed<0);assert.ok(r.v<=7.1);assert.ok(r.s<start);assert.equal(r.gear,-1);
});
test('manual corrections can follow the actual curve and remain clear of the barriers',()=>{
 const t=getTrack('coast'),r=car('coast');for(let i=0;i<900;i++){
  const input=need('driverInput')({difficulty:'normal',rules:'circuit',racers:[r],time:i/60},r,t);need('stepVehicle')(r,input,t,1/60,{maxSpeed:58,baseMaxSpeed:58});
 }
 assert.ok(r.s>250,`made only ${r.s}m`);assert.ok(Math.abs(r.x)<8);assert.ok((r.collisions||0)<3,`${r.collisions} impacts`);
});

test('a safety parking input stops the car without starting an unattended reverse',()=>{
 const t=getTrack('coast'),r=car('coast',t.boostStraight.s+30);r.v=12;need('syncVehiclePose')(r,t);drive(r,t,{brake:true,park:true},5);
 assert.equal(r.v,0);assert.equal(r.reversing,false);assert.ok(Math.abs(r.forwardSpeed)<1e-8);
});

test('reverse can pull away on the grass without repeatedly crossing zero or chattering gears',()=>{
 for(const config of TRACKS){
  const t=getTrack(config.id),r=car(config.id,t.boostStraight.s+160,10),start=r.s;let changes=0,last=1;
  for(let i=0;i<600;i++){need('stepVehicle')(r,{brake:true},t,1/60);if(i>60&&last!==r.gear)changes++;last=r.gear;}
  assert.ok(r.s<start-12,`${config.id} reversed only ${start-r.s}m`);assert.ok(r.forwardSpeed<-1.5&&r.v<=7.1);assert.equal(changes,0,`${config.id} shifted ${changes} times during steady reverse`);
  drive(r,t,{},3);assert.equal(r.forwardSpeed,0);const parked=r.s;drive(r,t,{},2);assert.ok(Math.abs(r.s-parked)<1e-8);
 }
});
