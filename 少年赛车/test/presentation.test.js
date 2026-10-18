import test from 'node:test';
import assert from 'node:assert/strict';
import {getTrack} from '../src/tracks.js';
const feel=await import('../src/presentation.js').catch(()=>({}));
const need=name=>{assert.equal(typeof feel[name],'function',`${name} must be available`);return feel[name];};

test('car suspension settles at the same rate at 30, 60 and 120Hz without overshoot',()=>{
  const spring=need('dampSpring'),values=[];
  for(const hz of [30,60,120]) {const state={value:0,velocity:0};for(let i=0;i<hz/2;i++){spring(state,1,1/hz,14);assert.ok(state.value>=0&&state.value<=1);}values.push(state.value);}
  assert.ok(values[0]>.99);assert.ok(Math.max(...values)-Math.min(...values)<1e-9);
});

test('weight transfer raises the nose on throttle, lowers it under braking and rolls with cornering load',()=>{
  const targets=need('motionTargets');
  const accel=targets({v:35,acceleration:20,steerAngle:0}),brake=targets({v:35,acceleration:-30,steerAngle:0});
  assert.ok(accel.pitch<0&&brake.pitch>0);assert.equal(accel.roll,0);
  const left=targets({v:45,steerAngle:-.7}),right=targets({v:45,steerAngle:.7});
  assert.ok(left.roll<0&&right.roll>0);assert.ok(Math.abs(right.roll)<=.09);
  const idle=targets({v:0,steerAngle:1,acceleration:0});assert.equal(idle.roll,0);assert.equal(idle.heave,0);
});

test('bonnet camera looks along the true car heading instead of auto-following the road',()=>{
  const camera=need('cameraFrame'),track=getTrack('coast'),r={s:12,x:0,v:25,headingError:.8},pose=camera(r,track,'bonnet'),p=track.sample(r.s),yaw=p.yaw+r.headingError;
  const dx=pose.look.x-pose.position.x,dz=pose.look.z-pose.position.z;
  assert.ok(Math.abs(Math.atan2(Math.sin(Math.atan2(dx,dz)-yaw),Math.cos(Math.atan2(dx,dz)-yaw)))<1e-9);
  assert.ok(pose.position.y>p.y+1);
});

test('chase camera widens at speed while preserving a readable road and a bounded offset',()=>{
  const camera=need('cameraFrame'),track=getTrack('canyon'),r={s:60,x:0,v:0,headingError:0};
  const idle=camera(r,track,'chase'),fast=camera({...r,v:65,boosting:true},track,'chase'),reduced=camera({...r,v:65,boosting:true},track,'chase',true),p=track.sample(r.s);
  assert.ok(fast.fov>idle.fov&&fast.fov<70);assert.ok(fast.fov>reduced.fov);
  assert.ok(Math.hypot(fast.position.x-p.x,fast.position.z-p.z)<14);
  for(const frame of [idle,fast,reduced])assert.ok(Object.values(frame.position).every(Number.isFinite));
});

test('sound follows throttle load, engine firing order, speed and real slip',()=>{
  const sound=need('soundFrame'),r={engine:'balanced',rpm:3600,v:30,gripUsage:.7,acceleration:0};
  const coast=sound(r,true,{throttle:false}),load=sound(r,true,{throttle:true}),turbo=sound({...r,engine:'turbo'},true,{throttle:true}),electric=sound({...r,engine:'electric'},true,{throttle:true});
  assert.ok(load.motorGain>coast.motorGain*1.3);assert.equal(load.frequency,180);assert.equal(turbo.frequency,240);
  assert.equal(load.turboGain,0);assert.ok(turbo.turboGain>0);assert.equal(electric.combustionGain,0);assert.ok(electric.electricGain>0);
  assert.equal(load.tyreGain,0);assert.ok(sound({...r,drifting:true},true).tyreGain>0);
  assert.equal(sound({...r,v:0,drifting:true},true).tyreGain,0);
});

test('paused and invalid audio inputs cannot leave a continuous sound or nonfinite targets',()=>{
  const sound=need('soundFrame');
  const paused=sound({v:60,rpm:7000,boosting:true,drifting:true,engine:'turbo'},false,{throttle:true});
  for(const [name,value] of Object.entries(paused)){assert.ok(Number.isFinite(value),name);if(name.endsWith('Gain'))assert.equal(value,0,name);}
  for(const r of [null,{}, {v:NaN,rpm:Infinity,engine:'invalid'}])for(const value of Object.values(sound(r,true)))assert.ok(Number.isFinite(value));
});

test('effect randomness is reproducible and never consumes the gameplay random stream',()=>{
  const random=need('createRandom'),a=random(41),b=random(41),c=random(42),first=Array.from({length:30},()=>a());
  assert.deepEqual(first,Array.from({length:30},()=>b()));assert.notDeepEqual(first,Array.from({length:30},()=>c()));assert.ok(first.every(v=>v>=0&&v<1));
});

test('boost remains an audible engine load when the accelerator has been released',()=>{
  const sound=need('soundFrame'),r={engine:'turbo',rpm:5200,v:45,boosting:true};
  const boost=sound(r,true,{throttle:false}),coast=sound({...r,boosting:false},true,{throttle:false});
  assert.ok(boost.motorGain>coast.motorGain*1.3);assert.ok(boost.turboGain>0);
});

test('chase camera stays inside the roadside rail during a large sideways slide',()=>{
  const camera=need('cameraFrame'),track=getTrack('coast'),s=track.boostStraight.s+130;
  for(const x of [-8,8])for(const headingError of [-1.2,1.2]){
    const pose=camera({s,x,v:45,headingError},track,'chase'),centre=track.sample(s);
    const lane=(pose.position.x-centre.x)*centre.nx+(pose.position.z-centre.z)*centre.nz;
    assert.ok(Math.abs(lane)<=8.5,`${x}/${headingError}: camera lane ${lane}`);
  }
});

test('a stationary electric drivetrain is quiet and becomes audible as the car moves',()=>{
  const sound=need('soundFrame'),r={engine:'electric',rpm:900,v:0};
  assert.equal(sound(r,true,{throttle:false}).electricGain,0);
  assert.ok(sound({...r,v:12,rpm:2200},true,{throttle:true}).electricGain>0);
});
