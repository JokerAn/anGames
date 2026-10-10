// Shared deterministic rules: runs locally for solo and on the server for LAN.
import { WORLD, MAPS, getMap } from './maps.js';
import { findPath, groundClear, navigationGoal } from './navigation.js';
export { findPath, groundClear } from './navigation.js';
export { WORLD, MAPS, getMap } from './maps.js';
export const WEAPONS = {
  blaster: { name: '泡泡突击步枪', short: '泡泡步枪', icon: '↗', color: '#ffb84a', damage: 22, interval: .19, spread: .018, range: 60, pellets: 1, speed: 1, desc: '全能选手，稳稳命中', sound: 250 },
  smg: { name: '糖果冲锋枪', short: '糖果冲锋', icon: 'ϟ', color: '#ab90e4', damage: 12, interval: .09, spread: .048, range: 28, pellets: 1, speed: 1.13, desc: '轻巧灵活，快乐连发', sound: 420 },
  shotgun: { name: '彩虹散弹枪', short: '彩虹散弹', icon: '≋', color: '#f489aa', damage: 15, interval: .78, spread: .13, range: 18, pellets: 7, speed: .95, desc: '近距离，一次七颗彩球', sound: 130 },
  sniper: { name: '星星狙击枪', short: '星星狙击', icon: '✧', color: '#6fbec5', damage: 72, interval: 1.1, spread: .003, range: 80, pellets: 1, speed: .88, desc: '慢慢瞄准，远距离发光', sound: 620 },
};
export const AI_LEVELS = Object.freeze({
  easy:Object.freeze({speed:3.8,interval:2.1,damage:.55,spread:.038,turnRate:3.3,reaction:.42,burst:1.05,pause:.72,think:.26}),
  hard:Object.freeze({speed:4.6,interval:1.55,damage:.8,spread:.012,turnRate:5.8,reaction:.2,burst:1.5,pause:.32,think:.16}),
});
export function cameraFraming(actor,aim=false){
  const aspect=clamp(finite(actor.viewAspect,16/9),.4,3),portraitScale=Math.min(1,aspect);
  return {distance:aim?3.2:5.7,shoulder:(aim?1.16:1.65)*portraitScale,height:aim?2:2.12};
}
export const isWeapon = key => typeof key==='string' && Object.hasOwn(WEAPONS,key);
export const OBSTACLES = getMap().obstacles; // Backward-compatible default for callers.
export const clamp = (n,a,b) => Math.min(b,Math.max(a,n));
export const finite = (n, fallback=0) => Number.isFinite(Number(n)) ? Number(n) : fallback;
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
  addActor(info){const a={...info,x:0,z:0,y:0,vy:0,yaw:0,pitch:0,hp:100,kills:0,deaths:0,cooldown:.8,respawn:0,shield:2,lastHit:-20,lastAttacker:null,lastStep:0,viewAspect:16/9,input:{},path:[],pathTime:0,weaponChoice:info.weapon||'blaster',weapon:'blaster'};this.actors.push(a);this.actorIndex.set(a.id,a);this.spawn(a);return a;}
  spawn(a){
    const sign=a.team==='blue'?1:-1;let best={x:0,z:sign*21},bestDistance=-1;
    for(let i=0;i<12;i++){const p={x:(this.random()-.5)*38,z:sign*(18+this.random()*5)};if(blocked(p.x,p.z,.48,this.config.map))continue;const enemyDistance=Math.min(100,...this.actors.filter(b=>b.team!==a.team&&b.hp>0).map(b=>Math.hypot(p.x-b.x,p.z-b.z)));const allyDistance=Math.min(8,...this.actors.filter(b=>b.id!==a.id&&b.team===a.team&&b.hp>0).map(b=>Math.hypot(p.x-b.x,p.z-b.z)));const d=enemyDistance+allyDistance*3;if(d>bestDistance){best=p;bestDistance=d;}}
    a.x=best.x;a.z=best.z;a.y=0;a.vy=0;a.hp=100;a.shield=2;a.respawn=0;a.pitch=a.bot?0:-.12;a.yaw=a.team==='blue'?0:Math.PI;a.path=[];a.pathIndex=0;a.pathTime=0;a.routeGoal=-1;a.routeTarget=null;a.targetId=null;a.thinkTime=0;a.canShoot=false;a.fireReadyAt=this.time;a.lastAttacker=null;a.lastHit=-20;a.strafeSign=this.actors.indexOf(a)%2?-1:1;a.navMoving=false;a.stuckTime=0;a.navX=a.x;a.navZ=a.z;a.input.weapon=undefined;
    a.weapon=a.weaponChoice==='random'?Object.keys(WEAPONS)[Math.floor(this.random()*4)]:a.weaponChoice;if(!isWeapon(a.weapon))a.weapon='blaster';
  }
  setInput(id,input){const a=this.actors.find(a=>a.id===id&&!a.bot);if(a)a.input=sanitizeInput(input);}
  stopInput(id){const a=this.actorIndex.get(id);if(a&&!a.bot)a.input=sanitizeInput({yaw:a.yaw,pitch:a.pitch});}
  event(e){this.events.push({...e,id:++this.eventId});}
  ai(a,dt){
    const map=this.config.map,hard=a.difficulty==='hard',level=AI_LEVELS[a.difficulty]||AI_LEVELS.easy;
    a.thinkTime-=dt;let target=this.actorIndex.get(a.targetId);
    if(!target||target.hp<=0||target.team===a.team||a.thinkTime<=0){
      let nearest=null,nearestDistance=Infinity,seen=null,seenDistance=Infinity,human=null,humanDistance=Infinity,seenHuman=null,seenHumanDistance=Infinity;
      const oldTarget=a.targetId,wasVisible=a.canShoot;
      for(const candidate of this.actors){
        if(candidate.hp<=0||candidate.team===a.team)continue;
        const d=(a.x-candidate.x)**2+(a.z-candidate.z)**2;
        const clear=combatVisible(a,candidate,map);
        if(d<nearestDistance){nearest=candidate;nearestDistance=d;}
        if(clear&&d<seenDistance){seen=candidate;seenDistance=d;}
        if(!candidate.bot){if(d<humanDistance){human=candidate;humanDistance=d;}if(clear&&d<seenHumanDistance){seenHuman=candidate;seenHumanDistance=d;}}
      }
      const attacker=this.actorIndex.get(a.lastAttacker);
      const retaliate=attacker&&attacker.hp>0&&attacker.team!==a.team&&this.time-a.lastHit<2.5&&combatVisible(a,attacker,map);
      // Keep pressure on real opponents instead of getting permanently occupied
      // by distant bot-v-bot firefights; defend against a nearby recent attacker.
      target=retaliate&&(!attacker.bot||Math.hypot(attacker.x-a.x,attacker.z-a.z)<6)?attacker:seenHuman||human||seen||nearest;
      a.targetId=target?.id||null;a.canShoot=!!target&&combatVisible(a,target,map);
      if(oldTarget!==a.targetId||!wasVisible&&a.canShoot)a.fireReadyAt=this.time+level.reaction;
      a.thinkTime=level.think+(this.actors.indexOf(a)%5)*.011;
    }
    if(!target){a.navMoving=false;return {};}
    const dx=target.x-a.x,dz=target.z-a.z,dist=Math.hypot(dx,dz),bearing=Math.atan2(-dx,-dz);
    const clearShot=a.canShoot&&combatVisible(a,target,map,muzzlePosition(a,map));
    const preferred=a.weapon==='shotgun'?(hard?6:5):a.weapon==='sniper'?(hard?20:15):a.weapon==='smg'?(hard?10:8):hard?14:11;
    const traveled=Math.hypot(a.x-a.navX,a.z-a.navZ);
    a.stuckTime=a.navMoving&&traveled<.001?a.stuckTime+dt:0;a.navX=a.x;a.navZ=a.z;
    let wx=0,wz=0;a.navMoving=false;
    if(!clearShot||dist>preferred){
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
        if(len>.015){const amount=Math.min(1,len/Math.max(.001,level.speed*WEAPONS[a.weapon].speed*dt));wx=(next.x-a.x)/len*amount;wz=(next.z-a.z)/len*amount;a.navMoving=true;}
      }
    }else if(hard){
      const retreat=dist<(a.weapon==='sniper'?9:3)?.55:0;
      wx=Math.cos(bearing)*a.strafeSign*.6-dx/Math.max(.01,dist)*retreat;
      wz=-Math.sin(bearing)*a.strafeSign*.6-dz/Math.max(.01,dist)*retreat;
      if(!groundClear(a,{x:a.x+wx*.8,z:a.z+wz*.8},map)){a.strafeSign*=-1;wx=-wx;wz=-wz;if(!groundClear(a,{x:a.x+wx*.8,z:a.z+wz*.8},map)){wx=0;wz=0;}}
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
      if(a.hp<100&&this.time-a.lastHit>5)a.hp=Math.min(100,a.hp+dt*8);
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
    for(let pellet=0;pellet<w.pellets;pellet++){
      const spread=w.spread*(aim?.45:1)+(a.bot?(AI_LEVELS[a.difficulty]||AI_LEVELS.easy).spread:0);
      const yaw=shotYaw+(this.random()-.5)*spread*2,pitch=shotPitch+(this.random()-.5)*spread*2;
      const dir=viewDirection(yaw,pitch),hit=traceRay(origin,dir,w.range,this.actors,a,map),victim=hit.victim;
      if(victim&&victim.shield<=0){
        const damage=w.damage*(a.bot?(AI_LEVELS[a.difficulty]||AI_LEVELS.easy).damage:1);victim.hp=Math.max(0,victim.hp-damage);victim.lastHit=this.time;victim.lastAttacker=a.id;
        this.event({type:'hit',actor:a.id,target:victim.id,damage,x:victim.x,y:victim.y+1.2,z:victim.z});
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
  let distance=wallDistance(origin,dir,max,map),victim=null;
  for(const b of actors){
    if(b.id===shooter.id||b.hp<=0||b.team===shooter.team)continue;
    for(const height of [.72,1.43]){
      const dx=b.x-origin.x,dy=b.y+height-origin.y,dz=b.z-origin.z,t=dx*dir.x+dy*dir.y+dz*dir.z;
      const perpendicular=dx*dx+dy*dy+dz*dz-t*t,radius=height>1?.48:.62;
      if(t<0||perpendicular>radius*radius)continue;
      const hit=t-Math.sqrt(radius*radius-perpendicular);if(hit>=0&&hit<distance){distance=hit;victim=b;}
    }
  }
  return {distance,victim};
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
