import test from 'node:test';
import assert from 'node:assert/strict';
import {getTrack} from '../src/tracks.js';
import {stepVehicle,syncVehiclePose} from '../src/driving.js';
import {createRace,stepRace} from '../src/simulation.js';
const drift=await import('../src/drift.js').catch(()=>({}));
function fixture(rules='arcade') {
  const race={rules,time:1,events:[]};
  const racer={id:'local',v:30,forwardSpeed:30,slipAngle:-.18,yawRate:.35,steerAngle:.6,headingError:.25,x:0,nitro:40,drifting:true,driftCharge:0,driftTier:0,impactCooldown:0};
  const emit=(_race,r,type,text,extra={})=>race.events.push({racer:r.id,type,text,...extra});
  const step=(input={drift:true,steer:.6,throttle:true},seconds=1/60)=>{
    assert.equal(typeof drift.stepDrift,'function','controlled drift state machine must exist');
    for(let n=0;n<Math.round(seconds*60);n++)drift.stepDrift(race,racer,input,1/60,emit);
  };
  return {race,racer,step};
}
test('only a deliberate slide on asphalt earns drift charge; straight handbrake does not',()=>{
  const {racer,step}=fixture();racer.slipAngle=0;racer.yawRate=0;step(undefined,1);
  assert.equal(racer.driftCharge,0);assert.equal(racer.driftTier,0);
  racer.slipAngle=-.18;racer.yawRate=.35;step(undefined,.7);
  assert.ok(racer.driftCharge>=.55);assert.equal(racer.driftTier,1);
});
test('a controlled drift crosses three visible tiers and caps stored energy',()=>{
  const {racer,step,race}=fixture();step(undefined,.7);assert.equal(racer.driftTier,1);
  step(undefined,.6);assert.equal(racer.driftTier,2);
  step(undefined,.8);assert.equal(racer.driftTier,3);
  step(undefined,4);assert.ok(racer.driftCharge<=2.4);
  assert.equal(race.events.filter(e=>e.type==='drift-ready').length,3);
});
test('releasing the handbrake pays a mini turbo once, with a larger reward for higher tiers',()=>{
  const durations=[];
  for(const seconds of [.7,1.3,2.1]){
    const {race,racer,step}=fixture();step(undefined,seconds);const tier=racer.driftTier,nitro=racer.nitro;
    step({throttle:true,steer:.25,drift:false});
    assert.ok(racer.driftBoost>0);durations.push(racer.driftBoost);
    assert.ok(racer.nitro>nitro);assert.equal(racer.driftCharge,0);assert.equal(racer.driftTier,0);
    const reward=race.events.filter(e=>e.type==='drift');assert.equal(reward.length,1);assert.equal(reward[0].tier,tier);
    const earned=racer.nitro;step({throttle:true},1);assert.equal(racer.nitro,earned);assert.equal(race.events.filter(e=>e.type==='drift').length,1);
  }
  assert.ok(durations[0]<durations[1]&&durations[1]<durations[2]);
});
test('grass, collisions, braking, parking, reverse and low speed cancel banked charge without reward',()=>{
  for(const change of [{offRoad:true},{impactThisStep:true},{impactCooldown:.2},{reversing:true},{v:9,forwardSpeed:9}]){
    const {race,racer,step}=fixture();step(undefined,1.3);Object.assign(racer,change);step({drift:false,throttle:true});
    assert.equal(racer.driftCharge,0,JSON.stringify(change));assert.ok(!racer.driftBoost);assert.ok(!race.events.some(e=>e.type==='drift'));
  }
  for(const input of [{brake:true},{park:true}]){
    const {race,racer,step}=fixture();step(undefined,1.3);step({...input,drift:false});
    assert.equal(racer.driftCharge,0);assert.ok(!racer.driftBoost);assert.ok(!race.events.some(e=>e.type==='drift'));
  }
});
test('circuit and time attack retain handbrake control without arcade drift rewards',()=>{
  for(const rules of ['circuit','timeattack']){
    const {race,racer,step}=fixture(rules);step(undefined,3);step({drift:false});
    assert.equal(racer.driftCharge,0);assert.equal(racer.driftTier,0);assert.ok(!racer.driftBoost);assert.deepEqual(race.events,[]);
  }
});
test('opposite yaw cannot bank energy from weaving between two drift directions',()=>{
  const {racer,step}=fixture();step(undefined,1.3);racer.yawRate=-.35;racer.slipAngle=.18;
  step({throttle:true,drift:true,steer:-.6});assert.ok(racer.driftCharge<.1);assert.equal(racer.driftTier,0);assert.equal(racer.driftDirection,-1);
});
test('a short correction keeps charge, but holding handbrake after traction returns never auto-pays',()=>{
  const {race,racer,step}=fixture();step(undefined,.7);const charge=racer.driftCharge;
  racer.slipAngle=0;step(undefined,.1);assert.equal(racer.driftCharge,charge);
  racer.slipAngle=-.18;step(undefined,.1);assert.ok(racer.driftCharge>charge);
  racer.slipAngle=0;step(undefined,.5);assert.equal(racer.driftCharge,0);assert.ok(!race.events.some(e=>e.type==='drift'));
});
test('drift HUD exposes tier, charge and release hint and hides arcade energy in circuit modes',()=>{
  assert.equal(typeof drift.driftFeedback,'function','drift HUD feedback must exist');
  const {racer,step}=fixture();step(undefined,1.3);const hud=drift.driftFeedback(racer,'arcade');
  assert.equal(hud.tier,2);assert.ok(hud.progress>0&&hud.progress<=1);assert.match(hud.hint,/松开/);
  assert.equal(drift.driftFeedback(racer,'timeattack').visible,false);
});
test('service brake dominates the handbrake, including during a steering manoeuvre',()=>{
  const track=getTrack('coast'),cars=[false,true].map(()=>({id:'local',car:'comet',engine:'balanced',s:track.boostStraight.s+90,x:0,v:30,steerAngle:.6,headingError:0}));
  for(const [i,r] of cars.entries()){
    syncVehiclePose(r,track);
    for(let n=0;n<12;n++)stepVehicle(r,{brake:true,drift:!!i,steer:.6},track,1/60);
  }
  assert.ok(Math.abs(cars[0].v-cars[1].v)<1e-8,'adding the drift button must not alter service braking');
  assert.ok(Math.hypot(cars[0].worldX-cars[1].worldX,cars[0].worldZ-cars[1].worldZ)<1e-8);
});
test('releasing a slide preserves velocity continuity and progressively restores rear grip',()=>{
  const track=getTrack('coast'),r={car:'comet',engine:'balanced',s:track.boostStraight.s+90,x:0,v:29,steerAngle:.5,headingError:0};syncVehiclePose(r,track);
  for(let n=0;n<32;n++)stepVehicle(r,{throttle:true,steer:.5,drift:true},track,1/60);
  const slip=Math.abs(r.slipAngle),side=r.sideSpeed;assert.ok(slip>.04);
  stepVehicle(r,{throttle:true,steer:0,drift:false},track,1/60);assert.ok(Math.abs(r.sideSpeed-side)<.8);
  // Check traction recovery before the stronger retained heading reaches a rail;
  // the driver remains responsible for steering back onto the road.
  for(let n=0;n<30;n++)stepVehicle(r,{throttle:true,steer:0,drift:false},track,1/60);
  assert.equal(r.offRoad,false);assert.ok(Math.abs(r.slipAngle)<slip*.4);assert.ok(Number.isFinite(r.worldX+r.worldZ+r.v));
});
test('race integration turns a completed drift into acceleration and reset discards it',()=>{
  const race=createRace({rules:'arcade'}),track=getTrack(race.trackId),r=race.racers[0];race.time=1;race.racers.slice(1).forEach(a=>a.finishTime=0);
  Object.assign(r,{s:track.boostStraight.s+90,x:0,v:29,steerAngle:.5,input:{throttle:true,steer:.5,drift:true}});syncVehiclePose(r,track);
  for(let n=0;n<52;n++)stepRace(race,1/60);
  assert.ok(r.driftTier>=1,'a real controlled slide must reach the first reward tier');
  r.input={throttle:true,steer:0,drift:false};stepRace(race,1/60);assert.ok(r.driftBoost>0);
  stepRace(race,1/60);assert.equal(r.boosting,true);
  r.input={resetPress:1};stepRace(race,1/60);assert.equal(r.driftBoost,0);assert.equal(r.driftTier,0);assert.equal(r.driftCharge,0);
});
test('coasting momentum can charge a deliberate controlled slide without requiring a held accelerator',()=>{
  const {racer,step}=fixture();step({drift:true,steer:.6,throttle:false},.7);
  assert.equal(racer.driftTier,1);step({drift:false});assert.ok(racer.driftBoost>0);
});
