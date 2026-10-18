import test from 'node:test';
import assert from 'node:assert/strict';
import {RaceHud, renderRaceSummary} from '../src/race-hud.js';

test('HUD tolerates absent DOM, missing corners and incomplete network state', () => {
  const hud = new RaceHud();
  for (const input of [undefined, null, {}, {status:'racing'}, {time:NaN, status:'finished', checkpoints:[]}]) {
    assert.doesNotThrow(() => hud.sync(input, {}, null));
  }
  assert.doesNotThrow(() => hud.sync({status:'racing', time:2, laps:2, checkpoints:[1, 2]}, {id:'you', nextCheckpoint:Infinity, penaltyTime:NaN, wrongWayTime:Infinity}, {}, {direction:'unknown', distance:NaN, speed:Infinity}));
  assert.doesNotThrow(() => hud.results(null, null));
  assert.doesNotThrow(() => hud.results({rules:'circuit', racers:[]}, {}));
  assert.doesNotThrow(() => renderRaceSummary({rules:'timeattack', status:'finished'}, {finishTime:null, resultTime:null}));
  hud.destroy();
  hud.destroy();
});

test('HUD keeps simulation and racer state read-only', () => {
  const race = Object.freeze({time:10, status:'racing', rules:'circuit', laps:2, checkpoints:Object.freeze([1, 2, 3])});
  const me = Object.freeze({id:'you', nextCheckpoint:2, completedLaps:1, validLap:false, penaltyTime:4, v:40, wrongWayTime:1, resetCount:2});
  const corner = Object.freeze({direction:'left', distance:70, speed:15, severity:'hairpin'});
  const hud = new RaceHud({onReset:null, onRestart:null});
  assert.doesNotThrow(() => hud.sync(race, me, Object.freeze({}), corner));
  assert.equal(me.v, 40);
  assert.equal(me.penaltyTime, 4);
  assert.equal(race.time, 10);
  hud.destroy();
});

function hudDocument(t) {
  class Element {
    constructor() { this.children = []; this.dataset = {}; this.style = {}; this.attributes = {}; this.hidden = false; this.text = ''; }
    set textContent(value) { this.text = String(value); this.children = []; }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.text = ''; this.children = children; }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener() {}
    removeEventListener() {}
  }
  const ids = ['racer-count', 'checkpoint-progress', 'checkpoint-meter', 'checkpoint-fill', 'completed-laps', 'valid-lap-state', 'lap-integrity', 'race-warning', 'result-list', 'timeattack-feedback', 'result-title', 'corner-advice', 'race-guide', 'ghost-comparison', 'ghost-delta', 'ghost-label', 'ghost-toggle'];
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  const savedDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const savedStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const records = new Map();
  Object.defineProperty(globalThis, 'document', {configurable:true, value:{getElementById:id => elements[id] || null, createElement:() => new Element()}});
  Object.defineProperty(globalThis, 'localStorage', {configurable:true, value:{getItem:key => records.get(key) ?? null, setItem:(key,value) => records.set(key,value)}});
  t.after(() => {
    if (savedDocument) Object.defineProperty(globalThis, 'document', savedDocument); else delete globalThis.document;
    if (savedStorage) Object.defineProperty(globalThis, 'localStorage', savedStorage); else delete globalThis.localStorage;
  });
  return {elements, records};
}

const hudRace = (rules = 'circuit') => ({trackId:'hud-test', time:10, status:'racing', rules, laps:2, checkpoints:Array.from({length:8}, (_, i) => i)});
const finishedDriver = extra => ({id:'you', name:'车手', finishTime:100, resultTime:103, penaltyTime:3, completedLaps:2, ...extra});

test('checkpoint counts prefer checkpointsPassed, then checks, then legacy index', t => {
  const {elements} = hudDocument(t), hud = new RaceHud(), race = hudRace();
  for (const [me, passed] of [
    [{checkpointsPassed:0, checks:5, nextCheckpoint:7}, 0],
    [{checkpointsPassed:1, nextCheckpoint:1}, 1],
    [{checkpointsPassed:8, nextCheckpoint:0}, 8],
    [{checks:8, nextCheckpoint:0}, 8],
    [{checkpointsPassed:NaN, checks:3, nextCheckpoint:7}, 3],
    [{nextCheckpoint:4}, 4],
    [{checkpointsPassed:99}, 8],
    [{checkpointsPassed:-1}, 0],
  ]) {
    hud.sync(race, me);
    assert.equal(elements['checkpoint-progress'].textContent, `检查点 ${passed} / 8`);
    assert.equal(elements['checkpoint-meter'].attributes['aria-valuenow'], String(Math.round(passed / 8 * 100)));
  }
  hud.destroy();
});

test('dirty laps show neutral fastest-lap guidance, while explicit warnings take priority', t => {
  const {elements} = hudDocument(t), hud = new RaceHud(), race = hudRace();
  const dirty = {id:'you', validLap:false};
  hud.sync(race, dirty);
  assert.equal(elements['race-warning'].textContent, '本圈不计最快圈；请依次过检查点');
  assert.doesNotMatch(elements['race-warning'].textContent, /漏点|越界/);
  for (const flag of ['_missedCheckpoint', 'checkpointMissed', 'missedCheckpoint']) {
    hud.sync(race, {...dirty, [flag]:true});
    assert.match(elements['race-warning'].textContent, /漏过检查点/);
  }
  hud.sync(race, {...dirty, _missedCheckpoint:true, offTrackTime:1});
  assert.match(elements['race-warning'].textContent, /^越界/);
  hud.sync(race, {...dirty, _missedCheckpoint:true, offTrackTime:1, wrongWayTime:1});
  assert.match(elements['race-warning'].textContent, /^逆行/);
  hud.destroy();
});

test('circuit and arcade count dirty completed laps and retain their penalized result', t => {
  const {elements, records} = hudDocument(t), hud = new RaceHud();
  for (const rules of ['circuit', 'arcade']) {
    const me = finishedDriver({validLap:false, cleanLaps:0}), race = {...hudRace(rules), racers:[me], status:'finished'};
    hud.sync(race, me);
    assert.equal(elements['completed-laps'].textContent, '完成圈 2 / 2');
    hud.results(race, me);
    assert.equal(elements['result-list'].children.length, 1);
    assert.match(elements['result-list'].textContent, /有效成绩01:43.00/);
    assert.equal(elements['timeattack-feedback'].hidden, true);
  }
  assert.equal(records.size, 0);
  hud.destroy();
});

test('timeattack rejects insufficient clean laps even when resultTime is numeric', t => {
  const {elements, records} = hudDocument(t), hud = new RaceHud();
  for (const cleanLaps of [0, 1, NaN]) {
    const me = finishedDriver({cleanLaps}), race = {...hudRace('timeattack'), status:'finished', racers:[me]};
    hud.results(race, me);
    assert.equal(elements['result-list'].children.length, 1);
    assert.match(elements['result-list'].textContent, /无有效成绩/);
    assert.match(elements['timeattack-feedback'].textContent, /没有有效成绩/);
    assert.equal(records.size, 0);
  }
  hud.destroy();
});

test('a slow clean solo timeattack earns a PB without a medal and keeps exactly one result row', t => {
  const {elements, records} = hudDocument(t), hud = new RaceHud();
  const me = finishedDriver({finishTime:300, resultTime:303, cleanLaps:2, medal:'none'});
  const race = {...hudRace('timeattack'), status:'finished', racers:[me]};
  hud.sync(race, me);
  assert.equal(elements['completed-laps'].textContent, '干净圈 2 / 2');
  hud.results(race, me);
  assert.equal(elements['result-list'].children.length, 1);
  assert.match(elements['result-list'].textContent, /有效成绩05:03.00/);
  assert.match(elements['timeattack-feedback'].textContent, /未获奖牌.*首次有效完赛.*个人最佳 05:03.00/);
  assert.deepEqual([...records.values()], ['303']);
  const dirty = finishedDriver({finishTime:200, resultTime:200, cleanLaps:1});
  hud.results({...race, racers:[dirty]}, dirty);
  assert.deepEqual([...records.values()], ['303'], 'A faster dirty run must not replace the clean PB');
  hud.destroy();
});

test('legacy timeattack state without cleanLaps remains supported, explicit null result remains invalid', t => {
  const {elements, records} = hudDocument(t), hud = new RaceHud();
  const legacy = finishedDriver(), race = {...hudRace('timeattack'), status:'finished', racers:[legacy]};
  hud.results(race, legacy);
  assert.match(elements['timeattack-feedback'].textContent, /个人最佳/);
  assert.equal(records.size, 1);
  const invalid = finishedDriver({cleanLaps:2, resultTime:null});
  hud.results({...race, racers:[invalid]}, invalid);
  assert.match(elements['result-list'].textContent, /无有效成绩/);
  assert.deepEqual([...records.values()], ['103']);
  hud.destroy();
});


test('position count follows the roster for solo timeattack, dual timing and full-grid races', t => {
  const {elements} = hudDocument(t), hud = new RaceHud();
  for (const [rules, count] of [['timeattack', 1], ['timeattack', 2], ['circuit', 6], ['arcade', 6]]) {
    hud.sync({...hudRace(rules), racers:Array.from({length:count}, (_, i) => ({id:String(i)}))}, {id:'0'});
    assert.equal(elements['racer-count'].textContent, String(count));
  }
  hud.sync(hudRace(), {id:'you'});
  assert.equal(elements['racer-count'].textContent, '—');
  hud.destroy();
});


test('timeattack headlines describe the earned challenge result instead of declaring a one-car championship',t=>{
 const {elements}=hudDocument(t);
 for(const [extra,title] of [[{cleanLaps:2,medal:'silver'},'银牌 · 时间挑战完成'],[{cleanLaps:2,medal:'none'},'挑战完成 · 未获奖牌'],[{cleanLaps:0,medal:'none'},'挑战未达标'],[{finishTime:null,resultTime:null,cleanLaps:0},'本场未完赛']]){
  const me=finishedDriver(extra),race={...hudRace('timeattack'),status:'finished',racers:[me]};elements['result-title'].textContent='P1 · 本场冠军';renderRaceSummary(race,me);assert.equal(elements['result-title'].textContent,title);
 }
});

test('distance-based braking guidance does not demand braking throughout a distant bend approach',t=>{
 const {elements}=hudDocument(t),hud=new RaceHud(),race=hudRace();
 for(const [cue,message,brake] of [[{brakeNow:false,brakeIn:70,phase:'approach'},/70.*米.*减速/,false],[{brakeNow:false,brakeIn:18,phase:'prepare'},/准备.*减速/,false],[{brakeNow:true,brakeIn:-4,phase:'brake'},/现在刹车/,true]]){
  hud.sync(race,{id:'you',v:45},{},{direction:'left',distance:100,speed:20,severity:'tight',...cue});assert.match(elements['corner-advice'].textContent,message);assert.equal(elements['race-guide'].dataset.brake,String(brake));
 }
 hud.destroy();
});

test('ghost comparison names a signed lead or deficit and cannot appear as an AI racer',t=>{
 const {elements}=hudDocument(t),hud=new RaceHud(),race={...hudRace('timeattack'),racers:[{id:'you'}]},me={id:'you',validLap:true};
 assert.equal(typeof hud.syncGhost,'function');hud.sync(race,me);
 hud.syncGhost({bestTime:93.2,delta:-.42,enabled:true});assert.equal(elements['ghost-comparison'].hidden,false);assert.match(elements['ghost-delta'].textContent,/领先.*0.42/);assert.equal(elements['ghost-toggle'].attributes['aria-pressed'],'true');
 hud.syncGhost({bestTime:93.2,delta:1.08,enabled:false});assert.match(elements['ghost-delta'].textContent,/落后.*1.08/);assert.equal(elements['ghost-toggle'].attributes['aria-pressed'],'false');
 hud.syncGhost({bestTime:null,delta:null,enabled:true});assert.equal(elements['ghost-toggle'].disabled,true);assert.match(elements['ghost-delta'].textContent,/干净完赛/);
 hud.sync(race,{...me,validLap:false});hud.syncGhost({bestTime:93.2,delta:2,enabled:true});assert.equal(elements['ghost-comparison'].hidden,true);
 hud.sync({...race,rules:'circuit'},me);hud.syncGhost({bestTime:93.2,delta:-1,enabled:true});assert.equal(elements['ghost-comparison'].hidden,true);assert.equal(race.racers.length,1);
 hud.destroy();
});
