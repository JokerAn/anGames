// Shared deterministic rules: runs locally for solo and on the server for LAN.
import { WORLD, MAPS, getMap } from './maps.js';
import { findPath, groundClear, navigationGoal } from './navigation.js';
export { findPath, groundClear } from './navigation.js';
export { WORLD, MAPS, getMap } from './maps.js';
export const MAX_HP = 500;                      // 5× the old 100 so fights last
// Head hits count double; the vertical band of the target volume decides zone.
export const HEADSHOT_MULTIPLIER = 2;
export const WEAPONS = {
  blaster: { name: '泡泡突击步枪', short: '泡泡步枪', icon: '↗', color: '#ffb84a', damage: 22, interval: .2, spread: .018, range: 60, pellets: 1, speed: 1, desc: '全能选手，稳稳命中', sound: 250 },
  smg: { name: '糖果冲锋枪', short: '糖果冲锋', icon: 'ϟ', color: '#ab90e4', damage: 12, interval: .2, spread: .048, range: 28, pellets: 1, speed: 1.13, desc: '轻巧灵活，快乐连发', sound: 420 },
  shotgun: { name: '彩虹散弹枪', short: '彩虹散弹', icon: '≋', color: '#f489aa', damage: 15, interval: .2, spread: .13, range: 18, pellets: 7, speed: .95, desc: '近距离，一次七颗彩球', sound: 130 },
  sniper: { name: '星星狙击枪', short: '星星狙击', icon: '✧', color: '#6fbec5', damage: 72, interval: .2, spread: .003, range: 80, pellets: 1, speed: .88, desc: '慢慢瞄准，远距离发光', sound: 620 },
};
export const AI_LEVELS = Object.freeze({
  easy:Object.freeze({speed:3.3,interval:2.1,damage:.55,spread:.038,turnRate:4.6,reaction:.42,burst:1.05,pause:.72,think:.26,closing:.92}),
  hard:Object.freeze({speed:4.0,interval:1.55,damage:.8,spread:.012,turnRate:6,reaction:.2,burst:1.5,pause:.32,think:.16,closing:.9}),
});
export function cameraFraming(actor,aim=false){
  const aspect=clamp(finite(actor.viewAspect,16/9),.4,3),portraitScale=Math.min(1,aspect);
  return {distance:aim?3.2:5.7,shoulder:(aim?1.16:1.65)*portraitScale,height:aim?2:2.12};
}
export const isWeapon = key => typeof key==='string' && Object.hasOwn(WEAPONS,key);
export const OBSTACLES = getMap().obstacles; // Backward-compatible default for callers.
export const clamp = (n,a,b) => Math.min(b,Math.max(a,n));
export const finite = (n, fallback=0) => Number.isFinite(Number(n)) ? Number(n) : fallback;
// Attack slots: only a few bots may press a given opponent at once. The rest
// advance toward the objective (or hold at weapon range) so a defending player
// is not buried by a whole stack converging at full speed.
const ATTACK_SLOTS_EASY=2,ATTACK_SLOTS_HARD=3,ATTACK_WINDOW=56,ATTACK_SLOT_LIFE=.35;
export function defaultConfig(){ return {map:'blocks',duration:180,target:30,bots:{blue:[{difficulty:'easy',weapon:'random'},{difficulty:'easy',weapon:'random'}],red:Array.from({length:4},()=>({difficulty:'easy',weapon:'random'}))}}; }
export function sanitizeConfig(raw={}) {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))raw={};
  const bots={};
  for(const team of ['blue','red']) bots[team]=(Array.isArray(raw.bots?.[team])?raw.bots[team]:[]).slice(0,24).map(b=>({difficulty:b?.difficulty==='hard'?'hard':'easy',weapon:isWeapon(b?.weapon)?b.weapon:'random'}));
  return {map:getMap(raw.map).id,duration:clamp(Math.round(finite(raw.duration,180)),60,600),target:clamp(Math.round(finite(raw.target,30)),5,100),bots};
}
export function sanitizeInput(raw={}) {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))raw={};
  return {moveX:clamp(finite(raw.moveX),-1,1),moveZ:clamp(finite(raw.moveZ),-1,1),yaw:finite(raw.yaw)%(Math.PI*2),pitch:clamp(finite(raw.pitch),-1.2,1.2),fire:raw.fire===true,jump:raw.jump===true,aim:raw.aim===true,sprint:raw.sprint===true,weapon:isWeapon(raw.weapon)?raw.weapon:undefined,viewAspect:raw.viewAspect===undefined?undefined:clamp(finite(raw.viewAspect,16/9),.4,3)};
}
export function blocked(x,z,r=.48,map='blocks'){return Math.abs(x)>WORLD-r || Math.abs(z)>WORLD-r || getMap(map).obstacles.some(o=>Math.abs(x-o.x)<o.w/2+r&&Math.abs(z-o.z)<o.d/2+r);}
export function moveActor(a,dx,dz,map='blocks'){if(!blocked(a.x+dx,a.z,.48,map))a.x+=dx;if(!blocked(a.x,a.z+dz,.48,map))a.z+=dz;}
export function wallDistance(origin,dir,max,map='blocks',padding=0){
  let closest=max;
  for(const o of getMap(map).obstacles){
    let near=0,far=max;
    for(const [axis,min,maxV] of [['x',o.x-o.w/2-padding,o.x+o.w/2+padding],['y',-padding,o.h+padding],['z',o.z-o.d/2-padding,o.z+o.d/2+padding]]){
      if(Math.abs(dir[axis])<1e-8){if(origin[axis]<min||origin[axis]>maxV){far=-1;break;}}
      else{let a=(min-origin[axis])/dir[axis],b=(maxV-origin[axis])/dir[axis];if(a>b)[a,b]=[b,a];near=Math.max(near,a);far=Math.min(far,b);}
    }
    if(far>=near&&far>=0)closest=Math.min(closest,near);
  }
  return closest;
}
export function visible(a,b,map='blocks',height=1.4){const dx=b.x-a.x,dz=b.z-a.z,d=Math.hypot(dx,dz)||.001;return wallDistance({x:a.x,y:height,z:a.z},{x:dx/d,y:0,z:dz/d},d,map)>=d-.1;}
export class Match {
  constructor(config, humans, random=Math.random){
    this.config=sanitizeConfig(config);this.random=random;this.time=0;this.actors=[];this.actorIndex=new Map();this.score={blue:0,red:0};this.events=[];this.eventId=0;this.ended=false;this.winner=null;
    for(const h of humans)this.addHuman(h);
    for(const team of ['blue','red'])this.config.bots[team].forEach((b,i)=>this.addActor({id:`bot-${team}-${i}`,name:`${b.difficulty==='hard'?'闪电':'泡泡'}${i+1}号`,team,bot:true,...b}));
  }
  addHuman(h){if(!this.actors.some(a=>a.id===h.id))this.addActor({...h,bot:false});}
  addActor(info){const a={...info,x:0,z:0,y:0,vy:0,yaw:0,pitch:0,hp:MAX_HP,kills:0,deaths:0,cooldown:.8,respawn:0,shield:2,lastHit:-20,lastAttacker:null,lastStep:0,viewAspect:16/9,input:{},path:[],pathTime:0,weaponChoice:info.weapon||'blaster',weapon:'blaster',fleeTarget:null,fleeUntil:0,fear:0,patrolX:null,patrolZ:null,patrolUntil:0,patrolWait:0,alertUntil:0};this.actors.push(a);this.actorIndex.set(a.id,a);this.spawn(a);return a;}
  spawn(a){
    const sign=a.team==='blue'?1:-1;let best={x:0,z:sign*WORLD*.84},bestDistance=-1;
    for(let i=0;i<12;i++){const p={x:(this.random()-.5)*WORLD*1.52,z:sign*(WORLD*.72+this.random()*WORLD*.2)};if(blocked(p.x,p.z,.48,this.config.map))continue;const enemyDistance=Math.min(100,...this.actors.filter(b=>b.team!==a.team&&b.hp>0).map(b=>Math.hypot(p.x-b.x,p.z-b.z)));const allyDistance=Math.min(8,...this.actors.filter(b=>b.id!==a.id&&b.team===a.team&&b.hp>0).map(b=>Math.hypot(p.x-b.x,p.z-b.z)));const d=enemyDistance+allyDistance*3;if(d>bestDistance){best=p;bestDistance=d;}}
    a.x=best.x;a.z=best.z;a.y=0;a.vy=0;a.hp=MAX_HP;a.shield=2;a.respawn=0;a.pitch=a.bot?0:-.12;a.yaw=a.team==='blue'?0:Math.PI;a.path=[];a.pathIndex=0;a.pathTime=0;a.routeGoal=-1;a.routeTarget=null;a.targetId=null;a.thinkTime=0;a.canShoot=false;a.fireReadyAt=this.time;a.lastAttacker=null;a.lastHit=-20;a.strafeSign=this.actors.indexOf(a)%2?-1:1;a.coverTarget=null;a.coverUntil=0;a.fleeTarget=null;a.fleeUntil=0;a.fear=0;a.patrolX=null;a.patrolZ=null;a.patrolUntil=0;a.patrolWait=0;a.alertUntil=0;a.navMoving=false;a.stuckTime=0;a.navX=a.x;a.navZ=a.z;a.attackKey=null;a.attackUntil=0;a.attackGranted=true;a.input.weapon=undefined;
    a.weapon=a.weaponChoice==='random'?Object.keys(WEAPONS)[Math.floor(this.random()*4)]:a.weaponChoice;if(!isWeapon(a.weapon))a.weapon='blaster';
  }
  setInput(id,input){const a=this.actors.find(a=>a.id===id&&!a.bot);if(a)a.input=sanitizeInput(input);}
  stopInput(id){const a=this.actorIndex.get(id);if(a&&!a.bot)a.input=sanitizeInput({yaw:a.yaw,pitch:a.pitch});}
  event(e){this.events.push({...e,id:++this.eventId});}
  patrol(a,dt,hard,level,map){
    // No contact: hold a forward-leaning patrol area. The bot drifts toward the
    // contested middle / the enemy side so firefights still happen, but it does
    // NOT lock onto or beeline to a specific unseen foe. "Own area" means a
    // region near the front, not a corner camp, so the map never goes silent.
    let wx=0,wz=0;a.navMoving=false;
    if(a.patrolX==null||this.time>a.patrolUntil||!groundClear(a,{x:a.patrolX,z:a.patrolZ},map)){
      if(a.patrolWait>0){a.patrolWait-=dt;if(a.patrolWait<=0){a.patrolX=null;a.patrolUntil=0;}}
      else if(a.patrolX==null){
        let best=null,bestScore=-Infinity;
        const home={x:a.spawnX??a.x,z:a.spawnZ??a.z};
        // Where the fight should drift: a band toward the map middle on the
        // bot's own side, so rivals converge without perfect tracking. If the
        // human is far away, lean the patrol deeper toward its half so the
        // teams actually meet instead of camping opposite corners forever.
        const enemyHuman=[...this.actors].find(c=>!c.bot&&c.hp>0&&c.team!==a.team);
        const far=enemyHuman?Math.hypot(enemyHuman.x-a.x,enemyHuman.z-a.z)>WORLD*.7:false;
        const frontZ=enemyHuman&&far?enemyHuman.z+(this.random()-.5)*WORLD*.25:(a.team==='blue'?1:-1)*WORLD*.28;
        for(let i=0;i<10;i++){
          const ang=this.random()*Math.PI*2,r=WORLD*.12+this.random()*WORLD*.22;
          const p={x:clamp(a.x+Math.cos(ang)*r,-WORLD+1,WORLD-1),z:clamp(a.z+Math.sin(ang)*r,-WORLD+1,WORLD-1)};
          if(!groundClear(a,p,map))continue;
          const cover=!visible(a,p,map);                     // prefers points near cover
          const front=Math.abs(p.z-frontZ);                  // nearer the front line is better
          const drift=Math.hypot(p.x-home.x,p.z-home.z);     // still stays in its half
          const score=(cover?3:0)-front*.18-drift*.06;
          if(score>bestScore){bestScore=score;best=p;}
        }
        a.patrolX=best?best.x:home.x;a.patrolZ=best?best.z:home.z;
        a.patrolUntil=this.time+2.5+this.random()*2;
      }
    }
    if(a.patrolX!=null){
      const lx=a.patrolX-a.x,lz=a.patrolZ-a.z,len=Math.hypot(lx,lz);
      if(len>.5){
        const amount=Math.min(1,len/Math.max(.001,level.speed*.6*WEAPONS[a.weapon].speed*dt));
        wx=lx/len*amount;wz=lz/len*amount;a.navMoving=true;
      }else{a.patrolWait=.6+this.random()*1.2;a.patrolX=null;}
    }
    // Scan: slowly pan the view so patrol looks alert, not statuesque.
    const scan=Math.atan2(Math.sin(this.time*(hard?.5:.32)+(this.actors.indexOf(a)+1)*2.1),Math.cos(this.time*(hard?.5:.32)+(this.actors.indexOf(a)+1)*2.1));
    const desiredYaw=a.yaw+scan*dt*1.5;
    const turn=Math.atan2(Math.sin(desiredYaw-a.yaw),Math.cos(desiredYaw-a.yaw));
    const yaw=a.yaw+clamp(turn,-level.turnRate*.7*dt,level.turnRate*.7*dt);
    return {yaw,pitch:a.pitch,moveX:wx*Math.cos(yaw)-wz*Math.sin(yaw),moveZ:wx*Math.sin(yaw)+wz*Math.cos(yaw),fire:false,aim:false,jump:false};
  }
  ai(a,dt){
    const map=this.config.map,hard=a.difficulty==='hard',level=AI_LEVELS[a.difficulty]||AI_LEVELS.easy;
    a.thinkTime-=dt;let target=this.actorIndex.get(a.targetId);
    if(!target||target.hp<=0||target.team===a.team||a.thinkTime<=0){
      let nearest=null,nearestDistance=Infinity,seen=null,seenDistance=Infinity,human=null,humanDistance=Infinity,seenHuman=null,seenHumanDistance=Infinity;
      const oldTarget=a.targetId,wasVisible=a.canShoot;
      for(const candidate of this.actors){
        if(candidate.hp<=0||candidate.team===a.team)continue;
        const d=(a.x-candidate.x)**2+(a.z-candidate.z)**2;
        // Awareness = raw line of sight (`visible`), not the stricter shooting
        // test. A bot that can see a foe through/over cover still knows where it
        // is and may path toward it; it just cannot shoot through the cover.
        // But a sighting alone should not pull a bot off patrol from across the
        // map: only an ENGAGE_RANGE contact starts a chase. Beyond that the bot
        // keeps guarding and lets the fight come to it.
        const ENGAGE_RANGE=hard?34:26;
        const sees=visible(a,candidate,map)&&d<=ENGAGE_RANGE*ENGAGE_RANGE;
        const clear=sees&&combatVisible(a,candidate,map);
        if(d<nearestDistance){nearest=candidate;nearestDistance=d;}
        if(sees&&d<seenDistance){seen=candidate;seenDistance=d;}
        if(!candidate.bot){if(d<humanDistance){human=candidate;humanDistance=d;}if(sees&&d<seenHumanDistance){seenHuman=candidate;seenHumanDistance=d;}}
      }
      const attacker=this.actorIndex.get(a.lastAttacker);
      const retaliate=attacker&&attacker.hp>0&&attacker.team!==a.team&&this.time-a.lastHit<2.5&&combatVisible(a,attacker,map);
      // No omniscient targeting: a bot may only lock onto what it can actually
      // see, or the spot where it last saw a foe. Locking the nearest/human actor
      // through walls is what made bots feel like wallhacks. Difficulty sets how
      // well they remember.
      const memTime=hard?2.2:1.0;                     // seconds a sighting stays valid
      // Prefer what is actually visible, but always favour a real player over a
      // bot when both are in sight: a human is the prize target, bots are noise.
      // Reach the human by biasing toward it even before it is in view, so a
      // room full of bots still converges on the real player.
      const preferredSeen=seenHuman||seen;
      if(preferredSeen){a.memTarget=preferredSeen.id;a.memX=preferredSeen.x;a.memZ=preferredSeen.z;a.memUntil=this.time+memTime;}
      const recall=!preferredSeen&&a.memTarget&&this.time<=a.memUntil;
      if(preferredSeen)target=preferredSeen;
      else if(recall){const mem=this.actorIndex.get(a.memTarget);target=mem&&mem.hp>0&&mem.team!==a.team?mem:null;}
      else target=null;
      // Recently shot by someone => turn and fight them (they revealed themselves).
      if(retaliate&&(!attacker.bot||Math.hypot(attacker.x-a.x,attacker.z-a.z)<6))target=attacker;
      // No live contact: drift toward the human's last-known/expected area rather
      // than camping, but WITHOUT flawless wallhack tracking. The bot commits to
      // a search point with a per-bot error, so its route is plausible rather
      // than a perfect beeline to your true position.
      a.searching=false;
      if(!target){
        // Prefer a real player as the search lead; fall back to the nearest foe.
        const lead=human||nearest;
        if(lead){
          const err=hard?2.5:5.5;                       // metres of aim error
          const ex=(this.random()-.5)*2*err,ez=(this.random()-.5)*2*err;
          a.aimMemory=true;a.memX=lead.x+ex;a.memZ=lead.z+ez;
          a.memTarget=lead.id;a.memUntil=this.time+.3;
          target=lead;a.searching=true;
        }
      }
      a.targetId=target?.id||null;a.canShoot=!!target&&combatVisible(a,target,map);
      // Chosen info: with no live sighting, aim at the remembered spot, not the
      // target's true position; that is the "imperfect awareness" a human has.
      a.aimMemory=!a.canShoot&&recall;
      if(oldTarget!==a.targetId||!wasVisible&&a.canShoot)a.fireReadyAt=this.time+level.reaction;
      a.thinkTime=level.think+(this.actors.indexOf(a)%5)*.011;
    }
    if(!target){
      // Guard/patrol: with no contact a bot does NOT hunt across the map. It
      // holds its own area, drifting between nearby cover points and scanning.
      // Only a live sighting or a hit pulls it out of patrol (handled above).
      return this.patrol(a,dt,hard,level,map);
    }
    // Use the perceived position when there is no live sighting: aim foot and
    // path at the remembered spot so bots do not beeline to your true location.
    const aimX=a.aimMemory?a.memX:target.x,aimZ=a.aimMemory?a.memZ:target.z;
    const dx=aimX-a.x,dz=aimZ-a.z,dist=Math.hypot(dx,dz),bearing=Math.atan2(-dx,-dz);
    // Survival instinct: as HP drops (or under recent sustained fire) the bot
    // becomes cautious and disengages to recover instead of trading until it dies.
    const hurt=1-clamp(a.hp/MAX_HP,0,1);
    const underFire=this.time-a.lastHit<2.5?1:0;
    const fearTarget=clamp(hurt*1.25+underFire*.35+(a.shield>0?0:.15),0,1);
    a.fear+=(fearTarget-a.fear)*Math.min(1,dt*3);
    const clearShot=a.canShoot&&combatVisible(a,target,map,muzzlePosition(a,map));
    let wx=0,wz=0;a.navMoving=false;
    const preferred=a.weapon==='shotgun'?(hard?7:6):a.weapon==='sniper'?(hard?22:17):a.weapon==='smg'?(hard?11:9):hard?15:12;
    const retreat=fearTarget>.5&&dist<preferred*2.2;
    const tooClose=preferred*.55;                 // back off inside this band
    const rangeBand=.1;                          // float tolerance around preferred
    // Dead zone centered on preferred: raw float compare let a 1e-13 overshoot
    // freeze movement, and a one-sided band parked the bot at its outer edge.
    const atRange=Math.abs(dist-preferred)<=rangeBand;
    // Drop a stale cover commitment.
    if(a.coverTarget&&(this.time>a.coverUntil||dist<tooClose*.7))a.coverTarget=null;
    // Hold-range: once past the outer band the bot stops closing and fights from
    // here. This is the "do not crowd the player" rule mature bot AI uses.
    const holdRange=1.7;
    // Fire once the shot is lined up; the bot closes only until it has a clear
    // line and is inside its weapon band, then holds and strafes.
    const inBand=dist<=WEAPONS[a.weapon].range*.9;
    // Decide whether this bot is allowed to press the target this tick, or must
    // fall back to a standoff. Slots are held briefly so bots do not thrash.
    const slotKey=target.id;
    const slotLimit=hard?ATTACK_SLOTS_HARD:ATTACK_SLOTS_EASY;
    if(a.attackKey!==slotKey){a.attackKey=slotKey;a.attackUntil=0;a.attackGranted=false;}
    if(this.time>=a.attackUntil){
      let taken=0;
      for(const other of this.actors){if(other===a||!other.bot||!other.attackGranted||other.attackUntil<=this.time||other.attackKey!==slotKey)continue;taken++;}
      a.attackGranted=taken<slotLimit&&dist<=ATTACK_WINDOW&&!retreat;
      a.attackUntil=this.time+(a.attackGranted?ATTACK_SLOT_LIFE:.12);
    }
    if(!a.attackGranted){
      // Denied bots keep their distance: advance toward the target only while
      // beyond a standoff band, then hold and fire from range instead of piling on.
      // Also keep closing when the shot is blocked OR the foe is still outside
      // this weapon's range: "has line of sight" is not the same as "can hit".
      const standoff=holdRange;
      const outOfRange=dist>WEAPONS[a.weapon].range*.92;
      if(dist>standoff&&(!clearShot||outOfRange)){
        let next=null;
        if(groundClear(a,target,map))next=target;
        else{
          const goal=navigationGoal(target,map);a.pathTime-=dt;
          const rebuild=()=>{a.path=findPath(a,target,map);a.pathIndex=0;a.routeGoal=goal;a.routeTarget=target.id;a.pathTime=3;a.stuckTime=0;};
          if(goal!==a.routeGoal||target.id!==a.routeTarget||!a.path.length||a.pathTime<=0||a.stuckTime>.45)rebuild();
          if(a.path[a.pathIndex]&&!groundClear(a,a.path[a.pathIndex],map))rebuild();
          for(let skips=0;skips<6&&a.pathIndex+1<a.path.length;skips++){if(!groundClear(a,a.path[a.pathIndex+1],map))break;a.pathIndex++;}
          next=a.path[a.pathIndex];
        }
        if(next){
          const len=Math.hypot(next.x-a.x,next.z-a.z);
          if(len>.015){
            // Human-like imperfection: nudge the desired steering with a small
            // per-bot wander, and occasionally commit to a slightly wrong route
            // for a moment. Perfect shortest paths made bots feel superhuman.
            const wander=hard?.045:.09;
            const sway=Math.sin(this.time*(hard?2.4:1.8)+(this.actors.indexOf(a)+1)*1.7)*wander;
            const c=Math.cos(sway),s=Math.sin(sway);
            const rx=(next.x-a.x)/len*c-(next.z-a.z)/len*s;
            const rz=(next.x-a.x)/len*s+(next.z-a.z)/len*c;
            const amount=Math.min(1,len/Math.max(.001,level.speed*level.closing*WEAPONS[a.weapon].speed*dt));
            wx=rx*amount;wz=rz*amount;a.navMoving=true;
          }
        }
        // Occasional hesitation: a bot briefly loses focus and pauses or drifts,
        // like a player who misjudges the route instead of a perfect pathfinder.
        const hesitate=((Math.floor(this.time*(hard?1.1:.7)+(this.actors.indexOf(a)+1)*3)%(hard?11:7))===0);
        if(hesitate&&this.time>=a.hesitateUntil&&this.random()<(hard?.09:.16))a.hesitateUntil=this.time+(hard?.18:.4);
        if(this.time<a.hesitateUntil){wx*=.15;wz*=.15;}
      }
      const desiredYaw=clearShot||!a.navMoving?bearing:Math.atan2(-wx,-wz);
      const turn=Math.atan2(Math.sin(desiredYaw-a.yaw),Math.cos(desiredYaw-a.yaw));
      const yaw=a.yaw+clamp(turn,-level.turnRate*dt,level.turnRate*dt);
      const desiredPitch=Math.atan2(target.y+1.12-(a.y+1.22),Math.max(.01,dist));
      const pitch=a.pitch+clamp(desiredPitch-a.pitch,-level.turnRate*dt,level.turnRate*dt);
      const alignment=Math.abs(Math.atan2(Math.sin(bearing-yaw),Math.cos(bearing-yaw)));
      const cycle=level.burst+level.pause,phase=(this.time+this.actors.indexOf(a)*.13)%cycle;
      const fire=clearShot&&alignment<(hard?.16:.24)&&this.time>=a.fireReadyAt&&phase<level.burst&&dist<WEAPONS[a.weapon].range&&a.shield<.8&&target.shield<=0;
      return {yaw,pitch,moveX:wx*Math.cos(yaw)-wz*Math.sin(yaw),moveZ:wx*Math.sin(yaw)+wz*Math.cos(yaw),fire,aim:hard&&clearShot&&!a.navMoving,jump:false};
    }
    const traveled=Math.hypot(a.x-a.navX,a.z-a.navZ);
    a.stuckTime=a.navMoving&&traveled<.001?a.stuckTime+dt:0;a.navX=a.x;a.navZ=a.z;
    if(retreat){
      // Wounded bot breaks contact: pick a fallback point away from the threat
      // (ideally behind cover) and keep firing only if it still has a shot.
      if(!a.fleeTarget||this.time>a.fleeUntil){
        const away=Math.atan2(-dx,-dz)+Math.PI;   // directly away from the shooter
        let best=null,bestScore=-Infinity;
        for(let i=0;i<10;i++){
          const ang=away+(this.random()-.5)*1.6,r=12+this.random()*10;
          const p={x:clamp(a.x+Math.cos(ang)*r,-WORLD+1,WORLD-1),z:clamp(a.z+Math.sin(ang)*r,-WORLD+1,WORLD-1)};
          if(!groundClear(a,p,map))continue;
          const clear=!combatVisible({x:p.x,y:a.y,z:p.z},target,map);
          const ally=Math.min(30,...this.actors.filter(b=>b.team===a.team&&b.id!==a.id&&b.hp>0).map(b=>Math.hypot(p.x-b.x,p.z-b.z)));
          const score=(clear?8:0)+ally*.2-0.05*Math.hypot(p.x-target.x,p.z-target.z);
          if(score>bestScore){bestScore=score;best=p;}
        }
        a.fleeTarget=best||{x:a.x-dx/Math.max(.01,dist)*8,z:a.z-dz/Math.max(.01,dist)*8};
        a.fleeUntil=this.time+1.2;
      }
      const len=Math.hypot(a.fleeTarget.x-a.x,a.fleeTarget.z-a.z);
      if(len>.4){
        const panic=1+(1-a.fear)*0;   // full speed while fleeing
        const amount=Math.min(1,len/(level.speed*panic*WEAPONS[a.weapon].speed*dt));
        wx=(a.fleeTarget.x-a.x)/len*amount;wz=(a.fleeTarget.z-a.z)/len*amount;a.navMoving=true;
      }else a.fleeTarget=null;
      // Still face the threat so a cornered bot can shoot back.
      const desiredYaw=bearing;
      const turn=Math.atan2(Math.sin(desiredYaw-a.yaw),Math.cos(desiredYaw-a.yaw));
      const yaw=a.yaw+clamp(turn,-level.turnRate*dt,level.turnRate*dt);
      const desiredPitch=Math.atan2(target.y+1.12-(a.y+1.22),Math.max(.01,dist));
      const pitch=a.pitch+clamp(desiredPitch-a.pitch,-level.turnRate*dt,level.turnRate*dt);
      const alignment=Math.abs(Math.atan2(Math.sin(bearing-yaw),Math.cos(bearing-yaw)));
      const fire=clearShot&&alignment<(hard?.18:.26)&&this.time>=a.fireReadyAt&&dist<WEAPONS[a.weapon].range&&a.shield<.8&&target.shield<=0&&this.random()<.5;
      return {yaw,pitch,moveX:wx*Math.cos(yaw)-wz*Math.sin(yaw),moveZ:wx*Math.sin(yaw)+wz*Math.cos(yaw),fire,aim:false,jump:false};
    }
    a.fleeTarget=null;
    if(!clearShot&&a.coverTarget){
      // Break line of sight toward cover instead of marching straight at the player.
      const len=Math.hypot(a.coverTarget.x-a.x,a.coverTarget.z-a.z);
      if(len<.6||this.time>a.coverUntil)a.coverTarget=null;
      else{const amount=Math.min(1,len/Math.max(.001,level.speed*level.closing*WEAPONS[a.weapon].speed*dt));wx=(a.coverTarget.x-a.x)/len*amount;wz=(a.coverTarget.z-a.z)/len*amount;a.navMoving=true;}
    }else if(dist<tooClose||(!atRange&&dist>preferred)||!inBand||!clearShot){
      if(dist<tooClose&&clearShot){
        // Point-blank: back away and sidestep instead of hugging the player.
        wx=-dx/Math.max(.01,dist);wz=-dz/Math.max(.01,dist);a.navMoving=true;
        const sx=Math.cos(bearing)*a.strafeSign*.45,sz=-Math.sin(bearing)*a.strafeSign*.45;
        if(groundClear(a,{x:a.x+(wx+sx)*.7,z:a.z+(wz+sz)*.7},map)){wx+=sx;wz+=sz;}else a.strafeSign*=-1;
      }else if(!atRange&&dist>preferred||!inBand){
        // Close toward the weapon's working range, then settle.
        let next=null;
        if(groundClear(a,target,map))next=target;
        else{
          const goal=navigationGoal(target,map);a.pathTime-=dt;
          const rebuild=()=>{a.path=findPath(a,target,map);a.pathIndex=0;a.routeGoal=goal;a.routeTarget=target.id;a.pathTime=3;a.stuckTime=0;};
          if(goal!==a.routeGoal||target.id!==a.routeTarget||!a.path.length||a.pathTime<=0||a.stuckTime>.45)rebuild();
          if(a.path[a.pathIndex]&&!groundClear(a,a.path[a.pathIndex],map))rebuild();
          // Skip only waypoints reachable by a full-radius ground sweep. Consuming
          // a waypoint merely because it is nearby used to cut blocked corners.
          for(let skips=0;skips<6&&a.pathIndex+1<a.path.length;skips++){
            if(!groundClear(a,a.path[a.pathIndex+1],map))break;a.pathIndex++;
          }
          next=a.path[a.pathIndex];
        }
        if(next){
          const len=Math.hypot(next.x-a.x,next.z-a.z);
          if(len>.015){const amount=Math.min(1,len/Math.max(.001,level.speed*level.closing*WEAPONS[a.weapon].speed*dt));wx=(next.x-a.x)/len*amount;wz=(next.z-a.z)/len*amount;a.navMoving=true;}
          // Ease off near working range, but never to a full stop: a bot that
          // still lacks line of sight must keep pressing (flanking) rather than
          // freezing at the edge of its weapon band.
          const close=clearShot?clamp((dist-preferred)/2.5,0,1):1;
          wx*=close;wz*=close;a.navMoving=Math.abs(wx)+Math.abs(wz)>.03;
        }
      }else{
        // In range but the shot is blocked: sidestep to find the line.
        wx=Math.cos(bearing)*a.strafeSign*.5;wz=-Math.sin(bearing)*a.strafeSign*.5;
        if(!groundClear(a,{x:a.x+wx*.7,z:a.z+wz*.7},map)){a.strafeSign*=-1;wx=-wx;wz=-wz;if(!groundClear(a,{x:a.x+wx*.7,z:a.z+wz*.7},map)){wx=0;wz=0;}}
        a.navMoving=Math.abs(wx)+Math.abs(wz)>.05;
      }
    }else{
      // In the fight band with a shot: sidestep to dodge while firing, and break
      // away if the target gets truly point-blank. If sidestep is walled off,
      // still push toward the target so the bot never freezes in the open.
      const breakAway=dist<tooClose*1.4?.5:0;
      wx=Math.cos(bearing)*a.strafeSign*.6-dx/Math.max(.01,dist)*breakAway;
      wz=-Math.sin(bearing)*a.strafeSign*.6-dz/Math.max(.01,dist)*breakAway;
      if(!groundClear(a,{x:a.x+wx*.8,z:a.z+wz*.8},map)){a.strafeSign*=-1;wx=-wx;wz=-wz;
        if(!groundClear(a,{x:a.x+wx*.8,z:a.z+wz*.8},map)){
          wx=-dx/Math.max(.01,dist);wz=-dz/Math.max(.01,dist);
          if(!groundClear(a,{x:a.x+wx*.8,z:a.z+wz*.8},map)){wx=0;wz=0;}
        }
      }
      a.navMoving=Math.abs(wx)+Math.abs(wz)>.05;
    }
    const desiredYaw=clearShot||!a.navMoving?bearing:Math.atan2(-wx,-wz);
    const turn=Math.atan2(Math.sin(desiredYaw-a.yaw),Math.cos(desiredYaw-a.yaw));
    const yaw=a.yaw+clamp(turn,-level.turnRate*dt,level.turnRate*dt);
    const desiredPitch=Math.atan2(target.y+1.12-(a.y+1.22),Math.max(.01,dist));
    const pitch=a.pitch+clamp(desiredPitch-a.pitch,-level.turnRate*dt,level.turnRate*dt);
    const alignment=Math.abs(Math.atan2(Math.sin(bearing-yaw),Math.cos(bearing-yaw)));
    const cycle=level.burst+level.pause,phase=(this.time+this.actors.indexOf(a)*.13)%cycle;
    const fire=clearShot&&alignment<(hard?.16:.24)&&this.time>=a.fireReadyAt&&phase<level.burst&&dist<WEAPONS[a.weapon].range&&a.shield<.8&&target.shield<=0;
    return {yaw,pitch,moveX:wx*Math.cos(yaw)-wz*Math.sin(yaw),moveZ:wx*Math.sin(yaw)+wz*Math.cos(yaw),fire,aim:hard&&clearShot&&!a.navMoving,jump:false};
  }
  step(dt){
    if(this.ended)return;dt=clamp(dt,0,.05);this.time+=dt;
    this.actorIndex.clear();for(const actor of this.actors)this.actorIndex.set(actor.id,actor);
    for(const a of this.actors){
      if(a.hp<=0){a.respawn-=dt;if(a.respawn<=0){this.spawn(a);this.event({type:'respawn',actor:a.id});}continue;}
      a.shield=Math.max(0,a.shield-dt);a.cooldown-=dt;
      const input=a.bot?this.ai(a,dt):a.input;
      if(isWeapon(input.weapon)&&input.weapon!==a.weapon){a.weapon=input.weapon;a.weaponChoice=input.weapon;a.cooldown=Math.max(a.cooldown,.3);}
      a.yaw=input.yaw??a.yaw;a.pitch=input.pitch??a.pitch;if(input.viewAspect!==undefined)a.viewAspect=input.viewAspect;
      let mx=input.moveX||0,mz=input.moveZ||0;const len=Math.hypot(mx,mz);if(len>1){mx/=len;mz/=len;}
      const speed=(a.bot?(AI_LEVELS[a.difficulty]||AI_LEVELS.easy).speed:6.2)*WEAPONS[a.weapon].speed*(input.aim?.66:input.sprint?1.32:1);
      moveActor(a,(mx*Math.cos(a.yaw)+mz*Math.sin(a.yaw))*speed*dt,(-mx*Math.sin(a.yaw)+mz*Math.cos(a.yaw))*speed*dt,this.config.map);
      if(input.jump&&a.y<=0&&!a.jumpHeld)a.vy=6;a.jumpHeld=!!input.jump;a.vy-=16*dt;a.y=Math.max(0,a.y+a.vy*dt);if(a.y===0)a.vy=0;
      if(input.fire&&a.cooldown<=0){this.shoot(a,input.aim);a.cooldown=WEAPONS[a.weapon].interval*(a.bot?(AI_LEVELS[a.difficulty]||AI_LEVELS.easy).interval:1);}
      if(a.hp<MAX_HP&&this.time-a.lastHit>5)a.hp=Math.min(MAX_HP,a.hp+dt*8*5);
    }
    if(this.score.blue>=this.config.target||this.score.red>=this.config.target||this.time>=this.config.duration){this.ended=true;this.winner=this.score.blue===this.score.red?'draw':this.score.blue>this.score.red?'blue':'red';this.event({type:'end',winner:this.winner});}
  }
  shoot(a,aim){
    const w=WEAPONS[a.weapon],map=this.config.map;
    const origin=muzzlePosition(a,map);
    let shotYaw=a.yaw,shotPitch=a.pitch;
    if(!a.bot){
      const camera=cameraPose(a,a.yaw,a.pitch,aim,map),direction=viewDirection(a.yaw,a.pitch);
      const sight=traceRay(camera,direction,w.range+8,this.actors,a,map);
      const target={x:camera.x+direction.x*sight.distance,y:camera.y+direction.y*sight.distance,z:camera.z+direction.z*sight.distance};
      const dx=target.x-origin.x,dy=target.y-origin.y,dz=target.z-origin.z;
      shotYaw=Math.atan2(-dx,-dz);shotPitch=Math.atan2(dy,Math.hypot(dx,dz));
    }
    if(a.bot){
      const target=this.actorIndex.get(a.targetId);
      if(target&&target.hp>0&&target.team!==a.team){
        const dx=target.x-origin.x,dy=target.y+1.12-origin.y,dz=target.z-origin.z;
        shotYaw=Math.atan2(-dx,-dz);shotPitch=Math.atan2(dy,Math.hypot(dx,dz));
      }
    }
    const traces=[];
    const shotDist=Math.hypot(origin.x-(this.actorIndex.get(a.targetId)?.x??origin.x),origin.z-(this.actorIndex.get(a.targetId)?.z??origin.z));
    for(let pellet=0;pellet<w.pellets;pellet++){
      // Bots get distance-scaled inaccuracy: a fixed spread made them laser-accurate
      // across the enlarged arena. Error grows with range so far shots miss often.
      let spread=w.spread*(aim?.45:1)+(a.bot?(AI_LEVELS[a.difficulty]||AI_LEVELS.easy).spread:0);
      if(a.bot)spread+=spread*shotDist*.045;
      const yaw=shotYaw+(this.random()-.5)*spread*2,pitch=shotPitch+(this.random()-.5)*spread*2;
      const dir=viewDirection(yaw,pitch),hit=traceRay(origin,dir,w.range,this.actors,a,map),victim=hit.victim;
      if(victim&&victim.shield<=0){
        const head=hit.zone==='head';
        const damage=w.damage*(head?HEADSHOT_MULTIPLIER:1)*(a.bot?(AI_LEVELS[a.difficulty]||AI_LEVELS.easy).damage:1);victim.hp=Math.max(0,victim.hp-damage);victim.lastHit=this.time;victim.lastAttacker=a.id;
        this.event({type:'hit',actor:a.id,target:victim.id,damage,head,x:victim.x,y:victim.y+1.2,z:victim.z});
        if(victim.hp===0){victim.deaths++;victim.respawn=3;a.kills++;this.score[a.team]++;this.event({type:'pop',actor:a.id,target:victim.id,team:a.team,x:victim.x,y:victim.y+1,z:victim.z});}
      }
      traces.push({x:origin.x+dir.x*hit.distance,y:origin.y+dir.y*hit.distance,z:origin.z+dir.z*hit.distance});
    }
    this.event({type:'shot',actor:a.id,weapon:a.weapon,team:a.team,origin,traces});
  }
  drainEvents(){return this.events.splice(0);}
  snapshot(){return {time:this.time,score:{...this.score},ended:this.ended,winner:this.winner,config:this.config,actors:this.actors.map(({id,name,team,bot,difficulty,x,y,z,yaw,pitch,hp,kills,deaths,shield,respawn,weapon,viewAspect})=>({id,name,team,bot,difficulty,x,y,z,yaw,pitch,hp,kills,deaths,shield,respawn,weapon,viewAspect}))};}
}

// Same over-the-shoulder geometry on the client and server keeps the reticle honest.
export function viewDirection(yaw,pitch){return {x:-Math.sin(yaw)*Math.cos(pitch),y:Math.sin(pitch),z:-Math.cos(yaw)*Math.cos(pitch)};}
export function cameraPose(actor,yaw,pitch,aim=false,map='blocks'){
  const direction=viewDirection(yaw,pitch),{distance,shoulder,height}=cameraFraming(actor,aim);
  const anchor={x:actor.x,y:actor.y+height,z:actor.z};
  const offset={x:-direction.x*distance+Math.cos(yaw)*shoulder,y:-direction.y*distance,z:-direction.z*distance-Math.sin(yaw)*shoulder};
  const length=Math.hypot(offset.x,offset.y,offset.z),ray={x:offset.x/length,y:offset.y/length,z:offset.z/length};
  let safe=Math.max(.06,wallDistance(anchor,ray,length,map,.24)-.06);
  if(ray.y<0)safe=Math.min(safe,Math.max(.06,(anchor.y-.3)/-ray.y));
  return {x:anchor.x+ray.x*safe,y:anchor.y+ray.y*safe,z:anchor.z+ray.z*safe,distance:safe};
}
export function aimAngles(actor,target,aim=false){
  const dx=target.x-actor.x,dz=target.z-actor.z,distance=Math.hypot(dx,dz),{shoulder,height}=cameraFraming(actor,aim);
  const offset=Math.min(shoulder,Math.max(0,distance-.01));
  return {yaw:Math.atan2(-dx,-dz)+Math.asin(offset/Math.max(.01,distance)),pitch:Math.atan2(target.y-(actor.y+height),Math.sqrt(Math.max(.01,distance*distance-offset*offset)))};
}
export function traceRay(origin,dir,max,actors,shooter,map='blocks'){
  let distance=wallDistance(origin,dir,max,map),victim=null,zone='body';
  for(const b of actors){
    if(b.id===shooter.id||b.hp<=0||b.team===shooter.team)continue;
    // Two stacked hit volumes: lower torso and upper body. The upper band also
    // reads as the head zone, so a hit that lands there doubles its damage.
    for(const band of [{height:.72,radius:.62,zone:'body'},{height:1.43,radius:.48,zone:'head'}]){
      const dx=b.x-origin.x,dy=b.y+band.height-origin.y,dz=b.z-origin.z,t=dx*dir.x+dy*dir.y+dz*dir.z;
      const perpendicular=dx*dx+dy*dy+dz*dz-t*t,radius=band.radius;
      if(t<0||perpendicular>radius*radius)continue;
      const hit=t-Math.sqrt(radius*radius-perpendicular);if(hit>=0&&hit<distance){distance=hit;victim=b;zone=band.zone;}
    }
  }
  return {distance,victim,zone};
}

export function muzzlePosition(a,map='blocks'){
  const chest={x:a.x,y:a.y+1.22,z:a.z},offset={x:Math.cos(a.yaw)*.32-Math.sin(a.yaw)*.6,y:0,z:-Math.sin(a.yaw)*.32-Math.cos(a.yaw)*.6};
  const length=Math.hypot(offset.x,offset.z),direction={x:offset.x/length,y:0,z:offset.z/length};
  const safe=Math.max(0,wallDistance(chest,direction,length,map)-.03);
  return {x:chest.x+direction.x*safe,y:chest.y,z:chest.z+direction.z*safe};
}
export function combatVisible(a,b,map='blocks',origin={x:a.x,y:a.y+1.22,z:a.z}){
  const dx=b.x-origin.x,dy=b.y+1.12-origin.y,dz=b.z-origin.z,d=Math.hypot(dx,dy,dz);
  if(d<.001)return true;
  return wallDistance(origin,{x:dx/d,y:dy/d,z:dz/d},d,map)>=d-.025;
}
