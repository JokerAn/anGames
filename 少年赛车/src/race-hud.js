/** Manual-driving presentation only. The race simulation owns every rule and input. */
const number = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const positive = value => Math.max(0, number(value));
const finiteTime = value => Number.isFinite(value) && value >= 0;
const byId = id => typeof document === 'undefined' ? null : document.getElementById(id);
const put = (id, value) => { const element = byId(id); if (element && element.textContent !== value) element.textContent = value; };
const clock = value => {
  if (!finiteTime(value)) return '—';
  const centiseconds = Math.floor(value * 100 + 1e-6);
  return `${String(Math.floor(centiseconds / 6000)).padStart(2, '0')}:${String(Math.floor(centiseconds / 100) % 60).padStart(2, '0')}.${String(centiseconds % 100).padStart(2, '0')}`;
};
const storage = {
  get(key) { try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; } },
  set(key, value) { try { globalThis.localStorage?.setItem(key, value); } catch { /* Driving also works without storage. */ } }
};
const COACH_KEY = 'junior-racers:manual-coach:v3';
const modes = {
  circuit: '手动油门 · 检查点 · 走线；按 Shift 主动使用氮气。',
  arcade: '加速带 · 火箭／冰冻 · 全部道具 · 主动氮气；脏圈照常计圈，罚时计入总成绩。',
  timeattack: '无碰撞干净圈 · 挑战奖牌；按 Shift 主动使用氮气，干净完赛可记个人最佳。'
};
const medals = {gold: '金牌', silver: '银牌', bronze: '铜牌', none: '未获奖牌'};
const resultFeedback = new WeakMap();

function resultOf(racer, race) {
  const raw = finiteTime(racer.finishTime) ? racer.finishTime : null;
  const penalty = positive(racer.penaltyTime);
  const enoughLaps = !Number.isFinite(racer.completedLaps) || racer.completedLaps >= number(race.laps, 2);
  const enoughCleanLaps = race.rules !== 'timeattack' || racer.cleanLaps == null
    || (Number.isFinite(racer.cleanLaps) && racer.cleanLaps >= number(race.laps, 2));
  // An explicit null resultTime is authoritative: it must never become a valid score.
  const total = raw !== null && enoughLaps && enoughCleanLaps
    ? ('resultTime' in racer ? (finiteTime(racer.resultTime) ? racer.resultTime : null) : raw + penalty)
    : null;
  return {raw, penalty, total};
}

function personalBest(race, me, total) {
  let cache = resultFeedback.get(race);
  if (cache?.has(me.id)) return cache.get(me.id);
  const key = `junior-racers:timeattack-best:v3:${JSON.stringify([race.trackId || '', race.laps || 2, me.car || '', me.engine || '', race.difficulty || 'normal'])}`;
  const saved = storage.get(key), previous = saved === null ? null : Number(saved);
  const best = finiteTime(previous) && previous > 0 ? previous : null;
  if (race.status !== 'finished') return best === null ? '完赛后记录个人最佳' : `个人最佳 ${clock(best)}`;
  const improved = best === null || total < best;
  if (improved) storage.set(key, String(total));
  const message = best === null ? `首次有效完赛 · 个人最佳 ${clock(total)}`
    : improved ? `刷新个人最佳 ${clock(total)} · 快了 ${(best - total).toFixed(2)} 秒`
      : `个人最佳 ${clock(best)} · 本次慢了 ${(total - best).toFixed(2)} 秒`;
  if (!cache) { cache = new Map(); resultFeedback.set(race, cache); }
  cache.set(me.id, message);
  return message;
}

/** Call after the existing result list is built, before opening the result dialog. */
export function renderRaceSummary(race, me) {
  if (!race || !me) return;
  const list = byId('result-list'), feedback = byId('timeattack-feedback');
  const mine = resultOf(me, race);
  if(race.rules==='timeattack'){
    put('result-title',mine.raw===null?'本场未完赛':mine.total===null?'挑战未达标':me.medal&&me.medal!=='none'?`${medals[me.medal]||'完成'} · 时间挑战完成`:'挑战完成 · 未获奖牌');
  }
  if (feedback) {
    feedback.hidden = race.rules !== 'timeattack';
    if (!feedback.hidden) {
      feedback.dataset.medal = Object.hasOwn(medals, me.medal) ? me.medal : 'none';
      feedback.textContent = mine.total === null ? '本次没有有效成绩 · 完成全部无碰撞干净圈后再挑战'
        : `${medals[me.medal] || '完成挑战'} · ${personalBest(race, me, mine.total)}`;
    }
  }
  if (!list) return;
  const racers = (Array.isArray(race.racers) ? race.racers : [me]).filter(r => r && typeof r === 'object');
  const ordered = [...racers].sort((a, b) => {
    const av = resultOf(a, race).total ?? Infinity, bv = resultOf(b, race).total ?? Infinity;
    return av - bv || number(a.rank, Infinity) - number(b.rank, Infinity);
  });
  const rows = ordered.map((racer, index) => {
    const result = resultOf(racer, race), row = document.createElement('article');
    row.className = `result-row detailed-result${racer.id === me.id ? ' me' : ''}`;
    const rank = document.createElement('b'); rank.textContent = result.total === null ? '—' : String(index + 1);
    const content = document.createElement('div'); content.className = 'result-details';
    const name = document.createElement('strong'); name.className = 'result-driver';
    name.textContent = `${racer.name || '车手'}${racer.id === me.id ? '（你）' : ''}`;
    const timing = document.createElement('dl'); timing.className = 'result-timing';
    for (const [label, value] of [['原始用时', clock(result.raw)], ['罚时', `+${result.penalty.toFixed(2)} 秒`], ['有效成绩', result.total === null ? (result.raw === null ? '未完赛' : '无有效成绩') : clock(result.total)]]) {
      const cell = document.createElement('div'), term = document.createElement('dt'), description = document.createElement('dd');
      term.textContent = label; description.textContent = value; cell.append(term, description); timing.append(cell);
    }
    content.append(name, timing); row.append(rank, content); return row;
  });
  list.replaceChildren(...rows);
}

export class RaceHud {
  constructor({onReset = () => {}, onRestart = () => {}, onGhost = () => {}} = {}) {
    this.onReset = typeof onReset === 'function' ? onReset : () => {};
    this.onRestart = typeof onRestart === 'function' ? onRestart : () => {};
    this.onGhost=typeof onGhost==='function'?onGhost:()=>{};
    this.listeners = [];
    this.race = null;
    this.playerId = null;
    this.lastTime = null;
    this.resetPendingUntil = 0;
    this.coachSeen = storage.get(COACH_KEY) === '1';
    const automatic = byId('auto-throttle');
    if (automatic) { automatic.checked = false; automatic.disabled = true; automatic.hidden = true; }
    this.bind(byId('race-reset'), 'click', () => {
      if (byId('race-reset')?.disabled) return;
      // A brief click guard prevents a double tap from requesting two resets.
      this.resetPendingUntil = Date.now() + 700;
      if (byId('race-reset')) byId('race-reset').disabled = true;
      this.onReset();
    });
    this.bind(byId('ghost-toggle'),'click',()=>this.onGhost());
    this.bind(byId('ghost-toggle'),'keydown',event=>{if(event.code==='Space'||event.code==='Enter')event.stopPropagation();});
    this.bind(byId('hud-restart'), 'click', () => this.onRestart());
    this.bind(byId('dismiss-driving-coach'), 'click', () => this.dismissCoach());
    this.bind(byId('rules'), 'change', () => this.updateModeNote());
    this.updateModeNote();
  }

  bind(element, event, listener) {
    if (!element) return;
    element.addEventListener(event, listener);
    this.listeners.push(() => element.removeEventListener(event, listener));
  }

  updateModeNote() {
    const rules = byId('rules')?.value;
    put('rules-note', modes[rules] || modes.circuit);
    put('solo-racers-note', rules === 'timeattack' ? '无 AI' : '1 人 + 5 AI');
    put('lan-racers-note', rules === 'timeattack' ? '双人计时' : '2 人 + 4 AI');
  }

  dismissCoach() {
    this.coachSeen = true;
    storage.set(COACH_KEY, '1');
    if (byId('driving-coach')) byId('driving-coach').hidden = true;
  }

  /** corner.speed is metres/second; all displayed speeds are kilometres/hour. */
  sync(race, me, track, corner) {
    if (!race || !me) return;
    put('racer-count', Array.isArray(race.racers) && race.racers.length ? String(race.racers.length) : '—');
    const time = number(race.time);
    const newRace = !this.race || race.trackId !== this.race.trackId || me.id !== this.playerId || (this.lastTime !== null && time < this.lastTime - 1);
    if (newRace) this.resetPendingUntil = 0;
    this.race = race;
    this.playerId = me.id;
    this.lastTime = time;
    const racing = race.status === 'racing';
    const finished = finiteTime(me.finishTime) || race.status === 'finished';
    const reset = byId('race-reset');
    if (reset) reset.disabled = !racing || finished || Date.now() < this.resetPendingUntil;
    const coach = byId('driving-coach');
    if (coach) {
      if (racing && time >= 7 && !this.coachSeen) this.dismissCoach();
      coach.hidden = this.coachSeen || finished || !['countdown', 'racing'].includes(race.status);
    }
    const checkpointCount = Array.isArray(race.checkpoints) ? race.checkpoints.length : 0;
    // nextCheckpoint wraps to zero after the last gate; prefer the explicit count.
    const passedCount = Number.isFinite(me.checkpointsPassed) ? me.checkpointsPassed
      : Number.isFinite(me.checks) ? me.checks : me.nextCheckpoint;
    const passed = Math.min(checkpointCount, Math.floor(positive(passedCount)));
    put('checkpoint-progress', checkpointCount ? `检查点 ${Math.floor(passed)} / ${checkpointCount}` : '检查点待确认');
    const percent = checkpointCount ? Math.round(passed / checkpointCount * 100) : 0;
    const meter = byId('checkpoint-meter'), fill = byId('checkpoint-fill');
    if (meter) { meter.setAttribute('aria-valuenow', String(percent)); meter.setAttribute('aria-valuetext', checkpointCount ? `已通过 ${Math.floor(passed)} 个，共 ${checkpointCount} 个检查点` : '等待检查点信息'); }
    if (fill) fill.style.width = `${percent}%`;
    const timeattack = race.rules === 'timeattack';
    const lapCount = timeattack && Number.isFinite(me.cleanLaps) ? me.cleanLaps : me.completedLaps;
    put('completed-laps', `${timeattack ? '干净圈' : '完成圈'} ${Math.min(positive(lapCount), number(race.laps, 2))} / ${number(race.laps, 2)}`);
    put('penalty-time', `罚时 +${positive(me.penaltyTime).toFixed(2)} 秒`);
    const valid = me.validLap !== false;
    this.ghostEligible=timeattack&&!finished&&valid;
    put('valid-lap-state', finished ? '本场已结束' : race.status === 'countdown' ? '等待发车' : valid ? '本圈干净' : '非干净圈');
    const integrity = byId('lap-integrity');
    if (integrity) integrity.dataset.invalid = String(!valid);
    const warning = byId('race-warning');
    let message = '';
    if (racing && !finished) {
      if (me.wrongWay === true || positive(me.wrongWayTime) > .15) message = '逆行 · 减速，沿赛道方向行驶';
      else if (me.offTrack === true || positive(me.offTrackTime) > .15) message = '越界 · 减速驶回赛道，留意罚时';
      else if (me._missedCheckpoint === true || me.checkpointMissed === true || me.missedCheckpoint === true) message = '漏过检查点 · 按提示复位，重新通过';
      else if (!valid) message = '本圈不计最快圈；请依次过检查点';
    }
    if (warning) { if (warning.textContent !== message) warning.textContent = message; warning.hidden = !message; }
    const direction = ['left', 'right', 'straight'].includes(corner?.direction) ? corner.direction : 'straight';
    const usable = corner && Number.isFinite(corner.distance) && Number.isFinite(corner.speed) && corner.speed > 0;
    const severity = {hairpin: '发卡弯', tight: '急弯', medium: '中速弯', fast: '高速弯', straight: '直道'};
    put('corner-arrow', {left: '↰', right: '↱', straight: '↑'}[direction]);
    put('corner-title', usable ? (direction === 'straight' ? '前方直道' : `${direction === 'left' ? '左' : '右'}${severity[corner.severity] && corner.severity !== 'straight' ? severity[corner.severity] : '弯'}`) : '观察前方赛道');
    put('corner-distance', usable ? `${Math.round(positive(corner.distance))} 米` : '— 米');
    put('corner-speed', usable ? String(Math.round(corner.speed * 3.6)) : '—');
    const overspeed = usable && direction !== 'straight' && (typeof corner.brakeNow==='boolean'?corner.brakeNow:positive(me.v)>corner.speed*1.08);
    const guide = byId('race-guide');
    if (guide) { guide.dataset.brake = String(!!overspeed); guide.hidden = finished; }
    const planned=usable&&typeof corner.brakeNow==='boolean';
    if(guide)guide.dataset.phase=planned?corner.phase:'approach';
    put('corner-advice', !usable ? '入弯前松油门、刹车' : direction === 'straight' ? '观察前方，平稳加速' : planned
      ?corner.brakeNow?'现在刹车，再平稳转向':corner.phase==='prepare'?'准备减速，留出制动距离':positive(me.v)>corner.speed*1.03?`约 ${Math.max(0,Math.round(corner.brakeIn))} 米后减速`:'稳住方向，出弯再加速'
      :overspeed?'先刹车，再转向':'稳住方向，出弯再加速');
  }

  syncGhost({bestTime=null,delta=null,enabled=true}={}){
    const panel=byId('ghost-comparison'),button=byId('ghost-toggle'),available=finiteTime(bestTime)&&bestTime>0;
    if(panel)panel.hidden=!this.ghostEligible;
    if(button){button.disabled=!available;button.setAttribute('aria-pressed',String(available&&enabled));button.setAttribute('aria-label',enabled?'隐藏个人最佳幽灵车':'显示个人最佳幽灵车');button.textContent=available?enabled?'幽灵 开':'幽灵 关':'待解锁';}
    put('ghost-label',available?`最佳 ${clock(bestTime)}`:'个人最佳幽灵');
    put('ghost-delta',!available?'干净完赛后解锁':!Number.isFinite(delta)?'追赶上一场自己':Math.abs(delta)<.005?'与最佳齐平':`${delta<0?'领先':'落后'} ${Math.abs(delta).toFixed(2)} 秒`);
    if(panel)panel.dataset.advantage=Number.isFinite(delta)&&delta<-.005?'ahead':'behind';
  }

  results(race, me) { renderRaceSummary(race, me); }

  /** Release listeners if the application replaces its HUD instance. */
  destroy() { this.listeners.splice(0).forEach(remove => remove()); }
}
