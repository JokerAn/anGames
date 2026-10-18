import test from 'node:test';
import assert from 'node:assert/strict';
import {GhostRecorder, ghostStorageKey, GHOST_MAX_SAMPLES, GHOST_MAX_JSON_LENGTH} from '../src/ghost.js';
import {createRace, stepRace} from '../src/simulation.js';
import {getTrack} from '../src/tracks.js';
import {driverInput} from '../src/driving.js';

function memoryStorage() {
  const values = new Map();
  return {values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)};
}
function fixture() {
  const race = {rules: 'timeattack', trackId: 'coast', laps: 2, difficulty: 'normal', status: 'countdown', time: -3.5};
  const me = {id: 'local', bot: false, car: 'comet', engine: 'balanced', worldX: 0, worldZ: 0, heading: 0,
    s: -12, x: -2.5, v: 0, finishTime: null, resultTime: null, cleanLaps: 0, completedLaps: 0, penaltyTime: 0};
  return {race, me};
}
function pose(race, me, time) {
  race.time = time;
  race.status = 'racing';
  Object.assign(me, {worldX: time * 2, worldZ: time * 4, heading: .1 * time, s: time * 10 - 12, x: time / 10, v: 10});
}
function run(recorder, seconds = 2, changes = {}) {
  const {race, me} = fixture();
  recorder.begin(race, me);
  for (let i = 0; i <= Math.floor(seconds * 10); i++) {
    pose(race, me, i / 10);
    recorder.sample(race, me);
  }
  pose(race, me, seconds);
  race.status = 'finished';
  Object.assign(me, {finishTime: seconds, resultTime: seconds, cleanLaps: race.laps, completedLaps: race.laps}, changes.me);
  Object.assign(race, changes.race);
  return {saved: recorder.finish(race, me), race, me};
}
function seed(storage = memoryStorage(), time = 2) {
  const recorder = new GhostRecorder({storage});
  assert.equal(run(recorder, time).saved, true);
  const {race, me} = fixture(), key = ghostStorageKey(race, me);
  return {storage, recorder, key, record: JSON.parse(storage.getItem(key))};
}
function loaded(storage) {
  const recorder = new GhostRecorder({storage}), {race, me} = fixture();
  recorder.begin(race, me);
  return recorder;
}

test('countdown is excluded, actual manual poses are recorded at most 10Hz, snapshots do not reset the session', () => {
  const recorder = new GhostRecorder({storage: null});
  let {race, me} = fixture();
  assert.equal(recorder.begin(race, me), true);
  assert.equal(recorder.sample(race, me), false);
  for (let i = 0; i <= 60; i++) {
    pose(race, me, i / 60);
    race = {...race}; me = {...me};
    recorder.sample(race, me);
  }
  assert.equal(recorder.diagnostics.sampleCount, 11);
  assert.equal(recorder.diagnostics.firstSampleTime, 0);
  assert.equal(recorder.diagnostics.lastSampleTime, 1);
});

test('clean finished run stores a versioned compact record and reloads an identical best', () => {
  const {recorder, storage, key, record} = seed();
  assert.equal(record.schemaVersion, 1);
  assert.deepEqual(record.identity, {trackId: 'coast', laps: 2, car: 'comet', engine: 'balanced', difficulty: 'normal'});
  assert.equal(record.samples[0].length, 7);
  assert.equal(recorder.time, 2);
  assert.equal(loaded(storage).time, 2);
  assert.ok(key.startsWith('junior-racers:ghost:'));
  assert.ok(storage.getItem(key).length < GHOST_MAX_JSON_LENGTH);
  assert.deepEqual(recorder.playback(.5), {time: .5, worldX: 1, worldZ: 2, heading: .05, s: -7, x: .05, v: 10});
});

test('only faster clean records replace the best; ties and slower attempts preserve bytes', () => {
  const {storage, recorder, key} = seed();
  const bytes = storage.getItem(key);
  assert.equal(run(recorder, 3).saved, false);
  assert.equal(run(recorder, 2).saved, false);
  assert.equal(storage.getItem(key), bytes);
  assert.equal(run(recorder, 1).saved, true);
  assert.equal(recorder.time, 1);
  assert.equal(loaded(storage).time, 1);
});

for (const [name, changes] of [
  ['unfinished status', {race: {status: 'racing'}}],
  ['missing finishTime', {me: {finishTime: null}}],
  ['infinite finishTime', {me: {finishTime: Infinity}}],
  ['missing resultTime', {me: {resultTime: null}}],
  ['NaN resultTime', {me: {resultTime: NaN}}],
  ['dirty laps', {me: {cleanLaps: 1}}],
  ['penalty', {me: {penaltyTime: .001}}],
  ['incomplete laps', {me: {completedLaps: 1}}],
  ['implausible resultTime', {me: {resultTime: 200}}],
  ['earlier resultTime', {me: {resultTime: 1}}],
  ['missing clean laps', {me: {cleanLaps: undefined}}],
  ['wrong mode', {race: {rules: 'circuit'}}],
]) {
  test(`${name} cannot replace a best`, () => {
    const {storage, recorder, key} = seed();
    const bytes = storage.getItem(key);
    assert.equal(run(recorder, 1.5, changes).saved, false);
    assert.equal(storage.getItem(key), bytes);
    assert.equal(recorder.time, 2);
  });
}

test('mid-race begin and late first sample cannot produce a valid ghost', () => {
  for (const beginTime of [-3.5, 1]) {
    const {race, me} = fixture(), storage = memoryStorage(), recorder = new GhostRecorder({storage});
    race.time = beginTime; recorder.begin(race, me);
    for (let t = 1; t <= 2; t += .1) { pose(race, me, t); recorder.sample(race, me); }
    pose(race, me, 2); race.status = 'finished';
    Object.assign(me, {finishTime: 2, resultTime: 2, cleanLaps: 2, completedLaps: 2});
    assert.equal(recorder.finish(race, me), false);
    assert.equal(storage.values.size, 0);
  }
});

test('start tolerance accepts an actual sample at .25 but rejects a later one', () => {
  for (const first of [.25, .250001]) {
    const {race, me} = fixture(), recorder = new GhostRecorder({storage: null});
    recorder.begin(race, me);
    for (let i = 0; i < 10; i++) { pose(race, me, first + i / 10); recorder.sample(race, me); }
    race.status = 'finished'; Object.assign(me, {finishTime: race.time, resultTime: race.time, cleanLaps: 2, completedLaps: 2});
    assert.equal(recorder.finish(race, me), first === .25);
  }
});

test('finish forces a real final pose between normal ticks; stale finish poses and sparse records are rejected', () => {
  const {recorder} = seed(memoryStorage(), 1.05);
  assert.equal(recorder.best.samples.at(-1)[0], 1.05);
  assert.equal(recorder.playback(1.05).worldX, 2.1);
  for (const gap of [.6, 10]) {
    const {race, me} = fixture(), ghost = new GhostRecorder({storage: null}); ghost.begin(race, me);
    pose(race, me, 0); ghost.sample(race, me);
    pose(race, me, gap); race.status = 'finished';
    Object.assign(me, {finishTime: gap, resultTime: gap, cleanLaps: 2, completedLaps: 2});
    assert.equal(ghost.finish(race, me), false);
  }
  const {race, me} = fixture(), ghost = new GhostRecorder({storage: null}); ghost.begin(race, me);
  pose(race, me, 0); ghost.sample(race, me);
  pose(race, me, .1); race.status = 'finished';
  Object.assign(me, {finishTime: 2, resultTime: 2, cleanLaps: 2, completedLaps: 2});
  assert.equal(ghost.finish(race, me), false);
});

test('long sessions stay bounded and attempts exceeding 300s never save a truncated ghost', () => {
  const recorder = new GhostRecorder({storage: null});
  assert.equal(run(recorder, 300).saved, true);
  assert.ok(recorder.best.samples.length <= GHOST_MAX_SAMPLES);
  const {race, me} = fixture(); recorder.begin(race, me);
  for (let i = 0; i <= 350 * 60; i++) { pose(race, me, i / 60); recorder.sample(race, me); }
  assert.ok(recorder.diagnostics.sampleCount <= GHOST_MAX_SAMPLES);
  race.status = 'finished'; Object.assign(me, {finishTime: 350, resultTime: 350, cleanLaps: 2, completedLaps: 2});
  assert.equal(recorder.finish(race, me), false);
  assert.equal(recorder.time, 300);
});

test('identity separates every setting and rejects identity or player changes inside a session', () => {
  const {storage, key} = seed();
  for (const [owner, field, value] of [['race','trackId','city'], ['race','laps',3], ['race','difficulty','easy'], ['me','car','formula'], ['me','engine','speed']]) {
    const {race, me} = fixture(); ({race, me})[owner][field] = value;
    assert.notEqual(ghostStorageKey(race, me), key);
    const ghost = new GhostRecorder({storage}); ghost.begin(race, me); assert.equal(ghost.best, null);
  }
  for (const field of ['id', 'car']) {
    const ghost = new GhostRecorder({storage: null}), {race, me} = fixture(); ghost.begin(race, me);
    pose(race, me, 0); ghost.sample(race, me); me[field] = 'changed';
    assert.equal(ghost.sample(race, me), false);
    assert.equal(ghost.diagnostics.recording, false);
  }
});

for (const storage of [null, {}, {getItem() {throw Error('denied');}, setItem() {throw Error('quota');}},
  {get getItem() {throw Error('getter denied');}}, {getItem() {return null;}, setItem() {throw Error('quota');}}]) {
  test(`unavailable or throwing storage is harmless (${String(storage?.constructor?.name)})`, () => {
    const ghost = new GhostRecorder({storage});
    assert.doesNotThrow(() => run(ghost));
    assert.equal(ghost.time, 2);
    assert.equal(ghost.playback(1).s, -2);
  });
}

test('malformed, oversized, unversioned and wrong-config JSON never loads', () => {
  const {storage, key, record} = seed();
  const invalid = ['{', 'null', '[]', 'x'.repeat(GHOST_MAX_JSON_LENGTH + 1), 123,
    JSON.stringify({...record, schemaVersion: 99}), JSON.stringify({...record, schemaVersion: undefined}),
    JSON.stringify({...record, identity: {...record.identity, laps: 3}}), JSON.stringify({...record, time: '2'}),
    JSON.stringify({...record, control: {autoThrottle: true}}), JSON.stringify({...record, result: {...record.result, penaltyTime: 1}})];
  for (const value of invalid) { storage.values.set(key, value); assert.equal(loaded(storage).best, null); }
});

test('sample validation rejects nonfinite/missing fields, time disorder, gaps, missing endpoints and hard-limit overflow', () => {
  const {storage, key, record} = seed();
  const changes = [
    r => {r.samples[1][1] = null;}, r => {r.samples[1][2] = '3';}, r => {r.samples[1].pop();},
    r => {r.samples[1].push(0);}, r => {r.samples[1][0] = -1;}, r => {r.samples[1][0] = r.samples[0][0];},
    r => {r.samples[1][0] = .05;}, r => {r.samples[0][0] = .3;}, r => {r.samples.splice(1, 8);},
    r => {r.samples.splice(-5);}, r => {r.samples = Array(GHOST_MAX_SAMPLES + 1).fill(r.samples[0]);},
    r => {r.result.finishTime = 100;}, r => {r.result.completedLaps = 0;}, r => {r.result.status = 'racing';},
    r => {r.samples[1][1] = 1e100;}, r => {r.samples[1][3] = 1e100;},
  ];
  for (const change of changes) {
    const edited = structuredClone(record); change(edited); storage.values.set(key, JSON.stringify(edited));
    assert.equal(loaded(storage).best, null);
  }
});

test('playback interpolates actual positions and yaw across ±pi without extrapolating or mutating best', () => {
  const {storage, key, record} = seed();
  record.samples[0][3] = Math.PI - .1; record.samples[1][3] = -Math.PI + .1;
  storage.values.set(key, JSON.stringify(record));
  const ghost = loaded(storage), p = ghost.playback(.05);
  assert.ok(Math.abs(Math.abs(p.heading) - Math.PI) < 1e-6);
  assert.equal(p.worldX, .1); assert.equal(p.worldZ, .2);
  for (const time of [-.001, 2.001, NaN, Infinity, '1']) assert.equal(ghost.playback(time), null);
  assert.equal(ghost.playback(0).time, 0); assert.equal(ghost.playback(2).time, 2);
  p.worldX = 999; assert.equal(ghost.playback(.05).worldX, .1);
  assert.ok(Object.isFrozen(ghost.best)); assert.ok(Object.isFrozen(ghost.best.samples[0]));
});

test('progressDelta reports signed seconds with no extrapolation or ambiguous reverse-progress advantage', () => {
  const {storage, key, record} = seed();
  const ghost = loaded(storage);
  assert.ok(Math.abs(ghost.progressDelta(-7, .8) - .3) < 1e-8);
  assert.ok(Math.abs(ghost.progressDelta(-7, .3) + .2) < 1e-8);
  for (const s of [-13, 9, NaN]) assert.equal(ghost.progressDelta(s, 1), null);
  assert.equal(ghost.progressDelta(0, -1), null);
  record.samples[8][4] = record.samples[5][4]; storage.values.set(key, JSON.stringify(record));
  const reverse = loaded(storage);
  assert.ok(reverse.best, 'reversing must not invalidate a real replay');
  assert.equal(reverse.progressDelta(record.samples[6][4], 1), null);
});

test('nonfinite pose and time rollback invalidate recording instead of bridging a corrupt session', () => {
  for (const change of [(race, me) => {me.worldX = Infinity;}, race => {race.time = .05;}]) {
    const ghost = new GhostRecorder({storage: null}), {race, me} = fixture(); ghost.begin(race, me);
    pose(race, me, 0); ghost.sample(race, me); pose(race, me, .1); ghost.sample(race, me);
    pose(race, me, .2); change(race, me); assert.equal(ghost.sample(race, me), false);
    assert.equal(ghost.diagnostics.recording, false);
  }
});

test('bots/automatic controls are excluded; recording and playback never copy or alter input controls', () => {
  for (const change of [{bot: true}, {autoControl: true}, {autoThrottle: true}, {autoSteer: true}, {autopilot: true}, {control: 'auto'}]) {
    const {race, me} = fixture(); Object.assign(me, change);
    assert.equal(new GhostRecorder({storage: null}).begin(race, me), false);
  }
  const ghost = new GhostRecorder({storage: null}), {race, me} = fixture();
  me.input = Object.freeze({throttle: true, steer: -.2, brake: false});
  ghost.begin(race, me); pose(race, me, 0); const original = structuredClone(me);
  ghost.sample(race, me); assert.deepEqual(me, original);
  run(ghost);
  const json = JSON.stringify(ghost.best);
  assert.doesNotMatch(json, /input|throttle|steer|autopilot|autoControl|autoThrottle|autoSteer/);
  assert.deepEqual(Object.keys(ghost.playback(.5)).sort(), ['heading','s','time','v','worldX','worldZ','x'].sort());
});

test('exact pi headings and sub-microsecond finish timestamps remain valid and playable', () => {
  for (const heading of [Math.PI, -Math.PI]) {
    const {race, me} = fixture(), ghost = new GhostRecorder({storage: null});
    ghost.begin(race, me);
    for (let i = 0; i <= 10; i++) { pose(race, me, i / 10); me.heading = heading; ghost.sample(race, me); }
    pose(race, me, 1.0000001); me.heading = heading; race.status = 'finished';
    Object.assign(me, {finishTime: race.time, resultTime: race.time, cleanLaps: 2, completedLaps: 2});
    assert.equal(ghost.finish(race, me), true);
    assert.ok(ghost.playback(me.finishTime));
    assert.ok(Math.abs(Math.abs(ghost.playback(.05).heading) - Math.PI) < 1e-6);
  }
});

test('LAN local finish captures once and waits for global finished status without recording the wait', () => {
  const {race, me} = fixture(), ghost = new GhostRecorder({storage: null}); ghost.begin(race, me);
  for (let i = 0; i < 10; i++) { pose(race, me, i / 10); ghost.sample(race, me); }
  pose(race, me, .95);
  Object.assign(me, {finishTime: .94, resultTime: .94, cleanLaps: 2, completedLaps: 2});
  assert.equal(ghost.sample(race, me), true);
  assert.equal(ghost.finish(race, me), false, 'racing status must not save');
  assert.equal(ghost.time, null);
  const count = ghost.diagnostics.sampleCount;
  race.time = 12; me.worldX = 999;
  assert.equal(ghost.sample({...race}, {...me}), false);
  assert.equal(ghost.diagnostics.sampleCount, count);
  race.status = 'finished';
  assert.equal(ghost.finish({...race}, {...me}), true);
  assert.equal(ghost.best.samples.at(-1)[0], .95);
  assert.equal(ghost.time, .94);
  assert.equal(ghost.finish(race, me), false, 'finish is idempotent');
});

test('a faster best saved by another tab during the attempt is preserved', () => {
  const {storage, key} = seed(memoryStorage(), 3);
  const ghost = loaded(storage), {race, me} = fixture();
  ghost.begin(race, me);
  for (let i = 0; i <= 20; i++) { pose(race, me, i / 10); ghost.sample(race, me); }
  seed(storage, 1);
  const fasterBytes = storage.getItem(key);
  race.status = 'finished'; Object.assign(me, {finishTime: 2, resultTime: 2, cleanLaps: 2, completedLaps: 2});
  assert.equal(ghost.finish(race, me), false);
  assert.equal(storage.getItem(key), fasterBytes);
  assert.equal(ghost.time, 1);
});

test('the default global storage getter may throw without preventing recording', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    Object.defineProperty(globalThis, 'localStorage', {configurable: true, get() {throw Error('denied');}});
    const ghost = new GhostRecorder();
    assert.equal(run(ghost).saved, true);
    assert.equal(ghost.time, 2);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});


test('progressDelta uses first arrival at repeated start, middle and final positions without extrapolation', () => {
  const {storage, key, record} = seed();
  record.samples[1][4] = record.samples[0][4];
  record.samples[2][4] = record.samples[0][4];
  record.samples[9][4] = record.samples[8][4];
  record.samples[10][4] = record.samples[8][4];
  record.samples[20][4] = record.samples[19][4];
  storage.values.set(key, JSON.stringify(record));
  const ghost = loaded(storage);
  assert.equal(ghost.diagnostics.progressAvailable, true);
  // Equal progress compares against first arrival, including when still parked.
  assert.equal(ghost.progressDelta(-12, .5), .5);
  assert.ok(Math.abs(ghost.progressDelta(-4, 1.1) - .3) < 1e-8);
  assert.ok(Math.abs(ghost.progressDelta(7, 2) - .1) < 1e-8);
  assert.ok(Math.abs(ghost.progressDelta(-4, .6) + .2) < 1e-8);
  // Between positions, interpolate from departure after the pause to the next
  // actual arrival; never smear the stop across the following road segment.
  assert.ok(Math.abs(ghost.progressDelta(-11, .3) - (.3 - (.2 + .1 / 3))) < 1e-8);
  assert.ok(Math.abs(ghost.progressDelta(-2.5, 1.2) - .15) < 1e-8);
  for (const s of [-12.001, 7.001]) assert.equal(ghost.progressDelta(s, 1), null);
  assert.equal(ghost.playback(.1).s, -12);
  assert.equal(ghost.playback(.95).s, -4);
});

test('a wholly stationary record remains replayable but never reports progress comparison ready', () => {
  const {storage, key, record} = seed();
  record.samples.forEach(row => {row[4] = -12;});
  storage.values.set(key, JSON.stringify(record));
  const ghost = loaded(storage);
  assert.ok(ghost.best);
  assert.equal(ghost.playback(1).s, -12);
  assert.equal(ghost.diagnostics.progressAvailable, false);
  for (const s of [-12, -13, 0]) assert.equal(ghost.progressDelta(s, 1), null);
});

test('a real fixed-step race waiting at the start then driving produces a replay with available delta', () => {
  const race = createRace({track: 'coast', rules: 'timeattack', laps: 2});
  const me = race.racers[0], track = getTrack(race.trackId);
  const ghost = new GhostRecorder({storage: null});
  ghost.begin(race, me);
  // Test-only sampled steering drives the real physics/rules, after a human-like
  // reaction delay. GhostRecorder only observes the resulting authoritative pose.
  for (let ticks = 0; ticks < 60 * 170 && race.status !== 'finished'; ticks++) {
    if (race.time >= .8 && ticks % 5 === 0) me.input = driverInput(race, me, track);
    stepRace(race, 1 / 60);
    ghost.sample(race, me);
  }
  assert.equal(race.status, 'finished');
  assert.equal(ghost.finish(race, me), true);
  const rows = ghost.best.samples, startS = rows[0][4];
  assert.ok(rows.filter(row => row[4] === startS).length > 3, 'real start contains several equal-progress samples');
  assert.equal(ghost.diagnostics.progressAvailable, true);
  assert.ok(Math.abs(ghost.progressDelta(startS, .5) - (.5 - rows[0][0])) < 1e-8);
  const driving = rows.find(row => row[4] > startS + 1);
  assert.ok(Math.abs(ghost.progressDelta(driving[4], driving[0] + .25) - .25) < 1e-8);
  assert.equal(ghost.playback(driving[0]).s, driving[4]);
});
