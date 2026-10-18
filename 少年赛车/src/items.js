import {PICKUP_BOX, ROAD_HALF, CAR_CONTACT, clamp, mod} from './tracks.js';

export const ITEMS = Object.freeze({
  nitro: Object.freeze({name: '超级氮气', icon: '↟', shortName: '氮气', description: '至少加速3秒，并补充20点氮气。'}),
  oil: Object.freeze({name: '减速油污', icon: '◉', shortName: '油污', description: '在车后6米留下18秒油污，自己免疫，最多保留4处。'}),
  pulse: Object.freeze({name: '减速脉冲', icon: 'ϟ', shortName: '脉冲', description: '攻击前方65米瞄准范围内的赛车，减速3.5秒；护盾可抵挡。'}),
  shield: Object.freeze({name: '防撞护盾', icon: '⬡', shortName: '护盾', description: '清除减速与冰冻，开启6秒护盾，抵挡攻击和碰撞。'}),
  rocket: Object.freeze({name: '火箭冲刺', icon: '»', shortName: '火箭', description: '开启2.2秒火箭冲刺，适合直道强力加速。'}),
  frost: Object.freeze({name: '冰冻弹', icon: '❄', shortName: '冰冻', description: '冰冻前方85米瞄准范围内最近的一辆赛车2.4秒，仍可转向；护盾可抵挡。'}),
});

const TARGETING = {
  pulse: {range: 65, lateral: 4.5, limit: Infinity},
  frost: {range: 85, lateral: 5.5, limit: 1},
};
const AIM_CONE = Math.tan(Math.PI / 6);
const MAX_TRAPS = 32;
const MAX_OWNER_TRAPS = 4;
const noop = () => {};

const isFinished = racer => racer.finishTime != null;
const knownItem = kind => Object.hasOwn(ITEMS, kind);
const validRoad = track => Number.isFinite(track?.length) && track.length > 0;

// s is continuous race distance. Wrapping it here would let a lapped car hit
// another lap, while a real target across the start line already has s > ours.
function attackTargets(race, racer, track, kind) {
  const aim = TARGETING[kind];
  if (!validRoad(track) || !Number.isFinite(racer.s) || !Number.isFinite(racer.x)) return [];
  const yaw = racer.headingError ?? 0;
  if (!Number.isFinite(yaw) || Math.cos(yaw) <= 0 || Math.abs(racer.x) > ROAD_HALF) return [];
  const origin = typeof track.sample === 'function' ? track.sample(racer.s, racer.x) : null;
  const heading = origin ? origin.yaw + yaw : yaw;
  const sin = Math.sin(heading), cos = Math.cos(heading);
  return race.racers.filter(other => {
    if (other === racer || other.id === racer.id || isFinished(other)) return false;
    const ahead = other.s - racer.s, lateral = other.x - racer.x;
    if (!Number.isFinite(ahead) || !Number.isFinite(lateral) || ahead <= 0 || ahead > aim.range ||
        Math.abs(lateral) > aim.lateral || Math.abs(other.x) > ROAD_HALF) return false;
    // A world-space cone also prevents shooting through the back of a tight
    // hairpin. Minimal track fixtures can use the same cone in road coordinates.
    const target = origin ? track.sample(other.s, other.x) : null;
    const dx = target ? target.x - origin.x : lateral;
    const dz = target ? target.z - origin.z : ahead;
    const forward = dx * sin + dz * cos, side = dx * cos - dz * sin;
    return forward > 0 && Math.abs(side) <= forward * AIM_CONE;
  }).sort((a, b) => a.s - b.s || compareIds(a.id, b.id)).slice(0, aim.limit);
}

function compareIds(a, b) {
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

/** A fresh, serializable HUD view. Previewing never initializes or mutates state. */
export function itemPreview(race, racer, track) {
  const kind = knownItem(racer.item) ? racer.item : null;
  const view = {
    kind, name: '暂无道具', icon: '', description: '驶过道具箱获取补给。',
    hint: '驶过道具箱获取补给', available: false,
    targetCount: 0, targetId: null, targetIds: [], shieldedCount: 0,
  };
  if (!kind) return view;
  Object.assign(view, ITEMS[kind]);
  if (isFinished(racer)) {view.hint = '已完赛'; return view;}
  view.available = true;
  if (kind === 'nitro') view.hint = '直线加速 · 补充20点氮气';
  if (kind === 'rocket') view.hint = '直道强力冲刺 · 火箭2.2秒';
  if (kind === 'shield') view.hint = racer.frozen > 0 ? '立即解除冰冻与减速 · 护盾6秒'
    : racer.slow > 0 ? '立即清除减速 · 护盾6秒' : '开启6秒护盾';
  if (kind === 'oil') {
    view.available = validRoad(track) && Number.isFinite(racer.s) && Number.isFinite(racer.x);
    view.hint = view.available ? '在车后6米铺油 · 自己免疫' : '等待有效路面位置';
  }
  if (Object.hasOwn(TARGETING, kind)) {
    const targets = attackTargets(race, racer, track, kind);
    view.range = TARGETING[kind].range;
    view.targetMode = kind === 'frost' ? 'single' : 'area';
    view.targetIds = targets.map(target => target.id);
    view.targetCount = targets.length;
    view.targetId = view.targetIds[0] ?? null;
    view.shieldedCount = targets.filter(target => target.shield > 0).length;
    view.available = targets.length > 0;
    view.hint = targets.length
      ? `锁定${targets.length}辆${view.shieldedCount ? ` · ${view.shieldedCount}辆有护盾` : ''}`
      : `前方${view.range}米内无有效目标，靠近并对准再使用`;
  }
  return view;
}


function botNitroIntent(racer, track) {
  if (!Number.isFinite(racer.v) || racer.v <= 22 || racer.offRoad || Math.abs(racer.x) > ROAD_HALF ||
      racer.braking || racer.input?.brake || racer.input?.park || racer.reversing || racer.forwardSpeed < 0 ||
      racer.drifting || Math.abs(racer.headingError ?? 0) > .3 || typeof track.curvature !== 'function') return false;
  const horizon = clamp(racer.v * 2, 45, 90);
  return [0, .25, .5, .75, 1].every(fraction => {
    const curve = track.curvature(racer.s + horizon * fraction);
    return Number.isFinite(curve) && Math.abs(curve) <= .004;
  });
}

function botOilIntent(race, racer) {
  if (racer.offRoad || Math.abs(racer.x) > ROAD_HALF || racer.reversing || racer.forwardSpeed < 0 ||
      Math.cos(racer.headingError ?? 0) <= .5) return false;
  return race.racers.some(other => {
    const behind = racer.s - other.s;
    return other !== racer && other.id !== racer.id && !isFinished(other) &&
      behind >= 6 && behind <= 28 && Math.abs(other.x - racer.x) <= 2.3 &&
      !other.offRoad && Math.abs(other.x) <= ROAD_HALF && !other.reversing && !(other.forwardSpeed < 0) &&
      Math.cos(other.headingError ?? 0) > .5 && other.v >= Math.max(12, racer.v - 2);
  });
}

function botShieldIntent(race, racer, track) {
  if (racer.slow > 0 || racer.frozen > 0) return true;
  if (racer.shield > 0) return false;
  const horizon = clamp((racer.v || 0) * .9, 12, 32);
  const dangerous = hazard => {
    if (!['barrier', 'oil'].includes(hazard.type) || hazard.owner === racer.id ||
        !Number.isFinite(hazard.s) || !Number.isFinite(hazard.x) ||
        hazard.expires <= race.time || racer.cooldowns?.[hazard.id] > race.time) return false;
    // Hazards live on the periodic road, unlike opponents' continuous race s.
    const ahead = mod(hazard.s - racer.s, track.length);
    return ahead <= horizon && Math.abs(hazard.x - racer.x) <= (hazard.width ?? 2.3) + CAR_CONTACT.halfWidth;
  };
  if ((track.objects || []).some(dangerous) || (race.traps || []).some(dangerous)) return true;
  return race.racers.some(other => other !== racer && !isFinished(other) && Object.hasOwn(TARGETING, other.item) &&
    attackTargets(race, other, track, other.item).some(target => target.id === racer.id));
}

/** Read-only bot advice. Only the authoritative host applies the item and cooldown. */
export function botItemIntent(race, racer, track) {
  const slot = Number.isSafeInteger(racer.slot) && racer.slot >= 0 ? racer.slot : 0;
  if (racer.bot !== true || race.rules !== 'arcade' || isFinished(racer) || race.status === 'finished' ||
      !knownItem(racer.item) || !Number.isFinite(race.time) || race.time < 8 + slot * .5 ||
      racer.nextItemUse > race.time || !validRoad(track) ||
      !Number.isFinite(racer.s) || !Number.isFinite(racer.x)) return false;
  if (racer.item === 'nitro') return botNitroIntent(racer, track);
  if (racer.item === 'rocket') return !(racer.overdrive > 0) && !(racer.frozen > 0) && botNitroIntent(racer, track);
  if (Object.hasOwn(TARGETING, racer.item)) return itemPreview(race, racer, track).available;
  if (racer.item === 'oil') return botOilIntent(race, racer);
  return botShieldIntent(race, racer, track);
}

function notice(race, racer, event, key, seconds, type, text, extra) {
  const cooldowns = racer.cooldowns ||= {};
  if ((cooldowns[key] ?? -Infinity) > race.time) return;
  cooldowns[key] = race.time + seconds;
  event(race, racer, type, text, extra);
}

function deployOil(race, racer, track) {
  const previous = race.traps || [];
  const live = previous.filter(trap => trap.expires > race.time);
  const owned = live.filter(trap => trap.owner === racer.id);
  const replace = new Set(owned.slice(0, Math.max(0, owned.length - MAX_OWNER_TRAPS + 1)));
  const kept = live.filter(trap => !replace.has(trap)).slice(-(MAX_TRAPS - 1));
  const keptIds = new Set(kept.map(trap => trap.id));
  for (const trap of previous) {
    if (keptIds.has(trap.id)) continue;
    for (const other of race.racers) if (other.cooldowns) delete other.cooldowns[trap.id];
  }
  // Independent from pickup itemSeq and eventSeq: two uses in one frame must
  // produce different trap IDs even if the host's event hook does not emit.
  race.itemTrapSeq = (race.itemTrapSeq || 0) + 1;
  const width = 2.3;
  const trap = {
    id: `item-oil-${race.itemTrapSeq}-${racer.id}`, owner: racer.id,
    type: 'oil', source: 'oil', attacker: racer.id,
    s: mod(racer.s - 6, track.length), x: clamp(racer.x, -ROAD_HALF + width, ROAD_HALF - width),
    width, expires: race.time + 18,
  };
  race.traps = [...kept, trap];
  // The existing collision loop already honors per-object cooldowns. Owner is
  // also explicit for hosts that skip owned traps before collision detection.
  (racer.cooldowns ||= {})[trap.id] = trap.expires;
  return trap;
}

/** Apply item state only; the host owns movement, contacts, and hit physics. */
export function activateItem(race, racer, track, {event = noop, hit = noop} = {}) {
  const kind = racer.item;
  if (!knownItem(kind) || isFinished(racer)) return false;
  const offensive = Object.hasOwn(TARGETING, kind);
  const targets = offensive ? attackTargets(race, racer, track, kind) : [];
  if (offensive && !targets.length) {
    notice(race, racer, event, `item:${kind}:no-target`, 1.2, 'item',
      `前方${TARGETING[kind].range}米内无有效目标，道具已保留，请靠近并对准`,
      {item: kind, source: kind, reason: 'no-target', targetCount: 0, used: false});
    return false;
  }
  if (kind === 'oil' && !itemPreview(race, racer, track).available) return false;
  racer.item = null;
  const extra = {item: kind, source: kind, used: true};
  if (kind === 'nitro') {
    racer.boost = Math.max(racer.boost || 0, 3);
    racer.nitro = Math.min(100, (racer.nitro || 0) + 20);
  }
  if (kind === 'rocket') racer.overdrive = Math.max(racer.overdrive || 0, 2.2);
  if (kind === 'shield') {
    racer.frozen = 0;
    racer.shield = Math.max(racer.shield || 0, 6);
    racer.slow = 0;
  }
  if (kind === 'oil') extra.trapId = deployOil(race, racer, track).id;
  if (offensive) {
    let blockedCount = 0;
    for (const target of targets) {
      if (target.shield > 0) {
        blockedCount++;
        event(race, target, 'shield', `护盾抵挡${ITEMS[kind].name}`,
          {item: 'shield', source: kind, attacker: racer.id, blocked: true});
      } else {
        const freezing = kind === 'frost';
        if (freezing) target.frozen = Math.max(target.frozen || 0, 2.4);
        target.slow = Math.max(target.slow || 0, freezing ? 2.4 : 3.5);
        hit(race, target, `受到${ITEMS[kind].name}`, freezing ? .75 : .65, {item: kind, source: kind, attacker: racer.id});
      }
    }
    Object.assign(extra, {
      targetCount: targets.length, targetId: targets[0].id,
      targetIds: targets.map(target => target.id), blockedCount, hitCount: targets.length - blockedCount,
    });
  }
  const text = offensive
    ? `${ITEMS[kind].name} · 命中${extra.hitCount}辆${extra.blockedCount ? ` · 护盾抵挡${extra.blockedCount}辆` : ''}`
    : kind === 'shield' ? `${ITEMS[kind].name} · 清除减速与冰冻，防护6秒` : ITEMS[kind].name;
  event(race, racer, 'item', text, extra);
  return true;
}

// All ranks retain all six kinds. Rear-half rocket/frost rates rise modestly
// from 1/6 each to 1/5 each; legacy nitro/pulse also retain a recovery bias.
const NORMAL_SUPPLY = ['shield', 'nitro', 'oil', 'pulse', 'rocket', 'frost'];
const CHASE_SUPPLY = ['shield', 'nitro', 'rocket', 'frost', 'pulse', 'nitro', 'rocket', 'oil', 'frost', 'pulse'];

/** Called after the host's box contact test; cooldowns belong to each racer. */
export function awardItem(race, racer, box, {event = noop} = {}) {
  if (!box || typeof box.id !== 'string' || !/^box\d+$/.test(box.id) ||
      (box.type && box.type !== 'box') || isFinished(racer)) return false;
  const boxIndex = Number(box.id.slice(3));
  if (!Number.isSafeInteger(boxIndex)) return false;
  if ((racer.pickupCooldowns?.[box.id] ?? -Infinity) > race.time) return false;
  if (racer.item) {
    notice(race, racer, event, `full:${box.id}`, 2, 'full', '道具已满，请先使用当前道具',
      {item: racer.item, source: 'box', boxId: box.id, full: true, awarded: false});
    return false;
  }
  const population = race.racers.length;
  const chasing = population > 1 && racer.rank > Math.ceil(population / 2);
  const supply = chasing ? CHASE_SUPPLY : NORMAL_SUPPLY;
  const sequence = Number.isSafeInteger(racer.itemSeq) && racer.itemSeq >= 0 ? racer.itemSeq : 0;
  const slot = Number.isSafeInteger(racer.slot) && racer.slot >= 0 ? racer.slot : 0;
  // Mixing avoids sequence/box-number resonance on consecutive pickups.
  // Anchor box0 at bag offset zero to preserve the opening shield for slot0.
  const boxBits = Math.imul((boxIndex % 0x100000000) + 1, 0x9e3779b1) >>> 0;
  const zeroBits = Math.imul(1, 0x9e3779b1) >>> 0;
  const boxOffset = ((boxBits ^ (boxBits >>> 16)) - (zeroBits ^ (zeroBits >>> 16))) >>> 0;
  // Reduce each component before summing to avoid integer precision loss.
  const index = (sequence % supply.length + slot % supply.length + boxOffset % supply.length) % supply.length;
  const kind = knownItem(box.itemKind) ? box.itemKind : supply[index];
  racer.item = kind;
  racer.itemSeq = sequence + 1;
  (racer.pickupCooldowns ||= {})[box.id] = race.time + PICKUP_BOX.respawnSeconds;
  event(race, racer, 'pickup', `获得${ITEMS[kind].name}`,
    {item: kind, source: 'box', boxId: box.id, awarded: true});
  return true;
}
