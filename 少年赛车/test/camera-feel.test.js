import test from 'node:test';
import assert from 'node:assert/strict';
import * as feel from '../src/presentation.js';
const track={sample:(s,x=0)=>({x,y:0,z:s,yaw:0,nx:1,nz:0}),slope:()=>0};
const racer={s:100,x:0,v:35,heading:0,headingError:0,worldX:0,worldZ:100,worldVelocityX:0,worldVelocityZ:35,forwardSpeed:35};
const close=(a,b,tolerance=1e-8)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
const direction=frame=>Math.atan2(frame.look.x-frame.position.x,frame.look.z-frame.position.z);
const smooth=(...args)=>{assert.equal(typeof feel.smoothCameraFrame,'function');return feel.smoothCameraFrame(...args);};

test('world pose offsets translate both chase and bonnet rigs without changing the race actor',()=>{
  for(const mode of ['chase','bonnet','wide']){
    const r={...racer,worldX:3,worldZ:104},before=structuredClone(r),a=feel.cameraFrame(racer,track,mode),b=feel.cameraFrame(r,track,mode);
    close(b.position.x-a.position.x,3);close(b.position.z-a.position.z,4);close(b.look.x-a.look.x,3);close(b.look.z-a.look.z,4);assert.deepEqual(r,before);
  }
});
test('bonnet uses authoritative world heading when track heading telemetry disagrees',()=>{
  const frame=feel.cameraFrame({...racer,heading:.6,headingError:-.4},track,'bonnet');close(direction(frame),.6);
});
test('sideways chase balances velocity, nose and the road while keeping the car in view',()=>{
  const frame=feel.cameraFrame({...racer,heading:1.2,headingError:1.2,drifting:true,slipAngle:-1.2},track);
  assert.ok(Math.abs(direction(frame))<.55,'the rig must not swing to the sideways nose');
  const carYaw=Math.atan2(racer.worldX-frame.position.x,racer.worldZ-frame.position.z);
  assert.ok(Math.abs(direction(frame)-carYaw)<frame.fov*Math.PI/360*.8,'car remains inside the central view');
});
test('reverse chase shows the road in the actual direction of travel',()=>{
  const frame=feel.cameraFrame({...racer,v:6,forwardSpeed:-6,reversing:true,worldVelocityZ:-6},track);
  assert.ok(frame.position.z>racer.worldZ);assert.ok(frame.look.z<racer.worldZ);assert.equal(frame.reverse,true);
});
test('wide adds useful chase distance and elevation at both low and high speeds',()=>{
  for(const v of [0,65]){const a=feel.cameraFrame({...racer,v},track),b=feel.cameraFrame({...racer,v},track,'wide');assert.ok(b.distance>a.distance+2);assert.ok(b.position.y>a.position.y+1);assert.ok(b.fov>=a.fov);}
});
test('reduced motion removes roll and boost/drift FOV pulses but retains speed visibility',()=>{
  const r={...racer,drifting:true,slipAngle:.7,driftDirection:1,driftTier:3,driftBoost:1,boosting:true},normal=feel.cameraFrame(r,track),reduced=feel.cameraFrame(r,track,'chase',true),base=feel.cameraFrame({...r,boosting:false,driftBoost:0},track,'chase',true);
  assert.ok(Math.abs(normal.roll)>0);assert.equal(reduced.roll,0);assert.equal(reduced.fov,base.fov);assert.ok(normal.fov>reduced.fov);
});
test('camera distance, aim, FOV and roll settle consistently at 30/60/120Hz',()=>{
  const results=[];
  for(const hz of [30,60,120]){const state={};smooth(state,feel.cameraFrame({...racer,v:0},track),0);for(let i=0;i<hz;i++)smooth(state,feel.cameraFrame({...racer,v:65,drifting:true,slipAngle:.6},track),1/hz);results.push(state);}
  for(const b of results.slice(1))for(const field of ['fov','roll','distance'])close(b[field],results[0][field]);
  for(const b of results.slice(1))for(const key of ['x','y','z']){close(b.position[key],results[0].position[key]);close(b.look[key],results[0].look[key]);}
});
test('far teleports snap the rig immediately and clear old camera motion',()=>{
  const state={};smooth(state,feel.cameraFrame(racer,track),.016);const target=feel.cameraFrame({...racer,s:400,worldX:90,worldZ:400,v:0},track);
  smooth(state,target,.016);assert.deepEqual(state.position,target.position);assert.deepEqual(state.look,target.look);assert.equal(state.snapped,true);assert.equal(state.fov,target.fov);
});
test('reset button token snaps even when recovery is near the previous position',()=>{
  const state={};smooth(state,feel.cameraFrame({...racer,lastResetPress:0},track),.016);const target=feel.cameraFrame({...racer,heading:.8,headingError:.8,lastResetPress:1,v:0},track);
  smooth(state,target,.016);assert.deepEqual(state.position,target.position);assert.equal(state.snapped,true);
});
test('mode changes snap and reduced motion cancels residual roll immediately',()=>{
  const state={};smooth(state,feel.cameraFrame({...racer,drifting:true,slipAngle:.7},track),.016);const wide=feel.cameraFrame(racer,track,'wide');smooth(state,wide,.016);assert.deepEqual(state.position,wide.position);
  smooth(state,feel.cameraFrame(racer,track,'wide',true),.016);assert.equal(state.roll,0);
});
test('ordinary motion is damped instead of snapping and malformed telemetry remains finite',()=>{
  const state={},a=feel.cameraFrame(racer,track);smooth(state,a,.016);const b=feel.cameraFrame({...racer,s:101,worldZ:101,v:65},track);smooth(state,b,.016);assert.equal(state.snapped,false);assert.ok(state.position.z>a.position.z&&state.position.z<b.position.z);
  const frame=feel.cameraFrame({s:100,x:0,v:NaN,heading:Infinity,worldX:NaN,worldVelocityX:Infinity},track);for(const p of [frame.position,frame.look])assert.ok(Object.values(p).every(Number.isFinite));
});

test('switching into reverse cannot interpolate the chase camera through the car',()=>{
  const state={};smooth(state,feel.cameraFrame(racer,track),.016);const reverse=feel.cameraFrame({...racer,v:5,forwardSpeed:-5,reversing:true,worldVelocityZ:-5},track);
  smooth(state,reverse,.016);assert.equal(state.snapped,true);assert.deepEqual(state.position,reverse.position);
});

// The production /vendor import maps to this same installed Three build. Only
// module URLs and the smoke canvas are adapted; no WebGL/browser is started.
const {readFile}=await import('node:fs/promises');
const displayModules=new Map();
async function displayModule(name){
  if(displayModules.has(name))return displayModules.get(name);
  let source=await readFile(new URL(`../src/${name}`,import.meta.url),'utf8');
  const imports=[...source.matchAll(/from '([^']+)'/g)];
  for(const match of imports){
    const spec=match[1];let url;
    if(spec==='/vendor/three.module.js')url=import.meta.resolve('three');
    else if(['./effects.js','./course-guidance.js'].includes(spec))url=await displayModule(spec.slice(2));
    else url=new URL(spec,new URL(`../src/${name}`,import.meta.url)).href;
    source=source.replace(`from '${spec}'`,`from '${url}'`);
  }
  const url=`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;displayModules.set(name,url);return url;
}
const THREE=await import('three');
const {RaceEffects}=await import(await displayModule('effects.js'));
const {RaceRenderer}=await import(await displayModule('renderer.js'));
function newEffects(){
  const oldDocument=globalThis.document;
  globalThis.document={createElement:()=>({getContext:()=>({createRadialGradient:()=>({addColorStop(){}}),fillRect(){}})})};
  try{return new RaceEffects();}finally{if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;}
}
function carModel(){
  const car=new THREE.Group();car.position.set(0,.025,100);car.userData.wheels=[];
  for(const x of [-.9,.9]){const pivot=new THREE.Group();pivot.position.set(x,.45,-1);car.add(pivot);car.userData.wheels.push({front:false,pivot});}
  return car;
}
test('camera mode supports the setter, method and a three-view cycle while rejecting invalid modes',()=>{
  const renderer=Object.create(RaceRenderer.prototype);renderer.cameraMode='chase';renderer.cameraReady=true;
  assert.equal(renderer.setCameraMode('wide'),'wide');assert.equal(renderer.cameraReady,false);renderer.cameraMode='bonnet';assert.equal(renderer.cameraMode,'bonnet');
  assert.equal(renderer.toggleCamera(),'wide');assert.equal(renderer.toggleCamera(),'chase');assert.equal(renderer.toggleCamera(),'bonnet');assert.equal(renderer.setCameraMode('invalid'),'bonnet');
});
test('tiered rear-tyre sparks use the shared pool and identify each charge tier',()=>{
  for(const tier of [1,2,3]){const effects=newEffects(),car=carModel();for(let i=0;i<12;i++)effects.emitTyres({...racer,id:'p',drifting:true,driftTier:tier},car,track,1/60,36,false);
    effects.update(1/60,new THREE.PerspectiveCamera(),36);assert.ok(effects.diagnostics.driftSparks>0);assert.ok(effects.pool.filter(p=>p.life>0&&p.spark).every(p=>p.tier===tier));effects.releaseGPU();}
});
test('burst rings and sparks together respect every device quality budget and expire',()=>{
  for(const budget of [18,36,64,96]){const effects=newEffects(),car=carModel(),camera=new THREE.PerspectiveCamera(),geometry=effects.rings.geometry;
    for(let i=0;i<40;i++){effects.itemEvent({type:'item',item:'pulse'},car,budget);effects.impact(car,budget);}
    effects.update(1/60,camera,budget);assert.ok(effects.diagnostics.itemVFX>0);assert.ok(effects.diagnostics.particles+effects.diagnostics.itemVFX<=budget);assert.equal(effects.itemPool.length,12);assert.equal(effects.rings.geometry,geometry);assert.equal(effects.group.children.length,4);
    for(let i=0;i<20;i++)effects.update(.1,camera,budget);assert.equal(effects.diagnostics.itemVFX,0);assert.equal(effects.diagnostics.particles,0);effects.releaseGPU();}
});
test('item hit and shield diagnostics retain the source and attacker for browser inspection',()=>{
  const effects=newEffects(),car=carModel();effects.itemEvent({type:'hit',source:'oil',attacker:'rival'},car,36);effects.itemEvent({type:'shield',source:'pulse',attacker:'rival'},car,36);effects.update(.016,new THREE.PerspectiveCamera(),36);
  const active=effects.diagnostics.activeItemVFX;assert.equal(active[0].item,'oil');assert.equal(active[0].source,'oil');assert.equal(active[1].item,'shield');assert.equal(active[1].source,'pulse');assert.ok(active.every(v=>v.attacker==='rival'));effects.releaseGPU();
});
test('reduced motion cancels existing particles and keeps a small, fading pickup signal',()=>{
  const effects=newEffects(),car=carModel(),camera=new THREE.PerspectiveCamera();effects.impact(car,36);effects.itemEvent({type:'pickup',item:'nitro'},car,36,true);effects.update(.016,camera,36,true);
  assert.equal(effects.diagnostics.particles,0);assert.equal(effects.diagnostics.itemVFX,1);const matrix=new THREE.Matrix4();effects.rings.getMatrixAt(0,matrix);assert.ok(new THREE.Vector3().setFromMatrixScale(matrix).x<1.2);
  effects.reset();assert.equal(effects.diagnostics.itemVFX,0);assert.equal(effects.diagnostics.activeItemVFX.length,0);let disposed=0;effects.rings.geometry.addEventListener('dispose',()=>disposed++);effects.rings.material.addEventListener('dispose',()=>disposed++);effects.releaseGPU();assert.equal(disposed,2);
});

test('unsuccessful item and pickup notices create no VFX and cannot overwrite active feedback',()=>{
  const effects=newEffects(),car=carModel(),camera=new THREE.PerspectiveCamera();
  const notices=[
    {type:'item',item:'pulse',used:false,reason:'no-target'},
    {type:'pickup',item:'shield',awarded:false},
    {type:'pickup',item:'nitro',full:true},
    {type:'pickup',item:'oil',awarded:false,full:true},
    {type:'full',item:'oil'},
  ];
  try{
    for(const event of notices)effects.itemEvent(event,car,96);
    effects.update(.016,camera,96);
    assert.equal(effects.diagnostics.itemVFX,0,'unsuccessful notices must not render rings');
    assert.equal(effects.diagnostics.particles,0,'unsuccessful notices must not render sparks');
    // Keep legacy unflagged events working, then fill the ring pool. Rejected
    // notices must not consume slots or replace already playing feedback.
    for(let i=0;i<12;i++)effects.itemEvent({type:'pickup',item:'shield'},car,96);
    effects.itemEvent({type:'drift',tier:3,boostDuration:1},car,96);
    const rings=structuredClone(effects.itemPool),particles=structuredClone(effects.pool),cursor=effects.itemCursor;
    for(let i=0;i<4;i++)for(const event of notices)effects.itemEvent(event,car,96);
    assert.deepEqual(structuredClone(effects.itemPool),rings);
    assert.deepEqual(structuredClone(effects.pool),particles);
    assert.equal(effects.itemCursor,cursor);
    effects.reset();
    for(const event of [{type:'item',item:'pulse',used:true},{type:'pickup',item:'nitro',awarded:true,full:false},{type:'pickup',item:'shield'}])effects.itemEvent(event,car,36);
    effects.update(.016,camera,36);assert.equal(effects.diagnostics.itemVFX,3,'successful and legacy events still play');
  }finally{effects.releaseGPU();}
});

test('narrow portrait chase and wide rigs add bounded distance, height and FOV without losing road preview',()=>{
  for(const mode of ['chase','wide'])for(const v of [0,65]){
    const r={...racer,v,forwardSpeed:v,worldVelocityZ:v},landscape=feel.cameraFrame(r,track,mode,false,16/10),portrait=feel.cameraFrame(r,track,mode,false,390/844);
    assert.ok(portrait.distance>landscape.distance*1.4,'portrait must pull the rig back');
    assert.ok(portrait.distance<=landscape.distance*1.42+1e-8,'distance increase is capped at 42%');
    close(portrait.position.y-landscape.position.y,1.15);close(portrait.fov-landscape.fov,6);
    assert.deepEqual(portrait.look,landscape.look,'preserve the forward bend preview');
    assert.deepEqual(feel.cameraFrame(r,track,mode),landscape,'the default remains 16/10');
    for(const aspect of [.9,1,2])assert.deepEqual(feel.cameraFrame(r,track,mode,false,aspect),landscape,'only narrow portrait receives compensation');
  }
});
test('portrait compensation ramps gradually and stays capped for extremely narrow viewports',()=>{
  const frame=aspect=>feel.cameraFrame(racer,track,'chase',false,aspect),base=frame(1.6),narrow=frame(390/844),middle=frame(.7);
  assert.ok(middle.distance>base.distance&&middle.distance<narrow.distance);
  assert.ok(middle.position.y>base.position.y&&middle.position.y<narrow.position.y);
  assert.ok(middle.fov>base.fov&&middle.fov<narrow.fov);
  const tiny=frame(.01);assert.ok(tiny.distance<=base.distance*1.42+1e-8);assert.ok(tiny.fov<=base.fov+6);assert.ok(tiny.position.y<=base.position.y+1.15+1e-8);
});
test('real perspective projection reduces a 75 percent portrait car width toward 45 to 50 percent',()=>{
  const aspect=390/844,width=frame=>{
    const camera=new THREE.PerspectiveCamera(frame.fov,aspect,.2,850);camera.position.set(frame.position.x,frame.position.y,frame.position.z);camera.lookAt(frame.look.x,frame.look.y,frame.look.z);camera.updateMatrixWorld();
    const a=new THREE.Vector3(-1.05,.8,racer.worldZ).project(camera),b=new THREE.Vector3(1.05,.8,racer.worldZ).project(camera);return Math.abs(b.x-a.x)/2;
  };
  for(const mode of ['chase','wide']){
    const legacy=feel.cameraFrame(racer,track,mode,false,16/10),portrait=feel.cameraFrame(racer,track,mode,false,aspect),calibrated=.75*width(portrait)/width(legacy);
    assert.ok(calibrated>=.45&&calibrated<=.5,`${mode}: calibrated occupied width ${calibrated}`);
  }
});
test('reduced motion keeps static portrait visibility while excluding drift and boost pulses',()=>{
  const r={...racer,boosting:true,driftBoost:1,slipAngle:.7},portrait=feel.cameraFrame(r,track,'chase',true,390/844),landscape=feel.cameraFrame(r,track,'chase',true,16/10),unboosted=feel.cameraFrame({...r,boosting:false,driftBoost:0},track,'chase',true,390/844);
  assert.ok(portrait.distance>landscape.distance);close(portrait.fov-landscape.fov,6);assert.equal(portrait.roll,0);assert.equal(portrait.fov,unboosted.fov);
});
test('invalid aspects fall back to the finite default in all camera modes',()=>{
  for(const mode of ['chase','wide','bonnet'])for(const aspect of [0,-1,NaN,Infinity,-Infinity,null,'portrait']){
    const frame=feel.cameraFrame(racer,track,mode,false,aspect),base=feel.cameraFrame(racer,track,mode);
    assert.deepEqual(frame,base);for(const p of [frame.position,frame.look])assert.ok(Object.values(p).every(Number.isFinite));for(const key of ['distance','roll','fov'])assert.ok(Number.isFinite(frame[key]));
  }
});
