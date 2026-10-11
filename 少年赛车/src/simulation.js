import {CARS, ENGINES, TRACKS, ROAD_HALF, PICKUP_BOX, getTrack, clamp, mod, shortDistance} from './tracks.js';
const BOT_NAMES = ['阿橙', '小闪', '车神阿布', '风速少年', '泡泡', '追风'];
export const ITEMS = {nitro: {name: '超级氮气', icon: '↟'}, oil: {name: '减速油污', icon: '◉'}, pulse: {name: '减速脉冲', icon: 'ϟ'}, shield: {name: '防撞护盾', icon: '⬡'}};
export function cleanInput(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) input = {throttle:false};
  return {steer: Number.isFinite(input.steer) ? clamp(input.steer, -1, 1) : 0, throttle: input.throttle !== false, drift: !!input.drift, nitro: !!input.nitro, item: !!input.item, itemPress: Number.isSafeInteger(input.itemPress) && input.itemPress >= 0 ? input.itemPress : 0};
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
    return {...choice, id: player?.id || `bot-${i}`, bot: !player, slot: i, s: -12 - Math.floor(i/2)*7, x: i%2 ? 2.5 : -2.5, v: 0, vx: 0, nitro: 55, boost: 0, slow: 0, shield: 0, hit: 0, impactCooldown: 0, driftCharge: 0, drifting: false, item: null, itemHeld: false, lastItemPress: 0, itemSeq: 0, finishTime: null, lap: 1, rank: i+1, input: cleanInput(), cooldowns: {}, pickupCooldowns: {}, lapStart: 0, bestLap: null};
  });
  return {trackId, laps: options.laps === 2 ? 2 : 3, difficulty: options.difficulty === 'easy' ? 'easy' : 'normal', time: -3.5, status: 'countdown', racers, traps: [], events: [], eventSeq: 0, finishOrder: [], elapsedAfterWinner: 0};
}
function event(race, racer, type, text) {race.events.push({id: ++race.eventSeq, racer: racer.id, type, text, time: race.time});}
function hit(race, racer, text, power = .7) {
  if (racer.shield > 0) {racer.impactCooldown = .3; event(race, racer, 'shield', '护盾抵挡'); return;}
  racer.v *= power; racer.hit = .7; racer.impactCooldown = .7; event(race, racer, 'hit', text);
}
function useItem(race, racer, track) {
  if (!racer.item) return;
  const type = racer.item; racer.item = null;
  if (type === 'nitro') {racer.boost = 3; racer.nitro = Math.min(100, racer.nitro + 20);}
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
  const dif=race.difficulty||'normal';
  // Bots weave into the racing line but with human-like error: a slow wander plus
  // occasional bigger lapses, and they lift off the throttle now and then.
  let target = Math.sin(race.time * .45 + racer.slot * 2) * 4.8 + Math.sin(race.time * .13 + racer.slot) * 2.2;
  const lapse = dif === 'easy' ? .35 : .22;
  if (Math.sin(race.time * .9 + racer.slot * 3.1) > 1 - lapse) target += (racer.slot % 2 ? 2.6 : -2.6);
  const obstacle = [...track.objects, ...race.traps].find(o => ['oil','barrier'].includes(o.type) && shortDistance(o.s, racer.s, track.length) > 0 && shortDistance(o.s, racer.s, track.length) < 36 && Math.abs(o.x - racer.x) < 3);
  if (obstacle) target = obstacle.x > 0 ? -4 : 4;
  const curvature = track.curvature(racer.s);
  // Damp their steering response and their use of curvature so they can't carve
  // a perfect apex every corner like a pro driver.
  const steerGain = dif === 'easy' ? .24 : .28;
  // Lift off the throttle now and then, but never during the opening scramble —
  // a surging bot would ram a slower-starting player off the grid.
  const coasting = race.time > 2.5 && Math.sin(race.time * .6 + racer.slot * 2.4) > (dif === 'easy' ? .1 : .25);
  return {steer: clamp((target - racer.x) * steerGain + curvature * racer.v * (dif === 'easy' ? .15 : .18), -1, 1), throttle: !coasting, drift: Math.abs(curvature) > .013 && racer.v > 36, nitro: Math.abs(curvature) < .006 && racer.nitro > 40, item: !!racer.item && Math.sin(race.time * 2 + racer.slot) > .8};
}
// Sweep the entire car movement against the pickup footprint, including diagonal drifts.
// Using the nearest wrapped distance also handles crossing the start/finish seam.
function touchesPickup(oldS, oldX, racer, object, length) {
  let entry = 0, exit = 1;
  const axes = [
    [0, racer.s - oldS, shortDistance(object.s, oldS, length), PICKUP_BOX.halfLength],
    [oldX, racer.x - oldX, object.x, PICKUP_BOX.halfWidth],
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
    const nitroOn = input.nitro && r.nitro > 0 && r.v > 8;
    r.nitro = clamp(r.nitro + (nitroOn ? -26 / engine.nitro : input.nitro ? 0 : 3.5) * dt, 0, 100);
    const boosted = nitroOn || r.boost > 0;
    r.boosting = boosted;
    r.drifting = input.drift && Math.abs(input.steer) > .15 && r.v > 20;
    if (r.drifting) r.driftCharge = Math.min(1.8, r.driftCharge + dt);
    else if (r.driftCharge > 0) {
      if (r.driftCharge > .65) {r.nitro = Math.min(100, r.nitro + r.driftCharge*18); r.boost = Math.max(r.boost, .65); event(race, r, 'drift', '漂移蓄能 +氮气');}
      r.driftCharge = 0;
    }
    // Bots were running near-perfect lines at nearly full human speed, so real
    // players always finished last. Trim their pace and make them fallible.
    const dif=race.difficulty||'normal', diffMult=r.bot?(dif==='easy'?.7:.8):1;
    const maxSpeed =  60 * car.speed * engine.speed * (boosted ? 1.38 : 1) * (r.slow > 0 ? .51 : 1) * (r.bot ? diffMult + r.slot*.008 : 1);
    // Acceleration/accel edge: bots no longer leap off the line as hard as you.
    let acceleration = input.throttle ? 24 * car.accel * engine.accel * (boosted ? 1.35 : 1) * (r.bot ? .84 : 1) : -9;
    if (r.drifting) acceleration -= 5;
    r.v = clamp(r.v + acceleration*dt, 0, maxSpeed + Math.max(0, r.v-maxSpeed) * Math.exp(-dt*3));
    const curvature = track.curvature(r.s);
    const desiredVX = input.steer * (4 + r.v*.105) * car.grip * (r.drifting ? 1.38 : 1) - curvature*r.v*r.v*.018;
    r.vx += (desiredVX - r.vx) * Math.min(1, dt*(r.drifting ? 3 : 7));
    const oldX = r.x;
    r.x += r.vx*dt;
    if (Math.abs(r.x) > ROAD_HALF-1) {
      r.x = clamp(r.x, -ROAD_HALF+1, ROAD_HALF-1); r.vx *= -.4;
      if (r.impactCooldown <= 0) hit(race, r, '擦碰护栏', .78);
    }
    const oldS = r.s;
    r.s += r.v*dt;
    for (const o of [...track.objects, ...race.traps]) {
      if (o.type === 'box') {
        if ((r.pickupCooldowns[o.id] || 0) > race.time || !touchesPickup(oldS, oldX, r, o, track.length)) continue;
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
      const along = Math.abs(shortDistance(o.s, (oldS+r.s)/2, track.length));
      if (along > (o.type === 'boost' ? 5 : 2) + (r.s-oldS)/2 || Math.abs(r.x-o.x) > o.width || (r.cooldowns[o.id] || 0) > race.time) continue;
      r.cooldowns[o.id] = race.time + (o.type === 'boost' ? 1.5 : 3);
      if (o.type === 'boost') {r.boost = Math.max(r.boost, 1.7); event(race, r, 'boost', '加速带！');}
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
  return {...race, racers: race.racers.map(({input, cooldowns, ...r}) => r)};
}
