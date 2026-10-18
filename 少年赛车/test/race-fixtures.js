import assert from 'node:assert/strict';
import {getTrack} from '../src/tracks.js';
import {syncVehiclePose} from '../src/driving.js';
import {updateRaceRules} from '../src/race-rules.js';

// Earn ordered gates through bounded, timed road segments. This prepares race
// bookkeeping only; each test's decisive contact/crossing still uses stepRace.
export function earnRaceProgress(race, targets, speed = 40) {
  const track = getTrack(race.trackId), events = [];
  assert.ok(speed > 0 && speed <= 60);
  for (const [racer, target] of targets) {
    assert.ok(target >= racer.s);
    Object.assign(racer, {x: 0, v: speed, forwardSpeed: speed, offRoad: false, impactThisStep: false});
  }
  while (targets.some(([racer, target]) => target - racer.s > 1e-8)) {
    const dt = Math.min(.25, Math.max(...targets.map(([racer, target]) => (target - racer.s) / speed)));
    race.time += dt;
    for (const [racer, target] of targets) {
      const previous = {s: racer.s, x: racer.x, v: racer.v, offRoad: false};
      racer.s = Math.min(target, racer.s + speed * dt);
      events.push(...updateRaceRules(race, racer, track, previous, dt));
    }
  }
  for (const [racer, target] of targets) {
    assert.equal(racer.completedLaps, Math.floor(target / track.length));
    assert.equal(racer.validLap, true);
    assert.equal(racer.finishTime, null);
    syncVehiclePose(racer, track);
  }
  return events;
}
