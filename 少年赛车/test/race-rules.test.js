import test from 'node:test';
import assert from 'node:assert/strict';

// Dynamic import makes the red phase an explicit missing-interface assertion.
const rules = await import('../src/race-rules.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const track = {length: 800};
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

function setup({laps = 1, mode = 'circuit', ids = ['a']} = {}) {
  assert.equal(typeof rules.initRaceRules, 'function', 'initRaceRules must be exported');
  const race = {time: 0, laps, rules: mode, eventSeq: 0, racers: ids.map(id => ({id, s: -12, x: 0, v: 100, headingError: .2, nitro: 55})), finishOrder: []};
  rules.initRaceRules(race, track);
  return {race, racer: race.racers[0]};
}
function move(race, racer, s, dt = 1, x = racer.x, advanceClock = true) {
  const previous = {s: racer.s, x: racer.x, v: racer.v, offRoad: racer.offRoad, forwardSpeed: racer.forwardSpeed};
  racer.s = s; racer.x = x;
  if (advanceClock) race.time += dt;
  return rules.updateRaceRules(race, racer, track, previous, dt);
}
function start(race, racer) { move(race, racer, 0, .12); }
function lap(race, racer) {
  const end = Math.floor(racer.s / track.length + 1) * track.length;
  const events = [];
  while (racer.s < end) events.push(...move(race, racer, Math.min(racer.s + 100, end)));
  return events;
}

test('initialization provides eight ordered gates, targets, and legacy lap fields without moving the car', () => {
  const {race, racer} = setup();
  assert.deepEqual(race.checkpoints.map(c => [c.id, c.s]), Array.from({length: 8}, (_, i) => [i, i * 100]));
  assert.ok(race.targetTimes.gold < race.targetTimes.silver && race.targetTimes.silver < race.targetTimes.bronze);
  assert.equal(racer.s, -12); assert.equal(racer.x, 0); assert.equal(racer.headingError, .2);
  assert.equal(racer.nextCheckpoint, 0); assert.equal(racer.completedLaps, 0); assert.equal(racer.cleanLaps, 0);
  assert.equal(racer.checkpointsPassed, 0); assert.equal(racer.lap, 1);
  assert.equal(racer.finishTime, null); assert.equal(racer.bestLap, null);
  assert.equal(racer.penaltyTime, 0); assert.equal(racer.lastCheckpointS, null);
});

test('zero motion over many frames cannot start or complete any lap and never steers the car', () => {
  const {race, racer} = setup(); racer.v = 0; racer.x = 4; racer.headingError = .7;
  for (let i = 0; i < 1000; i++) move(race, racer, -12, .02);
  assert.equal(racer.completedLaps, 0); assert.equal(racer.checkpointsPassed, 0);
  assert.equal(racer.finishTime, null); assert.equal(racer.x, 4); assert.equal(racer.headingError, .7);
});

test('all modes count an ordered lap, record a clean best lap, and emit one finish event', () => {
  for (const mode of ['circuit', 'timeattack', 'arcade']) {
    const {race, racer} = setup({mode}); start(race, racer);
    const events = lap(race, racer);
    assert.equal(racer.completedLaps, 1); assert.equal(racer.lap, 1);
    near(racer.bestLap, 8); near(racer.finishTime, 8.12); near(racer.resultTime, 8.12);
    assert.deepEqual(race.finishOrder, ['a']); assert.equal(events.filter(e => e.type === 'finish').length, 1);
    assert.ok(events.every(e => typeof e.text === 'string'));
    assert.deepEqual(move(race, racer, 900), []); assert.equal(race.eventSeq, 0);
    if (mode === 'timeattack') assert.equal(racer.medal, 'gold');
  }
});

test('lap and finish timestamps interpolate the actual crossing inside the frame', () => {
  const {race, racer} = setup(); start(race, racer);
  for (let s = 100; s <= 700; s += 100) move(race, racer, s);
  move(race, racer, 790, .9);
  move(race, racer, 810, .4);
  near(racer.finishTime, 8.22); near(racer.bestLap, 8.1);
  assert.equal(racer.s, 810, 'rules must not clamp physical position');
});

test('continuous high speed movement can cross multiple gates and laps in one frame', () => {
  const {race, racer} = setup({laps: 2}); racer.v = 200;
  move(race, racer, 1610, 8.11);
  assert.equal(racer.completedLaps, 2); near(racer.finishTime, 8.06); near(racer.bestLap, 4);
});

test('skipped update checkpoints cannot turn a finish-line crossing into a win', () => {
  const {race, racer} = setup(); start(race, racer);
  racer.s = 790;
  const events = move(race, racer, 810, .2);
  assert.equal(racer.completedLaps, 0); assert.equal(racer.finishTime, null);
  assert.ok(events.some(e => e.type === 'checkpoint-missed'));
  assert.equal(racer.bestLap, null);
  lap(race, racer);
  assert.equal(racer.completedLaps, 1, 'a subsequent fully driven lap can recover');
});

test('teleporting through a whole lap cannot collect gates or finish', () => {
  const {race, racer} = setup(); start(race, racer); racer.v = 5;
  const events = move(race, racer, 810, .016);
  assert.equal(racer.completedLaps, 0); assert.equal(racer.finishTime, null);
  assert.ok(events.some(e => e.type === 'checkpoint-missed'));
});

test('reverse crossings do not count or repeat checkpoints', () => {
  const {race, racer} = setup(); start(race, racer);
  move(race, racer, 100); const count = racer.checkpointsPassed;
  move(race, racer, 90, .1); move(race, racer, 110, .2);
  assert.equal(racer.checkpointsPassed, count);
  move(race, racer, -10, 1.2);
  assert.equal(racer.completedLaps, 0); assert.equal(racer.finishTime, null);
  move(race, racer, 10, .2);
  assert.equal(racer.completedLaps, 0);
});

test('outside-road finish is invalid even with every earlier checkpoint passed', () => {
  const {race, racer} = setup(); start(race, racer);
  for (let s = 100; s <= 700; s += 100) move(race, racer, s);
  const events = move(race, racer, 810, 1.1, 12);
  assert.equal(racer.completedLaps, 0); assert.equal(racer.finishTime, null);
  assert.equal(racer.bestLap, null); assert.equal(racer.validLap, false);
  assert.ok(events.some(e => e.type === 'checkpoint-missed'));
});

test('off-road duration and penalties are independent of frame subdivision, including road-edge interpolation', () => {
  const one = setup(), split = setup();
  move(one.race, one.racer, -12, 4, 12);
  move(split.race, split.racer, -12, 2, 6);
  move(split.race, split.racer, -12, 2, 12);
  near(one.racer.penaltyTime, 1); near(split.racer.penaltyTime, 1);
  near(one.racer.offTrackTime, 1); near(split.racer.offTrackTime, 1);
  assert.equal(one.racer.validLap, false);
});

test('off-road excursions still count ordered circuit/arcade laps, but only a clean next lap sets bestLap', () => {
  for (const mode of ['circuit', 'arcade']) {
    const {race, racer} = setup({laps: 2, mode}); start(race, racer);
    move(race, racer, 20, .2, 12); move(race, racer, 40, .2, 0);
    lap(race, racer);
    assert.equal(racer.completedLaps, 1); assert.equal(racer.bestLap, null); assert.equal(racer.cleanLaps, 0);
    lap(race, racer);
    assert.equal(racer.completedLaps, 2); assert.ok(racer.bestLap > 0); assert.equal(racer.cleanLaps, 1);
    assert.ok(racer.finishTime !== null);
  }
});

test('an impact dirties validLap but preserves ordered circuit/arcade progress', () => {
  for (const mode of ['circuit', 'arcade']) {
    const {race, racer} = setup({laps: 2, mode}); start(race, racer);
    racer.impactThisStep = true; move(race, racer, 100); racer.impactThisStep = false;
    assert.equal(racer.validLap, false); assert.equal(racer._cleanLap, false);
    assert.equal(racer._missedCheckpoint, false);
    move(race, racer, 200);
    assert.equal(racer.validLap, false, 'clearing the impact signal must not clean the current lap');
    const events = lap(race, racer);
    assert.equal(racer.completedLaps, 1); assert.equal(racer.bestLap, null); assert.equal(racer.cleanLaps, 0);
    assert.equal(events.find(e => e.type === 'lap').clean, false);
    assert.equal(racer.validLap, true, 'the next undamaged lap starts clean');
    lap(race, racer); near(racer.bestLap, 8); assert.equal(racer.cleanLaps, 1);
  }
});

test('countdown movement and elapsed countdown do not grant gates or accrue penalties', () => {
  const {race, racer} = setup(); race.time = -2;
  move(race, racer, -10, 1, 12);
  assert.equal(racer.penaltyTime, 0); assert.equal(racer.checkpointsPassed, 0);
  move(race, racer, -8, 2, 12);
  near(racer.penaltyTime, 1); near(racer.offTrackTime, 1);
});

test('a crossing before countdown ends cannot start a lap', () => {
  const {race, racer} = setup(); race.time = -.1;
  move(race, racer, 28, .2);
  assert.equal(racer.checkpointsPassed, 0); assert.equal(racer.completedLaps, 0);
});

test('reset returns a safe checkpoint pose, adds 3 seconds, and clears continuous warnings without moving physics', () => {
  const {race, racer} = setup();
  assert.deepEqual(rules.resetRaceRacer(race, racer, track), {s: -12, x: 0, headingError: 0, v: 0});
  near(racer.penaltyTime, 3); assert.equal(racer.resetCount, 1);
  start(race, racer); move(race, racer, 100);
  Object.assign(racer, {s: 120, x: 15, v: 30, headingError: 2, offTrackTime: 4, wrongWayTime: 3});
  const pose = rules.resetRaceRacer(race, racer, track);
  assert.deepEqual(pose, {s: 102, x: 0, headingError: 0, v: 0});
  assert.equal(racer.s, 120); assert.equal(racer.x, 15); assert.equal(racer.v, 30); assert.equal(racer.headingError, 2);
  near(racer.penaltyTime, 6); assert.equal(racer.validLap, false); assert.equal(racer.resetCount, 2);
  assert.equal(racer.offTrackTime, 0); assert.equal(racer.wrongWayTime, 0);
});

test('reverse motion warns once per continuous episode and clears on forward driving', () => {
  const {race, racer} = setup(); racer.forwardSpeed = -5;
  const events = [];
  for (let i = 0; i < 20; i++) events.push(...move(race, racer, racer.s - .5, .1));
  assert.equal(events.filter(e => e.type === 'wrong-way').length, 1);
  racer.forwardSpeed = 5; move(race, racer, racer.s + .5, .1);
  assert.equal(racer.wrongWayTime, 0);
});

test('same-frame results include existing penalties and do not depend on racer update order', () => {
  function run(order) {
    const {race} = setup({ids: ['a', 'b']});
    for (const racer of race.racers) {
      race.time = 0; start(race, racer);
      for (let s = 100; s <= 700; s += 100) move(race, racer, s);
      move(race, racer, 790, .9);
    }
    race.racers[0].penaltyTime = 3;
    race.time = 8.42;
    for (const i of order) move(race, race.racers[i], 810, .4, 0, false);
    return {order: race.finishOrder, results: race.racers.map(r => [r.finishTime, r.resultTime, r.rank])};
  }
  const forward = run([0, 1]), reversed = run([1, 0]);
  assert.deepEqual(forward, reversed); assert.deepEqual(forward.order, ['b', 'a']);
  near(forward.results[0][1] - forward.results[0][0], 3);
});

test('penalties stop at the actual finish time, and later off-road motion cannot alter a result', () => {
  const {race, racer} = setup(); start(race, racer);
  for (let s = 100; s <= 700; s += 100) move(race, racer, s);
  move(race, racer, 790, .9);
  move(race, racer, 830, .4, 12);
  assert.equal(racer.completedLaps, 1); near(racer.penaltyTime, 0);
  const result = racer.resultTime;
  move(race, racer, 840, 1, 20);
  assert.equal(racer.resultTime, result);
});

test('timeattack medal thresholds use total result time including penalties', () => {
  for (const [medal, target] of [['gold', 'gold'], ['silver', 'silver'], ['bronze', 'bronze'], ['none', null]]) {
    const {race, racer} = setup({mode: 'timeattack'});
    const desired = target ? race.targetTimes[target] : race.targetTimes.bronze + 1;
    racer.penaltyTime = desired - 8.12;
    start(race, racer); lap(race, racer);
    assert.equal(racer.medal, medal); near(racer.resultTime, desired);
  }
});

test('fractional real-world track lengths complete laps without exact floating point comparisons', () => {
  for (const length of [731.1, 1234.567, 987.654321, 1446.713587253]) {
    const localTrack = {length};
    const race = {time: 0, laps: 3, rules: 'circuit', racers: [{id: 'a', s: -12, x: 0, v: 100}]};
    rules.initRaceRules(race, localTrack);
    const racer = race.racers[0];
    for (let i = 0; i <= 24; i++) {
      const previous = {s: racer.s, x: 0, v: 100};
      racer.s = length * i / 8;
      const dt = (racer.s - previous.s) / 100;
      race.time += dt;
      rules.updateRaceRules(race, racer, localTrack, previous, dt);
    }
    assert.equal(racer.completedLaps, 3, `length=${length}`);
    near(racer.finishTime, (length * 3 + 12) / 100);
  }
});

test('a backwards finish-line crossing cannot complete an otherwise prepared lap', () => {
  const {race, racer} = setup(); start(race, racer);
  for (let s = 100; s <= 700; s += 100) move(race, racer, s);
  racer.s = 810; racer.forwardSpeed = -100;
  move(race, racer, 790, .2);
  assert.equal(racer.completedLaps, 0); assert.equal(racer.finishTime, null);
  assert.equal(racer.checkpointsPassed, 8);
});

test('signed backwards velocity blocks checkpoints even when a physics correction increases s', () => {
  for (const speed of [-100, -.2]) {
    const {race, racer} = setup(); racer.forwardSpeed = speed;
    move(race, racer, 10, .22);
    assert.equal(racer.checkpointsPassed, 0, `forwardSpeed=${speed}`); assert.equal(racer.completedLaps, 0);
  }
});

test('applying a reset pose preserves checkpoint order and a complete circuit/arcade lap can finish with a penalty', () => {
  for (const mode of ['circuit', 'arcade']) {
    const {race, racer} = setup({mode}); start(race, racer); move(race, racer, 200, 2);
    Object.assign(racer, rules.resetRaceRacer(race, racer, track), {v: 100});
    lap(race, racer);
    assert.equal(racer.completedLaps, 1); assert.ok(racer.finishTime !== null);
    near(racer.resultTime - racer.finishTime, 3);
    assert.equal(racer.cleanLaps, 0); assert.equal(racer.bestLap, null);
  }
});

test('missing or invalid lap options default to the new menu value of two', () => {
  for (const laps of [undefined, 0, -1, 1.5, NaN]) {
    const {race, racer} = setup({laps: 1}); race.laps = laps;
    rules.initRaceRules(race, track);
    assert.equal(race.laps, 2); assert.equal(racer.cleanLaps, 0);
  }
});

test('the first zero-metre crossing starts timing without completing a lap', () => {
  const {race, racer} = setup();
  const events = move(race, racer, 8, .2);
  near(racer.lapStart, .12);
  assert.equal(racer.completedLaps, 0); assert.equal(racer.cleanLaps, 0);
  assert.equal(racer.checkpointsPassed, 1); assert.equal(racer.nextCheckpoint, 1);
  assert.equal(racer.finishTime, null); assert.equal(racer.bestLap, null);
  assert.ok(!events.some(e => e.type === 'lap' || e.type === 'finish'));
});

test('a dirty timeattack run finishes but cannot receive any medal, even when faster than gold', () => {
  for (const cause of ['off-road', 'reset', 'impact']) {
    const {race, racer} = setup({mode: 'timeattack'}); start(race, racer);
    if (cause === 'off-road') {
      move(race, racer, 20, .2, 12); move(race, racer, 40, .2, 0);
    } else if (cause === 'reset') {
      move(race, racer, 100);
      Object.assign(racer, rules.resetRaceRacer(race, racer, track), {v: 100});
    } else {
      racer.impactThisStep = true; move(race, racer, 100); racer.impactThisStep = false;
    }
    const events = lap(race, racer);
    assert.equal(racer.completedLaps, 1); assert.equal(racer.cleanLaps, 0);
    assert.ok(racer.resultTime < race.targetTimes.gold);
    assert.equal(racer.medal, 'none'); assert.equal(racer.bestLap, null);
    assert.equal(events.find(e => e.type === 'finish').medal, 'none');
  }
});

test('one clean lap cannot award a medal for a two-lap timeattack with another dirty lap', () => {
  const {race, racer} = setup({mode: 'timeattack', laps: 2}); start(race, racer);
  racer.impactThisStep = true; move(race, racer, 100); racer.impactThisStep = false;
  lap(race, racer); lap(race, racer);
  assert.equal(racer.completedLaps, 2); assert.equal(racer.cleanLaps, 1);
  assert.ok(racer.bestLap > 0); assert.equal(racer.medal, 'none');
});

test('the first 0.5 continuous off-road seconds are free regardless of frame subdivision', () => {
  for (const dts of [[1.2], Array(12).fill(.1), [.2, .3, .7]]) {
    const {race, racer} = setup(); racer.x = 12;
    for (const dt of dts) move(race, racer, racer.s, dt);
    near(racer.offTrackTime, 1.2); near(racer.penaltyTime, 1.4);
    assert.equal(racer.validLap, false);
  }
  const {race, racer} = setup(); racer.x = 12;
  move(race, racer, racer.s, .5); near(racer.penaltyTime, 0);
  move(race, racer, racer.s, .1); near(racer.penaltyTime, .2);
});

test('returning to the road renews grace, including an entire crossing from one grass verge to the other', () => {
  const {race, racer} = setup();
  for (let i = 0; i < 2; i++) {
    move(race, racer, racer.s, .4, 12);
    move(race, racer, racer.s, .3, 12);
    move(race, racer, racer.s, .4, 0);
    near(racer.offTrackTime, 0); near(racer.penaltyTime, 0);
  }
  racer.x = 12;
  move(race, racer, racer.s, 4, -12);
  near(racer.offTrackTime, .5); near(racer.penaltyTime, 0);
});

test('physics offRoad flags invalidate dirty laps and outside checkpoints even when centre projection looks on-road', () => {
  const {race, racer} = setup(); start(race, racer);
  racer.offRoad = true;
  move(race, racer, 20, 1, 8);
  assert.equal(racer.validLap, false); near(racer.penaltyTime, 1);
  const events = move(race, racer, 110, 1, 8);
  assert.equal(racer.nextCheckpoint, 1);
  assert.ok(events.some(e => e.type === 'checkpoint-missed'));
  racer.offRoad = false;
  move(race, racer, 800, 6.9, 0);
  assert.equal(racer.completedLaps, 0); assert.equal(racer.finishTime, null);
});

test('post-collision rules preserve independent world position, heading and physical fields', () => {
  const {race, racer} = setup(); start(race, racer);
  Object.assign(racer, {worldX: 42, worldZ: -800, heading: 2.3, headingError: .6, x: 12, forwardSpeed: -4, offRoad: true, impactThisStep: true});
  const physical = ({s, x, v, worldX, worldZ, heading, headingError, forwardSpeed, offRoad, impactThisStep}) => ({s, x, v, worldX, worldZ, heading, headingError, forwardSpeed, offRoad, impactThisStep});
  const before = physical(racer);
  move(race, racer, racer.s, 1);
  assert.deepEqual(physical(racer), before);
  rules.resetRaceRacer(race, racer, track);
  assert.deepEqual(physical(racer), before);
});

test('real average speeds of 30 and 35 m/s earn bronze and silver on a clean timeattack', () => {
  for (const [speed, medal] of [[30, 'bronze'], [35, 'silver'], [40, 'gold'], [26, 'none']]) {
    const {race, racer} = setup({mode: 'timeattack'}); racer.v = speed;
    for (let s = 0; s <= track.length; s += 100) move(race, racer, s, (s - racer.s) / speed);
    assert.equal(racer.medal, medal, `speed=${speed}`);
    assert.equal(racer.cleanLaps, 1);
    near(racer.resultTime, (track.length + 12) / speed);
  }
});


test('an impact on the exact start or lap boundary cannot leave the new validLap flag clean', () => {
  for (const boundary of ['start', 'lap']) {
    const {race, racer} = setup({laps: 2});
    if (boundary === 'lap') {
      start(race, racer);
      for (let s = 100; s <= 700; s += 100) move(race, racer, s);
    }
    racer.impactThisStep = true;
    move(race, racer, boundary === 'start' ? 0 : 800, boundary === 'start' ? .12 : 1);
    assert.equal(racer.validLap, false, `boundary=${boundary}`);
    assert.equal(racer._cleanLap, false); assert.equal(racer.cleanLaps, 0);
    assert.equal(racer.completedLaps, boundary === 'start' ? 0 : 1);
    assert.equal(racer._missedCheckpoint, false);
  }
});

test('reset after an outside checkpoint restores ordered completion of the same dirty lap for a 3-second penalty', () => {
  for (const mode of ['circuit', 'arcade', 'timeattack']) {
    const {race, racer} = setup({mode}); start(race, racer);
    move(race, racer, 100);
    const missed = move(race, racer, 210, 1.1, 12);
    assert.ok(missed.some(e => e.type === 'checkpoint-missed'));
    assert.equal(racer._missedCheckpoint, true);
    const earned = {lastCheckpointS: racer.lastCheckpointS, nextCheckpoint: racer.nextCheckpoint, nextS: racer._nextCheckpointS, checkpointsPassed: racer.checkpointsPassed};
    const penaltyBefore = racer.penaltyTime;
    const pose = rules.resetRaceRacer(race, racer, track);
    assert.equal(racer._missedCheckpoint, false, 'paying for recovery must clear the missed gate attempt');
    assert.equal(racer.validLap, false); assert.equal(racer._cleanLap, false);
    assert.deepEqual({lastCheckpointS: racer.lastCheckpointS, nextCheckpoint: racer.nextCheckpoint, nextS: racer._nextCheckpointS, checkpointsPassed: racer.checkpointsPassed}, earned);
    assert.deepEqual(pose, {s: 102, x: 0, headingError: 0, v: 0});
    near(racer.penaltyTime - penaltyBefore, 3); assert.equal(racer.resetCount, 1);
    Object.assign(racer, pose, {v: 100});
    move(race, racer, 200, .98);
    const events = lap(race, racer);
    assert.equal(racer.completedLaps, 1); assert.ok(racer.finishTime !== null);
    assert.ok(events.some(e => e.type === 'finish'));
    assert.equal(racer.cleanLaps, 0); assert.equal(racer.bestLap, null); assert.equal(racer.validLap, false);
    near(racer.resultTime - racer.finishTime, penaltyBefore + 3);
    if (mode === 'timeattack') assert.equal(racer.medal, 'none');
  }
});

test('without reset, returning to collect a missed gate still cannot count the invalidated lap', () => {
  for (const mode of ['circuit', 'arcade']) {
    const {race, racer} = setup({mode}); start(race, racer);
    move(race, racer, 100); move(race, racer, 210, 1.1, 12);
    assert.equal(racer._missedCheckpoint, true);
    move(race, racer, 190, .2, 0); move(race, racer, 200, .1);
    assert.equal(racer.checkpointsPassed, 3); assert.equal(racer._missedCheckpoint, true);
    const events = lap(race, racer);
    assert.equal(racer.completedLaps, 0); assert.equal(racer.finishTime, null);
    assert.equal(racer.bestLap, null); assert.equal(racer.cleanLaps, 0); assert.equal(racer.resetCount, 0);
    assert.ok(events.some(e => e.type === 'invalid-lap'));
    assert.ok(!events.some(e => e.type === 'finish'));
  }
});
