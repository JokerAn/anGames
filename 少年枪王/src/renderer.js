import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { WORLD, WEAPONS, getMap, cameraPose, MAX_HP, visible } from './simulation.js';

const TEAM={blue:0x66dfdd,red:0xff826b};
const GEO={armor:new RoundedBoxGeometry(1,1,1,1,.07),box:new THREE.BoxGeometry(1,1,1),sphere:new THREE.SphereGeometry(1,16,12),cylinder:new THREE.CylinderGeometry(1,1,1,12)};
const materials=new Map();
function mat(color,glow=false){
  const key=`${color}|${glow}`;
  if(!materials.has(key))materials.set(key,new THREE.MeshStandardMaterial({color,roughness:glow?.4:.64,metalness:glow?.25:.25,emissive:glow?color:0,emissiveIntensity:glow?1.5:0}));
  return materials.get(key);
}
function mesh(parent,kind,color,pos,scale,glow=false){const m=new THREE.Mesh(GEO[kind],mat(color,glow));m.position.set(...pos);m.scale.set(...scale);m.castShadow=!glow;m.receiveShadow=!glow;parent.add(m);return m;}
function box(p,c,x,y,z,w,h,d,glow=false){return mesh(p,p.userData.softShapes?'armor':'box',c,[x,y,z],[w,h,d],glow);}
function orb(p,c,x,y,z,r,glow=false){return mesh(p,'sphere',c,[x,y,z],[r,r,r],glow);}
function cylinder(p,c,x,y,z,r,h,glow=false){return mesh(p,'cylinder',c,[x,y,z],[r,h,r],glow);}
function texture(seed,color,kind='floor'){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=512;const c=canvas.getContext('2d');c.fillStyle=color;c.fillRect(0,0,512,512);
  let value=seed;const rand=()=>{value=(value*1664525+1013904223)>>>0;return value/4294967296;};
  for(let i=0;i<6500;i++){c.fillStyle=rand()>.5?'#ffffff08':'#00000014';const n=rand()*3+1;c.fillRect(rand()*512,rand()*512,n,n);}
  c.strokeStyle='#07121c33';c.lineWidth=3;
  if(kind==='floor'){for(let x=0;x<512;x+=128){c.strokeRect(x,0,128,512);c.strokeRect(0,x,512,128);}for(let i=0;i<35;i++){let x=rand()*512,y=rand()*512;c.beginPath();c.moveTo(x,y);for(let j=0;j<4;j++){x+=rand()*22-11;y+=rand()*22-11;c.lineTo(x,y);}c.stroke();}}
  else if(kind==='container'){for(let x=0;x<512;x+=26){c.fillStyle='#00000022';c.fillRect(x,0,5,512);c.fillStyle='#ffffff11';c.fillRect(x+5,0,2,512);}c.fillStyle='#ffffff80';c.font='bold 56px monospace';c.fillText('BL / 24',35,130);c.font='18px monospace';c.fillText('TACTICAL LOGISTICS',36,165);}
  if(kind==='sand'){c.lineWidth=1;for(let i=0;i<50;i++){c.strokeStyle=i%2?'#f8e2bd12':'#4435290e';c.beginPath();const y=rand()*512;c.moveTo(0,y);c.bezierCurveTo(160,y+rand()*55,340,y-rand()*55,512,y+rand()*20);c.stroke();}}
  const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;return t;
}
function textMaterial(text,color='#b9d2dc',bg='#122331dd',w=256,h=64){
  const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');x.fillStyle=bg;x.fillRect(0,0,w,h);x.fillStyle=color;x.font=`600 ${h*.45}px monospace`;x.textBaseline='middle';x.textAlign='center';x.fillText(text,w/2,h/2,w-16);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return new THREE.MeshBasicMaterial({map:t,transparent:true,depthWrite:false});
}
function dispose(root){
  root.traverse(o=>{if(o.geometry&&!Object.values(GEO).includes(o.geometry))o.geometry.dispose();for(const m of [o.material].flat()){if(m&&!Array.from(materials.values()).includes(m)){m.map?.dispose();m.dispose();}}});root.clear();
}
function mergeStatic(root,exclude=new Set()){
  root.updateMatrixWorld(true);const groups=new Map(),remove=[];
  root.traverse(m=>{if(!m.isMesh||!Array.from(materials.values()).includes(m.material))return;for(let p=m;p&&p!==root;p=p.parent)if(exclude.has(p))return;
    const g=m.geometry.index?m.geometry.toNonIndexed():m.geometry.clone();g.applyMatrix4(new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(m.matrixWorld));
    if(!groups.has(m.material))groups.set(m.material,[]);groups.get(m.material).push(g);remove.push(m);
  });
  for(const m of remove)m.removeFromParent();
  for(const [material,parts] of groups){const g=new THREE.BufferGeometry();for(const key of ['position','normal','uv']){const array=new Float32Array(parts.reduce((n,p)=>n+p.attributes[key].array.length,0));let at=0;for(const p of parts){array.set(p.attributes[key].array,at);at+=p.attributes[key].array.length;}g.setAttribute(key,new THREE.BufferAttribute(array,parts[0].attributes[key].itemSize));}g.computeBoundingSphere();const m=new THREE.Mesh(g,material);m.castShadow=!material.emissiveIntensity;m.receiveShadow=true;root.add(m);parts.forEach(p=>p.dispose());}
}
export function gunModel(key='blaster'){
  const w=WEAPONS[key]||WEAPONS.blaster,g=new THREE.Group(),length=key==='sniper'?1.4:key==='smg'?.8:1.04;
  g.userData.softShapes=true;
  box(g,0x202c3b,0,0,0,.19,.22,length);box(g,0x4f6374,0,.045,-length*.25,.22,.18,length*.45);
  box(g,w.color,.102,.055,.1,.012,.08,.34,true);box(g,0x101923,0,-.18,.23,.13,.28,.18).rotation.x=-.22;
  box(g,0x17212c,0,-.21,-.08,.14,.33,.22).rotation.x=.18;box(g,0x324757,0,.15,.03,.12,.035,.65);
  const barrel=cylinder(g,0x14212e,0,.018,-length*.5-.19,.045,.4);barrel.rotation.x=Math.PI/2;
  for(let i=0;i<5;i++)box(g,0x0a1420,.116,.04,-.08-i*.09,.008,.09,.035);
  if(key==='sniper'){const scope=cylinder(g,0x122231,0,.26,-.1,.08,.42);scope.rotation.x=Math.PI/2;orb(g,w.color,0,.26,-.32,.066,true);}
  if(key==='shotgun')box(g,0x645346,0,-.08,-.28,.23,.13,.34);
  box(g,0x14212c,0,0,length*.5+.16,.16,.19,.33);mergeStatic(g);return g;
}
function operative(team,hard=false){
  const g=new THREE.Group(),color=TEAM[team],legs=[],arms=[];g.userData.softShapes=true;
  // Helmet, segmented armored torso, fabric limbs and emissive identification strips.
  box(g,0x314553,0,.97,0,.56,.61,.34);box(g,0x617482,0,1.02,-.19,.47,.43,.12);
  for(const x of [-.18,.18])box(g,0x142335,x,.99,-.265,.14,.2,.09);
  box(g,color,0,1.23,-.258,.32,.035,.018,true);box(g,0x101a27,0,.64,0,.52,.13,.39);
  const helmet=orb(g,0x627888,0,1.56,0,.32);helmet.scale.y*=1.08;
  box(g,0x101923,0,1.58,-.256,.52,.18,.15);box(g,color,0,1.59,-.336,.42,.053,.025,true);
  box(g,0x1a2836,0,1.4,-.28,.27,.1,.12);box(g,0x172333,0,1.76,0,.22,.06,.22);
  for(const x of [-.33,.33]){cylinder(g,0x172333,x,1.56,0,.075,.12).rotation.z=Math.PI/2;box(g,color,x,1.51,-.07,.018,.06,.08,true);}
  box(g,0x172635,0,1,.25,.4,.48,.18);box(g,0x4c6472,0,1.08,.35,.25,.26,.04);
  for(const x of [-.17,.17])cylinder(g,0x0e1a28,x,1.02,.34,.047,.36);
  for(const x of [-.17,.17]){
    const leg=new THREE.Group();leg.userData.softShapes=true;leg.position.set(x,.62,0);g.add(leg);box(leg,0x233344,0,-.16,0,.21,.4,.25);box(leg,0x435867,0,-.3,-.13,.19,.14,.065);box(leg,0x172534,0,-.47,0,.18,.22,.21);box(leg,0x111d2a,0,-.56,-.075,.23,.14,.37);mergeStatic(leg);legs.push(leg);
    box(g,0x4b626c,x*1.5,.66,.1,.1,.17,.12);
  }
  const rig=new THREE.Group();rig.userData.softShapes=true;rig.position.y=1.19;g.add(rig);
  for(const x of [-.35,.35]){const arm=new THREE.Group();arm.userData.softShapes=true;arm.position.set(x,-.08,0);rig.add(arm);box(arm,0x253746,0,-.055,0,.2,.26,.25);box(arm,0x445b68,0,.035,0,.23,.12,.26);box(arm,color,0,.075,-.14,.12,.027,.02,true);box(arm,0x172635,0,-.15,-.2,.17,.18,.36);orb(arm,0x0f1b2a,0,-.13,-.39,.1);mergeStatic(arm);arms.push(arm);}
  arms[0].rotation.y=-.7;
  const gun=new THREE.Group();gun.position.set(.29,-.015,-.39);gun.scale.setScalar(.8);gun.add(gunModel());rig.add(gun);
  const shadow=new THREE.Mesh(new THREE.CircleGeometry(.53,24),new THREE.MeshBasicMaterial({color:0x020a12,transparent:true,opacity:.3,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=.012;g.add(shadow);
  g.userData={legs,rig,gun,team,weapon:'blaster'};mergeStatic(g,new Set([...legs,rig,shadow]));return g;
}
function healthSprite(){
  const canvas=document.createElement('canvas');canvas.width=128;canvas.height=32;const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthTest:true,depthWrite:false}));sprite.position.y=2.02;sprite.scale.set(1.45,.36,1);
  return {sprite,canvas,texture,key:''};
}

export class ArenaRenderer{
  constructor(preview,container){
    this.preview=preview;this.container=container;this.mode='preview';this.quality='balanced';this.map=getMap('harbor');this.models=new Map();this.effects=[];this.time=0;this.recoil=0;this.webglLost=false;this.lastPlayer=null;this.crosshair=document.querySelector('#crosshair');this.fps=60;
    this.renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.25;this.renderer.shadowMap.type=THREE.PCFShadowMap;this.renderer.info.autoReset=false;
    this.renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();this.webglLost=true;window.dispatchEvent(new CustomEvent('game-render-error'));});preview.replaceChildren(this.renderer.domElement);
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color(this.map.sky);this.scene.fog=new THREE.FogExp2(this.map.sky,.0085);
    this.sky=new THREE.Mesh(new THREE.SphereGeometry(150,32,16),new THREE.MeshBasicMaterial({side:THREE.BackSide,depthWrite:false,fog:false}));this.scene.add(this.sky);
    this.hemi=new THREE.HemisphereLight(0xaecbdf,0x1a2534,2.65);this.scene.add(this.hemi);
    this.sun=new THREE.DirectionalLight(0xffc69f,3.1);this.sun.position.set(-28,45,22);this.sun.castShadow=true;this.sun.shadow.mapSize.set(2048,2048);Object.assign(this.sun.shadow.camera,{left:-58,right:58,top:58,bottom:-58,near:1,far:150});this.sun.shadow.normalBias=.035;this.sun.shadow.bias=-.00015;this.scene.add(this.sun);
    const rim=new THREE.DirectionalLight(0x67d1ee,1.25);rim.position.set(25,15,-30);this.scene.add(rim);
    this.camera=new THREE.PerspectiveCamera(72,1,.06,220);this.camera.rotation.order='YXZ';this.scene.add(this.camera);
    this.previewCamera=new THREE.PerspectiveCamera(45,1,.1,300);this.previewCamera.position.set(29,20,51);this.previewCamera.lookAt(0,2.5,13);
    this.world=new THREE.Group();this.scene.add(this.world);this.buildWorld();
    this.previewActors=new THREE.Group();this.scene.add(this.previewActors);this.hero=operative('blue',true);this.hero.position.set(12,0,19);this.hero.scale.setScalar(4.1);this.hero.rotation.y=Math.PI+.55;this.previewActors.add(this.hero);
    const pedestal=cylinder(this.previewActors,0x243b49,12,-.12,19,3.25,.25);pedestal.receiveShadow=true;
    const ring=new THREE.Mesh(new THREE.TorusGeometry(3.25,.027,6,64),mat(0x70decf,true));ring.rotation.x=Math.PI/2;ring.position.set(12,.018,19);this.previewActors.add(ring);
    const heroLight=new THREE.SpotLight(0xc7eee6,160,38,Math.PI/4,1,2);heroLight.position.set(17,16,30);heroLight.target.position.set(12,4,19);this.previewActors.add(heroLight,heroLight.target);
    this.objectiveVisual=new THREE.Group();this.objectiveVisual.visible=false;this.scene.add(this.objectiveVisual);
    const circle=new THREE.Mesh(new THREE.RingGeometry(5.83,6,64),new THREE.MeshBasicMaterial({color:0xf1d09a,transparent:true,opacity:.8,side:THREE.DoubleSide,depthWrite:false}));circle.rotation.x=-Math.PI/2;circle.position.y=.075;this.objectiveVisual.add(circle);this.objectiveRing=circle;
    const beam=new THREE.Mesh(new THREE.CylinderGeometry(.045,.1,7,8),new THREE.MeshBasicMaterial({color:0xf1d09a,transparent:true,opacity:.28,blending:THREE.AdditiveBlending,depthWrite:false}));beam.position.y=3.5;this.objectiveVisual.add(beam);this.objectiveBeam=beam;
    const marker=new THREE.Sprite(new THREE.SpriteMaterial({map:textMaterial('A','#fff1c8','#142333ee',64,64).map,transparent:true,depthTest:true}));marker.position.y=8;marker.scale.set(1.2,1.2,1);this.objectiveVisual.add(marker);
    this.firstGun=new THREE.Group();this.firstGun.position.set(.3,-.31,-.65);this.firstGun.scale.setScalar(.65);this.camera.add(this.firstGun);
    this.composer=new EffectComposer(this.renderer);this.renderPass=new RenderPass(this.scene,this.previewCamera);this.composer.addPass(this.renderPass);this.bloom=new UnrealBloomPass(new THREE.Vector2(1,1),.26,.4,1.2);this.composer.addPass(this.bloom);this.composer.addPass(new OutputPass());
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(preview);this.resizeObserver.observe(container);window.addEventListener('resize',()=>this.resize());this.setQuality('balanced');this.updateEnvironment();
  }
  buildWorld(){
    const map=this.map,desert=map.id==='desert',harbor=map.id==='harbor';
    const floorTex=texture(14,map.ground,desert?'sand':'floor');floorTex.repeat.set(12,12);floorTex.anisotropy=Math.min(4,this.renderer.capabilities.getMaxAnisotropy());
    const floor=new THREE.Mesh(new THREE.BoxGeometry(101,1,101),new THREE.MeshStandardMaterial({map:floorTex,roughness:.84,metalness:desert?.03:.25}));floor.position.y=-.51;floor.receiveShadow=true;this.world.add(floor);
    box(this.world,map.path,0,.009,0,8,.016,99);box(this.world,map.path,0,.012,0,99,.016,7);
    // Thin lane markings, drains and inset runway lights give scale at shoulder height.
    for(let i=-44;i<=44;i+=5){box(this.world,0x8b9d9c,-3.7,.023,i,.1,.012,2);box(this.world,0x8b9d9c,3.7,.023,i,.1,.012,2);box(this.world,map.accent,-4.4,.05,i,.18,.05,.75,true);box(this.world,map.accent,4.4,.05,i,.18,.05,.75,true);}
    for(const team of ['blue','red']){
      const z=team==='blue'?41:-41;box(this.world,0x182738,0,.022,z,70,.03,6);box(this.world,TEAM[team],0,.052,z-3,70,.025,.15,true);
      for(let x=-30;x<=30;x+=8){box(this.world,0x394d5b,x,.6,z+5,1.1,1.2,1.1);box(this.world,TEAM[team],x,1.25,z+5,.7,.045,.7,true);}
      const sign=new THREE.Mesh(new THREE.PlaneGeometry(7,1),textMaterial(team==='blue'?'SECTOR 01 / BLUE':'SECTOR 02 / RED',team==='blue'?'#70decf':'#ff967c'));sign.position.set(0,3.4,team==='blue'?49:-49);if(team==='blue')sign.rotation.y=Math.PI;this.world.add(sign);
    }
    for(const [i,o] of map.obstacles.entries()){
      const c=desert?(i%2?0x94725a:0xab8767):harbor?[0x48677a,0x76594c,0x405e60][i%3]:[0x3b5367,0x405e60,0x5b5167][i%3];
      if(harbor&&o.type==='container'){
        const t=texture(i+30,`#${c.toString(16)}`,'container');t.repeat.set(Math.max(1,o.w/7),1);
        const material=new THREE.MeshStandardMaterial({map:t,color:0xb9c2c9,roughness:.58,metalness:.55});const m=new THREE.Mesh(new THREE.BoxGeometry(o.w,o.h,o.d),material);m.position.set(o.x,o.h/2,o.z);m.castShadow=m.receiveShadow=true;this.world.add(m);
      }else box(this.world,c,o.x,o.h/2,o.z,o.w,o.h,o.d);
      box(this.world,desert?0xc5a17b:0x748794,o.x,o.h+.045,o.z,o.w+.08,.09,o.d+.08);
      box(this.world,0x1c2d3a,o.x,.16,o.z,o.w+.06,.32,o.d+.06);
      if(!desert){
        for(const x of [-1,1])for(const z of [-1,1])box(this.world,0x2a3e4a,o.x+x*(o.w/2-.11),o.h*.5,o.z+z*(o.d/2-.11),.22,o.h,.22);
        box(this.world,map.accent,o.x,o.h-.18,o.z+o.d/2+.016,Math.min(o.w*.5,3),.055,.035,true);
        for(let j=0;j<Math.min(6,Math.ceil(o.w/2));j++)box(this.world,0xb1a276,o.x-o.w/2+.25+j*.42,.22,o.z+o.d/2+.03,.19,.27,.025).rotation.z=-.3;
      }else{
        for(let j=1;j<o.h;j+=.9)box(this.world,0x80644f,o.x,j,o.z+o.d/2+.01,o.w,.025,.02);
        for(let j=1;j<o.w;j+=2)box(this.world,0x80644f,o.x-o.w/2+j,o.h/2,o.z+o.d/2+.016,.025,o.h,.02);
      }
    }
    for(const sign of [-1,1]){
      box(this.world,desert?0x82634e:0x1c3042,sign*50,1,0,.5,2,100);box(this.world,0x1c3042,0,1,sign*50,100,2,.5);
      for(let i=-45;i<=45;i+=10){box(this.world,0x334858,sign*50,2.2,i,.4,4.4,.4);box(this.world,0x334858,i,2.2,sign*50,.4,4.4,.4);}
    }
    if(harbor){
      box(this.world,0x142f44,0,-1.2,0,250,.1,250);
      for(const [x,z] of [[-60,-32],[60,32]]){box(this.world,0x304858,x,13,z,1.2,26,1.2);box(this.world,0x304858,x,25,z,1.5,1.5,34);box(this.world,0xd5aa72,x,18,z+10,.1,13,.1);box(this.world,0x233746,x,12,z+10,2.5,1.5,1.5);}
    }
    // Skyline is outside the collision world, so every visible in-arena cover is physical.
    for(let i=0;i<28;i++){const angle=i*Math.PI*2/28,r=68+(i%4)*7,x=Math.cos(angle)*r,z=Math.sin(angle)*r,h=desert?5+i%4:9+(i*11)%23,w=5+(i%3)*4;box(this.world,desert?0x685b52:0x1b2b3a,x,h/2-1,z,w,h,7);if(!desert){for(let y=3;y<h-1;y+=3)box(this.world,i%3?0x709394:0xd1a271,x,y,z+3.52,w*.65,.24,.02,true);box(this.world,0x314452,x,h,z,w+.5,.4,7.5);}}
    for(const [x,z] of [[-42,12],[42,-12],[-29,-36],[29,36]]){
      box(this.world,0x243b4a,x,4,z,.18,8,.18);box(this.world,0x243b4a,x+1,7.8,z,2,.16,.18);box(this.world,0xccdce1,x+1.5,7.65,z,.9,.09,.45,true);
    }
    mergeStatic(this.world);
  }
  setMap(id){const next=getMap(id);if(next.id===this.map.id)return;dispose(this.world);this.clearEffects();this.map=next;this.buildWorld();this.updateEnvironment();this.renderer.domElement.dataset.map=next.id;}
  updateEnvironment(){const desert=this.map.id==='desert';this.scene.background.set(this.map.sky);this.scene.fog.color.set(this.map.sky);this.hemi.color.set(desert?0xffd9aa:0xaecbdf);this.hemi.groundColor.set(desert?0x5d4845:0x1a2534);this.sun.color.set(desert?0xffbd83:0xffcba7);this.scene.fog.density=this.mode==='preview'?.006:.008;this.preview.style.background=this.map.preview;
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=512;const ctx=canvas.getContext('2d'),gradient=ctx.createLinearGradient(0,0,0,512);
    gradient.addColorStop(0,desert?'#40526f':'#081728');gradient.addColorStop(.43,desert?'#ccac91':'#34566f');gradient.addColorStop(.58,desert?'#90745f':'#162c40');gradient.addColorStop(1,'#07131f');ctx.fillStyle=gradient;ctx.fillRect(0,0,1024,512);
    for(let i=0;i<10;i++){const y=100+i*11;ctx.fillStyle=desert?'#f9d8a509':'#8bafc30a';ctx.fillRect(0,y,1024,2+i%3);}
    const glow=ctx.createRadialGradient(110,desert?194:138,3,110,desert?194:138,48);glow.addColorStop(0,'#ffddb8b3');glow.addColorStop(.23,'#ffbd8066');glow.addColorStop(1,'#ffbd8000');ctx.fillStyle=glow;ctx.fillRect(55,80,110,170);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;this.sky.material.map?.dispose();this.sky.material.map=texture;this.sky.material.needsUpdate=true;this.sun.position.set(-28,desert?22:38,22);
  }
  setQuality(quality){this.quality=['low','balanced','high'].includes(quality)?quality:'balanced';this.renderer.setPixelRatio(Math.min(devicePixelRatio,this.quality==='low'?1:this.quality==='high'?1.75:1.25));this.renderer.shadowMap.enabled=this.quality!=='low';this.bloom.enabled=this.quality!=='low';this.resize();}
  resize(){const el=this.mode==='preview'?this.preview:this.container,w=el.clientWidth,h=el.clientHeight;if(!w||!h)return;this.renderer.setSize(w,h,false);this.composer?.setSize(w,h);this.camera.aspect=this.previewCamera.aspect=w/h;this.camera.updateProjectionMatrix();this.previewCamera.fov=w/h<.8?56:45;this.previewCamera.updateProjectionMatrix();}
  setMode(mode){this.mode=mode;(mode==='preview'?this.preview:this.container).append(this.renderer.domElement);this.previewActors.visible=mode==='preview';this.firstGun.visible=false;this.objectiveVisual.visible=false;this.lastPlayer=null;for(const model of this.models.values())model.visible=false;if(mode==='preview')this.clearEffects();this.updateEnvironment();this.renderer.domElement.dataset.view=mode==='game'?'third-person':'map-preview';this.renderer.domElement.dataset.map=this.map.id;this.resize();}
  sync(state,id,dt,controls){
    const me=state.actors.find(a=>a.id===id);if(!me)return;this.lastActor=me;this.lastPlayer=id;const active=new Set();this.recoil=Math.max(0,this.recoil-dt*5);
    for(const a of state.actors){
      active.add(a.id);let m=this.models.get(a.id);if(m&&m.userData.team!==a.team){this.scene.remove(m);dispose(m);this.models.delete(a.id);m=null;}
      if(!m){m=operative(a.team,a.difficulty==='hard');this.scene.add(m);this.models.set(a.id,m);m.position.set(a.x,a.y,a.z);const hud=healthSprite();m.userData.health=hud;m.add(hud.sprite);const marker=new THREE.Sprite(new THREE.SpriteMaterial({map:textMaterial(a.bot?(a.difficulty==='hard'?'VETERAN':'OPERATOR'):a.name,a.team===me.team?'#75e5d4':'#ffa28c').map,transparent:true,depthTest:true,depthWrite:false}));marker.position.y=2.4;marker.scale.set(1.6,.36,1);m.add(marker);m.userData.marker=marker;}
      if(m.userData.weapon!==a.weapon){dispose(m.userData.gun);m.userData.gun.add(gunModel(a.weapon));m.userData.weapon=a.weapon;}
      const own=a.id===id,gap=Math.hypot(m.position.x-a.x,m.position.z-a.z),walking=gap>.015;
      if(gap>8||own)m.position.set(a.x,a.y,a.z);else m.position.lerp(new THREE.Vector3(a.x,a.y,a.z),1-Math.exp(-dt*18));
      m.visible=a.hp>0&&!(own&&controls.viewMode==='first');m.rotation.y=own?controls.yaw:a.yaw;
      m.userData.legs.forEach((leg,i)=>leg.rotation.x=walking?Math.sin(this.time*(a.sprinting?15:11)+i*Math.PI)*(a.dashTime>0?.9:.45):Math.sin(this.time*2)*.018);
      m.userData.rig.rotation.x=(own?controls.pitch:a.pitch)+this.recoil*.055*(own?1:0);m.userData.rig.rotation.z=a.reloadTime>0?-.17:0;m.userData.gun.position.z=-.39+this.recoil*.05*(own?1:0);
      m.rotation.z=a.dashTime>0?.14:0;
      const hud=m.userData.health,known=a.team===me.team||Math.hypot(a.x-me.x,a.z-me.z)<42&&visible(me,a,this.map.id);
      hud.sprite.visible=m.userData.marker.visible=!own&&known&&a.hp>0;const key=`${Math.ceil(a.hp)}|${a.shield>0}`;
      if(hud.key!==key){hud.key=key;hud.value=Math.ceil(a.hp);const c=hud.canvas.getContext('2d');c.clearRect(0,0,128,32);c.fillStyle='#0b1520dd';c.fillRect(0,0,128,32);c.fillStyle=a.shield>0?'#ffe4a0':a.team===me.team?'#70dece':'#ff8e76';c.fillRect(4,5,89*Math.max(0,a.hp/MAX_HP),5);c.font='bold 15px monospace';c.fillText(Math.ceil(a.hp),97,16);c.fillStyle='#90aab8';c.font='10px monospace';c.fillText(a.shield>0?'SHIELD':'HP',4,25);hud.texture.needsUpdate=true;}
    }
    for(const [key,m] of this.models)if(!active.has(key)){this.scene.remove(m);dispose(m);this.models.delete(key);}
    const aim=controls.aim&&!controls.freeLook,actor={...me,shoulder:controls.shoulder,viewMode:controls.viewMode,viewAspect:this.camera.aspect};
    const pose=cameraPose(actor,controls.viewYaw,controls.viewPitch,aim,this.map.id);
    this.camera.position.set(pose.x,pose.y,pose.z);this.camera.rotation.set(controls.viewPitch,controls.viewYaw,0,'YXZ');
    const targetFov=aim?(me.weapon==='sniper'?22:50):me.sprinting?80:72;this.camera.fov+=(targetFov-this.camera.fov)*(1-Math.exp(-dt*16));this.camera.updateProjectionMatrix();
    const ownModel=this.models.get(id);if(ownModel&&pose.distance<1.4&&controls.viewMode!=='first')ownModel.visible=false;
    this.firstGun.visible=controls.viewMode==='first'&&me.hp>0&&!controls.freeLook&&!(aim&&me.weapon==='sniper');
    if(this.firstWeapon!==me.weapon){dispose(this.firstGun);this.firstGun.add(gunModel(me.weapon));this.firstWeapon=me.weapon;}
    this.firstGun.position.set(aim?.06:.3,-.31+(me.reloadTime>0?-.15:0),-.65+this.recoil*.08);this.firstGun.rotation.set(me.reloadTime>0?-.3:0,me.reloadTime>0?.2:0,me.reloadTime>0?.5:0);
    this.renderer.domElement.dataset.view=controls.viewMode==='first'?'first-person':'third-person';
    this.crosshair?.style.setProperty('--crosshair-gap',`${aim?3:6+this.recoil*6+(me.sprinting?8:0)}px`);
    document.body.classList.toggle('scoped',aim&&me.weapon==='sniper');
    if(state.objective){const o=state.objective;this.objectiveVisual.visible=true;this.objectiveVisual.position.set(o.x,0,o.z);const color=o.contested?0xffc780:o.owner?TEAM[o.owner]:0xf1d09a;this.objectiveRing.material.color.setHex(color);this.objectiveBeam.material.color.setHex(color);this.objectiveRing.material.opacity=.55+Math.sin(this.time*3)*.15;}
    else this.objectiveVisual.visible=false;
  }
  clearEffects(){for(const e of this.effects){e.mesh.removeFromParent();e.mesh.geometry?.dispose();e.mesh.material?.map?.dispose();e.mesh.material?.dispose();}this.effects=[];}
  effect(event,id){
    const add=(mesh,life,extra={})=>{this.scene.add(mesh);this.effects.push({mesh,life,max:life,...extra});};
    if(event.type==='shot'){
      if(event.actor===id)this.recoil=Math.min(1.8,this.recoil+(event.weapon==='sniper'||event.weapon==='shotgun'?.9:.35));
      const color=TEAM[event.team],origin=new THREE.Vector3(event.origin.x,event.origin.y,event.origin.z);
      if(this.quality!=='low'&&this.effects.filter(e=>e.light).length<5){const light=new THREE.PointLight(0xffddb0,8,7,2);light.position.copy(origin);add(light,.065,{light:true});}
      const flash=new THREE.Mesh(new THREE.SphereGeometry(.13,8,6),new THREE.MeshBasicMaterial({color:0xffecbe,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}));flash.position.copy(origin);add(flash,.065,{grow:true});
      for(const end of event.traces.slice(0,this.quality==='low'?1:3)){
        const to=new THREE.Vector3(end.x,end.y,end.z),delta=to.clone().sub(origin),length=delta.length();
        const tracer=new THREE.Mesh(new THREE.CylinderGeometry(.012,.023,Math.max(.001,length),5),new THREE.MeshBasicMaterial({color:0xffdc9e,transparent:true,opacity:.8,blending:THREE.AdditiveBlending,depthWrite:false}));tracer.position.copy(origin).lerp(to,.5);tracer.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());add(tracer,.075);
        for(let i=0;i<(this.quality==='low'?2:4);i++){const spark=new THREE.Mesh(new THREE.BoxGeometry(.027,.027,.12),new THREE.MeshBasicMaterial({color:i%2?color:0xffdd9e,transparent:true}));spark.position.copy(to);add(spark,.18+Math.random()*.12,{velocity:new THREE.Vector3((Math.random()-.5)*3,Math.random()*2,(Math.random()-.5)*3)});}
      }
    }
    if(event.type==='hit'&&event.actor===id){const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:textMaterial(`${event.head?'◆ ':''}${Math.round(event.damage)}`,event.head?'#ffe09c':'#e9fcff','#00000000',128,48).map,transparent:true,depthTest:true,depthWrite:false}));sprite.position.set(event.x,event.y+.9,event.z);sprite.scale.set(1.3,.5,1);add(sprite,.7,{velocity:new THREE.Vector3(0,1.2,0),noGravity:true});}
    if(event.type==='pop'||event.type==='dash'){
      const count=this.quality==='low'?5:event.type==='pop'?18:8;
      for(let i=0;i<count;i++){const particle=new THREE.Mesh(new THREE.BoxGeometry(.065,.065,.065),new THREE.MeshBasicMaterial({color:i%3?TEAM[event.team]||0x9ce3df:0xffdf9e,transparent:true}));particle.position.set(event.x,event.y,event.z);add(particle,.35+Math.random()*.5,{velocity:new THREE.Vector3((Math.random()-.5)*5,Math.random()*4,(Math.random()-.5)*5)});}
    }
    const limit=this.quality==='low'?65:150;while(this.effects.length>limit){const e=this.effects.shift();e.mesh.removeFromParent();e.mesh.geometry?.dispose();e.mesh.material?.map?.dispose();e.mesh.material?.dispose();}
  }
  render(dt){
    if(this.webglLost)return;this.time+=dt;this.fps+=(1/Math.max(.001,dt)-this.fps)*.02;
    for(let i=this.effects.length-1;i>=0;i--){const e=this.effects[i];e.life-=dt;if(e.life<=0){e.mesh.removeFromParent();e.mesh.geometry?.dispose();e.mesh.material?.map?.dispose();e.mesh.material?.dispose();this.effects.splice(i,1);continue;}if(e.light)e.mesh.intensity=8*e.life/e.max;else e.mesh.material.opacity=e.life/e.max;if(e.grow)e.mesh.scale.setScalar(1+(1-e.life/e.max)*2);if(e.velocity){e.mesh.position.addScaledVector(e.velocity,dt);if(!e.noGravity)e.velocity.y-=dt*7;}}
    if(this.mode==='preview'){this.hero.userData.rig.rotation.x=Math.sin(this.time*.8)*.025;this.hero.rotation.y=Math.PI+.55+Math.sin(this.time*.16)*.1;this.previewCamera.position.x=29+Math.sin(this.time*.13)*1.2;this.previewCamera.lookAt(0,2.5,13);}
    this.renderer.info.reset();const camera=this.mode==='preview'?this.previewCamera:this.camera;this.renderPass.camera=camera;
    if(this.quality==='low')this.renderer.render(this.scene,camera);else this.composer.render(dt);
  }
  minimap(canvas,state,id){
    const c=canvas.getContext('2d'),size=canvas.width,s=size/(WORLD*2+4),at=size/2,me=state.actors.find(a=>a.id===id);c.clearRect(0,0,size,size);c.fillStyle='#101e2bee';c.fillRect(0,0,size,size);c.strokeStyle='#294051';c.lineWidth=1;for(let i=0;i<size;i+=size/5){c.beginPath();c.moveTo(i,0);c.lineTo(i,size);c.moveTo(0,i);c.lineTo(size,i);c.stroke();}
    c.fillStyle='#496171';for(const o of this.map.obstacles)c.fillRect((o.x-o.w/2)*s+at,(o.z-o.d/2)*s+at,o.w*s,o.d*s);
    if(state.objective){const o=state.objective;c.strokeStyle=o.owner?(o.owner==='blue'?'#70dece':'#ff8e76'):'#f6d79c';c.fillStyle='#f6d79c20';c.beginPath();c.arc(o.x*s+at,o.z*s+at,o.radius*s,0,Math.PI*2);c.fill();c.stroke();}
    for(const a of state.actors){if(a.hp<=0||a.team!==me?.team&&(Math.hypot(a.x-(me?.x||0),a.z-(me?.z||0))>25||!visible(me,a,this.map.id)))continue;c.fillStyle=a.id===id?'#ffffff':a.team==='blue'?'#70dece':'#ff8e76';c.beginPath();c.arc(a.x*s+at,a.z*s+at,a.id===id?3.7:2.5,0,Math.PI*2);c.fill();}
    if(me){c.strokeStyle='#ffffff';c.lineWidth=1.5;c.beginPath();c.moveTo(me.x*s+at,me.z*s+at);c.lineTo(me.x*s+at-Math.sin(this.camera.rotation.y)*9,me.z*s+at-Math.cos(this.camera.rotation.y)*9);c.stroke();}
  }
}
