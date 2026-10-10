import * as THREE from 'three';
import { WORLD, WEAPONS, getMap, cameraPose } from './simulation.js';
const colors={blue:0x549ec6,red:0xec8c7e};
const geometries={box:new THREE.BoxGeometry(1,1,1),sphere:new THREE.SphereGeometry(1,10,8),cylinder:new THREE.CylinderGeometry(1,1,1,12),cone:new THREE.ConeGeometry(1,1,6)};
const mats=new Map();
function material(color,unlit=false){const key=String(color)+unlit;if(!mats.has(key))mats.set(key,unlit?new THREE.MeshBasicMaterial({color}):new THREE.MeshStandardMaterial({color,roughness:.85,metalness:0}));return mats.get(key);}
function shape(parent,kind,color,pos,size,unlit=false){const mesh=new THREE.Mesh(geometries[kind],material(color,unlit));mesh.position.set(...pos);mesh.scale.set(...size);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
function box(parent,color,x,y,z,w,h,d){return shape(parent,'box',color,[x,y,z],[w,h,d]);}
function sphere(parent,color,x,y,z,r){return shape(parent,'sphere',color,[x,y,z],[r,r,r]);}
function label(text,color='#355748',background='#fffae8',width=256,height=96){const c=document.createElement('canvas');c.width=width;c.height=height;const ctx=c.getContext('2d');ctx.fillStyle=background;ctx.beginPath();ctx.roundRect(0,0,width,height,14);ctx.fill();ctx.fillStyle=color;ctx.font=`bold ${height*.42}px system-ui, sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,width/2,height/2);const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;return new THREE.MeshBasicMaterial({map:texture,transparent:true});}
// Merge static meshes by material: keeps mobile draw calls low without external assets.
function mergeStatic(root, excluded=new Set()){
  root.updateMatrixWorld(true);const groups=new Map(),remove=[],sharedMaterials=new Set(mats.values());
  root.traverse(mesh=>{if(!mesh.isMesh||mesh.material.map||!sharedMaterials.has(mesh.material))return;
    for(let p=mesh;p&&p!==root;p=p.parent)if(excluded.has(p))return;
    const geometry=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry.clone();
    const relative=new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(mesh.matrixWorld);geometry.applyMatrix4(relative);
    if(!groups.has(mesh.material))groups.set(mesh.material,[]);groups.get(mesh.material).push(geometry);remove.push(mesh);
  });
  for(const mesh of remove)mesh.removeFromParent();
  for(const [mat,parts] of groups){const merged=new THREE.BufferGeometry();for(const name of ['position','normal','uv']){if(!parts.every(g=>g.attributes[name]))continue;const length=parts.reduce((n,g)=>n+g.attributes[name].array.length,0),array=new Float32Array(length);let offset=0;for(const g of parts){array.set(g.attributes[name].array,offset);offset+=g.attributes[name].array.length;}merged.setAttribute(name,new THREE.BufferAttribute(array,parts[0].attributes[name].itemSize));}const mesh=new THREE.Mesh(merged,mat);mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);parts.forEach(g=>g.dispose());}
}
export function gunModel(weapon='blaster'){
  const group=new THREE.Group(),color=WEAPONS[weapon]?.color||'#ffb84a',len=weapon==='sniper'?1.5:weapon==='smg'?.75:1.05;
  box(group,color,0,0,0,.26,.28,len);box(group,'#f5f0d7',0,.06,-len/2-.08,.21,.19,.2);box(group,'#4b6965',0,.04,-len/2-.2,.13,.13,.13);box(group,'#536b65',0,-.21,.2,.15,.3,.19).rotation.x=-.2;
  box(group,'#d9d9b9',0,0,len/2+.09,.22,.19,.22);box(group,'#46655e',0,.17,.05,.13,.06,.25);box(group,'#fff2b1',.137,0,.02,.014,.11,.22);
  if(weapon==='sniper'){const scope=shape(group,'cylinder','#45675f',[0,.29,-.1],[.095,.4,.095]);scope.rotation.x=Math.PI/2;sphere(group,'#98dacc',0,.29,-.31,.08);}
  if(weapon==='shotgun'){box(group,'#f4d774',0,-.03,-.57,.36,.18,.31);}
  mergeStatic(group);return group;
}
function disposeGroup(group){
  const shared=new Set(mats.values());group.traverse(o=>{if(o.geometry&&!Object.values(geometries).includes(o.geometry))o.geometry.dispose();if(o.material&&!shared.has(o.material)){o.material.map?.dispose();o.material.dispose();}});group.clear();
}
function robot(team,hard=false){
  const g=new THREE.Group(),c=colors[team],cream=0xfff0cb;
  box(g,c,0,.91,0,.66,.68,.44);box(g,cream,0,1.47,0,.74,.55,.61);box(g,c,0,1.77,0,.81,.15,.66);box(g,0x2b5156,0,1.5,-.317,.55,.23,.035);
  for(const x of [-.14,.14])sphere(g,0xb4eee0,x,1.52,-.347,.046);
  box(g,cream,0,1.35,-.33,.2,.055,.02);box(g,0xe8d5b1,0,1.18,0,.24,.12,.26);
  // A tiny adventure backpack and shoulder straps make the rear silhouette legible.
  box(g,0xe2b761,0,.91,.31,.49,.54,.22);box(g,0xf9e6aa,0,.95,.44,.22,.08,.02);
  for(const x of [-.25,.25])box(g,0xf3dcb2,x,.96,-.23,.07,.52,.035);
  const legs=[];
  for(const x of [-.2,.2]){const leg=new THREE.Group();leg.position.set(x,.57,0);g.add(leg);box(leg,0x54766a,0,-.16,0,.22,.39,.24);box(leg,cream,0,-.39,-.07,.29,.18,.42);mergeStatic(leg);legs.push(leg);}
  const rig=new THREE.Group();rig.position.y=1.19;g.add(rig);
  box(rig,c,.43,-.12,0,.22,.27,.25);box(rig,c,.42,-.17,-.24,.22,.2,.47);sphere(rig,cream,.35,-.09,-.39,.12);
  box(rig,c,-.43,-.12,-.05,.22,.26,.25);const forearm=box(rig,c,-.13,-.15,-.4,.62,.2,.22);forearm.rotation.y=-.55;sphere(rig,cream,.15,-.1,-.57,.12);
  const gun=new THREE.Group();gun.scale.setScalar(.72);gun.position.set(.32,.035,-.42);gun.add(gunModel(hard?'sniper':'blaster'));rig.add(gun);mergeStatic(rig,new Set([gun]));
  if(hard)shape(g,'cone',0xffd96e,[0,1.97,0],[.18,.27,.18]);
  const shadow=new THREE.Mesh(new THREE.CircleGeometry(.59,18),new THREE.MeshBasicMaterial({color:0x547969,transparent:true,opacity:.18,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=.015;g.add(shadow);
  g.userData={legs,gun,rig,team};mergeStatic(g,new Set([...legs,rig]));return g;
}
export class ArenaRenderer {
  constructor(preview,container){
    this.preview=preview;this.container=container;this.mode='preview';this.quality='balanced';this.models=new Map();this.effects=[];this.time=0;this.recoil=0;this.map=getMap();this.lastPlayer=null;this.webglLost=false;
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.setClearColor(0xdfe9db);
    preview.replaceChildren(this.renderer.domElement);this.renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();this.webglLost=true;window.dispatchEvent(new CustomEvent('game-render-error'));});
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color(0xdfe9db);this.scene.fog=new THREE.Fog(0xdfe9db,100,190);this.scene.add(new THREE.HemisphereLight(0xffffe7,0x8aa686,1.8));
    const sun=new THREE.DirectionalLight(0xfff0d1,2.4);sun.position.set(-22,38,15);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-36;sun.shadow.camera.right=36;sun.shadow.camera.top=36;sun.shadow.camera.bottom=-36;sun.shadow.normalBias=.04;sun.shadow.bias=-.0002;sun.shadow.camera.far=110;this.scene.add(sun);
    this.camera=new THREE.PerspectiveCamera(75,1,.06,140);this.camera.rotation.order='YXZ';this.scene.add(this.camera);
    this.previewCamera=new THREE.OrthographicCamera(-40,40,30,-30,.1,180);this.previewCamera.position.set(54,45,62);this.previewCamera.lookAt(0,0,1);
    this.world=new THREE.Group();this.scene.add(this.world);this.buildWorld();mergeStatic(this.world);this.previewActors=new THREE.Group();this.scene.add(this.previewActors);
    for(const [team,x,z,s,hard] of [['blue',10,24,4.5,false],['blue',0,26,3.6,true],['red',-12,20,3.3,false]]){const r=robot(team,hard);r.position.set(x,0,z);r.rotation.y=Math.PI+.6;r.scale.setScalar(s);this.previewActors.add(r);}
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(preview);this.resizeObserver.observe(container);window.addEventListener('resize',()=>this.resize());this.resize();
  }
  setMap(id){
    const next=getMap(id);if(next.id===this.map.id)return;
    disposeGroup(this.world);this.clearEffects();this.map=next;this.buildWorld();mergeStatic(this.world);this.updateEnvironment();
    this.renderer.domElement.dataset.map=next.id;
  }
  updateEnvironment(){
    const color=this.mode==='preview'?this.map.preview:this.map.sky;this.scene.background.set(color);this.scene.fog.color.set(color);
    this.scene.fog.near=this.mode==='preview'?100:38;this.scene.fog.far=this.mode==='preview'?190:105;
    this.preview.style.background=this.map.preview;
  }
  buildWorld(){
    const map=this.map,harbor=map.id==='harbor',desert=map.id==='desert';
    box(this.world,map.ground,0,-.65,0,51,1.3,51);box(this.world,desert?'#bb926c':'#c5bc9d',0,-1.45,0,51,.5,51);
    if(harbor){box(this.world,'#8cc2d3',0,-1.9,0,150,.15,150);for(let i=-60;i<=60;i+=8)box(this.world,'#abd7dd',i,-1.8,38+(i%3)*2,4,.01,.12);}
    if(desert)box(this.world,'#dbc499',0,-1.8,0,150,.15,150);
    if(!desert)for(let i=-24;i<=24;i+=4){box(this.world,harbor?'#acbbbe':'#c2d3ab',i,.006,0,.025,.012,50);box(this.world,harbor?'#acbbbe':'#c2d3ab',0,.007,i,50,.012,.025);}
    box(this.world,map.path,0,.017,0,harbor?6:9,.025,48);box(this.world,map.path,0,.02,0,48,.025,desert?6:8);
    for(const team of ['blue','red']){
      const z=team==='blue'?22:-22,col=team==='blue'?0xa5cad4:0xe9b6a1;
      box(this.world,col,0,.037,z,34,.04,4);for(let x=-16;x<=16;x+=4)box(this.world,0xfaf0d1,x,.065,z,1.5,.01,.13);
      const sign=new THREE.Mesh(new THREE.PlaneGeometry(6,1.8),label(team==='blue'?'BLUE BASE':'RED BASE'));sign.position.set(0,3.9,team==='blue'?24.8:-24.8);if(team==='blue')sign.rotation.y=Math.PI;this.world.add(sign);
      for(const x of [-3.5,3.5])box(this.world,colors[team],x,2,z+(team==='blue'?2.8:-2.8),.3,4,.3);
    }
    for(const o of map.obstacles){
      if(o.type==='tower'){
        box(this.world,o.color,o.x,1.65,o.z,o.w,3.3,o.d);box(this.world,map.trim,o.x,3.35,o.z,o.w,.1,o.d);
        box(this.world,0xf3d5a1,0,4.05,0,3.4,1.5,3.4);const roof=shape(this.world,'cone',0xe19665,[0,5.25,0],[2.8,1.1,2.8]);roof.rotation.y=Math.PI/4;
        const sign=new THREE.Mesh(new THREE.PlaneGeometry(2.4,1),label('PLAY!'));sign.position.set(0,2.05,3.015);this.world.add(sign);continue;
      }
      box(this.world,o.color,o.x,o.h/2,o.z,o.w,o.h,o.d);
      if(o.type==='container'){
        box(this.world,map.trim,o.x,o.h-.08,o.z,o.w,.16,o.d);
        for(let z=o.z-o.d/2+.35;z<o.z+o.d/2;z+=.75){for(const x of [o.x-o.w/2-.01,o.x+o.w/2+.01])box(this.world,map.trim,x,o.h/2,z,.025,o.h-.35,.06);}
        for(const x of [o.x-o.w*.2,o.x+o.w*.2])box(this.world,'#657980',x,o.h/2,o.z+o.d/2+.02,.08,o.h-.3,.04);
        const plate=new THREE.Mesh(new THREE.PlaneGeometry(Math.min(2.2,o.w-.3),.65),label('CARGO','#577984','#f1ead5'));plate.position.set(o.x,o.h*.65,o.z+o.d/2+.04);this.world.add(plate);
      }else if(desert){
        box(this.world,map.trim,o.x,o.h-.12,o.z,o.w,.24,o.d);
        for(let y=.8;y<o.h-.3;y+=.8)box(this.world,'#b38b65',o.x,y,o.z+o.d/2+.008,o.w,.025,.014);
        for(let x=o.x-o.w/2+.6;x<o.x+o.w/2;x+=1.2)box(this.world,'#b38b65',x,o.h/2,o.z+o.d/2+.014,.025,o.h-.25,.025);
        if(o.type==='pillar')box(this.world,'#e9d4a5',o.x,o.h*.58,o.z+o.d/2+.028,.8,.8,.025).rotation.z=Math.PI/4;
      }else{
        box(this.world,map.trim,o.x,o.h-.1,o.z,o.w,.2,o.d);
        if(o.type==='crate'){box(this.world,'#fae1ad',o.x,o.h*.5,o.z+o.d/2+.01,o.w,.17,.03);box(this.world,'#fae1ad',o.x,o.h*.5,o.z+o.d/2+.02,.17,o.h,.03);}
        else{for(let x=o.x-o.w/2+.55;x<o.x+o.w/2;x+=1.2)shape(this.world,'cylinder',o.color,[x,o.h+.06,o.z],[.27,.12,.27]);if(o.h>2){box(this.world,0x628d7c,o.x,o.h*.5,o.z-o.d/2-.015,o.w*.55,.65,.03);box(this.world,0xf8eac5,o.x,o.h*.5,o.z-o.d/2-.035,.07,.65,.02);}}
      }
    }
    for(let i=-24;i<=24;i+=2){for(const [x,z] of [[i,-25],[i,25],[-25,i],[25,i]])box(this.world,map.trim,x,.7,z,.23,1.4,.23);}
    for(const z of [-25,25]){box(this.world,map.trim,0,.55,z,50,.2,.16);box(this.world,map.trim,0,1.1,z,50,.2,.16);}for(const x of [-25,25]){box(this.world,map.trim,x,.55,0,.16,.2,50);box(this.world,map.trim,x,1.1,0,.16,.2,50);}
    if(harbor){
      // Cranes and lighthouse are outside the playable fence.
      for(const x of [-34,34]){box(this.world,'#d6ae62',x,6,0,1,12,1);box(this.world,'#d6ae62',x,12,0,1,1,18);box(this.world,'#708b94',x,8,-8,.09,8,.09);box(this.world,'#e5c788',x,4,-8,1,.3,1);}
      shape(this.world,'cylinder','#f0dfc8',[25,3,-35],[2,6,2]);shape(this.world,'cylinder','#e99b87',[25,5,-35],[2.03,.8,2.03]);shape(this.world,'cone','#7297a8',[25,7,-35],[2.8,2,2.8]);
    }else if(desert){
      for(let i=0;i<12;i++){const angle=i*Math.PI/6,x=Math.cos(angle)*34,z=Math.sin(angle)*34;const rock=sphere(this.world,i%2?'#caa679':'#e1c89e',x,0,z,4+i%3);rock.scale.y=.4;}
      for(const [x,z] of [[-29,-17],[29,17],[-30,12],[30,-12]]){shape(this.world,'cylinder','#8caa78',[x,1.6,z],[.4,3.2,.4]);box(this.world,'#8caa78',x+.65,1.6,z,1.1,.55,.5);shape(this.world,'cylinder','#8caa78',[x+1,2.15,z],[.27,1.2,.27]);}
    }else{
      for(let i=0;i<20;i++){const angle=i*Math.PI*2/20,r=30+(i%3)*3,x=Math.cos(angle)*r,z=Math.sin(angle)*r;box(this.world,0xaa956a,x,1.5,z,.65,3,.65);sphere(this.world,i%2?0x8da97a:0xa2ba86,x,4,z,2.5);sphere(this.world,0xa6bd87,x+1,3.7,z+.5,1.7);}
    }
    for(let i=0;i<6;i++){const cloud=new THREE.Group(),x=Math.cos(i*2.4)*60,z=Math.sin(i*2.4)*60;for(let j=0;j<3;j++){const m=sphere(cloud,0xf6f6e9,x+j*3,23+(i%3)*4,z,3+j%2);m.scale.y*=.55;m.castShadow=false;}this.world.add(cloud);}
  }
  setQuality(q){this.quality=q;this.renderer.setPixelRatio(Math.min(devicePixelRatio,q==='low'?1:q==='high'?2:1.5));this.renderer.shadowMap.enabled=q!=='low';this.resize();}
  resize(){const el=this.mode==='preview'?this.preview:this.container,w=el.clientWidth,h=el.clientHeight;if(!w||!h)return;this.renderer.setSize(w,h,false);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();const span=w/h<1?40:29;this.previewCamera.left=-span*w/h;this.previewCamera.right=span*w/h;this.previewCamera.top=span;this.previewCamera.bottom=-span;this.previewCamera.updateProjectionMatrix();}
  setMode(mode){
    this.mode=mode;(mode==='preview'?this.preview:this.container).append(this.renderer.domElement);this.previewActors.visible=mode==='preview';this.lastPlayer=null;this.updateEnvironment();
    this.renderer.domElement.dataset.view=mode==='game'?'third-person':'map-preview';this.renderer.domElement.dataset.map=this.map.id;
    for(const model of this.models.values())model.visible=mode==='game';if(mode==='preview')this.clearEffects();this.resize();
  }
  clearEffects(){for(const e of this.effects){this.scene.remove(e.mesh);e.mesh.geometry?.dispose();e.mesh.material?.dispose();}this.effects=[];}
  sync(state,playerId,dt,controls){
    const active=new Set();let me;
    this.recoil=Math.max(0,this.recoil-dt*4);
    for(const a of state.actors){
      const own=a.id===playerId;if(own)me=a;active.add(a.id);let model=this.models.get(a.id);
      if(model&&model.userData.team!==a.team){this.scene.remove(model);disposeGroup(model);this.models.delete(a.id);model=null;}
      if(!model){
        model=robot(a.team,a.difficulty==='hard');this.models.set(a.id,model);this.scene.add(model);model.position.set(a.x,a.y,a.z);
        const marker=new THREE.Sprite(new THREE.SpriteMaterial({map:label(a.bot?(a.difficulty==='hard'?'困难':'简单'):a.name,a.team==='blue'?'#40749d':'#b4564c').map,depthTest:true,transparent:true}));marker.position.y=2.2;marker.scale.set(.72,.27,1);model.add(marker);model.userData.marker=marker;
      }
      if(model.userData.weapon!==a.weapon){const gun=model.userData.gun;disposeGroup(gun);gun.add(gunModel(a.weapon));model.userData.weapon=a.weapon;}
      const gap=Math.hypot(model.position.x-a.x,model.position.z-a.z),walk=gap>.02;
      model.visible=a.hp>0;if(gap>7)model.position.set(a.x,a.y,a.z);else model.position.lerp(new THREE.Vector3(a.x,a.y,a.z),1-Math.exp(-dt*(own?26:15)));
      model.rotation.y=own?controls.yaw:a.yaw;
      model.userData.legs.forEach((leg,i)=>leg.rotation.x=walk?Math.sin(this.time*11+i*Math.PI)*.43:0);
      model.userData.rig.rotation.x=(own?controls.pitch:a.pitch)+(own?this.recoil*.08:0);
      model.userData.gun.position.z=-.42+(own?this.recoil*.045:0);model.userData.marker.visible=!own&&a.hp>0;
    }
    for(const [id,model] of this.models){if(!active.has(id)){this.scene.remove(model);disposeGroup(model);this.models.delete(id);}}
    if(me){
      const yaw=controls.viewYaw,pitch=controls.viewPitch,aim=controls.aim&&!controls.freeLook;
      const pose=cameraPose(me,yaw,pitch,aim,this.map.id);
      // Orbit reacts immediately; a collision-constrained camera never eases through cover.
      this.camera.position.set(pose.x,pose.y,pose.z);this.camera.rotation.set(pitch,yaw,0,'YXZ');this.lastPlayer=playerId;
      const fov=aim?(me.weapon==='sniper'?38:52):68;this.camera.fov+=(fov-this.camera.fov)*Math.min(1,dt*14);this.camera.updateProjectionMatrix();
    }
    return me;
  }
  effect(event,playerId){
    if(event.type==='shot'){
      if(event.actor===playerId)this.recoil=1;
      for(const end of event.traces.slice(0,3)){
        const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(event.origin.x,event.origin.y-.1,event.origin.z),new THREE.Vector3(end.x,end.y,end.z)]),new THREE.LineBasicMaterial({color:event.team==='blue'?0xa9e8ff:0xffdba9,transparent:true,opacity:.85}));this.scene.add(line);this.effects.push({mesh:line,life:.11,max:.11});
      }
    }
    if(event.type==='pop'||event.type==='hit'){
      const count=event.type==='pop'?18:4;
      for(let i=0;i<count;i++){const mesh=new THREE.Mesh(new THREE.SphereGeometry(event.type==='pop'?.13:.07,5,4),new THREE.MeshBasicMaterial({color:[0xffd985,0xb4e4cc,0xf4b9b1,0xfaf5d5][i%4],transparent:true}));mesh.position.set(event.x,event.y,event.z);this.scene.add(mesh);this.effects.push({mesh,life:event.type==='pop'?.85:.28,max:event.type==='pop'?.85:.28,velocity:new THREE.Vector3((Math.random()-.5)*5,Math.random()*4,(Math.random()-.5)*5)});}
    }
    while(this.effects.length>160){const e=this.effects.shift();this.scene.remove(e.mesh);e.mesh.geometry.dispose();e.mesh.material.dispose();}
  }
  render(dt){if(this.webglLost)return;this.time+=dt;
    for(let i=this.effects.length-1;i>=0;i--){const e=this.effects[i];e.life-=dt;if(e.life<=0){this.scene.remove(e.mesh);e.mesh.geometry.dispose();e.mesh.material.dispose();this.effects.splice(i,1);continue;}e.mesh.material.opacity=e.life/e.max;if(e.velocity){e.mesh.position.addScaledVector(e.velocity,dt);e.velocity.y-=dt*8;}}
    if(this.mode==='preview')this.previewActors.children.forEach((r,i)=>{r.position.y=Math.sin(this.time*1.7+i)*.09;r.rotation.y=Math.PI+.6+Math.sin(this.time*.4+i)*.1;});
    this.renderer.render(this.scene,this.mode==='preview'?this.previewCamera:this.camera);
  }
  minimap(canvas,state,id){const c=canvas.getContext('2d'),s=canvas.width/(WORLD*2+4),offset=canvas.width/2;c.clearRect(0,0,canvas.width,canvas.height);c.fillStyle=this.map.ground;c.fillRect(0,0,canvas.width,canvas.height);c.fillStyle='#9bb28b';for(const o of this.map.obstacles)c.fillRect((o.x-o.w/2)*s+offset,(o.z-o.d/2)*s+offset,o.w*s,o.d*s);
    const me=state.actors.find(a=>a.id===id);for(const a of state.actors){if(a.hp<=0||a.team!==me?.team&&Math.hypot(a.x-(me?.x||0),a.z-(me?.z||0))>14)continue;c.beginPath();c.arc(a.x*s+offset,a.z*s+offset,a.id===id?4:2.8,0,Math.PI*2);c.fillStyle=a.id===id?'#fffef0':a.team==='blue'?'#3a8bbd':'#d96e63';c.fill();if(a.id===id){c.strokeStyle='#537a60';c.lineWidth=1.5;c.stroke();c.beginPath();c.moveTo(a.x*s+offset,a.z*s+offset);c.lineTo(a.x*s+offset-Math.sin(this.camera.rotation.y)*10,a.z*s+offset-Math.cos(this.camera.rotation.y)*10);c.stroke();}}
  }
}
