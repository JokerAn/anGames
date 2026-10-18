// Presentation reads race telemetry; it never changes handling or race results.
import {clamp,steeringLimit,ROAD_HALF} from './tracks.js';
const finite=(value,fallback=0)=>Number.isFinite(value)?value:fallback;
export function createRandom(seed=1731) {
  let state=seed>>>0;
  return ()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
}
// Exact critically damped spring: equal elapsed time gives equal settling at any Hz.
export function dampSpring(state,target,dt,frequency=14) {
  dt=clamp(finite(dt),0,.1);const offset=state.value-target,j=state.velocity+frequency*offset,decay=Math.exp(-frequency*dt);
  state.value=target+(offset+j*dt)*decay;state.velocity=(state.velocity-frequency*j*dt)*decay;return state.value;
}
export function motionTargets(racer,time=0) {
  const speed=clamp(finite(racer.v),0,95),acceleration=clamp(finite(racer.acceleration),-40,35);
  const lateral=speed*speed/2.8*Math.tan(clamp(finite(racer.steerAngle),-1,1)*steeringLimit(speed));
  const curb=clamp((Math.abs(finite(racer.x))-(ROAD_HALF-1.5))/.6,0,1);
  return {pitch:clamp(-acceleration*.0018,-.05,.065),roll:clamp(lateral*.0038,-.085,.085),heave:speed>.5?Math.sin(time*speed*1.35)*curb*.023:0,curb};
}
export function cameraFrame(racer,track,mode='chase',reduced=false,aspect=16/10) {
  const s=finite(racer.s),lane=finite(racer.x),roadPose=track.sample(s,lane);
  const p={x:finite(racer.worldX,roadPose.x),y:roadPose.y,z:finite(racer.worldZ,roadPose.z)};
  const heading=finite(racer.heading,roadPose.yaw+finite(racer.headingError));
  const reverse=finite(racer.forwardSpeed,finite(racer.v))<-.35||racer.reversing===true;
  const speed=clamp(Math.max(Math.abs(finite(racer.forwardSpeed,finite(racer.v))),Math.hypot(finite(racer.worldVelocityX),finite(racer.worldVelocityZ)))/68,0,1);
  const nose=heading+(reverse?Math.PI:0),vx=finite(racer.worldVelocityX),vz=finite(racer.worldVelocityZ);
  const travel=Math.hypot(vx,vz)>1.5?Math.atan2(vx,vz):nose;
  // Blend angles along their shortest arc, including across the +/- PI seam.
  const slip=Math.abs(finite(racer.slipAngle)),velocityWeight=clamp(.4+slip*.45+(racer.drifting?.15:0),.4,.82);
  const yaw=nose+Math.atan2(Math.sin(travel-nose),Math.cos(travel-nose))*velocityWeight;
  const bonnet=mode==='bonnet',wide=mode==='wide',sign=reverse?-1:1,grade=finite(track.slope(s));
  const sx=Math.sin(bonnet?nose:yaw),sz=Math.cos(bonnet?nose:yaw);
  // Vertical FOV alone crops the road on phones. Ramp a static framing offset
  // below aspect .9, capped at .5 and narrower; render-time damping handles resize.
  const viewportAspect=Number.isFinite(aspect)&&aspect>0?aspect:16/10;
  const portrait=bonnet?0:clamp((.9-viewportAspect)/.4,0,1);
  const distance=bonnet?0:((wide?13:9)+speed*(wide?3.2:2.2))*(1+portrait*.42),height=(wide?4.8:3.05)+speed*(wide?.8:.4)+portrait*1.15;
  const base={anchor:p,mode:bonnet?'bonnet':wide?'wide':'chase',reverse,reduced,resetToken:finite(racer.lastResetPress),distance,roll:0};
  if(bonnet)return {...base,position:{x:p.x+sx*1.18,y:p.y+1.19+grade*sign*1.18,z:p.z+sz*1.18},look:{x:p.x+sx*32,y:p.y+1.19+grade*sign*32,z:p.z+sz*32},fov:66};
  // A rail-safe track projection, translated by the true world offset. The
  // same offset on the look target prevents camera/car disagreement on slides.
  const relative=yaw-roadPose.yaw,cameraS=s-distance*Math.cos(relative);
  const cameraLane=clamp(lane-distance*Math.sin(relative),-ROAD_HALF+.7,ROAD_HALF-.7),behind=track.sample(cameraS,cameraLane);
  const road=track.sample(s+sign*(16+speed*12),lane*.65),preview=reverse?.1:.24;
  const dx=p.x-roadPose.x,dz=p.z-roadPose.z,boost=!reduced&&(racer.boosting||finite(racer.driftBoost)>0);
  return {...base,position:{x:behind.x+dx,y:Math.max(behind.y+1.35,p.y+height-grade*sign*distance*.65),z:behind.z+dz},
    look:{x:(p.x+sx*6)*(1-preview)+(road.x+dx)*preview,y:p.y+1.05+grade*sign*5,z:(p.z+sz*6)*(1-preview)+(road.z+dz)*preview},
    fov:(wide?58:53)+speed*(wide?6:7)+portrait*6+(boost?2.5:0),roll:reduced?0:clamp(-finite(racer.slipAngle)*.027,-.025,.025)};
}
// Shared by the renderer and CPU tests. Teleports/rescues clear the whole rig
// before car interpolation, so neither car nor camera flies across the course.
export function smoothCameraFrame(state,frame,dt,reset=false) {
  dt=clamp(finite(dt),0,.1);
  const moved=state.anchor?Math.hypot(frame.anchor.x-state.anchor.x,frame.anchor.z-state.anchor.z):Infinity;
  const snap=reset||!state.position||state.mode!==frame.mode||state.reverse!==frame.reverse||state.resetToken!==frame.resetToken||moved>24;
  const rate=frame.mode==='bonnet'?24:frame.reduced?7:9,alpha=1-Math.exp(-dt*rate);
  for(const key of ['position','look']){
    if(snap)state[key]={...frame[key]};
    else for(const axis of ['x','y','z'])state[key][axis]+=(frame[key][axis]-state[key][axis])*alpha;
  }
  for(const key of ['fov','roll','distance']){
    if(snap||key==='roll'&&frame.reduced)state[key]=frame[key];
    else if(key==='fov'&&frame.reduced&&!state.reduced)state[key]=Math.min(state[key],frame[key]);
    else state[key]+=(frame[key]-state[key])*(1-Math.exp(-dt*(key==='roll'?8:7)));
  }
  state.anchor={...frame.anchor};state.mode=frame.mode;state.resetToken=frame.resetToken;state.reverse=frame.reverse;state.reduced=frame.reduced;state.snapped=snap;
  return state;
}
export function soundFrame(racer,active,options={}) {
  const r=racer||{},speed=clamp(finite(r.v),0,100),rpm=clamp(finite(r.rpm,900),900,8500),electric=r.engine==='electric',turbo=r.engine==='turbo';
  const powered=r.boosting===true||(options.throttle??finite(r.acceleration)>1);
  const load=r.braking?.12:powered?1:.25,on=active&&racer?1:0,bonnet=options.camera==='bonnet'?1.12:1;
  const slip=speed>10?clamp((r.drifting?.65:0)+Math.max(0,finite(r.gripUsage)-1)*.55+Math.abs(finite(r.vx)-Math.sin(finite(r.headingError))*speed)*.045,0,1):0;
  return {frequency:electric?180+rpm*.12:rpm/60*(turbo?4:3),motorGain:on*(.055+load*.13)*bonnet,
    combustionGain:on*(electric?0:.055+load*.13)*bonnet,electricGain:on*(electric?Math.min(1,speed/3)*(.045+load*.055):0)*bonnet,
    filterFrequency:electric?3600:440+rpm*(.12+load*.13),intakeGain:on*(electric?0:load*.035),
    turboGain:on*(turbo&&powered&&speed>5?.018+rpm*.000002:0),turboFrequency:750+rpm*.24,
    windGain:on*Math.min(.12,speed*speed*.000022),roadGain:on*Math.min(.04,speed*.0006),
    tyreGain:on*slip*.12,tyreFrequency:850+slip*850+speed*4,
    curbGain:on*(speed>2?clamp((Math.abs(finite(r.x))-(ROAD_HALF-1.5))/.6,0,1)*.07:0),boostGain:on*(r.boosting?.065:0)};
}
