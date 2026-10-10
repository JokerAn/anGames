// Pure combat rules shared by the game and regression tests.
export const MAX_AMMO = 30;
export const AMMO_PER_PICKUP = { easy:12, hard:8 };
export const SHOT_COOLDOWN = .25;
export const MAX_PROJECTILES = 6;
export const BULLET_SPEED = 650;
export const BULLET_LIFETIME = .95;

// Earliest contact of a horizontal projectile with an expanded target box.
// Sweeping the entire step prevents fast bullets tunnelling through thin walls.
export function horizontalImpact(fromX,toX,y,target,halfWidth=7,halfHeight=4){
  if(y+halfHeight<target.y||y-halfHeight>target.y+target.h)return null;
  const left=target.x-halfWidth,right=target.x+target.w+halfWidth;
  if(fromX>=left&&fromX<=right)return 0;
  const dx=toX-fromX;
  if(dx>0&&fromX<left&&toX>=left)return(left-fromX)/dx;
  if(dx<0&&fromX>right&&toX<=right)return(right-fromX)/dx;
  return null;
}

export function advanceProjectiles(projectiles,blockers,enemies,dt){
  const events=[];
  if(dt<=0)return events;
  let kept=0;
  for(const bullet of projectiles){
    if(bullet.life<=0)continue;
    // Also trace from the player's hand on the spawn frame: the drawn muzzle
    // can extend into a close enemy or even beyond a thin obstacle.
    const fromX=bullet.originX??bullet.x,toX=bullet.x+bullet.vx*Math.min(dt,Math.max(0,bullet.life));
    delete bullet.originX;
    let first=null;
    for(const wall of blockers){
      const time=horizontalImpact(fromX,toX,bullet.y,wall);
      if(time!==null&&(!first||time<first.time))first={time,kind:'wall'};
    }
    for(const enemy of enemies){
      if(enemy.dead)continue;
      const time=horizontalImpact(fromX,toX,bullet.y,enemy);
      if(time!==null&&(!first||time<first.time))first={time,kind:'enemy',enemy};
    }
    bullet.life-=dt;
    if(first){
      if(first.enemy)first.enemy.dead=true;
      events.push({...first,x:fromX+(toX-fromX)*first.time,y:bullet.y});
      continue;
    }
    bullet.x=toX;
    if(bullet.life>0)projectiles[kept++]=bullet;
  }
  projectiles.length=kept;
  return events;
}
