// Arcade rewards observe actual vehicle slip; this module never steers the car.
import {clamp,ROAD_HALF} from './tracks.js';
export const DRIFT_TIERS=Object.freeze([
  Object.freeze({charge:.55,duration:.75,nitro:10,name:'蓝焰',color:'#70d9ff'}),
  Object.freeze({charge:1.15,duration:1.2,nitro:16,name:'金焰',color:'#ffce70'}),
  Object.freeze({charge:1.9,duration:1.8,nitro:22,name:'紫焰',color:'#d2a2ff'}),
]);
export function clearDrift(racer,boost=false){
  racer.driftCharge=0;racer.driftTier=0;racer.driftDirection=0;racer._driftGrace=0;
  if(boost)racer.driftBoost=0;
}
export function stepDrift(race,racer,input,dt,emit){
  dt=clamp(Number.isFinite(dt)?dt:0,0,.05);
  const held=input.drift===true,wasHeld=racer._driftHeld===true;
  racer._driftHeld=held;
  const safe=race.rules==='arcade'&&racer.v>=14&&!racer.reversing&&
    !racer.offRoad&&!(racer.frozen>0)&&Math.abs(racer.x||0)<=ROAD_HALF&&!racer.impactThisStep&&
    !(racer.impactCooldown>0)&&!input.brake&&!input.park&&Math.abs(racer.headingError||0)<.95;
  if(!safe){clearDrift(racer,true);return;}
  if(!held){
    const tier=racer.driftTier||0;
    // Only a real release spends the bank: regaining traction while holding the
    // button, passive skids and repeated network input never produce a turbo.
    if(wasHeld&&tier>0){
      const reward=DRIFT_TIERS[tier-1];racer.driftBoost=Math.max(racer.driftBoost||0,reward.duration);
      racer.nitro=Math.min(100,racer.nitro+reward.nitro);
      emit(race,racer,'drift',`${reward.name}出弯 · 加速 ${reward.duration.toFixed(2)} 秒`,{tier,boostDuration:reward.duration});
    }
    clearDrift(racer);return;
  }
  const slip=Math.abs(racer.slipAngle||0),direction=Math.sign(racer.yawRate||0);
  const controlled=Math.abs(racer.steerAngle||0)>.12&&
    Math.abs(racer.yawRate||0)>.08&&slip>=.055&&slip<=.55;
  if(!controlled){
    racer._driftGrace=(racer._driftGrace||0)+dt;
    if(racer._driftGrace>.18)clearDrift(racer);
    return;
  }
  if(racer.driftDirection&&direction!==racer.driftDirection)clearDrift(racer);
  racer.driftDirection=direction;racer._driftGrace=0;
  racer.driftCharge=Math.min(2.4,(racer.driftCharge||0)+dt);
  const tier=DRIFT_TIERS.reduce((level,reward,i)=>racer.driftCharge+1e-8>=reward.charge?i+1:level,0);
  if(tier>(racer.driftTier||0))emit(race,racer,'drift-ready',`${DRIFT_TIERS[tier-1].name}就绪 · 松开漂移出弯`,{tier});
  racer.driftTier=tier;
}
export function driftFeedback(racer,rules){
  const tier=clamp(racer.driftTier||0,0,3),boost=Math.max(0,racer.driftBoost||0);
  return {visible:rules==='arcade',tier,progress:clamp((racer.driftCharge||0)/DRIFT_TIERS[2].charge,0,1),
    color:DRIFT_TIERS[Math.max(0,tier-1)].color,
    name:boost>0?'出弯加速':tier?`${DRIFT_TIERS[tier-1].name}就绪`:racer.driftCharge>0?'漂移蓄能':'漂移出弯',
    hint:boost>0?`加速剩余 ${boost.toFixed(1)} 秒`:tier?'松开漂移 · 释放加速':racer.driftCharge>0?'保持侧滑 · 蓝 → 金 → 紫':'油门 + 转向 + 漂移，松开释放'};
}
