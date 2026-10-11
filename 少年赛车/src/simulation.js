import {CARS, ENGINES, TRACKS, ROAD_HALF, PICKUP_BOX, BOOST_PAD, CAR_CONTACT, getTrack, clamp, mod, shortDistance} from './tracks.js';
const BOT_NAMES = ['林越', '陈驰', '周远', '沈锋', '陆衡', '江川'];
export const ITEMS = {nitro: {name: '超级氮气', icon: '↟'}, oil: {name: '减速油污', icon: '◉'}, pulse: {name: '减速脉冲', icon: 'ϟ'}, shield: {name: '防撞护盾', icon: '⬡'}};
export function cleanInput(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) input = {throttle:false,brake:true};
  return {steer: Number.isFinite(input.steer) ? clamp(input.steer, -1, 1) : 0, throttle: input.throttle !== false && !input.brake, brake: !!input.brake, drift: !!input.drift, nitro: !!input.nitro, item: !!input.item, itemPress: Number.isSafeInteger(input.itemPress) && input.itemPress >= 0 ? input.itemPress : 0};
}
export function cleanChoice(choice = {}) {
  if (!choice || typeof choice !== 'object' || Array.isArray(choice)) choice = {};
  const name = typeof choice.name === 'string' ? choice.name.trim().slice(0, 12) : '';
  return {name: name || '少年车手', car: CARS.some(c => c.id === choice.car) ? choice.car : 'comet', engine: ENGINES.some(e => e.id === choice.engine) ? choice.engine : 'balanced'};
}
export function createRace(options = {}) {
  const trackId = TRACKS.some(t => t.id === options.track) ? options.track : 'coast';
  const humans = (options.players || [{id: 'local'}]).slice(0, 2);
  const racers = Array.from({length: 6}, (_, i) => {
    const player = humans[i], choice = cleanChoice(player || {name: BOT_NAMES[i], car: CARS[i%3].id, engine: ENGINES[i%3].id});
    return {...choice, id: player?.id || `bot-${i}`, bot: !player, slot: i, s: -12 - Math.floor(i/2)*7, x: i%2 ? 2.5 : -2.5, v: 0, vx: 0, steerAngle:0, acceleration:0, rpm:900, gear:1, gripUsage:0, braking:false, nitro: 55, boost: 0, slow: 0, shield: 0, hit: 0, impactCooldown: 0, driftCharge: 0, drifting: false, item: null, itemHeld: false, lastItemPress: 0, itemSeq: 0, finishTime: null, lap: 1, rank: i+1, input: cleanInput(), boostContacts: {}, cooldowns: {}, pickupCooldowns: {}, lapStart: 0, bestLap: null};
  });
  return {trackId, rules:options.rules==='arcade'?'arcade':'circuit', laps: options.laps === 2 ? 2 : 3, difficulty: options.difficulty === 'easy' ? 'easy' : 'normal', time: -3.5, status: 'countdown', racers, traps: [], events: [], eventSeq: 0, finishOrder: [], elapsedAfterWinner: 0};
}
function event(race, racer, type, text) {race.events.push({id: ++race.eventSeq, racer: racer.id, type, text, time: race.time});}
function hit(race, racer, text, power = .7) {
  if (racer.shield > 0) {racer.impactCooldown = .3; event(race, racer, 'shield', '护盾抵挡'); return;}
  racer.v *= power; racer.hit = .7; racer.impactCooldown = .7; event(race, racer, 'hit', text);
}
function useItem(race, racer, track) {
  if (!racer.item) return;
  const type = racer.item; racer.item = null;
  if (type === 'nitro') {racer.boost = Math.max(racer.boost, 3); racer.nitro = Math.min(100, racer.nitro + 20);}
  if (type === 'shield') racer.shield = 6;
  if (type === 'oil') race.traps.push({id: `trap-${race.eventSeq+1}-${racer.id}`, owner: racer.id, type: 'oil', s: mod(racer.s - 6, track.length), x: racer.x, width: 2.3, expires: race.time + 18});
  if (type === 'pulse') {
    for (const other of race.racers) {
      const ahead = shortDistance(other.s, racer.s, track.length);
      if (other !== racer && other.finishTime === null && ahead > 0 && ahead < 65 && other.shield <= 0) {other.slow = 3.5; hit(race, other, '受到减速脉冲', .65);}
    }
  }
  event(race, racer, 'item', ITEMS[type].name);
}
function aiInput(race, racer, track) {
  const easy=race.difficulty==='easy',curvature=track.curvature(racer.s);
  const preview=track.curvature(racer.s+Math.max(12,racer.v*.45));
  let target=clamp(-preview*180+((racer.slot%3)-1)*1.15,-4.8,4.8)+Math.sin(race.time*.38+racer.slot*2)*.65;
  const obstacle=race.rules==='arcade'&&[...track.objects,...race.traps].find(o=>['oil','barrier'].includes(o.type)&&shortDistance(o.s,racer.s,track.length)>0&&shortDistance(o.s,racer.s,track.length)<36&&Math.abs(o.x-racer.x)<3);
  if(obstacle)target=obstacle.x>0?-4:4;
  const traffic=race.racers.find(other=>other!==racer&&other.finishTime===null&&shortDistance(other.s,racer.s,track.length)>0&&shortDistance(other.s,racer.s,track.length)<16&&Math.abs(other.x-racer.x)<2.5);
  if(traffic)target=clamp(traffic.x+(racer.slot%2?3:-3),-6,6);
  const car=CARS.find(c=>c.id===racer.car);
  const cornerSpeed=Math.sqrt((easy?12:23)*car.grip/Math.max(.002,Math.abs(preview)));
  const brake=racer.v>cornerSpeed+3;
  const compensation=curvature*racer.v*racer.v*.018/(4+racer.v*.105);
  return {steer:clamp((target-racer.x)*.3+compensation,-1,1),throttle:!brake,brake,
    drift:race.rules==='arcade'&&Math.abs(curvature)>.013&&racer.v>36,
    nitro:!brake&&Math.abs(preview)<.004&&racer.nitro>40,
    item:!!racer.item&&Math.sin(race.time*2+racer.slot)>.8};
}
// Sweep the entire movement against a footprint, including diagonal drifts.
// Using the nearest wrapped distance also handles crossing the start/finish seam.
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
  race.traps = race.traps.filter(t => t.expires > race.time);
  for (const r of race.racers) {
    if (r.finishTime !== null) {r.v *= Math.exp(-dt*2); continue;}
    const input = r.bot ? aiInput(race, r, track) : cleanInput(r.input);
    const car = CARS.find(c => c.id === r.car), engine = ENGINES.find(e => e.id === r.engine);
    for (const timer of ['boost','slow','shield','hit','impactCooldown']) r[timer] = Math.max(0, r[timer] - dt);
    const sequencedPress = Number.isSafeInteger(input.itemPress) && input.itemPress > 0;
    if (sequencedPress ? input.itemPress > r.lastItemPress : input.item && !r.itemHeld) useItem(race, r, track);
    r.lastItemPress = Math.max(r.lastItemPress, input.itemPress || 0);
    r.itemHeld = input.item;
    const nitroOn = !input.brake && input.nitro && r.nitro > 0 && r.v > 8;
    r.nitro = clamp(r.nitro + (nitroOn ? -26 / engine.nitro : input.nitro ? 0 : 3.5) * dt, 0, 100);
    const boosted = !input.brake && (nitroOn || r.boost > 0);
    r.boosting = boosted;
    r.drifting = input.drift && Math.abs(input.steer) > .15 && r.v > 20;
    if (r.drifting) r.driftCharge = Math.min(1.8, r.driftCharge + dt);
    else if (r.driftCharge > 0) {
      if (race.rules==='arcade' && r.driftCharge > .65) {r.nitro = Math.min(100, r.nitro + r.driftCharge*18); r.boost = Math.max(r.boost, .65); event(race, r, 'drift', '漂移蓄能 +氮气');}
      r.driftCharge = 0;
    }
    const diffMult=r.bot?(race.difficulty==='easy'?.72:race.rules==='circuit'?.97:.86)+r.slot*.004:1;
    const baseMaxSpeed=60*car.speed*engine.speed*(r.slow>0?.51:1)*diffMult;
    const maxSpeed=baseMaxSpeed*(boosted?1.26:1);
    const curvature=track.curvature(r.s),grade=track.slope(r.s);
    const lateralG=Math.abs(curvature)*r.v*r.v;
    const gripLoad=lateralG/(16*car.grip);r.gripUsage=clamp(gripLoad,0,2);
    // Torque fades near the redline. Brakes dominate the auto-throttle and boost.
    let acceleration=input.brake?-36*car.grip:(input.throttle||r.boost>0)?26*car.accel*engine.accel*(1-.52*clamp(r.v/maxSpeed,0,1))*(boosted?1.4:1):-2.4;
    acceleration-=.0012*r.v*r.v+clamp(grade,-.45,.45)*9.81;
    if(r.drifting)acceleration-=5;
    if(race.rules==='circuit')acceleration-=Math.min(40,Math.max(0,gripLoad-1)*9);
    const before=r.v;
    r.v=clamp(r.v+acceleration*dt,0,maxSpeed+Math.max(0,r.v-maxSpeed)*Math.exp(-dt*3));
    r.acceleration=(r.v-before)/Math.max(dt,.001);r.braking=!!input.brake;
    r.steerAngle+=(input.steer-r.steerAngle)*(1-Math.exp(-dt*8));
    const grip=race.rules==='circuit'?1/(1+Math.max(0,r.gripUsage-1)*.45):1;
    const desiredVX=r.steerAngle*(4+r.v*.105)*car.grip*grip*(r.drifting?1.38:1)-curvature*r.v*r.v*.018;
    r.vx+=(desiredVX-r.vx)*(1-Math.exp(-dt*(r.drifting?3:7)));
    // Six-speed automatic gearbox; electric drive uses a single reduction gear.
    if(engine.id==='electric')r.gear=1;
    else {while(r.gear<6&&r.v>r.gear*11+.6)r.gear++;while(r.gear>1&&r.v<(r.gear-1)*11-2)r.gear--;}
    r.rpm=engine.id==='electric'?900+r.v*105:900+r.v*[400,240,165,123,99,84][r.gear-1];
    r.rpm=clamp(r.rpm,900,7800);
    const oldX = r.x;
    r.x += r.vx*dt;
    if (Math.abs(r.x) > ROAD_HALF-1) {
      r.x = clamp(r.x, -ROAD_HALF+1, ROAD_HALF-1); r.vx *= -.4;
      if (r.impactCooldown <= 0) hit(race, r, '擦碰护栏', .78);
    }
    const oldS = r.s;
    r.s += r.v*dt;
    for (const o of race.rules==='arcade'?[...track.objects, ...race.traps]:track.objects) {
      if(race.rules!=='arcade'&&o.type!=='boost')continue;
      if (o.type === 'box') {
        if ((r.pickupCooldowns[o.id] || 0) > race.time || !touchesFootprint(oldS, oldX, r, o, track.length, PICKUP_BOX.halfLength, PICKUP_BOX.halfWidth)) continue;
        if (r.item) {
          const noticeKey = `full:${o.id}`;
          if (!r.bot && (r.cooldowns[noticeKey] || 0) <= race.time) {
            event(race, r, 'full', '道具已满，点击右下角道具使用');
            r.cooldowns[noticeKey] = race.time + 2;
          }
          continue;
        }
        r.item = ['nitro','oil','shield','pulse'][(r.itemSeq++ + r.slot + Number(o.id.replace('box','')))%4];
        r.pickupCooldowns[o.id] = race.time + PICKUP_BOX.respawnSeconds;
        event(race, r, 'pickup', `获得${ITEMS[r.item].name}`);
        continue;
      }
      if (o.type === 'boost') {
        // Project the rotated car onto the pad axes, so a drifting side or nose
        // counts as contact even when the car centre never crosses the arrows.
        const yaw=Math.atan2(r.vx,Math.max(8,r.v))*(r.drifting?1.8:.7);
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
        event(race,r,'boost',`加速带 · ${BOOST_PAD.duration.toFixed(1)} 秒`);
        continue;
      }
      const along = Math.abs(shortDistance(o.s, (oldS+r.s)/2, track.length));
      if (along > 2 + (r.s-oldS)/2 || Math.abs(r.x-o.x) > o.width || (r.cooldowns[o.id] || 0) > race.time) continue;
      r.cooldowns[o.id] = race.time + 3;
      if (o.type === 'barrier') {hit(race, r, '撞到路障', car.mass > 1 ? .76 : .55); r.vx += (r.x >= o.x ? 1 : -1)*5;}
      if (o.type === 'oil' && r.shield <= 0) {r.slow = 2.4; hit(race, r, '油污打滑', .7); r.vx += Math.sin(race.time*7)*8;}
    }
    const travel = r.s - oldS;
    const crossingTime = distance => travel > 0 ? race.time - dt + dt * clamp((distance - oldS) / travel, 0, 1) : race.time;
    const completed = Math.max(0, Math.floor(r.s/track.length));
    if (completed + 1 > r.lap) {
      const crossedAt = crossingTime(completed * track.length), lapTime = crossedAt - r.lapStart; r.bestLap = r.bestLap === null ? lapTime : Math.min(r.bestLap, lapTime); r.lapStart = crossedAt;
      r.lap = completed+1; if (completed < race.laps) event(race, r, 'lap', completed === race.laps-1 ? '最后一圈！' : '下一圈！');
    }
    if (r.s >= track.length*race.laps) {r.finishTime = crossingTime(track.length*race.laps); r.s = track.length*race.laps; race.finishOrder.push(r.id); event(race, r, 'finish', '冲过终点！');}
  }
  for (let i = 0; i < race.racers.length; i++) for (let j = i+1; j < race.racers.length; j++) {
    const a = race.racers[i], b = race.racers[j];
    if (a.finishTime !== null || b.finishTime !== null) continue;
    if (Math.abs(shortDistance(a.s,b.s,track.length)) < 4.1 && Math.abs(a.x-b.x) < 1.95) {
      const direction = a.x >= b.x ? 1 : -1, overlap = 1.95-Math.abs(a.x-b.x);
      const am = CARS.find(c=>c.id===a.car).mass, bm = CARS.find(c=>c.id===b.car).mass;
      a.x = clamp(a.x + direction*overlap*bm/(am+bm), -8, 8); b.x = clamp(b.x-direction*overlap*am/(am+bm), -8, 8);
      a.vx += direction*3*bm; b.vx -= direction*3*am;
      if (a.impactCooldown <= 0) hit(race, a, '车身碰撞', .89);
      if (b.impactCooldown <= 0) hit(race, b, '车身碰撞', .89);
    }
  }
  const ordered = [...race.racers].sort((a,b) => (a.finishTime ?? Infinity)-(b.finishTime ?? Infinity) || b.s-a.s);
  ordered.forEach((r,i) => r.rank=i+1);
  race.finishOrder.sort((a,b) => race.racers.find(r=>r.id===a).finishTime - race.racers.find(r=>r.id===b).finishTime);
  if (race.finishOrder.length) race.elapsedAfterWinner = race.time - race.racers.find(r=>r.id===race.finishOrder[0]).finishTime;
  if (race.racers.every(r=>r.finishTime !== null) || race.elapsedAfterWinner > 35 || race.time > 300) race.status = 'finished';
  race.events = race.events.filter(e => race.time - e.time < 3).slice(-40);
}
export function snapshot(race) {
  return {...race, racers: race.racers.map(({input, cooldowns, boostContacts, ...r}) => r)};
}
