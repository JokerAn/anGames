// Independent world-space vehicle motion. Track geometry measures progress and
// contacts; it never supplies a steering command for a human driver.
import {CARS,ENGINES,ROAD_HALF,steeringLimit,clamp,mod,shortDistance} from './tracks.js';
export const GUARDRAIL_OFFSET=ROAD_HALF+4.5;
export const VEHICLE_GRIP=21.5;
const TAU=Math.PI*2,wrap=a=>mod(a+Math.PI,TAU)-Math.PI;
const indexes=new WeakMap();
function indexTrack(track){
  if(indexes.has(track))return indexes.get(track);
  const points=track.points,cumulative=new Float64Array(points.length),grid=new Map(),lengths=new Float64Array(points.length-1);
  for(let i=0;i<points.length-1;i++){
    const a=points[i],b=points[i+1];lengths[i]=Math.hypot(b.x-a.x,b.z-a.z);cumulative[i+1]=cumulative[i]+lengths[i];
    for(let gx=Math.floor(Math.min(a.x,b.x)/32);gx<=Math.floor(Math.max(a.x,b.x)/32);gx++)for(let gz=Math.floor(Math.min(a.z,b.z)/32);gz<=Math.floor(Math.max(a.z,b.z)/32);gz++){
      const key=`${gx}:${gz}`;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(i);
    }
  }
  const data={points,cumulative,lengths,grid,seen:new Uint32Array(lengths.length),generation:0,candidates:[]};indexes.set(track,data);return data;
}
export function projectTrack(track,worldX,worldZ,hintS=0){
  const data=indexTrack(track),gx=Math.floor(worldX/32),gz=Math.floor(worldZ/32),candidates=data.candidates;candidates.length=0;
  data.generation=(data.generation+1)>>>0;if(!data.generation){data.seen.fill(0);data.generation=1;}
  for(let x=gx-1;x<=gx+1;x++)for(let z=gz-1;z<=gz+1;z++)for(const i of data.grid.get(`${x}:${z}`)||[]){if(data.seen[i]!==data.generation){data.seen[i]=data.generation;candidates.push(i);}}
  if(!candidates.length)for(let i=0;i<data.lengths.length;i++)candidates.push(i);
  let nearest=Infinity,result=null;
  for(const i of candidates){
    const a=data.points[i],b=data.points[i+1],length=data.lengths[i];if(length<1e-8)continue;
    const dx=b.x-a.x,dz=b.z-a.z,f=clamp(((worldX-a.x)*dx+(worldZ-a.z)*dz)/(length*length),0,1),x=a.x+dx*f,z=a.z+dz*f,distance=(worldX-x)**2+(worldZ-z)**2;
    if(distance>=nearest)continue;nearest=distance;
    const along=data.cumulative[i]+length*f;
    result={s:hintS+shortDistance(along,mod(hintS,track.length),track.length),x:(worldX-x)*dz/length-(worldZ-z)*dx/length,y:a.y+(b.y-a.y)*f,yaw:Math.atan2(dx,dz),nx:dz/length,nz:-dx/length,worldX:x,worldZ:z};
  }
  return result;
}
function remember(r){
  const synced=r._vehicleSynced||(r._vehicleSynced={});synced.s=r.s;synced.x=r.x;synced.v=r.v;synced.error=r.headingError;
}
export function syncVehicleVelocity(r){
  const sx=Math.sin(r.heading),sz=Math.cos(r.heading),relative=r.headingError||0;
  r.worldVelocityX=sx*r.forwardSpeed+sz*r.sideSpeed;r.worldVelocityZ=sz*r.forwardSpeed-sx*r.sideSpeed;
  r.v=Math.abs(r.forwardSpeed);r.vx=Math.sin(relative)*r.forwardSpeed+Math.cos(relative)*r.sideSpeed;
  remember(r);
}
export function applyLateralImpulse(r,track,amount){
  const p=track.sample(r.s),dx=p.nx*amount,dz=p.nz*amount,sx=Math.sin(r.heading),sz=Math.cos(r.heading);
  r.forwardSpeed+=dx*sx+dz*sz;r.sideSpeed+=dx*sz-dz*sx;syncVehicleVelocity(r);
}
export function syncVehiclePose(r,track){
  const p=track.sample(r.s,r.x);r.worldX=p.x;r.worldZ=p.z;r.heading=wrap(p.yaw+(r.headingError||0));r.forwardSpeed=(r.reversing?-1:1)*(r.v||0);r.sideSpeed=0;r.yawRate=0;r.reverseHold=0;r.slipAngle=0;r.driftBlend=0;
  syncVehicleVelocity(r);return r;
}
export function stepVehicle(r,input,track,dt,options={}){
  dt=clamp(dt,0,.05);if(!dt)return;
  const synced=r._vehicleSynced;
  if(!synced||Math.abs(r.s-synced.s)>.02||Math.abs(r.x-synced.x)>.02||Math.abs((r.headingError||0)-synced.error)>.02)syncVehiclePose(r,track);
  else if(Math.abs(r.v-synced.v)>.02)r.forwardSpeed=Math.sign(r.forwardSpeed||1)*r.v;
  const initialForward=r.forwardSpeed;
  const car=CARS.find(c=>c.id===r.car)||CARS[0],engine=ENGINES.find(e=>e.id===r.engine)||ENGINES[0],speed=Math.abs(r.forwardSpeed),offRoad=Math.abs(r.x)>ROAD_HALF;
  const baseMax=options.baseMaxSpeed||60*car.speed*engine.speed,maxSpeed=options.maxSpeed||baseMax;
  const throttle=input.throttle===true&&!input.brake,braking=input.brake===true,boosted=!braking&&options.boosted===true;
  r.boosting=boosted;r.braking=braking;if(!options.preserveImpact)r.impactThisStep=false;
  r.reverseHold=braking&&!input.park&&r.forwardSpeed<.45?Math.min(1,(r.reverseHold||0)+dt):0;
  let acceleration;
  if(braking&&input.park)acceleration=-Math.sign(r.forwardSpeed)*30*car.grip;
  else if(braking&&r.forwardSpeed>.2)acceleration=-30*car.grip;
  else if(braking&&r.reverseHold>.5)acceleration=r.forwardSpeed>-7?-5:0;
  else if(throttle&&r.forwardSpeed<0)acceleration=20;
  else if(throttle||boosted)acceleration=26*car.accel*engine.accel*(1-.52*clamp(speed/maxSpeed,0,1))*(boosted?clamp(options.boostForce??1.4,1,2):1);
  else acceleration=-Math.sign(r.forwardSpeed)*2.4;
  const grade=track.slope(r.s)*Math.cos(r.headingError||0);
  if(speed>.15||throttle||boosted||braking&&r.reverseHold>.5)acceleration-=Math.sign(r.forwardSpeed||1)*(.0013*speed*speed+(offRoad?7*clamp(speed/6,0,1):0))+grade*9.81;
  if(!throttle&&!boosted&&!braking&&speed<.12){r.forwardSpeed=0;acceleration=0;}
  const before=speed;
  r.steerAngle=(r.steerAngle||0)+(clamp(input.steer||0,-1,1)-(r.steerAngle||0))*(1-Math.exp(-dt*22));
  const wheel=r.steerAngle*steeringLimit(speed),requested=speed*speed/2.8*Math.abs(Math.tan(wheel));
  const handbrake=!braking&&input.drift===true&&r.forwardSpeed>14&&Math.abs(r.steerAngle)>.12;
  // Rear traction builds and recovers progressively, so releasing the handbrake
  // unwinds a slide without snapping the car back onto a racing line.
  r.driftBlend=braking?0:clamp((r.driftBlend||0)+((handbrake?1:0)-(r.driftBlend||0))*(1-Math.exp(-dt*(handbrake?13:7))),0,1);
  const slide=r.driftBlend,grip=VEHICLE_GRIP*car.grip*(offRoad?.52:1)*(1-slide*.24),lateralLimit=grip*(braking&&speed>4?.6:1);
  r.gripUsage=clamp(requested/Math.max(1,lateralLimit),0,2);
  if(r.gripUsage>1)acceleration-=Math.min(12,(r.gripUsage-1)*12);
  if(handbrake)acceleration-=3.2*slide;
  r.forwardSpeed+=acceleration*dt;
  if(braking&&initialForward>.2&&r.forwardSpeed<0)r.forwardSpeed=0;
  if(input.park&&(Math.sign(r.forwardSpeed)!==Math.sign(initialForward)||Math.abs(r.forwardSpeed)<.3))r.forwardSpeed=0;
  if(!throttle&&!boosted&&!braking&&Math.sign(r.forwardSpeed)!==Math.sign(r.forwardSpeed-acceleration*dt))r.forwardSpeed=0;
  r.forwardSpeed=clamp(r.forwardSpeed,-7,maxSpeed+Math.max(0,speed-maxSpeed)*Math.exp(-dt*3));
  const turnAssist=1+slide*.22,yawLimit=lateralLimit/Math.max(speed,4)*(1+slide*.5);
  const targetRate=clamp(r.forwardSpeed/2.8*Math.tan(wheel)*turnAssist,-yawLimit,yawLimit);
  r.yawRate+=(targetRate-r.yawRate)*(1-Math.exp(-dt*(20-slide*7)));
  const oldYaw=r.heading;r.heading=wrap(r.heading+r.yawRate*dt);const turn=wrap(r.heading-oldYaw),long=r.forwardSpeed,side=r.sideSpeed;
  r.forwardSpeed=long*Math.cos(turn)+side*Math.sin(turn);r.sideSpeed=side*Math.cos(turn)-long*Math.sin(turn);
  r.sideSpeed+=clamp(-r.sideSpeed*(18-slide*15.5),-lateralLimit,lateralLimit)*dt;
  const sx=Math.sin(r.heading),sz=Math.cos(r.heading),worldVX=sx*r.forwardSpeed+sz*r.sideSpeed,worldVZ=sz*r.forwardSpeed-sx*r.sideSpeed;
  r.worldX+=worldVX*dt;r.worldZ+=worldVZ*dt;
  // A parked car keeps its existing road progress. Reprojecting its unchanged
  // world point can shift the nearest centre segment at a tight offset corner.
  let pose=Math.abs(worldVX)+Math.abs(worldVZ)>1e-8?projectTrack(track,r.worldX,r.worldZ,r.s):{s:r.s,x:r.x,yaw:track.sample(r.s).yaw},relative=wrap(r.heading-pose.yaw);
  const halfWidth=1.02*Math.abs(Math.cos(relative))+2.25*Math.abs(Math.sin(relative)),edge=GUARDRAIL_OFFSET-halfWidth;
  if(Math.abs(pose.x)>edge){
    const sign=Math.sign(pose.x),p=track.sample(pose.s,sign*edge);r.worldX=p.x;r.worldZ=p.z;
    const outward=(worldVX*p.nx+worldVZ*p.nz)*sign;
    if(outward>0){
      const vx=worldVX-p.nx*sign*outward*1.08,vz=worldVZ-p.nz*sign*outward*1.08,loss=Math.exp(-dt*12);
      r.forwardSpeed=(vx*sx+vz*sz)*loss;r.sideSpeed=(vx*sz-vz*sx)*loss;
      if((r.impactCooldown||0)<=0){r.impactThisStep=true;r.collisions=(r.collisions||0)+1;}
    }
    pose=projectTrack(track,r.worldX,r.worldZ,pose.s);relative=wrap(r.heading-pose.yaw);
  }
  r.s=pose.s;r.x=pose.x;r.headingError=relative;
  r.worldVelocityX=sx*r.forwardSpeed+sz*r.sideSpeed;r.worldVelocityZ=sz*r.forwardSpeed-sx*r.sideSpeed;
  r.v=Math.abs(r.forwardSpeed);r.vx=r.worldVelocityX*pose.nx+r.worldVelocityZ*pose.nz;r.acceleration=(r.v-before)/dt;r.slipAngle=Math.atan2(r.sideSpeed,Math.max(1,r.v));
  r.offRoad=Math.abs(r.x)>ROAD_HALF;r.reversing=r.forwardSpeed<-.1;r.drifting=handbrake||r.v>16&&Math.abs(r.slipAngle)>.16;
  if(r.reversing)r.gear=-1;
  else if(engine.id==='electric')r.gear=1;
  else{r.gear=clamp(r.gear||1,1,6);while(r.gear<6&&r.v>r.gear*11+.6)r.gear++;while(r.gear>1&&r.v<(r.gear-1)*11-2)r.gear--;}
  r.rpm=clamp(engine.id==='electric'?900+r.v*105:900+r.v*[400,240,165,123,99,84][Math.max(0,r.gear-1)],900,7800);
  remember(r);
}
export function driverInput(race,r,track){
  const car=CARS.find(c=>c.id===r.car)||CARS[0],easy=race.difficulty==='easy';
  let target=clamp(-track.curvature(r.s+25)*95,-2.5,2.5)+((r.slot||0)%3-1)*.8;
  const traffic=race.racers.find(a=>a!==r&&a.finishTime===null&&shortDistance(a.s,r.s,track.length)>0&&shortDistance(a.s,r.s,track.length)<18&&Math.abs(a.x-r.x)<2.3);
  if(traffic)target=clamp(traffic.x+(r.slot%2?3:-3),-5,5);
  const obstacle=race.rules==='arcade'&&track.objects.find(o=>['barrier','oil'].includes(o.type)&&shortDistance(o.s,r.s,track.length)>0&&shortDistance(o.s,r.s,track.length)<45&&Math.abs(o.x-target)<3);
  if(obstacle)target=obstacle.x>0?-4:4;
  const ahead=Math.max(9,r.v*.45),curve=track.curvature(r.s+ahead*.6),desiredHeading=track.sample(r.s+ahead).yaw+Math.atan2(target-r.x,ahead);
  const heading=r.heading??track.sample(r.s).yaw+(r.headingError||0),desiredRate=curve*r.v+wrap(desiredHeading-heading)*2.2;
  const steer=clamp(Math.atan(2.8*desiredRate/Math.max(5,r.v))/steeringLimit(r.v),-1,1);
  let limit=easy?46:60;
  for(const distance of [8,22,42,65,95]){const curvature=Math.abs(track.curvature(r.s+distance)),corner=Math.sqrt((easy?8.5:11)*car.grip/Math.max(.001,curvature));limit=Math.min(limit,Math.sqrt(corner*corner+2*22*Math.max(0,distance-12)));}
  const brake=r.v>limit+.7;
  return {steer,throttle:!brake&&r.v<limit+1,brake,drift:false,nitro:!brake&&Math.abs(curve)<.003&&r.v>28&&r.nitro>30&&Math.abs(r.headingError||0)<.08};
}
// Driver guidance only: neither this estimate nor its road arrows write input.
export function recommendedCornerSpeed(curvature,grip=1){
  return clamp(Math.sqrt(VEHICLE_GRIP*.65*grip/Math.max(.002,Math.abs(curvature))),13,65);
}
export function brakingCue(speed,targetSpeed,distance,grip=1,grade=0){
  const deceleration=clamp(23*grip+clamp(grade,-.25,.25)*9.81,14,30),slowing=speed>targetSpeed*1.03;
  const response=slowing?speed*.35+4:0;
  const brakingDistance=slowing?Math.max(0,(speed*speed-targetSpeed*targetSpeed)/(2*deceleration))+response:0;
  const brakeIn=distance-brakingDistance,brakeNow=slowing&&brakeIn<=8;
  return {brakingDistance,brakeIn,brakeNow,approachSpeed:Math.sqrt(targetSpeed*targetSpeed+2*deceleration*Math.max(0,distance-response)),phase:brakeNow?'brake':slowing&&brakeIn<30?'prepare':'approach'};
}
export function cornerAdvice(track,s,racer={}){
  const car=CARS.find(c=>c.id===racer.car)||CARS[0],velocity=Number.isFinite(racer.v)?clamp(racer.v,0,100):0,grip=car.grip*(racer.offRoad?.52:1);
  const horizon=Math.min(250,155+velocity*1.5),segments=[];let segment=null,critical=null;
  for(let d=0;d<=horizon;d+=5){
    const curve=track.curvature(s+d),sign=Math.abs(curve)>=.0045?Math.sign(curve):0;
    if(!sign){segment=null;continue;}
    const target=recommendedCornerSpeed(curve,grip),cue=brakingCue(velocity,target,d,grip,track.slope?.(s+d)||0);
    if(!segment||segment.sign!==sign){segment={sign,entryDistance:d,distance:d,speed:target,cue};segments.push(segment);}
    if(target<segment.speed){segment.speed=target;segment.distance=d;segment.cue=cue;}
    if(!critical||cue.approachSpeed<critical.cue.approachSpeed)critical={sign,entryDistance:segment.entryDistance,distance:d,speed:target,cue};
  }
  if(!segments.length)return {direction:'straight',distance:horizon,entryDistance:horizon,speed:65,severity:'straight',...brakingCue(velocity,65,horizon,grip)};
  // Keep the next bend as the cue unless a tighter section already dictates
  // braking. Each same-direction segment uses its apex, never just its entry.
  const selected=critical?.cue.brakeNow?critical:segments[0],{speed,distance,entryDistance,cue}=selected;
  return {direction:selected.sign>0?'left':'right',distance,entryDistance,speed,severity:speed<22?'hairpin':speed<30?'tight':speed<43?'medium':'fast',...cue};
}
