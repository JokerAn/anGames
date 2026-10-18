/**
 * Session-local, passive time-attack ghost data. No physics, controls, DOM or Three.
 *
 * Integration: begin(race, me) once per new race (countdown is fine), sample the
 * authoritative state each update, finish(race, me) once status === 'finished'.
 * Object identity is deliberately irrelevant to sample/finish (LAN snapshots).
 * playback(t) returns {time, worldX, worldZ, heading, s, x, v} or null outside
 * the recorded interval / best result. The renderer derives road height from s.
 * progressDelta(s, t) is t - firstArrivalAtS: positive means behind, null unavailable.
 * Equal s during normal stops is allowed; reversing or no progress disables delta.
 *
 * JSON rows: [race.time, worldX, worldZ, heading, s, x, v]. At most 10 Hz using
 * actual poses, with one exceptional finish sample. Local finish freezes that pose
 * until global finished status permits saving. A >.5s capture gap invalidates
 * the attempt. Storage failures preserve the in-memory best. begin is the ONLY
 * operation that starts a new session; call it again on retry, not per snapshot.
 */
export const GHOST_SCHEMA_VERSION = 1;
export const GHOST_SAMPLE_HZ = 10;
export const GHOST_MAX_SECONDS = 300;
export const GHOST_MAX_SAMPLES = GHOST_MAX_SECONDS * GHOST_SAMPLE_HZ + 2;
export const GHOST_MAX_JSON_LENGTH = 512000;
const INTERVAL = 1 / GHOST_SAMPLE_HZ;
const FIRST_SAMPLE_LIMIT = .25;
const FINISH_SAMPLE_LIMIT = .25;
const MAX_GAP = .5;
const EPSILON = 1e-8;
const RESULT_TOLERANCE = .001;
const IDENTITY_FIELDS = ['trackId', 'laps', 'car', 'engine', 'difficulty'];
const RESULT_FIELDS = ['status', 'finishTime', 'resultTime', 'cleanLaps', 'completedLaps', 'penaltyTime'];
const ROW_LIMITS = [GHOST_MAX_SECONDS, 1e7, 1e7, Math.PI + EPSILON, 1e8, 1e4, 1e3];
const TOKEN = /^[a-zA-Z0-9_-]{1,64}$/;
const finite = Number.isFinite;
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const rounded = number => Math.round(number * 1e6) / 1e6;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, fields) => object(value) && Object.keys(value).length === fields.length
  && fields.every(field => Object.hasOwn(value, field));
const sameIdentity = (a, b) => a && b && IDENTITY_FIELDS.every(field => a[field] === b[field]);

function validIdentity(value) {
  return exactKeys(value, IDENTITY_FIELDS) && Number.isSafeInteger(value.laps) && value.laps > 0 && value.laps <= 99
    && ['trackId', 'car', 'engine', 'difficulty'].every(field => typeof value[field] === 'string' && TOKEN.test(value[field]));
}
function identityOf(race, me) {
  const identity = {trackId: race?.trackId, laps: race?.laps, car: me?.car, engine: me?.engine, difficulty: race?.difficulty};
  return validIdentity(identity) ? identity : null;
}
function manual(me) {
  return object(me) && me.bot === false && typeof me.id === 'string' && me.id.length > 0 && me.id.length <= 128
    && !['auto', 'autoControl', 'autoThrottle', 'autoSteer', 'autopilot'].some(field => me[field] === true)
    && ['control', 'controlMode'].every(field => me[field] === undefined || ['manual', 'human'].includes(me[field]));
}
/** Independent key for exactly trackId/laps/car/engine/difficulty; null if invalid. */
export function ghostStorageKey(race, me) {
  const identity = identityOf(race, me);
  return identity ? `junior-racers:ghost:v${GHOST_SCHEMA_VERSION}:${IDENTITY_FIELDS.map(field => identity[field]).join(':')}` : null;
}
function validResult(result, laps) {
  return exactKeys(result, RESULT_FIELDS) && result.status === 'finished'
    && finite(result.finishTime) && result.finishTime > 0 && result.finishTime <= GHOST_MAX_SECONDS
    && finite(result.resultTime) && result.resultTime > 0 && result.resultTime <= GHOST_MAX_SECONDS
    && Math.abs(result.resultTime - result.finishTime) <= RESULT_TOLERANCE
    && Number.isSafeInteger(result.cleanLaps) && result.cleanLaps >= laps
    && Number.isSafeInteger(result.completedLaps) && result.completedLaps >= laps
    && result.cleanLaps <= result.completedLaps && result.penaltyTime === 0;
}
function validRow(row) {
  return Array.isArray(row) && row.length === ROW_LIMITS.length
    && ROW_LIMITS.every((limit, index) => finite(row[index]) && Math.abs(row[index]) <= limit)
    && row[0] >= 0;
}
function poseRow(race, me) {
  if (![race.time, me.worldX, me.worldZ, me.heading, me.s, me.x, me.v].every(finite)
    || Math.abs(me.heading) > 1e6) return null;
  const row = [race.time, me.worldX, me.worldZ, wrap(me.heading), me.s, me.x, me.v];
  if (!validRow(row)) return null;
  // Preserve the actual clock, including a sub-microsecond finish boundary.
  // Six decimals for heading; millimetres for space and mm/s for speed.
  return row.map((value, index) => {
    if (index === 0) return value;
    if (index === 3) {
      const angle = rounded(value);
      return Math.abs(angle) <= Math.PI ? angle : wrap(angle);
    }
    return Math.round(value * 1000) / 1000;
  });
}
function validRecord(record, identity) {
  if (!exactKeys(record, ['schemaVersion', 'identity', 'time', 'result', 'samples'])
    || record.schemaVersion !== GHOST_SCHEMA_VERSION || !validIdentity(record.identity)
    || !sameIdentity(record.identity, identity) || !validResult(record.result, identity.laps)
    || !finite(record.time) || record.time !== record.result.resultTime
    || !Array.isArray(record.samples) || record.samples.length < 2 || record.samples.length > GHOST_MAX_SAMPLES) return false;
  const rows = record.samples;
  for (let i = 0; i < rows.length; i++) {
    if (!validRow(rows[i])) return false;
    if (i > 0) {
      const gap = rows[i][0] - rows[i - 1][0];
      if (gap <= 0 || gap > MAX_GAP + EPSILON || (i < rows.length - 1 && gap < INTERVAL - 1e-6)) return false;
    }
  }
  const end = rows.at(-1)[0], finish = record.result.finishTime;
  return rows[0][0] <= FIRST_SAMPLE_LIMIT && end >= finish - 1e-6 && end <= finish + FINISH_SAMPLE_LIMIT;
}
function freezeRecord(record) {
  Object.freeze(record.identity);
  Object.freeze(record.result);
  record.samples.forEach(Object.freeze);
  Object.freeze(record.samples);
  return Object.freeze(record);
}
function defaultStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}
function stateAt(row, time = row[0]) {
  return {time, worldX: row[1], worldZ: row[2], heading: row[3], s: row[4], x: row[5], v: row[6]};
}

export class GhostRecorder {
  #storage;
  #best = null;
  #identity = null;
  #playerId = null;
  #key = null;
  #samples = [];
  #recording = false;
  #lastSeen = null;
  #reason = null;
  #storageStatus = 'unavailable';
  #monotonicProgress = true;
  #terminal = false;

  constructor({storage = defaultStorage()} = {}) { this.#storage = storage; }

  get best() { return this.#best; }
  get time() { return this.#best?.time ?? null; }
  get diagnostics() {
    return {recording: this.#recording, sampleCount: this.#samples.length,
      firstSampleTime: this.#samples[0]?.[0] ?? null, lastSampleTime: this.#samples.at(-1)?.[0] ?? null,
      reason: this.#reason, storageStatus: this.#storageStatus, key: this.#key,
      awaitingFinish: this.#terminal && this.#recording,
      hasBest: this.#best !== null, progressAvailable: this.#best !== null && this.#monotonicProgress};
  }

  #stop(reason) { this.#recording = false; this.#reason = reason; return false; }
  #setBest(record) {
    this.#best = freezeRecord(record);
    const rows = record.samples;
    this.#monotonicProgress = rows.at(-1)[4] > rows[0][4]
      && rows.every((row, index) => index === 0 || row[4] >= rows[index - 1][4]);
  }
  #load() {
    try {
      if (typeof this.#storage?.getItem !== 'function') { this.#storageStatus = 'unavailable'; return null; }
      const json = this.#storage.getItem(this.#key);
      this.#storageStatus = 'ready';
      if (json === null || json === undefined) return null;
      if (typeof json !== 'string' || json.length > GHOST_MAX_JSON_LENGTH) { this.#storageStatus = 'invalid-data'; return null; }
      const record = JSON.parse(json);
      if (!validRecord(record, this.#identity)) { this.#storageStatus = 'invalid-data'; return null; }
      return record;
    } catch { this.#storageStatus = 'read-error'; return null; }
  }
  #persist() {
    try {
      if (typeof this.#storage?.setItem !== 'function') { this.#storageStatus = 'unavailable'; return; }
      const json = JSON.stringify(this.#best);
      if (json.length > GHOST_MAX_JSON_LENGTH) { this.#storageStatus = 'too-large'; return; }
      this.#storage.setItem(this.#key, json);
      this.#storageStatus = 'saved';
    } catch { this.#storageStatus = 'write-error'; }
  }

  /** Explicitly resets session samples and loads only this configuration's best. */
  begin(race, me) {
    const previousBest = this.#best;
    this.#samples = []; this.#recording = false; this.#lastSeen = null; this.#reason = null; this.#terminal = false;
    this.#best = null; this.#monotonicProgress = true; this.#storageStatus = 'unavailable';
    this.#identity = identityOf(race, me); this.#playerId = me?.id; this.#key = ghostStorageKey(race, me);
    if (!this.#identity || race?.rules !== 'timeattack' || !manual(me)) return this.#stop('ineligible');
    if (previousBest && sameIdentity(previousBest.identity, this.#identity)) this.#setBest(previousBest);
    const stored = this.#load();
    if (stored && (!this.#best || stored.time < this.#best.time)) this.#setBest(stored);
    if (!finite(race.time) || race.time > FIRST_SAMPLE_LIMIT || !['countdown', 'racing'].includes(race.status)) return this.#stop('late-start');
    this.#recording = true;
    // The first active pose may already be present when begin is called.
    if (race.status === 'racing' && race.time >= 0) this.sample(race, me);
    return this.#recording;
  }

  #matches(race, me) {
    return race?.rules === 'timeattack' && manual(me) && me.id === this.#playerId
      && sameIdentity(this.#identity, identityOf(race, me));
  }
  #capture(race, me, force) {
    if (!this.#matches(race, me)) return this.#stop('identity-or-control-changed');
    const time = race.time;
    if (!finite(time) || time > GHOST_MAX_SECONDS) return this.#stop('duration-limit');
    if (this.#lastSeen !== null && time < this.#lastSeen - EPSILON) return this.#stop('time-reversed');
    this.#lastSeen = time;
    if (time < 0 || (!force && race.status === 'countdown')) return false;
    if ((!force && race.status !== 'racing') || (force && !['racing', 'finished'].includes(race.status))) return false;
    const row = poseRow(race, me);
    if (!row) return this.#stop('invalid-pose');
    const previous = this.#samples.at(-1);
    if (!previous && time > FIRST_SAMPLE_LIMIT) return this.#stop('late-first-sample');
    if (previous) {
      const gap = row[0] - previous[0];
      if (gap > MAX_GAP + EPSILON) return this.#stop('capture-gap');
      if (gap < -EPSILON) return this.#stop('time-reversed');
      if (gap === 0) {
        if (force) this.#samples[this.#samples.length - 1] = row;
        return false;
      }
      if (!force && gap < INTERVAL - 1e-6) return false;
    }
    if (this.#samples.length >= GHOST_MAX_SAMPLES) return this.#stop('sample-limit');
    this.#samples.push(row);
    return true;
  }

  /** Returns true only when an actual pose is appended. Does not mutate inputs. */
  sample(race, me) {
    if (!this.#recording) return false;
    if (!this.#matches(race, me)) return this.#stop('identity-or-control-changed');
    if (this.#terminal) return false;
    if (me.finishTime !== null && me.finishTime !== undefined) {
      if (!finite(me.finishTime) || me.finishTime <= 0) return this.#stop('invalid-finish-time');
      const captured = this.#capture(race, me, true);
      if (!this.#recording) return false;
      const end = this.#samples.at(-1)?.[0];
      if (!finite(end) || end < me.finishTime - 1e-6 || end > me.finishTime + FINISH_SAMPLE_LIMIT) return this.#stop('missing-finish-pose');
      this.#terminal = true;
      this.#reason = 'awaiting-finish';
      return captured;
    }
    return this.#capture(race, me, false);
  }

  /** Returns true for an improved in-memory best, even if storage is unavailable. */
  finish(race, me) {
    if (!this.#recording) return false;
    if (!this.#matches(race, me)) return this.#stop('identity-or-control-changed');
    if (race.status !== 'finished') { this.#reason = 'awaiting-finish'; return false; }
    const result = {status: race.status, finishTime: me.finishTime, resultTime: me.resultTime,
      cleanLaps: me.cleanLaps, completedLaps: me.completedLaps, penaltyTime: me.penaltyTime};
    if (!validResult(result, this.#identity.laps)) return this.#stop('invalid-result');
    if (!this.#terminal) this.#capture(race, me, true);
    if (!this.#recording) return false;
    this.#recording = false;
    const record = {schemaVersion: GHOST_SCHEMA_VERSION, identity: {...this.#identity}, time: result.resultTime,
      result, samples: this.#samples.map(row => row.slice())};
    if (!validRecord(record, this.#identity)) return this.#stop('incomplete-recording');
    // Re-read to preserve a faster result saved by another tab since begin().
    const stored = this.#load();
    if (stored && (!this.#best || stored.time < this.#best.time)) this.#setBest(stored);
    if (this.#best && record.time >= this.#best.time) return this.#stop('not-faster');
    this.#setBest(record); this.#reason = 'personal-best'; this.#persist();
    return true;
  }

  playback(time) {
    if (!this.#best || !finite(time) || time < this.#best.samples[0][0] || time > this.#best.time
      || time > this.#best.samples.at(-1)[0]) return null;
    const rows = this.#best.samples;
    let lo = 0, hi = rows.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >>> 1;
      if (rows[mid][0] <= time) lo = mid; else hi = mid;
    }
    const a = rows[lo], b = rows[hi], fraction = (time - a[0]) / (b[0] - a[0]);
    const interpolated = a.map((value, index) => value + (b[index] - value) * fraction);
    interpolated[3] = wrap(a[3] + wrap(b[3] - a[3]) * fraction);
    return stateAt(interpolated, time);
  }

  progressDelta(s, time) {
    if (!this.#best || !this.#monotonicProgress || !finite(s) || !finite(time) || time < 0 || time > GHOST_MAX_SECONDS) return null;
    const rows = this.#best.samples;
    if (s < rows[0][4] || s > rows.at(-1)[4]) return null;
    let lo = 0, hi = rows.length - 1;
    // Lower bound finds the FIRST arrival at an exact position, including a
    // repeated start/end. Between positions it brackets the last departure from
    // the preceding stop and the next arrival, with strictly positive distance.
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (rows[mid][4] < s) lo = mid + 1; else hi = mid;
    }
    const b = rows[lo];
    let at = b[0];
    if (b[4] !== s) {
      const a = rows[lo - 1];
      at = a[0] + (s - a[4]) / (b[4] - a[4]) * (b[0] - a[0]);
    }
    // Never turn a post-finish pose into an apparent best-progress advantage.
    return at <= this.#best.result.finishTime ? time - at : null;
  }
}
