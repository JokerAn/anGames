import * as THREE from '/vendor/three.module.js';
import {CARS, getTrack, ROAD_HALF, PICKUP_BOX, mod} from './tracks.js';
const UP = new THREE.Vector3(0,1,0);
const materials = new Map();
function mat(color, emissive = false) {const key=`${color}-${emissive}`;if(!materials.has(key))materials.set(key,new THREE.MeshStandardMaterial({color,roughness:.55,metalness:.25,...(emissive?{emissive:color,emissiveIntensity:1.4}:{})}));return materials.get(key);}
const boxGeo=new THREE.BoxGeometry(1,1,1), wheelGeo=new THREE.CylinderGeometry(.43,.43,.3,12);
function box(parent,w,h,d,x,y,z,color,emissive=false) {const m=new THREE.Mesh(boxGeo,mat(color,emissive));m.scale.set(w,h,d);m.position.set(x,y,z);parent.add(m);return m;}
export function makeCar(id, colorOverride) {
  const config=CARS.find(c=>c.id===id)||CARS[0], color=colorOverride||config.color, g=new THREE.Group(), suv=id==='titan', formula=id==='bolt';
  const bodyY=suv?.85:.64;
  box(g,formula?1.35:1.95,.5,3.7,0,bodyY,0,color);
  box(g,formula?1:1.78,.25,1.45,0,bodyY+.22,1.0,color);
  box(g,1.88,.16,3.95,0,.37,0,'#152533');
  const cabin=box(g,formula?.85:1.5,suv?.8:.57,suv?1.85:1.55,0,bodyY+.48,-.35,'#153b4f');
  if(!formula) box(g,1.5,.09,suv?1.5:1.05,0,bodyY+(suv?.9:.8),-.5,color);
  else {box(g,.55,.27,.55,0,1.2,-.4,'#f1ecdf'); box(g,1.9,.1,.5,0,.48,1.95,color);}
  for(const x of [-1,1]) {
    for(const z of [-1.17,1.18]) {
      const wheel=new THREE.Mesh(wheelGeo,mat('#17202b'));wheel.rotation.z=Math.PI/2;wheel.position.set(x*(formula?1.1:1),.43,z);g.add(wheel);
      const hub=new THREE.Mesh(new THREE.CylinderGeometry(.23,.23,.32,8),mat('#9cb3bf'));hub.rotation.z=Math.PI/2;hub.position.copy(wheel.position);g.add(hub);
    }
    box(g,.45,.13,.06,x*.64,bodyY+.1,1.87,'#d5fff6',true);
    box(g,.5,.13,.07,x*.62,bodyY+.08,-1.88,'#ff493d',true);
    box(g,.12,.1,1.15,x*.64,bodyY+.76,-.2,color);
  }
  box(g,.25,.025,1.25,0,bodyY+.36,1.05,'#f6e4c9');
  box(g,.16,.4,.18,-.67,bodyY+.48,-1.6,'#19232e');box(g,.16,.4,.18,.67,bodyY+.48,-1.6,'#19232e');
  box(g,2.2,.12,.55,0,bodyY+.7,-1.62,color);
  const flame=new THREE.Group();
  for(const x of [-.5,.5]) {const mesh=new THREE.Mesh(new THREE.ConeGeometry(.23,1.7,7),mat('#48e9fa',true));mesh.rotation.x=-Math.PI/2;mesh.position.set(x,.48,-2.5);flame.add(mesh);}
  g.add(flame);flame.visible=false;
  const shield=new THREE.Mesh(new THREE.SphereGeometry(2.4,16,10),new THREE.MeshBasicMaterial({color:'#75fff0',wireframe:true,transparent:true,opacity:.22}));shield.position.y=.8;shield.scale.set(.65,.65,1);g.add(shield);shield.visible=false;
  const shadow=new THREE.Mesh(new THREE.CircleGeometry(1,20),new THREE.MeshBasicMaterial({color:'#081520',transparent:true,opacity:.32,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.scale.set(1.3,2.25,1);shadow.position.y=.045;g.add(shadow);
  g.userData={flame,shield,cabin};return g;
}
function strip(track,left,right,height,color,checker=false) {
  const pos=[],colors=[],indices=[],count=560;
  for(let i=0;i<=count;i++) {
    for(const lane of [left,right]) {const p=track.sample(i/count*track.length,lane);pos.push(p.x,p.y+height,p.z);const c=new THREE.Color(checker?(Math.floor(i/4)%2?'#eaf4ed':'#ff745a'):color);colors.push(c.r,c.g,c.b);}
    if(i<count) {let n=i*2;indices.push(n,n+2,n+1,n+1,n+2,n+3);}
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geo.setIndex(indices);geo.computeVertexNormals();
  return new THREE.Mesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.93,side:THREE.DoubleSide}));
}
function textPlane(text,width=15,height=2) {
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=128;const ctx=canvas.getContext('2d');ctx.fillStyle='#142539';ctx.fillRect(0,0,1024,128);ctx.fillStyle='#baf7e6';ctx.font='bold 64px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,512,68);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(width,height),new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide}));
}
export class RaceRenderer {
  constructor(container) {
    this.renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.2;
    this.renderer.domElement.setAttribute('aria-label','3D 赛车画面');container.append(this.renderer.domElement);
    this.container=container;this.camera=new THREE.PerspectiveCamera(52,1,.1,1400);this.cars=new Map();this.mode='garage';this.lastEvent=0;this.particles=[];
    this.garage=new THREE.Scene();this.garage.background=new THREE.Color('#142338');this.garage.fog=new THREE.Fog('#142338',20,65);
    this.garage.add(new THREE.HemisphereLight('#deffff','#24415c',3));const light=new THREE.DirectionalLight('#fff0d2',4);light.position.set(3,8,4);this.garage.add(light);
    const platform=new THREE.Mesh(new THREE.CylinderGeometry(3.8,4, .25,64),mat('#22374b'));platform.position.y=-.17;this.garage.add(platform);
    const ring=new THREE.Mesh(new THREE.TorusGeometry(3.8,.026,5,80),mat('#56d8cb',true));ring.rotation.x=Math.PI/2;ring.position.y=-.01;this.garage.add(ring);
    const grid=new THREE.GridHelper(100,70,'#2c5064','#1c3346');grid.position.y=-.35;this.garage.add(grid);
    this.garageCar=makeCar('comet');this.garage.add(this.garageCar);
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);this.resize();
    this.renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();document.dispatchEvent(new CustomEvent('graphics-lost'));});
  }
  resize(){const w=Math.max(1,this.container.clientWidth),h=Math.max(1,this.container.clientHeight);this.renderer.setSize(w,h);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();}
  setContainer(container){this.resizeObserver.disconnect();this.container=container;container.append(this.renderer.domElement);this.resizeObserver.observe(container);this.resize();}
  setCar(id){this.garage.remove(this.garageCar);this.disposePrivate(this.garageCar);this.garageCar=makeCar(id);this.garage.add(this.garageCar);}
  disposePrivate(root) {root.traverse(o=>{if(o.isMesh){if(o.geometry!==boxGeo&&o.geometry!==wheelGeo)o.geometry.dispose();if(![...materials.values()].includes(o.material)){o.material.map?.dispose();o.material.dispose();}}});}
  buildTrack(id) {
    if(this.world)this.disposePrivate(this.world);
    this.world=new THREE.Scene();this.track=getTrack(id);const t=this.track,night=id==='neon';
    this.world.background=new THREE.Color(t.sky);this.world.fog=new THREE.Fog(t.sky,110,520);
    this.world.add(new THREE.HemisphereLight(night?'#a6bcff':'#e2faff',t.ground,night?2.8:2.7));const sun=new THREE.DirectionalLight(night?'#a4b4ff':'#fff0d3',night?2.2:2.7);sun.position.set(100,170,80);this.world.add(sun);
    const ground=new THREE.Mesh(new THREE.PlaneGeometry(2400,2400),mat(t.ground));ground.rotation.x=-Math.PI/2;ground.position.y=-.8;this.world.add(ground);
    if(id==='coast'){const water=new THREE.Mesh(new THREE.PlaneGeometry(2000,2000),mat('#559ea9'));water.rotation.x=-Math.PI/2;water.position.set(-1190,-.65,0);this.world.add(water);}
    this.world.add(strip(t,-65,-ROAD_HALF-1.3,-.15,t.ground),strip(t,ROAD_HALF+1.3,65,-.15,t.ground));
    this.world.add(strip(t,-ROAD_HALF-1.3,ROAD_HALF+1.3,-.08,t.ground));this.world.add(strip(t,-ROAD_HALF,ROAD_HALF,.02,t.road));
    this.world.add(strip(t,-ROAD_HALF-.55,-ROAD_HALF,.06,'#ffffff',true),strip(t,ROAD_HALF,ROAD_HALF+.55,.06,'#ffffff',true));
    this.world.add(strip(t,-ROAD_HALF-.8,-ROAD_HALF-.55,.8,night?'#c198ff':'#a6bdc4'),strip(t,ROAD_HALF+.55,ROAD_HALF+.8,.8,night?'#48dbc5':'#a6bdc4'));
    const dummy=new THREE.Object3D(),dashCount=Math.floor(t.length/9)*2;
    const dashes=new THREE.InstancedMesh(boxGeo,mat('#c3d0ca'),dashCount);let n=0;
    for(let s=0;s<t.length-9;s+=9) for(const x of [-3,3]) {const p=t.sample(s,x);dummy.position.set(p.x,p.y+.04,p.z);dummy.rotation.set(0,p.yaw,0);dummy.scale.set(.09,.025,3.6);dummy.updateMatrix();dashes.setMatrixAt(n++,dummy.matrix);} dashes.count=n;this.world.add(dashes);
    const sceneryCount=110;
    const trunkGeo=night?boxGeo:new THREE.CylinderGeometry(.22,.45,5,5);
    const trunks=new THREE.InstancedMesh(trunkGeo,mat(night?'#26304f':id==='canyon'?'#99644d':'#776c4a'),sceneryCount);
    const topGeo=id==='coast'?new THREE.ConeGeometry(3,2,5):new THREE.ConeGeometry(5,13,5);
    const tops=new THREE.InstancedMesh(topGeo,mat(id==='coast'?'#4b9377':id==='canyon'?'#c98b66':'#484579'),sceneryCount);
    for(let i=0;i<sceneryCount;i++) {const p=t.sample(i/sceneryCount*t.length,(i%2?1:-1)*(16+(Math.sin(i*79)*.5+.5)*34));const scale=.7+(Math.sin(i*22)*.5+.5)*1.4;
      dummy.position.set(p.x,night?8*scale:p.y+2,p.z);dummy.rotation.set(0,i*1.9,0);dummy.scale.set(night?5:1,night?16*scale:scale,night?6:1);dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix);
      dummy.position.y=p.y+(id==='coast'?5:5.5)*scale;dummy.scale.set(scale,scale,scale);dummy.updateMatrix();tops.setMatrixAt(i,dummy.matrix);
      if(night&&i%2===0) {const sign=box(this.world,.16,10*scale,4,p.x+2.6,6*scale,p.z,i%4?'#47c9d1':'#aa73fa',true);sign.rotation.y=i*1.9;}
    }this.world.add(trunks);if(!night)this.world.add(tops);
    this.items=[];
    for(const o of t.objects){const p=t.sample(o.s,o.x);const group=new THREE.Group();group.position.set(p.x,p.y+.1,p.z);group.rotation.y=p.yaw;
      if(o.type==='box') {
        const cube=new THREE.Group(),size=PICKUP_BOX.size;
        cube.position.y=size/2;
        box(cube,size,size,size,0,0,0,'#ffc861');
        box(cube,size+.025,.13,size+.025,0,0,0,'#fff2c6');
        box(cube,.13,size+.025,size+.025,0,0,0,'#fff2c6');
        group.add(cube);
        const marker=new THREE.Mesh(new THREE.RingGeometry(1.2,1.48,24),mat('#ffe6a2',true));
        marker.rotation.x=-Math.PI/2;marker.position.y=.012;group.add(marker);
        // Keep the crate's bottom on the road, even on slopes; only rotate around Y.
        group.position.y=p.y+.04;
        const slope=(t.sample(o.s+1).y-t.sample(o.s-1).y)/2;
        group.rotation.order='YXZ';group.rotation.x=-Math.atan(slope);
        this.items.push({group,cube,o});
      }
      if(o.type==='barrier'){box(group,2.5,1.05,1.1,0,.52,0,'#f5784f');for(const x of [-.75,0,.75]){const stripe=box(group,.24,.85,1.13,x,.54,0,'#fff1d8');stripe.rotation.z=-.3;}}
      if(o.type==='oil'){const oil=new THREE.Mesh(new THREE.CircleGeometry(2,20),mat('#151e36'));oil.rotation.x=-Math.PI/2;oil.position.y=.02;oil.scale.y=1.4;group.add(oil);box(group,.6,.03,.6,0,.05,0,'#7753a4');}
      if(o.type==='boost'){box(group,4.7,.05,8,0,.04,0,'#247f81');for(let k=-2;k<=2;k++){for(const x of [-.65,.65]){const m=box(group,1.6,.04,.18,x,.09,k*1.4,'#8affdb',true);m.rotation.y=x>0?.5:-.5;}}}
      this.world.add(group);
    }
    const start=t.sample(0);const gate=new THREE.Group();gate.position.set(start.x,start.y,start.z);gate.rotation.y=start.yaw;
    box(gate,.5,7,.5,-10,3.5,0,'#244957');box(gate,.5,7,.5,10,3.5,0,'#244957');box(gate,20.5,2,.6,0,6.5,0,'#173245');
    const banner=textPlane('少年赛车  /  START',18,1.6);banner.position.set(0,6.5,.35);gate.add(banner);const backBanner=textPlane('少年赛车  /  START',18,1.6);backBanner.position.set(0,6.5,-.35);backBanner.rotation.y=Math.PI;gate.add(backBanner);
    for(let row=0;row<2;row++)for(let col=0;col<18;col++)box(gate,1,.025,1,col-8.5,.09,row-.5,(row+col)%2?'#f4f3de':'#1b2b3e');this.world.add(gate);
    this.cars.clear();this.particles=[];this.lastEvent=0;this.trapMeshes=new Map();this.cameraReady=false;
  }
  setRace(race){this.mode='race';this.buildTrack(race.trackId);for(const r of race.racers){const m=makeCar(r.car,r.bot?['#ffa261','#6bd7c0','#9aabff','#f5da89','#eb89aa','#75badc'][r.slot]:undefined);this.cars.set(r.id,m);this.world.add(m);}}
  render(race,playerId,dt,time){
    if(this.mode==='garage'){
      this.garageCar.rotation.y=-.5+Math.sin(time*.2)*.2;this.camera.position.set(7.4,4.1,8.8);this.camera.lookAt(0,.5,0);this.camera.fov=38;this.camera.updateProjectionMatrix();this.renderer.render(this.garage,this.camera);return;
    }
    if(!race)return;
    const me=race.racers.find(r=>r.id===playerId)||race.racers[0],t=this.track;
    for(const r of race.racers){const m=this.cars.get(r.id);if(!m)continue;const p=t.sample(r.s,r.x),target=new THREE.Vector3(p.x,p.y+.1,p.z);
      if(!this.cameraReady){m.position.copy(target);m.rotation.y=p.yaw;}else m.position.lerp(target,1-Math.exp(-dt*18));
      let yaw=p.yaw+(r.drifting?r.vx*.065:r.vx*.018);let diff=mod(yaw-m.rotation.y+Math.PI,Math.PI*2)-Math.PI;m.rotation.y+=diff*Math.min(1,dt*15);m.rotation.z=-r.vx*.008;
      m.userData.flame.visible=!!r.boosting;m.userData.flame.scale.set(1,1,.8+Math.sin(time*50)*.2);m.userData.shield.visible=r.shield>0;m.userData.shield.rotation.y=time;
      if(r.drifting&&Math.random()<.45)this.particle(m.position,r.driftCharge>.65?'#57e5f4':'#ffc57b');
    }
    for(const item of this.items) {
      item.group.visible=(me.pickupCooldowns?.[item.o.id] ?? -Infinity) <= race.time;
      item.cube.rotation.y=time*.65;
    }
    const ids=new Set(race.traps.map(tr=>tr.id));for(const [id,m] of this.trapMeshes)if(!ids.has(id)){this.world.remove(m);m.geometry.dispose();this.trapMeshes.delete(id);}
    for(const tr of race.traps)if(!this.trapMeshes.has(tr.id)){const p=t.sample(tr.s,tr.x),m=new THREE.Mesh(new THREE.CircleGeometry(2.3,16),mat('#443154'));m.rotation.x=-Math.PI/2;m.position.set(p.x,p.y+.12,p.z);this.world.add(m);this.trapMeshes.set(tr.id,m);}
    for(const e of race.events){if(e.id>this.lastEvent&&e.racer===playerId&&e.type==='hit'){const m=this.cars.get(playerId);if(m)for(let i=0;i<12;i++)this.particle(m.position,'#ffce84',true);}this.lastEvent=Math.max(this.lastEvent,e.id);}
    for(let i=this.particles.length-1;i>=0;i--){const p=this.particles[i];p.life-=dt;p.mesh.position.addScaledVector(p.vel,dt);p.vel.y-=dt*8;p.mesh.scale.multiplyScalar(.97);if(p.life<=0){this.world.remove(p.mesh);this.particles.splice(i,1);}}
    const carPos=t.sample(me.s,me.x),behind=t.sample(me.s-(me.boosting?15:13),me.x*.5),ahead=t.sample(me.s+15,me.x*.35);
    const shake=me.hit>0?Math.sin(time*83)*me.hit*.3:0;
    const desired=new THREE.Vector3(behind.x+shake,carPos.y+6.3,behind.z);
    if(!this.cameraReady){this.camera.position.copy(desired);this.cameraReady=true;}else this.camera.position.lerp(desired,1-Math.exp(-dt*7));
    this.camera.lookAt(ahead.x,carPos.y+1.5,ahead.z);this.camera.fov+=( (me.boosting?70:58)-this.camera.fov)*Math.min(1,dt*3);this.camera.updateProjectionMatrix();this.renderer.render(this.world,this.camera);
  }
  particle(position,color,burst=false){if(this.particles.length>70)return;const mesh=new THREE.Mesh(boxGeo,mat(color,true));mesh.scale.setScalar(.12+Math.random()*.12);mesh.position.copy(position);mesh.position.y+=.4;this.world.add(mesh);this.particles.push({mesh,life:.6,vel:new THREE.Vector3((Math.random()-.5)*(burst?15:3),Math.random()*5,(Math.random()-.5)*10)});}
}
