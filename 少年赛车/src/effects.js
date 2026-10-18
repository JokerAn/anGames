import * as THREE from '/vendor/three.module.js';
import {createRandom,soundFrame} from './presentation.js';

let smokeMap;
function smokeTexture(){
  if(smokeMap)return smokeMap;
  const size=128,canvas=document.createElement('canvas');canvas.width=canvas.height=size;
  const ctx=canvas.getContext('2d');let seed=211;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  // Several offset lobes read as a soft volume instead of a flat circle.
  for(let i=0;i<7;i++){
    const x=size*.5+(random()-.5)*size*.36,y=size*.5+(random()-.5)*size*.36,r=size*(.2+random()*.2);
    const gradient=ctx.createRadialGradient(x,y,0,x,y,r);
    gradient.addColorStop(0,'rgba(255,255,255,.50)');gradient.addColorStop(.45,'rgba(255,255,255,.26)');gradient.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=gradient;ctx.fillRect(0,0,size,size);
  }
  smokeMap=new THREE.CanvasTexture(canvas);smokeMap.colorSpace=THREE.SRGBColorSpace;return smokeMap;
}
let skidMap;
function skidTexture(){
  if(skidMap!==undefined)return skidMap;
  const canvas=document.createElement('canvas');canvas.width=64;canvas.height=256;
  const ctx=canvas.getContext('2d');
  // Node test canvases expose only a subset of the 2D API; skip the map there.
  if(!ctx||typeof ctx.createImageData!=='function'){skidMap=null;return null;}
  const image=ctx.createImageData(64,256);
  for(let y=0;y<256;y++)for(let x=0;x<64;x++){
    const i=(y*64+x)*4,u=(x-31.5)/31.5,v=Math.min(1,Math.min(y,255-y)/26);
    const edge=Math.max(0,1-u*u),soft=Math.min(1,v*1.6),grain=.86+((x*53+y*31)%17)/120;
    image.data[i]=image.data[i+1]=image.data[i+2]=255;
    image.data[i+3]=Math.round(255*edge*soft*grain);
  }
  ctx.putImageData(image,0,0);skidMap=new THREE.CanvasTexture(canvas);return skidMap;
}
function batch(capacity,{color,map=null,additive=false,skid=false,ring=false}){
  const geometry=ring?new THREE.RingGeometry(.86,1,32):new THREE.PlaneGeometry(1,1),opacity=new THREE.InstancedBufferAttribute(new Float32Array(capacity),1);geometry.setAttribute('instanceOpacity',opacity);
  const material=new THREE.MeshBasicMaterial({color,map,transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:additive?THREE.AdditiveBlending:THREE.NormalBlending,toneMapped:!additive,polygonOffset:skid,polygonOffsetFactor:skid?-1:0});
  material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float instanceOpacity;\nvarying float effectOpacity;').replace('#include <begin_vertex>','#include <begin_vertex>\neffectOpacity = instanceOpacity;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float effectOpacity;').replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.a *= effectOpacity;');
  };
  material.customProgramCacheKey=()=>`race-contact-${skid?'skid':additive?'spark':'smoke'}`;
  const mesh=new THREE.InstancedMesh(geometry,material,capacity);mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;mesh.count=0;mesh.renderOrder=skid?1:2;mesh.userData.opacity=opacity;return mesh;
}
export class RaceEffects {
  constructor(){
    this.group=new THREE.Group();this.group.name='tyre-contact-effects';this.smoke=batch(96,{color:'#b6bec0',map:smokeTexture()});this.sparks=batch(96,{color:'#ffffff',additive:true});this.rings=batch(12,{color:'#ffffff',additive:true,ring:true});this.skids=batch(192,{color:'#0f1417',skid:true,map:skidTexture()});this.group.add(this.skids,this.smoke,this.sparks,this.rings);
    this.colors=['#ffcc75','#62dfff','#ffb94e','#c18aff'].map(c=>new THREE.Color(c));this.itemColors={nitro:new THREE.Color('#ffb94e'),oil:new THREE.Color('#b994ed'),pulse:new THREE.Color('#81edff'),shield:new THREE.Color('#72bcff'),rocket:new THREE.Color('#ff653b'),frost:new THREE.Color('#b9eeff')};
    this.itemPool=Array.from({length:12},()=>({life:0}));this.pool=Array.from({length:96},()=>({life:0}));this.marks=Array.from({length:192},()=>({life:0}));this.dummy=new THREE.Object3D();this.contact=new THREE.Vector3();this.reset();
  }
  reset(){this.random=createRandom(7301);this.cursor=0;this.markCursor=0;this.itemCursor=0;this.tyres=new Map();for(const p of this.pool)p.life=0;for(const p of this.marks)p.life=0;for(const p of this.itemPool)p.life=0;for(const mesh of [this.smoke,this.sparks,this.skids,this.rings])mesh.count=0;}
  spawn(position,spark,speed,yaw,budget,tier=0,color=null){
    const full=this.pool.reduce((n,p)=>n+(p.life>0),0)>=budget;
    // An impact must remain legible while drifting fills the pool. Replace a
    // lower-priority smoke puff, without exceeding the current device budget.
    let particle=full&&spark?this.pool.find(p=>p.life>0&&!p.spark):null;
    if(full&&!particle)return;
    if(!particle)for(let i=0;i<96;i++){const p=this.pool[this.cursor++%96];if(p.life<=0){particle=p;break;}}
    if(!particle)return;const random=this.random,life=spark?.2+random()*.22:.8+random()*.5;
    Object.assign(particle,{x:position.x,y:position.y,z:position.z,spark,tier,color,life,max:life,rotation:random()*6.28,
      vx:spark?(random()-.5)*8:-Math.sin(yaw)*speed*.12+(random()-.5)*.8,
      vy:spark?1+random()*3:.55+random()*.4,vz:spark?(random()-.5)*8:-Math.cos(yaw)*speed*.12+(random()-.5)*.8});
  }
  emitTyres(racer,car,track,dt,budget,reduced){
    let state=this.tyres.get(racer.id);if(!state){state={debt:0,sparkDebt:0,last:[]};this.tyres.set(racer.id,state);}
    const slip=soundFrame(racer,true).tyreGain/.12,marking=racer.v>8&&(slip>.14||racer.braking&&racer.acceleration<-20),smoking=!reduced&&slip>.2;
    state.debt+=smoking?dt*Math.min(22,8+slip*18):0;const emit=Math.min(2,Math.floor(state.debt));if(emit)state.debt-=emit;
    const tier=racer.drifting?Math.max(0,Math.min(3,Math.floor(racer.driftTier||0))):0;
    state.sparkDebt+=!reduced&&tier?dt*(3+tier*4):0;const sparkCount=Math.min(2,Math.floor(state.sparkDebt));state.sparkDebt-=sparkCount;
    if(reduced||!tier)state.sparkDebt=0;
    car.updateMatrixWorld(true);let index=0;
    for(const wheel of car.userData.wheels){if(wheel.front)continue;
      this.contact.set(0,-.405,0).applyMatrix4(wheel.pivot.matrixWorld);this.contact.y+=.015;
      if(smoking)for(let n=0;n<emit;n++)this.spawn(this.contact,false,racer.v,car.rotation.y,budget);
      if(!reduced&&tier)for(let n=0;n<sparkCount;n++)this.spawn(this.contact,true,racer.v,car.rotation.y,budget,tier);
      const previous=state.last[index];
      if(marking&&previous){const dx=this.contact.x-previous.x,dz=this.contact.z-previous.z,length=Math.hypot(dx,dz);
        if(length>=.28){if(length<3){const mark=this.marks[this.markCursor++%192];Object.assign(mark,{x:(previous.x+this.contact.x)/2,y:(previous.y+this.contact.y)/2,z:(previous.z+this.contact.z)/2,length:length+.08,yaw:Math.atan2(dx,dz),grade:Math.atan(track.slope(racer.s)),life:10,max:10,strength:.15+slip*.26});}state.last[index]={x:this.contact.x,y:this.contact.y,z:this.contact.z};}
      }else state.last[index]=marking?{x:this.contact.x,y:this.contact.y,z:this.contact.z}:null;
      index++;
    }
    if(!smoking)state.debt=0;
  }
  impact(car,budget,tier=0,color=null){car.updateMatrixWorld(true);this.contact.set(.9,.38,0).applyMatrix4(car.matrixWorld);for(let i=0;i<14;i++)this.spawn(this.contact,true,0,car.rotation.y,budget,tier,color);}
  itemEvent(event,car,budget,reduced=false,item=null){
    const type=event.type,kind=type==='shield'?'shield':event.item||(this.itemColors[event.source]?event.source:null)||(type==='pickup'?item:null)||'pulse',tier=Math.max(1,Math.min(3,event.tier||1));
    if(!['item','pickup','shield','hit','drift'].includes(type)||!car)return;
    if(type==='hit'&&!['oil','pulse','rocket','frost'].includes(event.source)&&!event.item)return;
    // Notice-only events retain inventory and must not consume or replace VFX.
    // Missing flags remain compatible with existing successful event producers.
    if(type==='item'&&event.used===false||type==='pickup'&&(event.awarded===false||event.full===true))return;
    // Oil contact has a violet ring; shield absorption a blue rim. Rings are
    // bounded independently and never create a mesh/material per event.
    let ring=this.itemPool.find(p=>p.life<=0);
    if(!ring)ring=this.itemPool[this.itemCursor++%this.itemPool.length];
    const max=type==='pickup'?.55:type==='shield'?.42:.7;
    const pulse=type==='item'&&kind==='pulse',shield=type==='shield',pickup=type==='pickup',frost=type==='hit'&&kind==='frost';
    Object.assign(ring,{life:max,max,x:car.position.x,y:car.position.y+(shield||frost?.9:pickup?.8:.09),z:car.position.z,
      kind:type==='drift'?'drift':kind,type,source:event.source??null,attacker:event.attacker??null,shield,frost,pickup,reduced,radius:shield?1.65:pickup?.85:1.4,
      reach:reduced?.25:pulse?11:kind==='rocket'?4.5:frost?.65:type==='drift'?3:2.6,
      color:type==='drift'?this.colors[tier]:shield?this.itemColors.shield:this.itemColors[kind]||this.itemColors.pulse});
    if(type==='item'&&kind==='rocket'&&!reduced)this.impact(car,budget,0,this.itemColors.rocket);
    if(type==='drift'&&!reduced)this.impact(car,Math.min(budget,12+tier*8),tier);
  }
  update(dt,camera,budget,reduced=false){
    dt=Number.isFinite(dt)?Math.max(0,Math.min(.1,dt)):0;
    const dummy=this.dummy;let smoke=0,sparks=0,skids=0,total=0,rings=0;
    const ringBudget=Math.min(12,Math.max(0,Math.floor(budget/6)));
    for(const p of this.itemPool){if(p.life<=0)continue;p.life-=dt;if(p.life<=0||rings>=ringBudget){p.life=0;continue;}
      const age=1-p.life/p.max,quiet=reduced||p.reduced,radius=p.radius+(quiet?.25:p.reach)*(1-(1-age)**2);
      dummy.position.set(p.x,p.y+(p.pickup&&!quiet?age*.9:0),p.z);
      if(p.shield||p.frost)dummy.quaternion.copy(camera.quaternion);else dummy.rotation.set(-Math.PI/2,0,0);
      dummy.scale.setScalar(radius);dummy.updateMatrix();this.rings.setMatrixAt(rings,dummy.matrix);this.rings.setColorAt(rings,p.color);this.rings.userData.opacity.setX(rings++,(quiet?.35:.7)*(1-age));
    }
    budget=Math.max(0,budget-rings);
    for(const p of this.pool){if(p.life<=0)continue;p.life-=dt;if(p.life<=0||total>=budget||reduced){p.life=0;continue;}total++;
      p.x+=p.vx*dt;p.y+=p.vy*dt;p.z+=p.vz*dt;p.vy-=dt*(p.spark?8:-.08);
      dummy.position.set(p.x,p.y,p.z);dummy.quaternion.copy(camera.quaternion);dummy.rotateZ(p.rotation);
      const age=1-p.life/p.max,size=p.spark?.035:.18+age*1.1;dummy.scale.set(p.spark?.035:size,p.spark?.18:size,1);dummy.updateMatrix();
      const mesh=p.spark?this.sparks:this.smoke,index=p.spark?sparks++:smoke++;mesh.setMatrixAt(index,dummy.matrix);if(p.spark)mesh.setColorAt(index,p.color||this.colors[p.tier]||this.colors[0]);mesh.userData.opacity.setX(index,p.spark?p.life/p.max:.36*Math.sin(age*Math.PI));
    }
    for(const p of this.marks){if(p.life<=0)continue;p.life-=dt;if(p.life<=0)continue;
      dummy.position.set(p.x,p.y,p.z);dummy.rotation.set(-Math.PI/2-p.grade,p.yaw,0,'YXZ');dummy.scale.set(.23,p.length,1);dummy.updateMatrix();this.skids.setMatrixAt(skids,dummy.matrix);this.skids.userData.opacity.setX(skids++,p.strength*Math.min(1,p.life/2));
    }
    for(const [mesh,count] of [[this.smoke,smoke],[this.sparks,sparks],[this.skids,skids],[this.rings,rings]]){mesh.count=count;mesh.instanceMatrix.needsUpdate=true;mesh.userData.opacity.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;}
  }
  get diagnostics(){return {smoke:this.smoke.count,sparks:this.sparks.count,particles:this.smoke.count+this.sparks.count,skids:this.skids.count,itemVFX:this.rings.count,activeItemVFX:this.itemPool.filter(p=>p.life>0).map(p=>({type:p.type,item:p.kind,source:p.source,attacker:p.attacker,remaining:Math.round(p.life*100)/100})),driftSparks:this.pool.filter(p=>p.life>0&&p.spark&&p.tier>0).length};}
  releaseGPU(){for(const mesh of [this.smoke,this.sparks,this.skids,this.rings]){mesh.dispose();mesh.geometry.dispose();mesh.material.dispose();mesh.material.needsUpdate=true;}for(const texture of [smokeMap,skidMap]){texture?.dispose();if(texture)texture.needsUpdate=true;}}
}

// Camera-space speed streaks: cheap geometry, no textures, and only active on
// quality tiers that can afford them. Instances are reused every frame so the
// effect adds no allocation to the render loop.
export class SpeedStreaks {
  constructor(THREE,capacity=44){
    this.THREE=THREE;this.capacity=capacity;this.group=new THREE.Group();this.group.name='speed-streaks';
    this.geometry=new THREE.PlaneGeometry(1,1);
    this.material=new THREE.MeshBasicMaterial({color:'#d9ecf2',transparent:true,opacity:.5,depthWrite:false,depthTest:false,blending:THREE.AdditiveBlending,toneMapped:false,side:THREE.DoubleSide});
    this.mesh=new THREE.InstancedMesh(this.geometry,this.material,capacity);this.mesh.frustumCulled=false;this.mesh.renderOrder=3;this.group.add(this.mesh);
    this.dummy=new THREE.Object3D();this.seed=991;this.streaks=Array.from({length:capacity},()=>this.resetStreak({},true));
    this.forward=new THREE.Vector3();this.right=new THREE.Vector3();this.up=new THREE.Vector3();
    this.group.visible=false;this.mesh.count=0;this.lastOpacity=0;
  }
  resetStreak(streak,initial=false){
    const random=()=>{this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296;};
    streak.x=(random()-.5)*2.4;streak.y=.1+random()*1.2;streak.z=initial?-(14+random()*38):-(50+random()*8);
    streak.speed=.72+random()*.62;streak.length=.5+random()*1.5;streak.spread=(random()-.5)*.4;
    return streak;
  }
  update(dt,camera,speed01,active=true,reduced=false){
    const visible=active&&!reduced&&speed01>.3;
    this.group.visible=visible;if(!visible){this.mesh.count=0;this.lastOpacity=0;return;}
    dt=Number.isFinite(dt)?Math.max(0,Math.min(.1,dt)):0;
    camera.updateMatrixWorld();const position=camera.position,forward=this.forward.set(0,0,-1).applyQuaternion(camera.quaternion),right=this.right.set(1,0,0).applyQuaternion(camera.quaternion),up=this.up.set(0,1,0).applyQuaternion(camera.quaternion);
    const intensity=Math.min(1,(speed01-.3)/.6),fade=.1+intensity*.26;
    for(let i=0;i<this.capacity;i++){
      const streak=this.streaks[i];
      streak.z+=(6+speed01*44)*streak.speed*dt*(1+streak.speed*.4);
      if(streak.z>-10)this.resetStreak(streak,false);
      const depth=-streak.z,scale=Math.max(.4,depth*.055);
      this.dummy.position.set(
        position.x+right.x*streak.x*scale*3.7+up.x*streak.y*scale*2.2+forward.x*depth,
        position.y+right.y*streak.x*scale*3.7+up.y*streak.y*scale*2.2+forward.y*depth,
        position.z+right.z*streak.x*scale*3.7+up.z*streak.y*scale*2.2+forward.z*depth);
      this.dummy.quaternion.copy(camera.quaternion);
      this.dummy.rotateZ(streak.spread);
      this.dummy.scale.set(.026+intensity*.014,streak.length*(1+depth*.035),1);
      this.dummy.updateMatrix();this.mesh.setMatrixAt(i,this.dummy.matrix);
    }
    this.mesh.count=this.capacity;this.mesh.instanceMatrix.needsUpdate=true;this.material.opacity=fade;this.lastOpacity=fade;
  }
  get diagnostics(){return {visible:this.group.visible,count:this.mesh.count,opacity:Math.round(this.lastOpacity*100)/100};}
}
