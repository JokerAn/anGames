export const CARS = [
  {id: 'comet', name: '流星 GT', tag: '均衡跑车', color: '#ff6940', speed: 1, accel: 1, grip: 1, mass: 1, stats: [82, 82, 85]},
  {id: 'bolt', name: '闪电 R', tag: '轻量方程式', color: '#4de4d3', speed: 1.04, accel: 1.12, grip: 1.14, mass: .76, stats: [90, 96, 95]},
  {id: 'titan', name: '泰坦 X', tag: '重装越野', color: '#b8a3ff', speed: .96, accel: .91, grip: .91, mass: 1.5, stats: [75, 73, 98]},
];
export const ENGINES = [
  {id: 'balanced', name: '街道 V6', tag: '均衡 · 容易上手', speed: 1, accel: 1, nitro: 1},
  {id: 'turbo', name: '涡轮 V8', tag: '极速 +12% · 起步稍慢', speed: 1.12, accel: .83, nitro: .88},
  {id: 'electric', name: '电驱 E', tag: '加速 +25% · 氮气更持久', speed: .96, accel: 1.25, nitro: 1.25},
];
export const TRACKS = [
  {id: 'coast', name: '晴空海岸', tag: 'COASTLINE', desc: '海风、棕榈与连续急弯', difficulty: '入门', color: '#4de4d3', sky: '#b9dced', ground: '#d5c99e', road: '#36495b', radius: [175, 128], wave: 13, hills: 2.5, theme: 'coast'},
  {id: 'canyon', name: '溪涧小路', tag: 'CREEK PASS', desc: '山谷溪流、发夹弯与窄桥', difficulty: '进阶', color: '#ffac68', sky: '#ecd0af', ground: '#af7657', road: '#544b50', radius: [157, 134], wave: 36, hills: 8, theme: 'creek'},
  {id: 'neon', name: '赛博夜城', tag: 'CYBER CITY', desc: '霓虹、光轨与高速对决', difficulty: '挑战', color: '#b8a3ff', sky: '#0b1030', ground: '#141a30', road: '#2b3350', radius: [165, 145], wave: 27, hills: 4, theme: 'cyber'},
];
export const ROAD_HALF = 9;
// The rendered crate and pickup sweep share dimensions; extra reach includes the car body.
export const PICKUP_BOX = {size: 1.5, halfWidth: 2.25, halfLength: 3.2, respawnSeconds: 3};
export const mod = (x, n) => ((x % n) + n) % n;
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const cache = new Map();
export function getTrack(id = 'coast') {
  if (cache.has(id)) return cache.get(id);
  const config = TRACKS.find(t => t.id === id) || TRACKS[0];
  const points = [], cumulative = [0], count = 1440;
  // A longer lap with two deliberately complex sections: a chicane cluster at
  // ~30% and a wide sweeping esses complex at ~68%. Both add extra radius wobble
  // (tight turns) and hill variation so they read as technical, not flat.
  //
  // Wobble frequency is bounded by the sampling rate. With `count` points over
  // 2π, the phase step per point is 2π*freq/count; keeping freq <= ~count/12
  // stops the centreline from doubling back on itself (which tears the road).
  const hasFeatures = config.features !== false;
  for (let i = 0; i <= count; i++) {
    const a = i / count * Math.PI * 2;
    let r = config.wave * Math.sin(3 * a);
    let y = 2 + config.hills * (1 + Math.sin(2 * a));
    if (hasFeatures) {
      // Chicane: rapid, tighter left-right flicks around the 30% mark.
      const chic = Math.exp(-((a - 1.9) ** 2) / .05);
      r += chic * 20 * Math.sin(a * 11);
      y += chic * config.hills * 1.6 * Math.cos(a * 9);
      // Esses: a long, widening sweep of linked corners near 68%.
      const ess = Math.exp(-((a - 4.25) ** 2) / .16);
      r += ess * 24 * Math.sin(a * 7);
      y += ess * config.hills * 1.1 * Math.sin(a * 6);
      // A short climb-and-crest to break up the flat run down the far side.
      const crest = Math.exp(-((a - 5.6) ** 2) / .04);
      y += crest * Math.max(6, config.hills) * 2.2;
    }
    const p = {x: (config.radius[0] + r) * Math.cos(a), z: (config.radius[1] + r) * Math.sin(a), y};
    points.push(p);
    if (i) cumulative.push(cumulative[i - 1] + Math.hypot(p.x - points[i-1].x, p.z - points[i-1].z));
  }
  const length = cumulative[count];
  function sample(distance, lateral = 0) {
    const s = mod(distance, length);
    let lo = 0, hi = count;
    while (lo + 1 < hi) {const mid = (lo + hi) >> 1; if (cumulative[mid] <= s) lo = mid; else hi = mid;}
    const p = points[lo], q = points[lo+1], f = (s - cumulative[lo]) / (cumulative[lo+1] - cumulative[lo]);
    const dx = q.x - p.x, dz = q.z - p.z, norm = Math.hypot(dx, dz);
    return {x: p.x + dx * f + dz / norm * lateral, y: p.y + (q.y-p.y)*f, z: p.z + dz*f - dx/norm*lateral, yaw: Math.atan2(dx, dz), nx: dz/norm, nz: -dx/norm};
  }
  function curvature(s) {let d = sample(s + 7).yaw - sample(s - 7).yaw; d = mod(d + Math.PI, Math.PI * 2) - Math.PI; return d / 14;}
  const objects = [];
  for (let i = 0; i < 12; i++) {
    const s = length * (.065 + i * .075);
    objects.push({id: `box${i}`, type: 'box', s, x: [-5, 0, 5][i%3], width: 1.7});
    if (i%2 === 0) objects.push({id: `boost${i}`, type: 'boost', s: s + 26, x: i%4 ? 4 : -4, width: 2.6});
    objects.push({id: `barrier${i}`, type: i%3 === 0 ? 'oil' : 'barrier', s: s + 46, x: [3, -4, 0, 5, -5][i%5], width: i%3 === 0 ? 2.1 : 1.7});
  }
  const result = {...config, length, sample, curvature, objects, points}; cache.set(id, result); return result;
}
export function shortDistance(a, b, length) {return mod(a - b + length/2, length) - length/2;}
