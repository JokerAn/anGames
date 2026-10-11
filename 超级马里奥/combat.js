// Pure combat rules shared by the game and regression tests.
export const MAX_AMMO = 30;
export const AMMO_PER_PICKUP = { easy:12, hard:8 };
export const SHOT_COOLDOWN = .25;
export const MAX_PROJECTILES = 6;
export const BULLET_SPEED = 650;
export const BULLET_LIFETIME = .95;
// Classic fireball physics: the shot hops along the ground instead of flying in
// a dead-straight line. Vertical velocity and a bounce send it skipping forward.
// Sub-stepping keeps the hop stable no matter how large the frame delta is.
export const BULLET_GRAVITY = 2100;
export const BULLET_BOUNCE = 470;
export const BULLET_STEP = 1/120;

// Earliest contact of a swept AABB (fromX,fromY -> toX,toY) with an expanded target box.
// Sweeping the entire step prevents fast bullets tunnelling through thin walls.
export function sweptImpact(fromX,fromY,toX,toY,target,halfWidth=7,halfHeight=4){
  const left=target.x-halfWidth,right=target.x+target.w+halfWidth,top=target.y-halfHeight,bottom=target.y+target.h+halfHeight;
  const dx=toX-fromX,dy=toY-fromY;
  let t0=0,t1=1;
  const clip=(p,q)=>{if(p===0)return q>=0;const r=q/p;if(p<0){if(r>t1)return false;if(r>t0)t0=r;}else{if(r<t0)return false;if(r<t1)t1=r;}return true;};
  if(!clip(-dx,fromX-left))return null;
  if(!clip(dx,right-fromX))return null;
  if(!clip(-dy,fromY-top))return null;
  if(!clip(dy,bottom-fromY))return null;
  return t0;
}

// Earliest contact of a horizontal projectile with an expanded target box.
// Kept for callers/tests that only sweep on the X axis.
export function horizontalImpact(fromX,toX,y,target,halfWidth=7,halfHeight=4){
  return sweptImpact(fromX,y,toX,y,target,halfWidth,halfHeight);
}

// Highest solid surface at/below the shot's column, so it can land and bounce.
// In this level format a solid's TOP face is `y` and it extends DOWN by `h`
// (ground blocks are {y:550,h:500}), so the surface a fireball hops on is `y`.
function supportTop(blockers,x){
  let top=Infinity;
  for(const wall of blockers){if(x>=wall.x-6&&x<=wall.x+wall.w+6&&wall.y<top)top=wall.y;}
  return top;
}

export function advanceProjectiles(projectiles,blockers,enemies,dt){
  const events=[];
  if(dt<=0)return events;
  let kept=0;
  for(const bullet of projectiles){
    if(bullet.life<=0)continue;
    let fromX=bullet.originX??bullet.x,fromY=bullet.originY??bullet.y;
    delete bullet.originX;delete bullet.originY;
    let vx=bullet.vx,vy=bullet.vy??0;
    let x=bullet.x,y=bullet.y,life=bullet.life;
    // First sub-step starts from the drawn muzzle when the spawn frame provided
    // one, so a point-blank enemy behind the hand still gets swept.
    let segX=fromX,segY=fromY;
    let hit=null;
    // Advance in fixed sub-steps: stable hop and no tunnelling at any frame rate.
    let remaining=Math.min(dt,Math.max(0,life));
    let guard=0;
    while(remaining>1e-6&&guard++<512){
      const step=Math.min(BULLET_STEP,remaining);remaining-=step;
      const toX=x+vx*step,toY=y+vy*step;
      // Classic fireball hop: gravity pulls the shot down and it bounces off the
      // ground, skipping along the track. Screen Y grows downward, so "on the
      // ground" means a LARGER y than the surface's top face (`wall.y`).
      const top=supportTop(blockers,toX);
      let nextY=toY,nextVy=vy+BULLET_GRAVITY*step;
      if(nextY>=top&&vy>=0){nextY=top;nextVy=-Math.abs(vy||BULLET_BOUNCE);}
      let first=null;
      for(const wall of blockers){
        const time=sweptImpact(segX,segY,toX,nextY,wall);
        if(time===null)continue;
        const iy=segY+(nextY-segY)*time;
        const bottom=wall.y+(wall.h??wall.height??0);
        // Landing on a top/bottom face is the hop, not a fatal wall. Only a SIDE
        // face stops the shot, so the fireball survives its own bounces.
        if(Math.abs(iy-wall.y)<5||Math.abs(iy-bottom)<5)continue;
        if(!first||time<first.time)first={time,kind:'wall',wall};
      }
      for(const enemy of enemies){
        if(enemy.dead)continue;
        const time=sweptImpact(segX,segY,toX,nextY,enemy);
        if(time!==null&&(!first||time<first.time))first={time,kind:'enemy',enemy};
      }
      if(first){
        hit={...first,x:segX+(toX-segX)*first.time,y:segY+(nextY-segY)*first.time};
        life=0;break;
      }
      x=toX;y=nextY;vy=nextVy;segX=x;segY=y;
    }
    fromX=fromY=undefined;
    if(hit){
      if(hit.kind==='enemy')hit.enemy.dead=true;
      events.push(hit);continue;
    }
    life-=dt;
    bullet.x=x;bullet.y=y;bullet.vy=vy;
    if(life>0){bullet.life=life;projectiles[kept++]=bullet;}
  }
  projectiles.length=kept;
  return events;
}
