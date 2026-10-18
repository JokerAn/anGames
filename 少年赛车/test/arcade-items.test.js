import test from 'node:test';
import assert from 'node:assert/strict';
import {ITEMS, activateItem, awardItem, itemPreview, botItemIntent} from '../src/items.js';
import {PICKUP_BOX, getTrack} from '../src/tracks.js';

function setup(count = 3) {
  const track = {
    length: 1000, objects: [], curvature: () => 0,
    sample(s, x = 0) {return {x, z: s, yaw: 0};},
  };
  const racers = Array.from({length: count}, (_, slot) => ({
    id: `r${slot}`, slot, rank: slot + 1, bot: true, finishTime: null,
    s: 100 + slot * 20, x: 0, v: 30, forwardSpeed: 30, headingError: 0,
    item: null, itemSeq: 0, nitro: 50, boost: 0, slow: 0, shield: 0,
    frozen: 0, overdrive: 0, cooldowns: {}, pickupCooldowns: {}, input: {},
  }));
  const race = {time: 20, status: 'racing', rules: 'arcade', racers, traps: [], events: [], eventSeq: 0};
  const hits = [];
  const hooks = {
    event(state, target, type, text, extra = {}) {
      state.events.push({...extra, id: ++state.eventSeq, racer: target.id, type, text, time: state.time});
    },
    hit(state, target, text, power = .7, extra = {}) {hits.push({racer: target.id, text, power, extra});},
  };
  return {track, race, racers, me: racers[0], other: racers[1], hooks, hits};
}
function freeze(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child);
  return Object.freeze(value);
}

test('火箭和冰冻弹有独立名称、图标、简称及玩法说明', () => {
  assert.ok(ITEMS.rocket && ITEMS.frost);
  assert.deepEqual([ITEMS.rocket.name, ITEMS.rocket.icon, ITEMS.rocket.shortName], ['火箭冲刺', '»', '火箭']);
  assert.deepEqual([ITEMS.frost.name, ITEMS.frost.icon, ITEMS.frost.shortName], ['冰冻弹', '❄', '冰冻']);
  assert.match(ITEMS.rocket.description, /2\.2/); assert.match(ITEMS.frost.description, /85/);
});

test('火箭只设置2.2秒overdrive，不积分车辆、不等同于普通氮气', () => {
  const f = setup(); f.me.item = 'rocket';
  const before = structuredClone(f.me);
  assert.equal(activateItem(f.race, f.me, f.track, f.hooks), true);
  assert.equal(f.me.overdrive, 2.2); assert.equal(f.me.item, null);
  for (const key of ['s', 'x', 'v', 'forwardSpeed', 'headingError', 'nitro', 'boost']) assert.equal(f.me[key], before[key]);
  assert.equal(f.race.events[0].type, 'item'); assert.equal(f.race.events[0].item, 'rocket');
  assert.equal(f.race.events[0].source, 'rocket'); assert.equal(f.race.events[0].used, true);
});

test('火箭保留已有更长冲刺计时，circuit手动持有也可激活', () => {
  const f = setup(); Object.assign(f.me, {item: 'rocket', overdrive: 4}); f.race.rules = 'circuit';
  assert.equal(activateItem(f.race, f.me, f.track, f.hooks), true);
  assert.equal(f.me.overdrive, 4);
});

test('冰冻弹只命中最近有效目标，透传0.75命中参数和攻击者', () => {
  const f = setup(4); f.me.item = 'frost'; f.race.racers.reverse();
  assert.equal(activateItem(f.race, f.me, f.track, f.hooks), true);
  assert.equal(f.other.frozen, 2.4); assert.equal(f.other.slow, 2.4);
  assert.equal(f.racers.find(r => r.id === 'r2').frozen, 0); assert.equal(f.racers.find(r => r.id === 'r3').slow, 0);
  assert.equal(f.me.item, null); assert.equal(f.hits.length, 1);
  assert.deepEqual(f.hits[0], {
    racer: f.other.id, text: '受到冰冻弹', power: .75,
    extra: {item: 'frost', source: 'frost', attacker: f.me.id},
  });
  const used = f.race.events.at(-1);
  assert.equal(used.type, 'item'); assert.equal(used.item, 'frost'); assert.equal(used.source, 'frost');
  assert.equal(used.targetId, f.other.id); assert.equal(used.targetCount, 1);
  assert.equal(used.hitCount, 1); assert.equal(used.blockedCount, 0);
});

test('冰冻弹按距离、相同距离按ID选单体，不依赖赛车数组顺序', () => {
  const f = setup(); f.me.item = 'frost'; f.racers[2].s = f.other.s;
  f.race.racers = [f.racers[2], f.other, f.me];
  assert.equal(itemPreview(f.race, f.me, f.track).targetId, f.other.id);
  activateItem(f.race, f.me, f.track, f.hooks);
  assert.deepEqual(f.hits.map(hit => hit.racer), [f.other.id]);
});

test('冰冻弹范围含85米和横向5.5米边界，与65米群体脉冲不同', () => {
  for (const [gap, x, expected] of [[85, 0, true], [85.01, 0, false], [20, 5.5, true], [20, 5.501, false]]) {
    const f = setup(2); f.me.item = 'frost'; Object.assign(f.other, {s: f.me.s + gap, x});
    assert.equal(itemPreview(f.race, f.me, f.track).available, expected);
    assert.equal(activateItem(f.race, f.me, f.track, f.hooks), expected);
  }
  const f = setup(2); f.other.s = f.me.s + 75;
  f.me.item = 'pulse'; assert.equal(itemPreview(f.race, f.me, f.track).available, false);
  f.me.item = 'frost'; assert.equal(itemPreview(f.race, f.me, f.track).available, true);
});

test('冰冻弹车头前方夹角限制为±30度，不能倒车头向前攻击', () => {
  for (const yaw of [Math.PI / 6 - .001, -Math.PI / 6 + .001, Math.PI / 6 + .001, -Math.PI / 6 - .001, Math.PI]) {
    const f = setup(2); Object.assign(f.me, {item: 'frost', headingError: yaw});
    const expected = Math.abs(yaw) < Math.PI / 6;
    assert.equal(activateItem(f.race, f.me, f.track, f.hooks), expected, `heading ${yaw}`);
  }
});

test('冰冻弹排除身后、重合、隔圈、离路和已完赛目标', () => {
  for (const changes of [{s: 90}, {s: 100}, {s: 1120}, {s: -880}, {x: 10}, {finishTime: 0}]) {
    const f = setup(2); f.me.item = 'frost'; Object.assign(f.other, changes);
    assert.equal(activateItem(f.race, f.me, f.track, f.hooks), false, JSON.stringify(changes));
    assert.equal(f.me.item, 'frost'); assert.equal(f.hits.length, 0);
  }
});

test('冰冻弹支持实际跨起终点前车，不能穿过急弯后方', () => {
  const f = setup(2), track = getTrack('coast');
  Object.assign(f.me, {item: 'frost', s: track.length - 10}); f.other.s = track.length + 10;
  assert.equal(activateItem(f.race, f.me, track, f.hooks), true);
  f.me.item = 'frost';
  const hairpin = {...track, sample(s, x = 0) {return {x, z: s > f.me.s ? -20 : 0, yaw: 0};}};
  assert.equal(activateItem(f.race, f.me, hairpin, f.hooks), false);
});

test('最近冰冻目标的护盾真实抵挡，保留时效、不跳过护盾改打后车', () => {
  const f = setup(); f.me.item = 'frost'; Object.assign(f.other, {shield: 4, frozen: .8, slow: 1});
  assert.equal(activateItem(f.race, f.me, f.track, f.hooks), true);
  assert.equal(f.hits.length, 0); assert.equal(f.other.shield, 4);
  assert.equal(f.other.frozen, .8); assert.equal(f.other.slow, 1); assert.equal(f.racers[2].frozen, 0);
  const blocked = f.race.events.find(event => event.racer === f.other.id);
  assert.equal(blocked.type, 'shield'); assert.equal(blocked.item, 'shield');
  assert.equal(blocked.source, 'frost'); assert.equal(blocked.attacker, f.me.id); assert.equal(blocked.blocked, true);
  assert.match(blocked.text, /护盾.*冰冻/);
  const used = f.race.events.find(event => event.racer === f.me.id);
  assert.equal(used.hitCount, 0); assert.equal(used.blockedCount, 1); assert.equal(used.targetCount, 1);
});

test('冰冻不缩短现有计时，也不改转向或直接写车辆速度', () => {
  const f = setup(2); f.me.item = 'frost'; Object.assign(f.other, {frozen: 4, slow: 5, steerAngle: .2, input: {steer: .6}});
  const before = structuredClone(f.other);
  assert.equal(activateItem(f.race, f.me, f.track, f.hooks), true);
  for (const key of ['frozen', 'slow', 'v', 'forwardSpeed', 's', 'x', 'steerAngle', 'input']) assert.deepEqual(f.other[key], before[key]);
});

test('无目标冰冻弹保留道具并节流失败提示，提示标明85米', () => {
  const f = setup(1); f.me.item = 'frost';
  for (let i = 0; i < 60; i++) {
    f.race.time = 20 + i / 60;
    assert.equal(activateItem(f.race, f.me, f.track, f.hooks), false);
  }
  assert.equal(f.me.item, 'frost'); assert.equal(f.race.events.length, 1);
  const notice = f.race.events[0];
  assert.equal(notice.type, 'item'); assert.equal(notice.item, 'frost'); assert.equal(notice.source, 'frost');
  assert.equal(notice.used, false); assert.equal(notice.reason, 'no-target'); assert.match(notice.text, /85/);
  f.race.time = 21.3; activateItem(f.race, f.me, f.track, f.hooks); assert.equal(f.race.events.length, 2);
});

test('护盾清除frozen和slow，预览和事件均明确冰冻解除能力', () => {
  const f = setup(1); Object.assign(f.me, {item: 'shield', frozen: 2.4, slow: 3});
  const preview = itemPreview(f.race, f.me, f.track);
  assert.match(preview.description, /冰冻/); assert.match(preview.hint, /冰冻/);
  assert.equal(activateItem(f.race, f.me, f.track, f.hooks), true);
  assert.equal(f.me.shield, 6); assert.equal(f.me.slow, 0); assert.equal(f.me.frozen, 0);
  assert.equal(f.race.events[0].type, 'item'); assert.equal(f.race.events[0].item, 'shield');
  assert.match(f.race.events[0].text, /冰冻/);
});

test('火箭和冰冻预览保留稳定字段、单体目标与无副作用约定', () => {
  for (const kind of ['rocket', 'frost']) {
    const f = setup(); f.me.item = kind; f.other.shield = 2;
    const before = structuredClone(f.race); freeze(f.race);
    const view = itemPreview(f.race, f.me, f.track);
    assert.equal(view.kind, kind); assert.equal(view.available, true); assert.ok(view.hint);
    for (const key of ['name', 'description', 'icon']) assert.equal(view[key], ITEMS[kind][key]);
    if (kind === 'frost') {
      assert.equal(view.range, 85); assert.equal(view.targetCount, 1); assert.equal(view.targetId, f.other.id);
      assert.deepEqual(view.targetIds, [f.other.id]); assert.equal(view.shieldedCount, 1);
      view.targetIds.push('bad'); assert.equal(itemPreview(f.race, f.me, f.track).targetCount, 1);
    } else assert.match(view.hint, /2\.2/);
    assert.deepEqual(f.race, before);
  }
});

test('默认box0首次补给仍为护盾，重复读取选择可复现', () => {
  for (const rank of [1, 6]) {
    const f = setup(6); f.me.rank = rank;
    assert.equal(awardItem(f.race, f.me, {id: 'box0', type: 'box'}, f.hooks), true);
    assert.equal(f.me.item, 'shield');
  }
});

test('箱子itemKind可定向发放全部六种道具，同时保留冷却和序列', () => {
  const f = setup(6); f.me.rank = 6; f.me.slot = 3;
  for (const kind of ['rocket', 'frost', 'nitro', 'oil', 'pulse', 'shield']) {
    f.me.item = null; f.race.time += PICKUP_BOX.respawnSeconds;
    const sequence = f.me.itemSeq;
    assert.equal(awardItem(f.race, f.me, {id: 'box0', itemKind: kind}, f.hooks), true);
    assert.equal(f.me.item, kind); assert.equal(f.me.itemSeq, sequence + 1);
    assert.equal(f.me.pickupCooldowns.box0, f.race.time + PICKUP_BOX.respawnSeconds);
    assert.equal(f.race.events.at(-1).type, 'pickup'); assert.equal(f.race.events.at(-1).item, kind);
    assert.equal(f.race.events.at(-1).source, 'box');
  }
});

test('定向箱不绕过满仓与独立箱冷却，满仓仍发full而不是pickup', () => {
  const f = setup(); f.me.item = 'rocket';
  const box = {id: 'box0', itemKind: 'frost'};
  assert.equal(awardItem(f.race, f.me, box, f.hooks), false);
  assert.equal(f.me.item, 'rocket'); assert.equal(f.me.itemSeq, 0);
  assert.equal(f.race.events[0].type, 'full'); assert.equal(f.race.events[0].full, true);
  f.me.item = null; assert.equal(awardItem(f.race, f.me, box, f.hooks), true);
  f.me.item = null; box.itemKind = 'rocket';
  assert.equal(awardItem(f.race, f.me, box, f.hooks), false); assert.equal(f.me.item, null); assert.equal(f.me.itemSeq, 1);
  f.race.time += PICKUP_BOX.respawnSeconds;
  assert.equal(awardItem(f.race, f.me, box, f.hooks), true); assert.equal(f.me.item, 'rocket');
});

test('未知和原型属性itemKind按确定性普通补给回退', () => {
  for (const itemKind of ['unknown', '__proto__', 'toString', null]) {
    const a = setup(), b = setup();
    assert.equal(awardItem(a.race, a.me, {id: 'box1', itemKind}, a.hooks), true);
    awardItem(b.race, b.me, {id: 'box1'}, b.hooks);
    assert.equal(a.me.item, b.me.item); assert.ok(Object.hasOwn(ITEMS, a.me.item));
  }
});

test('每个名次都能获得六种补给，后排火箭和冰冻供给适度增加', () => {
  const counts = [];
  for (let rank = 1; rank <= 6; rank++) {
    const f = setup(6); f.me.rank = rank;
    const tally = Object.fromEntries(['nitro', 'oil', 'pulse', 'shield', 'rocket', 'frost'].map(kind => [kind, 0]));
    for (let i = 0; i < 120; i++) {
      f.race.time += PICKUP_BOX.respawnSeconds; f.me.item = null;
      awardItem(f.race, f.me, {id: 'box0'}, f.hooks); tally[f.me.item]++;
    }
    assert.ok(Object.values(tally).every(count => count > 0), `rank ${rank}`); counts.push(tally);
  }
  assert.ok(counts[5].rocket > counts[0].rocket); assert.ok(counts[5].frost > counts[0].frost);
  assert.ok(counts[5].rocket + counts[5].frost <= 60, '新道具补给不能完全压制其他玩法');
});

test('AI 火箭沿用高速直道时机，并避免在已有冲刺或冰冻中浪费道具', () => {
  const f = setup(); f.me.item = 'rocket';
  assert.equal(botItemIntent(f.race, f.me, f.track), true);
  f.me.overdrive = 1; assert.equal(botItemIntent(f.race, f.me, f.track), false);
  f.me.overdrive = 0; f.me.frozen = 2; assert.equal(botItemIntent(f.race, f.me, f.track), false);
  f.me.frozen = 0; f.me.braking = true; assert.equal(botItemIntent(f.race, f.me, f.track), false);
  f.me.braking = false;
  assert.equal(botItemIntent(f.race, f.me, {...f.track, curvature: s => s > f.me.s + 20 ? .015 : 0}), false);
});

test('AI 冰冻使用85米单体预览，保留起步、冷却、人类输入和纯函数约束', () => {
  const f = setup(); f.me.item = 'frost'; f.other.s = f.me.s + 75; f.racers[2].s = f.me.s + 90;
  assert.equal(botItemIntent(f.race, f.me, f.track), true);
  f.me.nextItemUse = f.race.time + 1; assert.equal(botItemIntent(f.race, f.me, f.track), false);
  f.me.nextItemUse = 0; f.me.bot = false; assert.equal(botItemIntent(f.race, f.me, f.track), false);
  f.me.bot = true; f.race.time = 7; assert.equal(botItemIntent(f.race, f.me, f.track), false);
  f.race.time = 20;
  const before = structuredClone(f.race); freeze(f.race);
  assert.equal(botItemIntent(f.race, f.me, f.track), true); assert.deepEqual(f.race, before);
});

test('AI 护盾识别冰冻状态以及后方冰冻弹威胁，尊重单体遮挡', () => {
  const f = setup(); f.me.item = 'shield'; f.me.frozen = 1;
  assert.equal(botItemIntent(f.race, f.me, f.track), true);
  f.me.frozen = 0; f.other.item = 'frost'; f.other.s = f.me.s - 75; f.racers[2].s = f.me.s + 90;
  assert.equal(botItemIntent(f.race, f.me, f.track), true);
  f.racers[2].s = f.me.s - 50;
  assert.equal(botItemIntent(f.race, f.me, f.track), false, '冰冻弹会先命中更近的另一辆车');
  f.racers[2].x = 7; assert.equal(botItemIntent(f.race, f.me, f.track), true);
  f.other.headingError = Math.PI; assert.equal(botItemIntent(f.race, f.me, f.track), false);
});
