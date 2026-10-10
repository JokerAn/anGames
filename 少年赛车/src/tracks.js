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
  {id: 'coast', name: '晴空海岸', tag: 'COASTLINE', desc: '海风、棕榈与全速长弯', difficulty: '入门', color: '#4de4d3', sky: '#b9dced', ground: '#d5c99e', road: '#36495b', radius: [175, 128], wave: 13, hills: 2.5},
  {id: 'canyon', name: '赤岩峡谷', tag: 'RED CANYON', desc: '起伏山路与连续 S 弯', difficulty: '进阶', color: '#ffac68', sky: '#ecd0af', ground: '#af7657', road: '#544b50', radius: [157, 134], wave: 36, hills: 8},
  {id: 'neon', name: '霓虹都市', tag: 'NEON CIRCUIT', desc: '夜色、光轨与高速对决', difficulty: '挑战', color: '#b8a3ff', sky: '#10152f', ground: '#171c34', road: '#2d344e', radius: [165, 145], wave: 27, hills: 4},
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
  const points = [], cumulative = [0], count = 720;
  for (let i = 0; i <= count; i++) {
    const a = i / count * Math.PI * 2;
    const r = config.wave * Math.sin(3 * a);
    const p = {x: (config.radius[0] + r) * Math.cos(a), z: (config.radius[1] + r) * Math.sin(a), y: 2 + config.hills * (1 + Math.sin(2 * a))};
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
