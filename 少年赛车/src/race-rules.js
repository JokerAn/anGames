/**
 * Race bookkeeping only: never integrates movement or changes steering/position.
 * Call init once after creating racers. Call update once per racer AFTER physics,
 * with race.time at the END of the frame and previous from BEFORE physics.
 * previous.offRoad is optional, but improves wheel-contact transition timing.
 * validLap means a clean, valid timed lap (including no impacts).
 * Ordered gates and missed-checkpoint state determine competition lap credit.
 * Returned events have no sequence IDs; the host owns eventSeq and presentation.
 */
import {ROAD_HALF} from './tracks.js';

const CHECKPOINT_COUNT = 8;
const OFF_ROAD_PENALTY_RATE = 2;
const OFF_ROAD_GRACE = .5;
const RESET_PENALTY = 3;
const WRONG_WAY_DELAY = 1.5;
const EPSILON = 1e-9;

export function initRaceRules(race, track) {
  if (!Number.isFinite(track.length) || track.length <= 0) throw new RangeError('Track length must be positive');
  race.laps = Number.isSafeInteger(race.laps) && race.laps > 0 ? race.laps : 2;
  race.checkpoints = Array.from({length: CHECKPOINT_COUNT}, (_, id) => ({id, s: id * track.length / CHECKPOINT_COUNT}));
  // Targets include the approach from the grid; average speeds are metres/second.
  const distance = track.length * race.laps + 12;
  race.targetTimes = {gold: distance / 40, silver: distance / 34, bronze: distance / 28};
  race.finishOrder = [];
  for (const racer of race.racers) {
    if (!Number.isFinite(racer.s)) racer.s = -12;
    Object.assign(racer, {
      nextCheckpoint: 0, checkpointsPassed: 0, completedLaps: 0, cleanLaps: 0,
      validLap: true, penaltyTime: 0, offTrackTime: 0, wrongWayTime: 0,
      resetCount: 0, lastCheckpointS: null,
      lap: 1, lapStart: 0, bestLap: null, finishTime: null, resultTime: null, medal: null,
      _nextCheckpointS: 0, _lapStarted: false, _cleanLap: true,
      _missedCheckpoint: false, _wrongWayWarned: false, _offTrackWarned: false,
    });
  }
}

function event(events, racer, type, text, time, extra = {}) {
  events.push({type, text, racer: racer.id, time, ...extra});
}

function missed(events, racer, time) {
  racer.validLap = false;
  racer._cleanLap = false;
  if (!racer._missedCheckpoint) {
    event(events, racer, 'checkpoint-missed', '漏过检查点，本圈无效；通过起点后重新计圈', time, {checkpoint: racer.nextCheckpoint});
    racer._missedCheckpoint = true;
  }
}

// Prefer physical road contact flags when wheel contact differs from centre x.
// Use the geometric sweep whenever it agrees with both endpoint flags. If flags
// change without a geometric edge crossing, only the endpoints are known: use a
// midpoint transition. Capture previous.offRoad for continuity in that fallback.
function roadSweep(previous, racer) {
  const oldOutside = Math.abs(previous.x) > ROAD_HALF;
  const newOutside = Math.abs(racer.x) > ROAD_HALF;
  const wasOutside = typeof previous.offRoad === 'boolean' ? previous.offRoad : oldOutside;
  const isOutside = typeof racer.offRoad === 'boolean' ? racer.offRoad : newOutside;
  if (wasOutside === oldOutside && isOutside === newOutside) return [previous.x, racer.x];
  return [ROAD_HALF + (wasOutside ? 1 : -1), ROAD_HALF + (isOutside ? 1 : -1)];
}

// Split at both road edges, so returning through the road renews grace even if
// a single frame begins and ends on opposite grass verges.
function roadSpans(x0, x1, from, to) {
  const cuts = [from, to];
  if (Math.abs(x1 - x0) > EPSILON) {
    for (const edge of [-ROAD_HALF, ROAD_HALF]) {
      const fraction = (edge - x0) / (x1 - x0);
      if (fraction > from && fraction < to) cuts.push(fraction);
    }
  }
  cuts.sort((a, b) => a - b);
  return cuts.slice(1).map((end, i) => ({
    from: cuts[i], to: end,
    outside: Math.abs(x0 + (x1 - x0) * (cuts[i] + end) / 2) > ROAD_HALF,
  }));
}

function sortResults(race) {
  const finished = race.racers.filter(racer => racer.finishTime !== null);
  for (const racer of finished) {
    racer.resultTime = racer.finishTime + racer.penaltyTime;
    if (race.rules === 'timeattack') {
      racer.medal = racer.cleanLaps >= race.laps
        ? ['gold', 'silver', 'bronze'].find(medal => racer.resultTime <= race.targetTimes[medal] + EPSILON) || 'none'
        : 'none';
    }
  }
  // A deterministic tie-break also makes simultaneous equal finishes order independent.
  finished.sort((a, b) => a.resultTime - b.resultTime || a.finishTime - b.finishTime || String(a.id).localeCompare(String(b.id)));
  race.finishOrder = finished.map(racer => racer.id);
  finished.forEach((racer, index) => { racer.rank = index + 1; });
}

/** Returns {type, text, racer, time, ...}[]; does not push into race.events. */
export function updateRaceRules(race, racer, track, previous, dt) {
  const events = [];
  if (racer.finishTime !== null || !Number.isFinite(dt) || dt <= 0 || !Number.isFinite(race.time) || race.time < 0) return events;
  const {s: oldS, x: oldX} = previous;
  if (![oldS, oldX, racer.s, racer.x].every(Number.isFinite)) return events;
  const frameStart = race.time - dt;
  const activeFrom = Math.max(0, -frameStart / dt);
  if (activeFrom >= 1) return events;
  const travel = racer.s - oldS;
  const speed = Math.max(Math.abs(previous.v || 0), Math.abs(racer.v || 0), Math.abs(racer.forwardSpeed || 0));
  // A generous acceleration allowance tolerates physics updates, but rejects a
  // position jump that would otherwise manufacture an entire ordered lap.
  const plausible = Math.abs(travel) <= speed * dt + 40 * dt * dt + 2;
  const reverse = travel < -dt || (Number.isFinite(racer.forwardSpeed) && racer.forwardSpeed < -1);
  const [roadX0, roadX1] = roadSweep(previous, racer);
  let cursor = activeFrom;

  function accrue(to) {
    if (to <= cursor) return;
    const start = cursor;
    for (const span of roadSpans(roadX0, roadX1, start, to)) {
      if (span.outside) {
        const before = racer.offTrackTime;
        racer.offTrackTime += (span.to - span.from) * dt;
        const penalized = Math.max(0, racer.offTrackTime - OFF_ROAD_GRACE) - Math.max(0, before - OFF_ROAD_GRACE);
        racer.penaltyTime += penalized * OFF_ROAD_PENALTY_RATE;
        racer.validLap = false;
        racer._cleanLap = false;
        if (!racer._offTrackWarned) {
          event(events, racer, 'off-track', '驶出赛道，当前圈不计干净圈；持续越界将罚时', frameStart + span.from * dt, {penaltyRate: OFF_ROAD_PENALTY_RATE, grace: OFF_ROAD_GRACE});
          racer._offTrackWarned = true;
        }
      } else {
        racer.offTrackTime = 0;
        racer._offTrackWarned = false;
      }
    }
    if (Math.abs(roadX0 + (roadX1 - roadX0) * to) <= ROAD_HALF) {
      racer.offTrackTime = 0;
      racer._offTrackWarned = false;
    }
    const span = to - start;
    if (racer.impactThisStep) {
      racer.validLap = false;
      racer._cleanLap = false;
    }
    if (reverse) {
      const before = racer.wrongWayTime;
      racer.wrongWayTime += span * dt;
      if (racer.wrongWayTime >= WRONG_WAY_DELAY && !racer._wrongWayWarned) {
        event(events, racer, 'wrong-way', '正在逆行，请自行转向返回赛道方向', frameStart + start * dt + Math.max(0, WRONG_WAY_DELAY - before));
        racer._wrongWayWarned = true;
      }
    } else {
      racer.wrongWayTime = 0;
      racer._wrongWayWarned = false;
    }
    cursor = to;
  }

  if (!plausible) {
    missed(events, racer, Math.max(0, frameStart));
    accrue(1);
    return events;
  }
  if (travel <= 0 || (Number.isFinite(racer.forwardSpeed) && racer.forwardSpeed < -EPSILON)) {
    accrue(1);
    return events;
  }

  const spacing = track.length / CHECKPOINT_COUNT;
  const activeS = oldS + travel * activeFrom;
  // Checking the previous position catches missing snapshots/teleports that did
  // not include the required gate in the reported movement segment.
  if (activeS > racer._nextCheckpointS + EPSILON) missed(events, racer, Math.max(0, frameStart));
  let gateIndex = Math.floor(activeS / spacing) + 1;
  // Exact t=0 crossings are allowed on the first active frame, once only.
  if (!racer._lapStarted && activeS === 0 && racer._nextCheckpointS === 0) gateIndex = 0;
  for (; gateIndex * spacing <= racer.s + EPSILON; gateIndex++) {
    const gateS = gateIndex * spacing;
    const fraction = Math.max(activeFrom, Math.min(1, (gateS - oldS) / travel));
    accrue(fraction);
    const crossedAt = Math.max(0, frameStart + fraction * dt);
    const x = roadX0 + (roadX1 - roadX0) * fraction;
    const checkpoint = ((gateIndex % CHECKPOINT_COUNT) + CHECKPOINT_COUNT) % CHECKPOINT_COUNT;
    if (gateS < racer._nextCheckpointS - EPSILON) continue; // Previously earned, including after reversing.
    if (Math.abs(x) > ROAD_HALF || Math.abs(gateS - racer._nextCheckpointS) > EPSILON) {
      missed(events, racer, crossedAt);
      // Only an in-road start-line crossing can begin a new attempt.
      if (checkpoint !== 0 || Math.abs(x) > ROAD_HALF) continue;
    }
    if (checkpoint === 0) {
      if (racer._lapStarted) {
        const lapTime = crossedAt - racer.lapStart;
        if (!racer._missedCheckpoint && racer.checkpointsPassed === CHECKPOINT_COUNT && Math.abs(gateS - racer._nextCheckpointS) <= EPSILON) {
          racer.completedLaps++;
          const clean = racer.validLap && racer._cleanLap;
          if (clean) racer.cleanLaps++;
          if (clean && lapTime > 0) racer.bestLap = racer.bestLap === null ? lapTime : Math.min(racer.bestLap, lapTime);
          racer.lap = Math.min(race.laps, racer.completedLaps + 1);
          event(events, racer, 'lap', `完成第 ${racer.completedLaps} 圈`, crossedAt, {lap: racer.completedLaps, lapTime, clean});
          if (racer.completedLaps >= race.laps) {
            racer.finishTime = crossedAt;
            racer.lastCheckpointS = gateS;
            sortResults(race);
            event(events, racer, 'finish', '冲过终点！', crossedAt, {finishTime: racer.finishTime, resultTime: racer.resultTime, medal: racer.medal});
            return events;
          }
        } else {
          event(events, racer, 'invalid-lap', '本圈无效，通过全部检查点后重新计圈', crossedAt);
        }
      }
      racer._lapStarted = true;
      racer.lapStart = crossedAt;
      racer.validLap = !racer.impactThisStep;
      racer._cleanLap = racer.validLap;
      racer._missedCheckpoint = false;
      racer.checkpointsPassed = 1;
    } else {
      racer.checkpointsPassed++;
    }
    racer.lastCheckpointS = gateS;
    racer.nextCheckpoint = (checkpoint + 1) % CHECKPOINT_COUNT;
    racer._nextCheckpointS = gateS + spacing;
    event(events, racer, 'checkpoint', `通过检查点 ${checkpoint + 1}/${CHECKPOINT_COUNT}`, crossedAt, {checkpoint, s: gateS});
  }
  accrue(1);
  return events;
}

/**
 * The caller applies this track-local pose and synchronizes world coordinates.
 * A reset dirties the current lap and preserves already-earned checkpoints.
 * Reset clears the missed attempt so remaining gates can complete this lap.
 * Ordered competition progress can still count; clean-lap/medal credit cannot.
 */
export function resetRaceRacer(race, racer, track) {
  if (racer.finishTime === null) {
    racer.penaltyTime += RESET_PENALTY;
    racer.resetCount++;
    racer.validLap = false;
    racer._cleanLap = false;
    racer._missedCheckpoint = false;
    racer.offTrackTime = 0;
    racer.wrongWayTime = 0;
    racer._wrongWayWarned = false;
    racer._offTrackWarned = false;
  }
  const offset = Math.min(2, track.length / CHECKPOINT_COUNT / 2);
  return {s: racer.lastCheckpointS === null ? -12 : racer.lastCheckpointS + offset, x: 0, headingError: 0, v: 0};
}
