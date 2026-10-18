import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {getTrack, PICKUP_BOX, ROAD_HALF, mod} from '../src/tracks.js';

// Keep the first red run an explicit assertion about the missing API, rather
// than letting module resolution abort the entire behavioral test suite.
async function api() {
  const path = new URL('../src/items.js', import.meta.url);
  assert.ok(existsSync(path), '需要实现 src/items.js 道具 API');
  return import(path.href);
}
function fixture(count = 2) {
  const track = getTrack('coast');
  const racers = Array.from({length: count}, (_, slot) => ({
    id: `r${slot}`, slot, s: track.boostStraight.s + 20 + slot * 20,
    x: 0, headingError: 0, v: 30, forwardSpeed: 30, item: null,
    nitro: 55, boost: 0, slow: 0, shield: 0, hit: 0,
    itemSeq: 0, rank: slot + 1, finishTime: null,
    cooldowns: {}, pickupCooldowns: {},
  }));
  const race = {time: 10, status: 'racing', rules: 'arcade', racers, traps: [], events: [], eventSeq: 0};
  const hits = [];
  const hooks = {
    event(state, racer, type, text, extra = {}) {
      state.events.push({...extra, racer: racer.id, type, text, time: state.time, id: ++state.eventSeq});
    },
    hit(state, racer, text, power = .7, extra = {}) {
      hits.push({racer: racer.id, text, power, extra});
      racer.v *= power;
      racer.forwardSpeed *= power;
      racer.impactThisStep = true;
    },
  };
  return {track, race, racers, me: racers[0], other: racers[1], hooks, hits};
}

test('六种道具保留名称与图标并提供 HUD 说明', async () => {
  const {ITEMS} = await api();
  const expected = {nitro: ['超级氮气', '↟'], oil: ['减速油污', '◉'], pulse: ['减速脉冲', 'ϟ'], shield: ['防撞护盾', '⬡'], rocket: ['火箭冲刺', '»'], frost: ['冰冻弹', '❄']};
  assert.deepEqual(Object.keys(ITEMS).sort(), Object.keys(expected).sort());
  for (const [kind, [name, icon]] of Object.entries(expected)) {
    assert.equal(ITEMS[kind].name, name);
    assert.equal(ITEMS[kind].icon, icon);
    assert.ok(ITEMS[kind].shortName && ITEMS[kind].description);
  }
});

test('氮气保留更长加速、补充上限100，模块不积分车辆', async () => {
  const {activateItem} = await api(), {race, me, track, hooks} = fixture();
  Object.assign(me, {item: 'nitro', boost: 5, nitro: 95});
  const before = {s: me.s, x: me.x, v: me.v, forwardSpeed: me.forwardSpeed};
  assert.equal(activateItem(race, me, track, hooks), true);
  assert.equal(me.item, null); assert.equal(me.boost, 5); assert.equal(me.nitro, 100);
  for (const key of Object.keys(before)) assert.equal(me[key], before[key]);
  assert.equal(race.events[0].type, 'item'); assert.equal(race.events[0].item, 'nitro');
});

test('氮气至少提供3秒加速和20点燃料', async () => {
  const {activateItem} = await api(), {race, me, track, hooks} = fixture();
  me.item = 'nitro';
  assert.equal(activateItem(race, me, track, hooks), true);
  assert.equal(me.boost, 3); assert.equal(me.nitro, 75);
});

test('护盾清除减速、持续6秒，默认 circuit 手动持有仍可使用', async () => {
  const {activateItem} = await api(), {race, me, track, hooks} = fixture();
  race.rules = 'circuit'; Object.assign(me, {item: 'shield', slow: 3.5});
  assert.equal(activateItem(race, me, track, hooks), true);
  assert.equal(me.shield, 6); assert.equal(me.slow, 0); assert.equal(me.item, null);
  assert.equal(race.events[0].item, 'shield'); assert.match(race.events[0].text, /护盾/);
});

test('油污部署在车后6米、限制在路面，所有者冷却覆盖整个有效期', async () => {
  const {activateItem} = await api(), {race, me, track, hooks} = fixture();
  Object.assign(me, {item: 'oil', x: ROAD_HALF + 8, s: 2});
  assert.equal(activateItem(race, me, track, hooks), true);
  const trap = race.traps[0];
  assert.equal(trap.type, 'oil'); assert.equal(trap.owner, me.id);
  assert.equal(trap.s, mod(-4, track.length));
  assert.ok(Math.abs(trap.x) + trap.width <= ROAD_HALF);
  assert.equal(trap.expires, race.time + 18);
  assert.ok(me.cooldowns[trap.id] >= trap.expires, '跨过起终点后也不可被自己的油污伤害');
  assert.equal(race.events[0].item, 'oil'); assert.equal(me.item, null);
});

test('同帧反复部署油污 ID 唯一、全局不超过32且单车不超过4个', async () => {
  const {activateItem} = await api(), {race, racers, track, hooks} = fixture(12);
  const ids = new Set();
  for (let i = 0; i < 96; i++) {
    const racer = racers[i % racers.length]; racer.item = 'oil';
    assert.equal(activateItem(race, racer, track, hooks), true);
    const trap = race.traps.at(-1); assert.ok(!ids.has(trap.id)); ids.add(trap.id);
    assert.ok(race.traps.length <= 32);
    for (const owner of racers) assert.ok(race.traps.filter(t => t.owner === owner.id).length <= 4);
  }
  assert.equal(ids.size, 96);
  for (const racer of racers) {
    const own = race.traps.filter(t => t.owner === racer.id);
    assert.ok(Object.keys(racer.cooldowns).length <= own.length, '被淘汰陷阱不能残留无界的免伤记录');
    assert.equal(racer.itemSeq, 0, '部署不改变补给序列');
  }
});

test('部署时清理过期陷阱及其免伤记录', async () => {
  const {activateItem} = await api(), {race, me, track, hooks} = fixture();
  me.item = 'oil'; activateItem(race, me, track, hooks);
  const old = race.traps[0]; race.time = old.expires; me.item = 'oil';
  activateItem(race, me, track, hooks);
  assert.equal(race.traps.length, 1); assert.notEqual(race.traps[0].id, old.id);
  assert.equal(me.cooldowns[old.id], undefined);
});

test('脉冲覆盖前方65米边界，命中通过注入 hit 并携带来源和攻击者', async () => {
  const {activateItem} = await api(), {race, me, other, track, hooks, hits} = fixture();
  me.item = 'pulse'; other.s = me.s + 65;
  assert.equal(activateItem(race, me, track, hooks), true);
  assert.equal(other.slow, 3.5); assert.equal(me.item, null); assert.equal(hits.length, 1);
  assert.equal(hits[0].racer, other.id); assert.equal(hits[0].power, .65);
  assert.equal(hits[0].extra.source, 'pulse'); assert.equal(hits[0].extra.attacker, me.id);
  assert.equal(race.events.at(-1).item, 'pulse');
});

test('脉冲不缩短已有更长减速，且只命中有效车手', async () => {
  const {activateItem} = await api(), {race, me, racers, other, track, hooks, hits} = fixture(7);
  me.item = 'pulse'; other.slow = 5;
  racers[2].s = me.s + 65.01;
  racers[3].s = me.s - 2;
  racers[4].s = me.s;
  racers[5].s = me.s + 15; racers[5].x = 5;
  racers[6].s = me.s + 10; racers[6].finishTime = 0;
  assert.equal(activateItem(race, me, track, hooks), true);
  assert.deepEqual(hits.map(hit => hit.racer), [other.id]); assert.equal(other.slow, 5);
});

test('脉冲不会环绕隔圈命中，但能跨起终点命中真实前车', async () => {
  const {activateItem} = await api(), {race, me, other, track, hooks, hits} = fixture();
  Object.assign(me, {s: track.length + 20, item: 'pulse'}); other.s = 40;
  assert.equal(activateItem(race, me, track, hooks), false);
  assert.equal(hits.length, 0); assert.equal(me.item, 'pulse');
  // A real front car across the seam still has an unwrapped gap of 20m.
  me.s = track.length - 10; other.s = track.length + 10;
  assert.equal(activateItem(race, me, track, hooks), true); assert.equal(hits.length, 1);
});

for (const yaw of [Math.PI, Math.PI / 2, -.9]) test(`脉冲不能在朝向错误 ${yaw.toFixed(2)} 时攻击正前方`, async () => {
  const {activateItem, itemPreview} = await api(), {race, me, other, track, hooks, hits} = fixture();
  me.item = 'pulse'; me.headingError = yaw;
  assert.equal(itemPreview(race, me, track).available, false);
  assert.equal(activateItem(race, me, track, hooks), false);
  assert.equal(me.item, 'pulse'); assert.equal(other.slow, 0); assert.equal(hits.length, 0);
});

test('脉冲使用实际路面朝向限制，不穿过急弯后方的赛车', async () => {
  const {activateItem} = await api(), {race, me, other, hooks, hits} = fixture();
  const track = {length: 1000, sample(s, x = 0) {return s <= me.s ? {x, z: 0, yaw: 0} : {x, z: -20, yaw: Math.PI};}};
  me.item = 'pulse';
  assert.equal(activateItem(race, me, track, hooks), false); assert.equal(hits.length, 0);
});

test('脉冲被盾抵挡时不调用 hit、不减速，抵挡事件属于受击者并保留盾时效', async () => {
  const {activateItem} = await api(), {race, me, other, track, hooks, hits} = fixture();
  me.item = 'pulse'; other.shield = 4;
  assert.equal(activateItem(race, me, track, hooks), true);
  assert.equal(other.slow, 0); assert.equal(other.shield, 4); assert.equal(other.v, 30); assert.equal(hits.length, 0);
  const blocked = race.events.find(e => e.racer === other.id);
  assert.equal(blocked.type, 'shield'); assert.equal(blocked.item, 'shield');
  assert.equal(blocked.source, 'pulse'); assert.equal(blocked.attacker, me.id);
  assert.equal(blocked.blocked, true); assert.match(blocked.text, /护盾.*抵挡/);
});

test('群体脉冲逐个处理护盾并在施放事件中报告命中与抵挡数量', async () => {
  const {activateItem} = await api(), {race, me, racers, track, hooks, hits} = fixture(3);
  me.item = 'pulse'; racers[1].shield = 2;
  assert.equal(activateItem(race, me, track, hooks), true);
  assert.deepEqual(hits.map(h => h.racer), [racers[2].id]);
  const used = race.events.find(e => e.racer === me.id);
  assert.equal(used.targetCount, 2); assert.equal(used.hitCount, 1); assert.equal(used.blockedCount, 1);
});

test('无目标时保留脉冲、明确提示，持续每帧调用不会刷事件', async () => {
  const {activateItem} = await api(), {race, me, track, hooks} = fixture(1);
  me.item = 'pulse';
  for (let i = 0; i < 60; i++) {race.time = 10 + i / 60; assert.equal(activateItem(race, me, track, hooks), false);}
  assert.equal(me.item, 'pulse'); assert.equal(race.events.length, 1);
  assert.equal(race.events[0].item, 'pulse'); assert.equal(race.events[0].type, 'item');
  assert.match(race.events[0].text, /无.*目标|没有.*目标/);
  race.time = 12; activateItem(race, me, track, hooks); assert.equal(race.events.length, 2);
});

test('没有道具、未知道具和已完赛时不误消耗或产生事件', async () => {
  const {activateItem} = await api(), {race, me, track, hooks} = fixture();
  assert.equal(activateItem(race, me, track, hooks), false);
  me.item = 'unknown'; assert.equal(activateItem(race, me, track, hooks), false); assert.equal(me.item, 'unknown');
  me.item = 'nitro'; me.finishTime = 0; assert.equal(activateItem(race, me, track, hooks), false);
  assert.equal(me.item, 'nitro'); assert.equal(race.events.length, 0);
});

test('HUD 预览无道具也有稳定字段，多次调用完全无副作用', async () => {
  const {itemPreview} = await api(), {race, me, track} = fixture();
  const before = structuredClone(race), result = itemPreview(race, me, track);
  assert.equal(result.kind, null); assert.equal(result.available, false); assert.equal(result.targetCount, 0);
  for (const key of ['name', 'icon', 'description', 'hint']) assert.equal(typeof result[key], 'string');
  assert.equal(result.targetId, null);
  itemPreview(race, me, track); assert.deepEqual(race, before);
});

test('HUD 预览共享瞄准规则，报告最近目标和带盾目标，返回对象可安全修改', async () => {
  const {itemPreview, ITEMS} = await api(), {race, me, racers, track} = fixture(4);
  me.item = 'pulse'; racers[1].shield = 3; racers[3].x = 7;
  const before = structuredClone(race), view = itemPreview(race, me, track);
  assert.equal(view.kind, 'pulse'); assert.equal(view.available, true); assert.equal(view.targetCount, 2);
  assert.equal(view.targetId, racers[1].id); assert.deepEqual(view.targetIds, [racers[1].id, racers[2].id]);
  assert.equal(view.shieldedCount, 1); assert.ok(view.hint); assert.equal(view.name, ITEMS.pulse.name);
  view.targetIds.push('bad'); view.name = 'changed';
  assert.equal(itemPreview(race, me, track).targetCount, 2); assert.deepEqual(race, before);
  assert.equal(ITEMS.pulse.name, '减速脉冲');
});

test('HUD 对其余道具提供可执行提示，已完赛可见但不可用', async () => {
  const {itemPreview} = await api(), {race, me, track} = fixture();
  for (const kind of ['nitro', 'oil', 'shield', 'rocket']) {
    me.item = kind; const view = itemPreview(race, me, track);
    assert.equal(view.kind, kind); assert.equal(view.available, true); assert.ok(view.hint && view.description);
  }
  me.finishTime = 0; assert.equal(itemPreview(race, me, track).available, false);
});

test('道具箱遵守3秒配置及每车独立冷却，只有成功拾取递增 itemSeq', async () => {
  const {awardItem} = await api(), {race, me, other, hooks} = fixture();
  const box = {id: 'box0', type: 'box'};
  assert.equal(awardItem(race, me, box, hooks), true);
  assert.equal(me.pickupCooldowns.box0, race.time + PICKUP_BOX.respawnSeconds); assert.equal(me.itemSeq, 1);
  assert.equal(race.events[0].type, 'pickup'); assert.equal(race.events[0].item, me.item);
  me.item = null;
  assert.equal(awardItem(race, me, box, hooks), false); assert.equal(me.itemSeq, 1);
  assert.equal(awardItem(race, other, box, hooks), true);
  race.time = me.pickupCooldowns.box0;
  assert.equal(awardItem(race, me, box, hooks), true); assert.equal(me.itemSeq, 2);
});

test('满道具提示节流、不消耗箱子、不推进序列，空位后可立即拾取', async () => {
  const {awardItem} = await api(), {race, me, hooks} = fixture();
  const box = {id: 'box0', type: 'box'}; me.item = 'shield';
  for (let i = 0; i < 60; i++) {race.time = 10 + i / 60; assert.equal(awardItem(race, me, box, hooks), false);}
  assert.equal(race.events.length, 1); assert.match(race.events[0].text, /已满/);
  assert.equal(race.events[0].type, 'full'); assert.equal(race.events[0].item, 'shield');
  assert.equal(race.events[0].full, true); assert.equal(race.events[0].awarded, false);
  assert.equal(race.events.filter(e => e.type === 'pickup').length, 0);
  assert.equal(me.itemSeq, 0); assert.equal(me.pickupCooldowns.box0, undefined);
  me.item = null; assert.equal(awardItem(race, me, box, hooks), true);
});

test('补给可复现且不依赖赛车数组顺序、时间小数或事件序号', async () => {
  const {awardItem} = await api(), a = fixture(6), b = fixture(6);
  b.race.racers.reverse(); b.race.eventSeq = 100;
  const seqA = [], seqB = [];
  for (let i = 0; i < 24; i++) {
    a.race.time = 10 + i * 4; b.race.time = 10.5 + i * 4;
    a.me.item = null; b.me.item = null;
    const box = {id: `box${i % 4}`, type: 'box'};
    assert.equal(awardItem(a.race, a.me, box, a.hooks), true);
    assert.equal(awardItem(b.race, b.me, box, b.hooks), true);
    seqA.push(a.me.item); seqB.push(b.me.item);
  }
  assert.deepEqual(seqA, seqB);
});

test('后排有适度追赶补给优势，同时所有名次仍能拿到六种道具', async () => {
  const {awardItem} = await api(), front = fixture(6), rear = fixture(6);
  rear.me.rank = 6;
  const tally = f => {
    const counts = {nitro: 0, oil: 0, shield: 0, pulse: 0, rocket: 0, frost: 0};
    for (let i = 0; i < 120; i++) {
      f.race.time = 10 + i * 4; f.me.item = null;
      awardItem(f.race, f.me, {id: 'box0'}, f.hooks); counts[f.me.item]++;
    }
    return counts;
  };
  const a = tally(front), b = tally(rear);
  for (const counts of [a, b]) for (const count of Object.values(counts)) assert.ok(count > 0);
  assert.ok(b.nitro > a.nitro); assert.ok(b.nitro + b.pulse > a.nitro + a.pulse);
  assert.ok(b.rocket > a.rocket); assert.ok(b.frost > a.frost);
  assert.ok(b.nitro + b.pulse <= 90, '不得把追赶方补给变成压倒性优势');
});

test('缺省辅助字典可初始化，箱子非法/已完赛不发放道具', async () => {
  const {awardItem} = await api(), {race, me, hooks} = fixture();
  delete me.cooldowns; delete me.pickupCooldowns; delete me.itemSeq;
  assert.equal(awardItem(race, me, {id: 'box0'}, hooks), true);
  assert.equal(me.itemSeq, 1); assert.ok(me.pickupCooldowns.box0 > race.time);
  me.item = null;
  assert.equal(awardItem(race, me, null, hooks), false);
  assert.equal(awardItem(race, me, {id: 'oil0', type: 'oil'}, hooks), false);
  me.finishTime = 0; assert.equal(awardItem(race, me, {id: 'box1'}, hooks), false);
});

test('顺序经过连续编号箱子时仍可获得六种补给，不出现编号与序列相消', async () => {
  const {awardItem} = await api();
  for (const rank of [1, 6]) {
    const f = fixture(6), seen = new Set(); f.me.rank = rank;
    for (let i = 0; i < 120; i++) {
      f.race.time = 10 + i * 4; f.me.item = null;
      awardItem(f.race, f.me, {id: `box${i % 4}`}, f.hooks); seen.add(f.me.item);
    }
    assert.deepEqual([...seen].sort(), ['frost', 'nitro', 'oil', 'pulse', 'rocket', 'shield']);
  }
});

test('异常过大的箱子编号不可生成 undefined 道具或污染补给序列', async () => {
  const {awardItem} = await api(), {race, me, hooks} = fixture();
  const before = structuredClone(race);
  assert.equal(awardItem(race, me, {id: `box${'9'.repeat(400)}`}, hooks), false);
  assert.deepEqual(race, before);
});

async function botApi() {
  const module = await api();
  assert.equal(typeof module.botItemIntent, 'function', '需要导出纯函数 botItemIntent');
  return module;
}
function botFixture(count = 2) {
  const f = fixture(count);
  f.me.bot = true;
  f.race.time = 20;
  return f;
}

test('AI 道具决策仅针对道具赛中未完赛的 bot，不改变人类输入', async () => {
  const {botItemIntent} = await botApi();
  const scenarios = [
    f => {f.me.bot = false;},
    f => {delete f.me.bot;},
    f => {f.race.rules = 'circuit';},
    f => {f.race.rules = 'timeattack';},
    f => {f.me.finishTime = 0;},
    f => {f.race.status = 'finished';},
    f => {f.me.item = null;},
    f => {f.me.item = 'unknown';},
  ];
  for (const arrange of scenarios) {
    const f = botFixture(); f.me.item = 'nitro'; f.me.input = {throttle: true, item: true}; arrange(f);
    const before = structuredClone(f.race);
    assert.equal(botItemIntent(f.race, f.me, f.track), false);
    assert.deepEqual(f.race, before);
  }
});

test('AI 六种道具均等待8秒加slot错峰，达到边界后才能决策', async () => {
  const {botItemIntent} = await botApi();
  for (const slot of [0, 3, 5]) for (const kind of ['nitro', 'oil', 'pulse', 'shield', 'rocket', 'frost']) {
    const f = botFixture(); Object.assign(f.me, {slot, item: kind});
    if (kind === 'oil') f.other.s = f.me.s - 15;
    if (kind === 'shield') f.me.slow = 2;
    f.race.time = 8 + slot * .5 - .001;
    assert.equal(botItemIntent(f.race, f.me, f.track), false, `${kind}: before slot ${slot}`);
    f.race.time += .001;
    assert.equal(botItemIntent(f.race, f.me, f.track), true, `${kind}: at slot ${slot}`);
  }
});

test('AI 尊重下次使用时刻，查询不会自行推进冷却或消耗道具', async () => {
  const {botItemIntent} = await botApi();
  for (const kind of ['nitro', 'oil', 'pulse', 'shield', 'rocket', 'frost']) {
    const f = botFixture(); Object.assign(f.me, {item: kind, nextItemUse: f.race.time + .01});
    if (kind === 'oil') f.other.s = f.me.s - 15;
    if (kind === 'shield') f.me.slow = 2;
    assert.equal(botItemIntent(f.race, f.me, f.track), false);
    f.race.time = f.me.nextItemUse;
    assert.equal(botItemIntent(f.race, f.me, f.track), true);
    assert.equal(f.me.nextItemUse, f.race.time); assert.equal(f.me.item, kind);
  }
});

test('AI 氮气仅在速度超过22且前方相对平直时使用', async () => {
  const {botItemIntent} = await botApi(), f = botFixture(); f.me.item = 'nitro';
  f.me.v = 22; assert.equal(botItemIntent(f.race, f.me, f.track), false);
  f.me.v = 22.01; assert.equal(botItemIntent(f.race, f.me, f.track), true);
  f.me.v = 40; assert.equal(botItemIntent(f.race, f.me, f.track), true);
  const bendAhead = {...f.track, curvature: s => s > f.me.s + 30 ? .012 : 0};
  assert.equal(botItemIntent(f.race, f.me, bendAhead), false, '不能只检查脚下的直线');
  const gentle = {...f.track, curvature: () => -.002};
  assert.equal(botItemIntent(f.race, f.me, gentle), true);
});

test('AI 离路、制动、倒车或失去朝向时保留氮气', async () => {
  const {botItemIntent} = await botApi();
  for (const changes of [
    {offRoad: true}, {x: ROAD_HALF + .1}, {braking: true},
    {input: {brake: true}}, {input: {park: true}}, {reversing: true},
    {forwardSpeed: -4}, {headingError: 1}, {drifting: true},
  ]) {
    const f = botFixture(); Object.assign(f.me, {item: 'nitro'}, changes);
    assert.equal(botItemIntent(f.race, f.me, f.track), false, JSON.stringify(changes));
  }
});

test('AI 缺少有效路况或位置时不盲目使用氮气', async () => {
  const {botItemIntent} = await botApi(), f = botFixture(); f.me.item = 'nitro';
  for (const track of [{length: f.track.length}, {...f.track, curvature: () => NaN}]) {
    assert.equal(botItemIntent(f.race, f.me, track), false);
  }
  f.me.s = NaN; assert.equal(botItemIntent(f.race, f.me, f.track), false);
});

test('AI 脉冲决策严格复用预览可用性，包括带盾目标和隔圈排除', async () => {
  const {botItemIntent, itemPreview} = await botApi(), f = botFixture(); f.me.item = 'pulse';
  const scenarios = [
    {s: f.me.s + 20, x: 0, shield: 0, expected: true},
    {s: f.me.s + 20, x: 0, shield: 3, expected: true},
    {s: f.me.s + 65.01, x: 0, expected: false},
    {s: f.me.s + 20, x: 6, expected: false},
    {s: f.me.s + 20 - f.track.length, x: 0, expected: false},
  ];
  for (const {expected, ...target} of scenarios) {
    Object.assign(f.other, target);
    assert.equal(botItemIntent(f.race, f.me, f.track), expected);
    assert.equal(botItemIntent(f.race, f.me, f.track), itemPreview(f.race, f.me, f.track).available);
  }
  f.other.s = f.me.s + 20; f.me.headingError = Math.PI;
  assert.equal(botItemIntent(f.race, f.me, f.track), false);
});

test('AI 油污只在身后6到28米且同车道有追车时部署', async () => {
  const {botItemIntent} = await botApi(), f = botFixture(); f.me.item = 'oil';
  for (const [gap, expected] of [[5.99, false], [6, true], [18, true], [28, true], [28.01, false], [-10, false]]) {
    f.other.s = f.me.s - gap;
    assert.equal(botItemIntent(f.race, f.me, f.track), expected, `rear gap ${gap}`);
  }
  f.other.s = f.me.s - 18; f.other.x = 4;
  assert.equal(botItemIntent(f.race, f.me, f.track), false);
  f.other.x = 2; assert.equal(botItemIntent(f.race, f.me, f.track), true);
});

test('AI 不向已完赛、停驶、远离路面或反向后车丢油', async () => {
  const {botItemIntent} = await botApi();
  for (const changes of [{finishTime: 0}, {v: 0}, {v: 10}, {headingError: Math.PI}, {offRoad: true}]) {
    const f = botFixture(); f.me.item = 'oil'; f.other.s = f.me.s - 18; Object.assign(f.other, changes);
    assert.equal(botItemIntent(f.race, f.me, f.track), false, JSON.stringify(changes));
  }
  const f = botFixture(); f.me.item = 'oil'; f.other.s = f.me.s - 18; f.me.offRoad = true;
  assert.equal(botItemIntent(f.race, f.me, f.track), false);
});

test('AI 油污追车识别不环绕隔圈，但支持跨起终点的连续距离', async () => {
  const {botItemIntent} = await botApi(), f = botFixture(); f.me.item = 'oil';
  f.me.s = f.track.length + 10; f.other.s = f.me.s - 18;
  assert.equal(botItemIntent(f.race, f.me, f.track), true);
  f.other.s += f.track.length;
  assert.equal(botItemIntent(f.race, f.me, f.track), false);
  f.other.s -= 2 * f.track.length;
  assert.equal(botItemIntent(f.race, f.me, f.track), false);
});

test('AI 没有追车或危险时持有道具，护盾不会刚获得就被消耗', async () => {
  const {botItemIntent} = await botApi(), f = botFixture(1);
  const track = {...f.track, objects: []};
  for (const kind of ['oil', 'shield', 'pulse', 'frost']) {
    f.me.item = kind;
    assert.equal(botItemIntent(f.race, f.me, track), false);
  }
});

test('AI 护盾受减速时立即意图清除，已有有效盾时不重复刷新', async () => {
  const {botItemIntent} = await botApi(), f = botFixture(); f.me.item = 'shield';
  f.me.slow = 2; assert.equal(botItemIntent(f.race, f.me, f.track), true);
  f.me.slow = 0; f.me.shield = 4;
  f.other.s = f.me.s - 20; f.other.item = 'pulse';
  assert.equal(botItemIntent(f.race, f.me, f.track), false);
});

test('AI 护盾预判同车道的前方路障和油污，忽略远处与其他车道', async () => {
  const {botItemIntent} = await botApi(), f = botFixture(); f.me.item = 'shield';
  for (const type of ['barrier', 'oil']) {
    const hazard = {id: 'hazard', type, s: f.me.s + 15, x: 0, width: 2};
    const track = {...f.track, objects: [hazard]};
    assert.equal(botItemIntent(f.race, f.me, track), true, type);
    hazard.x = 7; assert.equal(botItemIntent(f.race, f.me, track), false);
    hazard.x = 0; hazard.s = f.me.s + 70;
    assert.equal(botItemIntent(f.race, f.me, track), false);
    hazard.s = f.me.s - 15; assert.equal(botItemIntent(f.race, f.me, track), false);
    hazard.s = f.me.s + 15; hazard.type = 'box';
    assert.equal(botItemIntent(f.race, f.me, track), false);
  }
});

test('AI 护盾识别跨线陷阱，忽略自己的、已过期的油污', async () => {
  const {botItemIntent} = await botApi(), f = botFixture(); f.me.item = 'shield';
  const track = {...f.track, objects: []}; f.me.s = track.length - 8;
  const trap = {id: 'enemy-oil', type: 'oil', owner: f.other.id, s: 7, x: 0, width: 2.3, expires: f.race.time + 2};
  f.race.traps = [trap];
  assert.equal(botItemIntent(f.race, f.me, track), true);
  trap.owner = f.me.id; assert.equal(botItemIntent(f.race, f.me, track), false);
  trap.owner = f.other.id; trap.expires = f.race.time;
  assert.equal(botItemIntent(f.race, f.me, track), false);
});

test('AI 护盾仅在后方脉冲实际可瞄准自己时预防攻击', async () => {
  const {botItemIntent} = await botApi(), f = botFixture(); f.me.item = 'shield';
  const track = {...f.track, objects: []};
  f.other.s = f.me.s - 20; f.other.item = 'pulse';
  assert.equal(botItemIntent(f.race, f.me, track), true);
  f.other.item = 'oil'; assert.equal(botItemIntent(f.race, f.me, track), false);
  f.other.item = 'pulse'; f.other.headingError = Math.PI;
  assert.equal(botItemIntent(f.race, f.me, track), false);
  f.other.headingError = 0; f.other.x = 6;
  assert.equal(botItemIntent(f.race, f.me, track), false);
  f.other.x = 0; f.other.s = f.me.s - 66;
  assert.equal(botItemIntent(f.race, f.me, track), false);
  f.other.s = f.me.s - 20 - track.length;
  assert.equal(botItemIntent(f.race, f.me, track), false);
  f.other.s = f.me.s - 20; f.other.finishTime = 0;
  assert.equal(botItemIntent(f.race, f.me, track), false);
});

test('AI 道具意图重复查询完全无副作用、对冻结比赛状态也可计算', async () => {
  const {botItemIntent} = await botApi();
  const freeze = object => {
    for (const value of Object.values(object)) if (value && typeof value === 'object') freeze(value);
    return Object.freeze(object);
  };
  for (const kind of ['nitro', 'oil', 'pulse', 'shield', 'rocket', 'frost']) {
    const f = botFixture(); f.me.item = kind; f.me.input = {throttle: true, item: false};
    if (kind === 'oil') f.other.s = f.me.s - 15;
    if (kind === 'shield') f.me.slow = 2;
    const before = structuredClone(f.race); freeze(f.race);
    const track = Object.freeze({...f.track, objects: freeze(f.track.objects.map(object => ({...object})))});
    for (let i = 0; i < 20; i++) assert.equal(botItemIntent(f.race, f.me, track), true);
    assert.deepEqual(f.race, before); assert.equal(f.me.nextItemUse, undefined);
  }
});
