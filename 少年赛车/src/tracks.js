export const CARS = [
  {id: 'comet', name: '赤曜 GT', tag: '中置双门跑车', color: '#a92c25', speed: 1, accel: 1, grip: 1, mass: 1, stats: [84, 84, 86]},
  {id: 'bolt', name: '银箭 R', tag: '开放座舱赛车', color: '#d9dde2', speed: 1.04, accel: 1.12, grip: 1.14, mass: .76, stats: [90, 96, 95]},
  {id: 'titan', name: '曜夜 GTS', tag: '长轴距 GT', color: '#33454c', speed: .96, accel: .91, grip: .91, mass: 1.5, stats: [76, 74, 98]},
];
export const ENGINES = [
  {id: 'balanced', name: '街道 V6', tag: '线性输出 · 均衡调校', speed: 1, accel: 1, nitro: 1},
  {id: 'turbo', name: '涡轮 V8', tag: '极速 +12% · 起步稍慢', speed: 1.12, accel: .83, nitro: .88},
  {id: 'electric', name: '电驱 E', tag: '加速 +25% · 氮气更持久', speed: .96, accel: 1.25, nitro: 1.25},
];
export const TRACKS = [
  {id: 'coast', name: '海岸公路', tag: 'COAST CIRCUIT', desc: '临海弯道与 320 米连续加速直线', difficulty: '入门', color: '#7fa2a5', sky: '#a7bdc5', ground: '#8d9272', road: '#353a3d', radius: [175, 128], wave: 13, hills: 2.5, theme: 'coast'},
  {id: 'canyon', name: '山岭隘口', tag: 'MOUNTAIN PASS', desc: '起伏山路与 320 米连续加速直线', difficulty: '进阶', color: '#b39671', sky: '#c5c1b3', ground: '#777d60', road: '#383a38', radius: [157, 134], wave: 36, hills: 8, theme: 'creek'},
  {id: 'neon', night:true, lightShow:true, name: '都市夜环', tag: 'NIGHT EXPRESS', desc: '城市灯火与 320 米连续加速直线', difficulty: '挑战', color: '#8899b3', sky: '#101824', ground: '#293034', road: '#252b30', radius: [165, 145], wave: 27, hills: 4, theme: 'cyber'},
  {id:'arcade',name:'霓虹游乐场',tag:'NEON PLAYGROUND',desc:'穿越光环隧道、追逐灯海与火箭补给，体验电玩城夜赛',difficulty:'街机',color:'#ed6bff',sky:'#100722',ground:'#171128',road:'#1b1630',radius:[205,118],wave:20,hills:3.5,theme:'arcade',night:true,lightShow:true},
];
export const ROAD_HALF = 9;
// Arcade steering gives a larger mechanical lock, with a finite speed taper.
export const steeringLimit = speed => {const v=Number.isFinite(speed)?Math.abs(speed):0;return .84/(1+.02*v+.0004*v*v);};
// The rendered crate and pickup sweep share dimensions; extra reach includes the car body.
export const PICKUP_BOX = {size: 1.5, halfWidth: 2.25, halfLength: 3.2, respawnSeconds: 3};
// Shared by the rendered pad and swept vehicle contact, including mirrors/bumper.
export const BOOST_PAD = {width: 4.7, length: 8, duration: 3.7, speedGain: 7};
export const CAR_CONTACT = {halfWidth: 1.2, halfLength: 2.6};
export const TRACK_LAYOUT = {straightLength: 320, boostApproach: 80, boostRunoff: 120, straightEntrance: 80, straightExit: 120};
export const mod = (x, n) => ((x % n) + n) % n;
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const cache = new Map();
export function getTrack(id = 'coast') {
  if (cache.has(id)) return cache.get(id);
  const config = TRACKS.find(t => t.id === id) || TRACKS[0];
  const points = [], cumulative = [0], sections = [], arcSamples = 1440;
  const extension = TRACK_LAYOUT.straightLength / 2;
  const append = p => {
    if(points.length){const q=points.at(-1);cumulative.push(cumulative.at(-1)+Math.hypot(p.x-q.x,p.z-q.z));}
    points.push(p);
  };
  // Separate the two half-loops and join them with tangent-matched straights.
  // Flatten only their approaches; retain each track's hills and technical turns.
  for(let i=0;i<=arcSamples;i++) {
    const a=i/arcSamples*Math.PI*2;
    let r=config.wave*Math.sin(3*a),y=2+config.hills*(1+Math.sin(2*a));
    if(config.features!==false) {
      const chic=Math.exp(-((a-1.9)**2)/.05);
      r+=chic*13*Math.sin(a*11);y+=chic*config.hills*.35*Math.cos(a*5);
      const ess=Math.exp(-((a-4.25)**2)/.16);
      r+=ess*18*Math.sin(a*7);y+=ess*config.hills*.45*Math.sin(a*4);
      const crest=Math.exp(-((a-5.6)**2)/.04);y+=crest*Math.max(4,config.hills)*.7;
    }
    const u=clamp(Math.abs(Math.cos(a))/Math.sin(.45),0,1),blend=u*u*u*(u*(u*6-15)+10);
    r*=blend;y=2+config.hills+(y-2-config.hills)*blend*.8;
    const side=i<=arcSamples/4||i>arcSamples*3/4?1:-1;
    const p={x:(config.radius[0]+r)*Math.cos(a)+side*extension,z:(config.radius[1]+r)*Math.sin(a),y};
    append(i===arcSamples?{...points[0]}:p);
    if(i===arcSamples/4||i===arcSamples*3/4) {
      const direction=i===arcSamples/4?-1:1,start=cumulative.at(-1),steps=Math.ceil(TRACK_LAYOUT.straightLength/4);
      for(let j=1;j<=steps;j++)append({x:p.x+direction*TRACK_LAYOUT.straightLength*j/steps,y:p.y,z:p.z});
      sections.push({id:direction<0?'boost-straight':'return-straight',name:direction<0?'连续加速直线':'回程直线',s:start,length:cumulative.at(-1)-start});
    }
  }
  const count=points.length-1,length=cumulative[count];
  function sample(distance, lateral = 0) {
    const s = mod(distance, length);
    let lo = 0, hi = count;
    while (lo + 1 < hi) {const mid = (lo + hi) >> 1; if (cumulative[mid] <= s) lo = mid; else hi = mid;}
    const p = points[lo], q = points[lo+1], f = (s - cumulative[lo]) / (cumulative[lo+1] - cumulative[lo]);
    const dx = q.x - p.x, dz = q.z - p.z, norm = Math.hypot(dx, dz);
    return {x: p.x + dx * f + dz / norm * lateral, y: p.y + (q.y-p.y)*f, z: p.z + dz*f - dx/norm*lateral, yaw: Math.atan2(dx, dz), nx: dz/norm, nz: -dx/norm};
  }
  function slope(s) {return (sample(s+2).y-sample(s-2).y)/4;}
  function curvature(s) {let d = sample(s + 7).yaw - sample(s - 7).yaw; d = mod(d + Math.PI, Math.PI * 2) - Math.PI; return d / 14;}
  const boostStraight=sections.find(section=>section.id==='boost-straight');
  const returnStraight=sections.find(section=>section.id==='return-straight');
  const pads=[
    ...[60,130,200].map((offset,i)=>({id:`boost-straight-${i}`,type:'boost',s:boostStraight.s+offset,x:0,width:BOOST_PAD.width/2,section:'boost-straight'})),
    {id:'boost-return-0',type:'boost',s:returnStraight.s+70,x:-4,width:BOOST_PAD.width/2},
    {id:'boost-return-1',type:'boost',s:returnStraight.s+150,x:4,width:BOOST_PAD.width/2},
  ];
  const inStraightZone = distance => {
    const delta=shortDistance(distance,boostStraight.s,length);
    return delta>=-TRACK_LAYOUT.straightEntrance&&delta<=boostStraight.length+TRACK_LAYOUT.straightExit;
  };
  const nearBoost = distance => pads.some(pad => {
    const delta=shortDistance(distance,pad.s,length);
    // Include object and vehicle lengths beyond the advertised clear distances.
    return delta>=-TRACK_LAYOUT.boostApproach-6&&delta<=TRACK_LAYOUT.boostRunoff+6;
  });
  const objects=[...pads];
  // The opening pickup is harmless and gives the driver room to join the boost lane.
  const pickups=[{s:45,x:-5}];
  for(let i=0;i<20;i++) {
    const s=length*(.1+i*.043);
    if(inStraightZone(s)||pads.some(pad=>Math.abs(shortDistance(s,pad.s,length))<22)||pickups.some(o=>Math.abs(shortDistance(s,o.s,length))<30))continue;
    pickups.push({s,x:[-5,0,5][i%3]});
  }
  pickups.forEach((o,i)=>objects.push({id:`box${i}`,type:'box',...o,width:1.7,...(config.id==='arcade'&&i<2?{itemKind:i===0?'rocket':'frost'}:{})}));
  // Hazards occupy technical sections only, with a full-lane boost approach/runoff.
  let hazardIndex=0;
  for(let i=0;i<36;i++) {
    const s=length*(.045+i*.026);
    if(inStraightZone(s)||nearBoost(s)||pickups.some(o=>Math.abs(shortDistance(s,o.s,length))<45))continue;
    if(objects.some(o=>['oil','barrier'].includes(o.type)&&Math.abs(shortDistance(s,o.s,length))<55))continue;
    const type=hazardIndex%3===0?'oil':'barrier';
    objects.push({id:`barrier${hazardIndex}`,type,s,x:[-5,5,3,-4][hazardIndex%4],width:type==='oil'?2.1:1.7});hazardIndex++;
  }
  objects.sort((a,b)=>a.s-b.s);
  const bounds={minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity};
  for(const p of points){bounds.minX=Math.min(bounds.minX,p.x);bounds.maxX=Math.max(bounds.maxX,p.x);bounds.minZ=Math.min(bounds.minZ,p.z);bounds.maxZ=Math.max(bounds.maxZ,p.z);}
  bounds.width=bounds.maxX-bounds.minX;bounds.height=bounds.maxZ-bounds.minZ;
  bounds.centerX=(bounds.minX+bounds.maxX)/2;bounds.centerZ=(bounds.minZ+bounds.maxZ)/2;
  const result = {...config, length, sample, curvature, slope, objects, points, sections, boostStraight, bounds}; cache.set(id, result); return result;
}
export function shortDistance(a, b, length) {return mod(a - b + length/2, length) - length/2;}
