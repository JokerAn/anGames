import {CARS, ENGINES, TRACKS, PICKUP_BOX, BOOST_PAD, CAR_CONTACT, getTrack, clamp, shortDistance} from './tracks.js';
import {stepVehicle,syncVehiclePose,syncVehicleVelocity,applyLateralImpulse,driverInput} from './driving.js';
import {initRaceRules,updateRaceRules,resetRaceRacer} from './race-rules.js';
import {stepDrift,clearDrift} from './drift.js';
import {activateItem,awardItem,botItemIntent} from './items.js';
export {ITEMS} from './items.js';
const BOT_NAMES = ['林越', '陈驰', '周远', '沈锋', '陆衡', '江川'];
export function cleanInput(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) input = {throttle:false,brake:true,park:true};
  return {steer: Number.isFinite(input.steer) ? clamp(input.steer, -1, 1) : 0, throttle: input.throttle === true && !input.brake, brake: !!input.brake, park: input.park===true, resetPress:Number.isSafeInteger(input.resetPress)&&input.resetPress>=0?input.resetPress:0, drift: !!input.drift, nitro: !!input.nitro, item: !!input.item, itemPress: Number.isSafeInteger(input.itemPress) && input.itemPress >= 0 ? input.itemPress : 0};
}
export function cleanChoice(choice = {}) {
  if (!choice || typeof choice !== 'object' || Array.isArray(choice)) choice = {};
  const name = typeof choice.name === 'string' ? choice.name.trim().slice(0, 12) : '';
  return {name: name || '少年车手', car: CARS.some(c => c.id === choice.car) ? choice.car : 'comet', engine: ENGINES.some(e => e.id === choice.engine) ? choice.engine : 'balanced'};
}
export function createRace(options = {}) {
  const trackId = TRACKS.some(t => t.id === options.track) ? options.track : 'coast';
  const humans = (options.players || [{id: 'local'}]).slice(0, 2);
  const racers = Array.from({length: options.rules==='timeattack'?Math.max(1,humans.length):6}, (_, i) => {
    const player = humans[i], choice = cleanChoice(player || {name: BOT_NAMES[i], car: CARS[i%3].id, engine: ENGINES[i%3].id});
    return {...choice, id: player?.id || `bot-${i}`, bot: !player, slot: i, s: -12 - Math.floor(i/2)*7, x: i%2 ? 2.5 : -2.5, v: 0, vx: 0, headingError:0, steerAngle:0, acceleration:0, rpm:900, gear:1, gripUsage:0, braking:false, nitro: 55, boost: 0, overdrive:0, frozen:0, slow: 0, shield: 0, hit: 0, impactCooldown: 0, resetGrace:0,lastResetPress:0,cleanSectors:0,draftTime:0,drafting:false,collisions:0,driftCharge: 0, driftTier:0, driftDirection:0, driftBoost:0, drifting: false, item: null, itemHeld: false, lastItemPress: 0, itemSeq: 0, nextItemUse:0, finishTime: null, lap: 1, rank: i+1, input: cleanInput(), boostContacts: {}, cooldowns: {}, pickupCooldowns: {}, lapStart: 0, bestLap: null};
  });
  const track=getTrack(trackId),race={version:'3.1',trackId,rules:['arcade','timeattack'].includes(options.rules)?options.rules:'circuit',laps:options.laps===3?3:2,difficulty:options.difficulty==='easy'?'easy':'normal',time:-3.5,status:'countdown',racers,traps:[],events:[],eventSeq:0,finishOrder:[],elapsedAfterWinner:0,timeLimit:Math.min(300,Math.max(100,track.length*(options.laps===3?3:2)/20+30))};
  initRaceRules(race,track);for(const racer of racers)syncVehiclePose(racer,track);return race;
}
function event(race,racer,type,text,extra={}){race.events.push({...extra,id:++race.eventSeq,racer:racer.id,type,text,time:extra.time??race.time});}
function hit(race, racer, text, power = .7, extra = {}) {
  if (racer.shield > 0) {racer.impactCooldown = .3; event(race, racer, 'shield', '护盾抵挡', {...extra,item:'shield',blocked:true}); return;}
  racer.v*=power;if(Number.isFinite(racer.forwardSpeed))racer.forwardSpeed*=power;if(Number.isFinite(racer.heading))syncVehicleVelocity(racer);clearDrift(racer,true);racer.impactThisStep=true;racer.hit=.7; racer.impactCooldown = .7; event(race, racer, 'hit', text, extra);
}
function touchesFootprint(oldS, oldX, racer, object, length, halfLength, halfWidth) {
  let entry = 0, exit = 1;
  const axes = [
    [0, racer.s - oldS, shortDistance(object.s, oldS, length), halfLength],
    [oldX, racer.x - oldX, object.x, halfWidth],
  ];
  for (const [start, movement, center, radius] of axes) {
    if (Math.abs(movement) < 1e-9) {
      if (Math.abs(start - center) > radius) return false;
      continue;
    }
    const a = (center - radius - start) / movement;
    const b = (center + radius - start) / movement;
    entry = Math.max(entry, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
    if (entry > exit) return false;
  }
  return true;
}
export function stepRace(race, dt) {
  dt = clamp(dt, 0, .05);
  if (race.status === 'finished') return;
  race.time += dt;
  if (race.time < 0) return;
  race.status = 'racing';
  const track = getTrack(race.trackId);
  for(const trap of race.traps)if(trap.expires<=race.time)for(const r of race.racers)delete r.cooldowns[trap.id];
  race.traps=race.traps.filter(t=>t.expires>race.time);
  const previous=new Map(race.racers.map(r=>[r.id,{s:r.s,x:r.x,v:r.v}]));
  // Clear once for the whole frame, before any item can affect a later actor.
  for(const racer of race.racers)racer.impactThisStep=false;
  for (const r of race.racers) {
    if (r.finishTime !== null) {r.v *= Math.exp(-dt*2); continue;}
    const input=r.bot?driverInput(race,r,track):cleanInput(r.input);
    r.botStuckTime=r.bot&&r.v<1.5&&(Math.abs(r.headingError)>.5||r.offRoad)?(r.botStuckTime||0)+dt:0;
    const botRecovery=r.bot&&(r._missedCheckpoint||r.botStuckTime>2.5);
    if(input.resetPress>r.lastResetPress&&!r.bot||botRecovery){
      const pose=resetRaceRacer(race,r,track);Object.assign(r,pose,{resetGrace:1.2,driftCharge:0,driftTier:0,driftDirection:0,driftBoost:0,boost:0,overdrive:0,botStuckTime:0});syncVehiclePose(r,track);previous.set(r.id,{s:r.s,x:r.x,v:0});event(race,r,'reset','返回上一检查点 · +3 秒');
      if(botRecovery)Object.assign(input,{throttle:false,brake:true,park:true,steer:0});
    }
    r.lastResetPress=Math.max(r.lastResetPress||0,input.resetPress||0);
    const car = CARS.find(c => c.id === r.car), engine = ENGINES.find(e => e.id === r.engine);
    for (const timer of ['boost','slow','shield','hit','impactCooldown','resetGrace','driftBoost','overdrive','frozen']) r[timer] = Math.max(0, r[timer] - dt);
    if(r.bot)input.item=botItemIntent(race,r,track);
    const sequencedPress = Number.isSafeInteger(input.itemPress) && input.itemPress > 0;
    if (sequencedPress ? input.itemPress > r.lastItemPress : input.item && !r.itemHeld){
      if(activateItem(race,r,track,{event,hit})&&r.bot)r.nextItemUse=race.time+12+r.slot*.4;
    }
    r.lastItemPress = Math.max(r.lastItemPress, input.itemPress || 0);
    r.itemHeld = input.item;
    const nitroOn = !input.brake && input.nitro && r.nitro > 0 && r.v > 8;
    r.nitro = clamp(r.nitro + (nitroOn ? -26 / engine.nitro : input.nitro||r.v<12||r.offRoad ? 0 : 1.2) * dt, 0, 100);
    const boosted = !input.brake && (nitroOn || r.boost > 0 || r.driftBoost > 0 || r.overdrive > 0);
    r.boosting = boosted;
    const diffMult=r.bot?(race.difficulty==='easy'?.72:race.rules==='circuit'?.97:.86)+r.slot*.004:1;
    const baseMaxSpeed=60*car.speed*engine.speed*(r.frozen>0?.38:r.slow>0?.51:1)*diffMult;
    const maxSpeed=baseMaxSpeed*(boosted?(r.overdrive>0?1.44:1.26):1);
    const oldX=r.x,oldS=r.s;
    const drafting=race.racers.some(other=>other!==r&&other.finishTime===null&&other.v>18&&shortDistance(other.s,r.s,track.length)>6&&shortDistance(other.s,r.s,track.length)<24&&Math.abs(other.x-r.x)<1.6&&Math.abs(shortDistance(other.headingError||0,r.headingError||0,Math.PI*2))<.2);
    r.draftTime=drafting?(r.draftTime||0)+dt:0;r.drafting=r.draftTime>.7&&r.v>18;
    stepVehicle(r,input,track,dt,{baseMaxSpeed,maxSpeed:maxSpeed*(r.drafting?1.035:1),boosted,boostForce:r.overdrive>0?1.7:1.4,preserveImpact:true});
    if(r.impactThisStep&&r.impactCooldown<=0)hit(race,r,'撞上护栏，请刹车修正或 R 重置',.8);
    stepDrift(race,r,input,dt,event);
    for(const o of race.rules==='arcade'?[...track.objects,...race.traps]:[]) {
      if (o.type === 'box') {
        if ((r.pickupCooldowns[o.id] || 0) > race.time || !touchesFootprint(oldS, oldX, r, o, track.length, PICKUP_BOX.halfLength, PICKUP_BOX.halfWidth)) continue;
        awardItem(race,r,o,{event});
        continue;
      }
      if (o.type === 'boost') {
        // Project the rotated car onto the pad axes, so a drifting side or nose
        // counts as contact even when the car centre never crosses the arrows.
        const yaw=(r.headingError||0)*(r.drifting?1.08:1);
        const cos=Math.abs(Math.cos(yaw)),sin=Math.abs(Math.sin(yaw));
        const halfWidth=BOOST_PAD.width/2+CAR_CONTACT.halfWidth*cos+CAR_CONTACT.halfLength*sin;
        const halfLength=BOOST_PAD.length/2+CAR_CONTACT.halfLength*cos+CAR_CONTACT.halfWidth*sin;
        const touchingNow=touchesFootprint(r.s,r.x,r,o,track.length,halfLength,halfWidth);
        const contacts=r.boostContacts||(r.boostContacts={}),wasTouching=!!contacts[o.id];
        contacts[o.id]=touchingNow;
        // One impulse on entry; remaining on a pad cannot repeatedly add speed.
        if(wasTouching||!touchesFootprint(oldS,oldX,r,o,track.length,halfLength,halfWidth))continue;
        r.boost=Math.max(r.boost,BOOST_PAD.duration);
        r.boosting=!input.brake;
        if(!input.brake)r.v=Math.min(r.v+BOOST_PAD.speedGain,Math.max(r.v,baseMaxSpeed*1.26));
        event(race,r,'boost',`加速带 · ${BOOST_PAD.duration.toFixed(1)} 秒`,{pad:o.id});
        continue;
      }
      if(o.owner===r.id)continue;
      const along = Math.abs(shortDistance(o.s, (oldS+r.s)/2, track.length));
      if (along > 2 + (r.s-oldS)/2 || Math.abs(r.x-o.x) > o.width || (r.cooldowns[o.id] || 0) > race.time) continue;
      r.cooldowns[o.id] = race.time + 3;
      if (o.type === 'barrier') {hit(race, r, '撞到路障', car.mass > 1 ? .76 : .55); applyLateralImpulse(r,track,(r.x>=o.x?1:-1)*5);}
      if(o.type==='oil'){
        const extra={source:'oil',attacker:o.owner??null};
        if(r.shield>0)event(race,r,'shield','护盾抵挡油污',{...extra,item:'shield',blocked:true});
        else{r.slow=Math.max(r.slow,2.4);hit(race,r,'油污打滑',.7,extra);applyLateralImpulse(r,track,Math.sin(race.time*7)*8);}
      }
    }
  }
  for (let i = 0; i < race.racers.length; i++) for (let j = i+1; j < race.racers.length; j++) {
    const a = race.racers[i], b = race.racers[j];
    if(a.finishTime!==null||b.finishTime!==null||a.resetGrace>0||b.resetGrace>0||race.rules==='timeattack')continue;
    if (Math.abs(shortDistance(a.s,b.s,track.length)) < 4.1 && Math.abs(a.x-b.x) < 1.95) {
      const direction = a.x >= b.x ? 1 : -1, overlap = 1.95-Math.abs(a.x-b.x);
      const am = CARS.find(c=>c.id===a.car).mass, bm = CARS.find(c=>c.id===b.car).mass;
      const ax=a.x,bx=b.x;a.x=clamp(a.x+direction*overlap*bm/(am+bm),-12,12);b.x=clamp(b.x-direction*overlap*am/(am+bm),-12,12);
      for(const [r,oldX] of [[a,ax],[b,bx]]){const p=track.sample(r.s);r.worldX+=(r.x-oldX)*p.nx;r.worldZ+=(r.x-oldX)*p.nz;if(r._vehicleSynced)r._vehicleSynced.x=r.x;}
      const normal=track.sample((a.s+b.s)/2),relative=((a.worldVelocityX-b.worldVelocityX)*normal.nx+(a.worldVelocityZ-b.worldVelocityZ)*normal.nz)*direction;
      // Resolve closing speed once. Positional overlap correction must not keep
      // adding outward energy while two cars are already separating.
      const contactSpeed=relative<-.1?-relative*1.05:Math.abs(relative)<.1&&a.impactCooldown<=0&&b.impactCooldown<=0?2:0;
      const impulse=contactSpeed/(1/am+1/bm);
      if(impulse>0){applyLateralImpulse(a,track,direction*impulse/am);applyLateralImpulse(b,track,-direction*impulse/bm);}
      if (a.impactCooldown <= 0) hit(race, a, '车身碰撞', .89);
      if (b.impactCooldown <= 0) hit(race, b, '车身碰撞', .89);
    }
  }
  for(const r of race.racers){
    if(r.finishTime!==null)continue;
    for(const e of updateRaceRules(race,r,track,previous.get(r.id),dt)){
      if(e.type==='checkpoint'&&e.checkpoint!==0&&r.validLap&&!r.impactThisStep){r.cleanSectors++;r.nitro=Math.min(100,r.nitro+5);e.text+=' · 干净走线 +氮气';}
      event(race,r,e.type,e.text,e);
    }
  }
  const ordered=[...race.racers].sort((a,b)=>(a.resultTime??Infinity)-(b.resultTime??Infinity)||((b.completedLaps||0)-(a.completedLaps||0))||((b.lastCheckpointS??-20)-(a.lastCheckpointS??-20))||b.s-a.s);
  ordered.forEach((r,i)=>r.rank=i+1);
  race.finishOrder=ordered.filter(r=>r.finishTime!==null).map(r=>r.id);
  if(race.finishOrder.length)race.elapsedAfterWinner=race.time-race.racers.find(r=>r.id===race.finishOrder[0]).finishTime;
  if(race.racers.every(r=>r.finishTime!==null)||race.elapsedAfterWinner>35||race.time>race.timeLimit)race.status='finished';
  race.events = race.events.filter(e => race.time - e.time < 3).slice(-40);
}
export function snapshot(race) {
  return {...race,racers:race.racers.map(r=>({...Object.fromEntries(Object.entries(r).filter(([key])=>!key.startsWith('_')&&!['input','cooldowns','boostContacts'].includes(key))),checkpointMissed:r._missedCheckpoint===true}))};
}
