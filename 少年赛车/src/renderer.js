import * as THREE from '/vendor/three.module.js';
import {CARS,getTrack,ROAD_HALF,PICKUP_BOX,BOOST_PAD,steeringLimit,mod,clamp} from './tracks.js';
import {AdaptiveQuality,renderRatio} from './quality.js';
import {dampSpring,motionTargets,cameraFrame,smoothCameraFrame} from './presentation.js';
import {RaceEffects,SpeedStreaks} from './effects.js';
import {CourseGuidance} from './course-guidance.js';
import {TrackLightShow,isNightTrack} from './light-show.js';
import {GUARDRAIL_OFFSET} from './driving.js';
import {PostPipeline} from './postfx.js';
import {createSky,createOutdoorEnvironment,skyPreset} from './sky-environment.js';
import {buildSceneryKit} from './track-scenery.js';
const materials=new Map(),sharedGeometries=new Set();
const boxGeo=new THREE.BoxGeometry(1,1,1);sharedGeometries.add(boxGeo);
let carbonMap,liveryMap;
function carbonTexture(){
  if(carbonMap)return carbonMap;
  const c=document.createElement('canvas');c.width=c.height=128;const ctx=c.getContext('2d');
  ctx.fillStyle='#111416';ctx.fillRect(0,0,128,128);
  // A 2x2 twill reads as woven composite at car distance without a photo texture.
  for(let y=0;y<8;y++)for(let x=0;x<8;x++){ctx.fillStyle=(x+y)%2?'#242a2d':'#0d1012';ctx.fillRect(x*16+1,y*16+1,14,14);ctx.fillStyle=(x+y)%2?'#31383b':'#171b1e';ctx.fillRect(x*16+2,y*16+2,12,3);}
  ctx.globalAlpha=.25;for(let i=0;i<520;i++){ctx.fillStyle=i%2?'#59646a':'#000';ctx.fillRect((i*37)%128,(i*53)%128,1,1);}
  ctx.globalAlpha=1;carbonMap=new THREE.CanvasTexture(c);carbonMap.wrapS=carbonMap.wrapT=THREE.RepeatWrapping;carbonMap.repeat.set(2,2);carbonMap.colorSpace=THREE.SRGBColorSpace;carbonMap.anisotropy=4;return carbonMap;
}
function liveryTexture(){
  if(liveryMap)return liveryMap;
  const c=document.createElement('canvas');c.width=512;c.height=128;const ctx=c.getContext('2d');
  ctx.clearRect(0,0,512,128);
  ctx.fillStyle='#e7e2d4';ctx.fillRect(14,86,484,9);
  ctx.fillStyle='#c8bda6';ctx.fillRect(14,100,346,4);
  ctx.fillStyle='#f3efe2';ctx.font='900 50px system-ui';ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText('JRC',26,48);
  ctx.fillStyle='#c8bda6';ctx.font='700 18px monospace';ctx.fillText('PERFORMANCE DIVISION',150,52);
  ctx.fillStyle='#e7e2d4';ctx.fillRect(430,22,58,58);ctx.fillStyle='#171b1d';ctx.font='900 44px system-ui';ctx.textAlign='center';ctx.fillText('07',459,54);
  liveryMap=new THREE.CanvasTexture(c);liveryMap.colorSpace=THREE.SRGBColorSpace;liveryMap.anisotropy=4;return liveryMap;
}
function mat(color,kind='default') {
  if(typeof kind==='boolean')kind=kind?'light':'default';
  const key=`${color}:${kind}`;
  if(!materials.has(key)) {
    if(kind==='paint')materials.set(key,new THREE.MeshPhysicalMaterial({color,roughness:.26,metalness:.3,clearcoat:1,clearcoatRoughness:.055,envMapIntensity:1.15}));
    else if(kind==='glass')materials.set(key,new THREE.MeshPhysicalMaterial({color,roughness:.045,metalness:.35,clearcoat:1,clearcoatRoughness:.02,envMapIntensity:2.3}));
    else if(kind==='metal')materials.set(key,new THREE.MeshStandardMaterial({color,roughness:.28,metalness:.9,envMapIntensity:1.2}));
    else if(kind==='chrome')materials.set(key,new THREE.MeshStandardMaterial({color,roughness:.1,metalness:1,envMapIntensity:1.5}));
    else if(kind==='carbon')materials.set(key,new THREE.MeshStandardMaterial({color:'#ffffff',map:carbonTexture(),roughness:.4,metalness:.5,envMapIntensity:.9}));
    else if(kind==='rubber')materials.set(key,new THREE.MeshStandardMaterial({color,roughness:.94,metalness:0,envMapIntensity:.3}));
    else if(kind==='terrain')materials.set(key,new THREE.MeshStandardMaterial({color:'#ffffff',map:terrainTexture(),roughness:1,metalness:0}));
    else if(kind==='terrainShaded')materials.set(key,new THREE.MeshStandardMaterial({color:'#ffffff',map:terrainTexture(),vertexColors:true,roughness:.98,metalness:0,envMapIntensity:.45}));
    else if(kind==='light')materials.set(key,new THREE.MeshStandardMaterial({color:'#1b1a16',emissive:color,emissiveIntensity:2.6,roughness:.32,metalness:.15,envMapIntensity:.7}));
    else if(kind==='roadpaint')materials.set(key,new THREE.MeshStandardMaterial({color,roughness:.5,metalness:.02,emissive:color,emissiveIntensity:.08,envMapIntensity:.45}));
    else if(kind==='decal')materials.set(key,new THREE.MeshStandardMaterial({map:liveryTexture(),transparent:true,roughness:.5,metalness:.1,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2,side:THREE.DoubleSide}));
    else materials.set(key,new THREE.MeshStandardMaterial({color,roughness:.8,metalness:.05}));
  }
  return materials.get(key);
}
function box(parent,w,h,d,x,y,z,color,kind='default') {
  const m=new THREE.Mesh(boxGeo,color?.isMaterial?color:mat(color,kind));
  m.scale.set(w,h,d);m.position.set(x,y,z);parent.add(m);return m;
}
// Merge the static panels by material. Six detailed cars remain a small draw budget.
function mergeStatic(group) {
  group.updateMatrixWorld(true);const batches=new Map();
  for(const mesh of [...group.children]) {
    if(!mesh.isMesh)continue;
    const geo=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry.clone();
    geo.applyMatrix4(mesh.matrix);const list=batches.get(mesh.material)||[];list.push(geo);batches.set(mesh.material,list);
    group.remove(mesh);if(mesh.geometry!==boxGeo)mesh.geometry.dispose();
  }
  for(const [material,list] of batches) {
    const geo=new THREE.BufferGeometry();
    for(const key of ['position','normal','uv']) {
      if(!list.every(g=>g.getAttribute(key)))continue;
      const size=list[0].getAttribute(key).itemSize,total=list.reduce((n,g)=>n+g.getAttribute(key).array.length,0),values=new Float32Array(total);
      let cursor=0;for(const g of list){values.set(g.getAttribute(key).array,cursor);cursor+=g.getAttribute(key).array.length;}
      geo.setAttribute(key,new THREE.BufferAttribute(values,size));
    }
    list.forEach(g=>g.dispose());geo.computeBoundingSphere();const mesh=new THREE.Mesh(geo,material);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
  }
}
// Rounded, tapered cross-sections form actual bodywork instead of stacked cubes.
function coachwork(sections) {
  const positions=[],indices=[],ring=8;
  for(const [z,w,bottom,top] of sections) {
    for(const [x,y] of [[-w*.82,bottom],[w*.82,bottom],[w,bottom+.08],[w,top-.1],[w*.78,top],[-w*.78,top],[-w,top-.1],[-w,bottom+.08]])positions.push(x,y,z);
  }
  for(let j=0;j<sections.length-1;j++)for(let k=0;k<ring;k++){const a=j*ring+k,b=j*ring+(k+1)%ring;indices.push(a,b,a+ring,b,b+ring,a+ring);}
  for(let k=1;k<ring-1;k++){indices.push(0,k+1,k);const a=(sections.length-1)*ring;indices.push(a,a+k,a+k+1);}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setIndex(indices);geo.computeVertexNormals();return geo;
}
const carTemplates=new Map();
export function makeCar(id,colorOverride) {
  const config=CARS.find(c=>c.id===id)||CARS[0],color=colorOverride||config.color,key=`${config.id}:${color}`;
  let template=carTemplates.get(key);
  if(!template) {
    const g=new THREE.Group(),formula=id==='bolt',gt=id==='titan',w=gt?1.03:.94,len=gt?4.85:4.55;
    const paint=mat(color,'paint'),carbon=mat('#ffffff','carbon'),glass=mat('#24384a','glass'),metal=mat('#9aa3a6','metal'),lights=mat('#e9e5d5','light'),decal=mat('#ffffff','decal');
    const body=new THREE.Mesh(coachwork(formula?[[-2.3,.62,.3,.64],[-1.4,.76,.28,.83],[.2,.65,.28,.77],[1.4,.36,.3,.6],[2.3,.22,.34,.45]]:[[-len/2,w*.88,.3,.67],[-1.3,w,.28,.91],[-.2,w*.99,.28,.81],[1.25,w*.95,.3,.72],[len/2,w*.82,.37,.57]]),paint);g.add(body);
    if(!formula) {
      const cabin=new THREE.Mesh(coachwork([[-1.42,w*.68,.73,.91],[-.7,w*.7,.73,gt?1.52:1.35],[.28,w*.65,.71,gt?1.49:1.32],[1.05,w*.7,.7,.77]]),glass);g.add(cabin);
      box(g,w*1.3,.045,.92,0,gt?1.52:1.35,-.24,paint);
      for(const side of [-1,1]) {
        const pillar=box(g,.055,.56,.06,side*w*.67,1.02,.64,paint);pillar.rotation.x=-.85;
        box(g,.2,.09,.22,side*(w+.08),.95,.53,carbon);
        box(g,.16,.07,.02,side*(w+.09),.95,.43,glass);
        box(g,.04,.05,1.65,side*(w+.005),.66,-.14,carbon);
      }
    } else {
      box(g,.54,.14,1.25,0,.8,-.35,carbon);
      const helmet=new THREE.Mesh(new THREE.SphereGeometry(.19,12,8),mat('#e9e7df'));helmet.position.set(0,1,-.35);g.add(helmet);
      const visor=new THREE.Mesh(new THREE.SphereGeometry(.195,12,8,0,Math.PI*2,1.2,1.1),glass);visor.position.set(0,1,-.35);g.add(visor);
      const hoop=new THREE.Mesh(new THREE.TorusGeometry(.33,.055,6,16,Math.PI),carbon);hoop.position.set(0,.95,-.75);g.add(hoop);
      box(g,2.15,.08,.6,0,.27,2.07,carbon);box(g,1.9,.1,.62,0,1,-2.09,paint);
      // Front wing endplates and a small nose camera pod.
      for(const side of [-1,1])box(g,.05,.2,.62,side*1.02,.3,2.07,carbon);
      box(g,.14,.08,.18,0,1.12,2.24,metal);
    }
    // Authored aero and trim: splitter, canards, side skirts, diffuser, vents.
    box(g,w*1.78,.05,.5,0,.24,len*.47,carbon);
    box(g,w*1.66,.06,.55,0,.25,-len*.45,carbon).rotation.x=.2;
    for(const side of [-1,1]){
      box(g,.34,.028,.22,side*w*1.01,.47,len*.34,carbon).rotation.z=side*-.16;
      box(g,.05,.11,2.2,side*(w+.005),.33,-.1,carbon);
      for(const z of [len*.1,-len*.2])box(g,.03,.09,.5,side*(w*1.02),.3,z,carbon);
    }
    for(const x of [-.32,0,.32])box(g,.15,.022,.36,x*w,.9,1.02,carbon);
    box(g,w*1.94,.075,.34,0,.27,len*.48,carbon);box(g,w*1.86,.15,.28,0,.37,-len*.49,carbon);
    const tailHousing=mat('#14181a');
    for(const side of [-1,1]) {
      box(g,.5,.055,.055,side*w*.6,.61,len*.49,lights);
      box(g,.36,.05,.03,side*w*.6,.54,len*.497,lights);
      box(g,.32,.15,.06,side*w*.55,.43,len*.501,tailHousing);
      box(g,.12,.03,.66,side*w*.48,.81,-1.37,carbon);
      if(!formula)box(g,.055,.24,.09,side*w*.67,.99,-len*.43,carbon);
      const pipe=new THREE.Mesh(new THREE.CylinderGeometry(.075,.075,.2,10),metal);pipe.rotation.x=Math.PI/2;pipe.position.set(side*.36,.4,-len*.51);g.add(pipe);
      const pipeLip=new THREE.Mesh(new THREE.TorusGeometry(.076,.018,6,12),metal);pipeLip.position.set(side*.36,.4,-len*.515);g.add(pipeLip);
    }
    if(!formula){
      box(g,w*1.8,.045,.38,0,1.08,-len*.43,carbon);
      for(const side of [-1,1])box(g,.04,.24,.42,side*w*.9,1.1,-len*.43,carbon);
    }
    {
      // Rear plate reuses the livery atlas cell with the #07 mark: no extra draw.
      const plate=new THREE.Mesh(new THREE.PlaneGeometry(.42,.14),decal);
      const uv=plate.geometry.attributes.uv,u0=430/512,u1=488/512,v0=1-80/128,v1=1-22/128;
      uv.setXY(0,u0,v1);uv.setXY(1,u1,v1);uv.setXY(2,u0,v0);uv.setXY(3,u1,v0);uv.needsUpdate=true;
      plate.position.set(0,.55,-len*.514);plate.rotation.y=Math.PI;g.add(plate);
    }
    if(!formula)for(const side of [-1,1])for(const z of [len*.285,-len*.29]){const arch=new THREE.Mesh(new THREE.TorusGeometry(.475,.085,6,20,Math.PI),paint);arch.rotation.y=Math.PI/2;arch.position.set(side*w*.94,.43,z);g.add(arch);}
    // Team livery: one shared decal material, merged into a single draw per car.
    const decalGeometry=new THREE.PlaneGeometry(formula?1.05:1.55,formula?.26:.38);
    for(const side of [-1,1]){const patch=new THREE.Mesh(decalGeometry,decal);patch.position.set(side*(w+.006),formula?.5:.63,formula?-.25:.28);patch.rotation.y=side>0?Math.PI/2:-Math.PI/2;g.add(patch);}
    for(const x of [-.65,-.32,0,.32,.65])box(g,.035,.15,.45,x,.26,-len*.47,carbon);
    mergeStatic(g);g.traverse(o=>{if(o.isMesh&&o.material.transparent)o.castShadow=false;});
    const wheelDefs=[];
    for(const side of [-1,1])for(const z of [len*.285,-len*.29]) {
      const pivot=new THREE.Group();pivot.position.set(side*(formula?1.03:w*.91),.43,z);const roll=new THREE.Group();pivot.add(roll);
      const tyre=new THREE.Mesh(new THREE.CylinderGeometry(.43,.43,.32,22),mat('#151719','rubber'));tyre.rotation.z=Math.PI/2;roll.add(tyre);
      const rim=new THREE.Mesh(new THREE.CylinderGeometry(.25,.25,.335,18),metal);rim.rotation.z=Math.PI/2;roll.add(rim);
      const barrel=new THREE.Mesh(new THREE.CylinderGeometry(.255,.255,.02,18),mat('#151719','rubber'));barrel.rotation.z=Math.PI/2;barrel.position.x=side*.05;roll.add(barrel);
      for(let i=0;i<5;i++){const spoke=box(roll,.34,.05,.5,0,0,0,metal);spoke.rotation.x=i*Math.PI/5;}
      const lip=new THREE.Mesh(new THREE.TorusGeometry(.288,.022,5,18),metal);lip.rotation.y=Math.PI/2;roll.add(lip);
      const cap=new THREE.Mesh(new THREE.CylinderGeometry(.075,.075,.35,12),metal);cap.rotation.z=Math.PI/2;roll.add(cap);
      const disc=new THREE.Mesh(new THREE.CylinderGeometry(.24,.24,.025,20),metal);disc.rotation.z=Math.PI/2;disc.position.x=side*.18;roll.add(disc);
      box(roll,.12,.19,.12,side*.2,0,.18,mat('#b4472e','metal'));
      mergeStatic(roll);roll.traverse(o=>{if(o.isMesh)o.castShadow=false;});g.add(pivot);wheelDefs.push({pivot,roll,front:z>0});
    }
    // Geometry is immutable and reused on rematch; dispose only scene-owned assets.
    g.traverse(o=>{if(o.isMesh)sharedGeometries.add(o.geometry);});
    template={g,wheelDefs,len,paint};carTemplates.set(key,template);
  }
  const car=template.g.clone(true),wheels=[],body=new THREE.Group();body.name='sprung-body';
  for(const child of [...car.children])if(child.isGroup)wheels.push({pivot:child,roll:child.children[0],front:child.position.z>0});else body.add(child);
  car.add(body);
  const brakeMaterial=new THREE.MeshStandardMaterial({color:'#7d1512',emissive:'#ff2c12',emissiveIntensity:.45,roughness:.28,metalness:.1,toneMapped:false});
  const brakeGroup=new THREE.Group();
  for(const side of [-1,1])box(brakeGroup,id==='bolt'?.36:.64,.055,.06,side*(id==='titan'?1.03:.94)*.51,.69,-template.len*.502,brakeMaterial);
  box(brakeGroup,.29,.025,.04,0,id==='titan'?1.41:1.22,-.75,brakeMaterial);
  mergeStatic(brakeGroup);brakeGroup.traverse(o=>{if(o.isMesh)o.castShadow=false;});body.add(brakeGroup);
  const shadowMaterial=new THREE.MeshBasicMaterial({map:shadowTexture(),transparent:true,opacity:.7,depthWrite:false});
  const shadow=new THREE.Mesh(new THREE.PlaneGeometry(3.1,5.9),shadowMaterial);shadow.rotation.x=-Math.PI/2;shadow.position.y=.035;car.add(shadow);
  const flame=new THREE.Group(),flameOuter=mat('#ff6a24','light'),flameCore=mat('#ffe0a8','light');
  for(const side of [-1,1]){
    const outer=new THREE.Mesh(new THREE.ConeGeometry(.11,.8,7),flameOuter);outer.rotation.x=-Math.PI/2;outer.position.set(side*.36,.4,-template.len*.58);flame.add(outer);
    const inner=new THREE.Mesh(new THREE.ConeGeometry(.055,.48,6),flameCore);inner.rotation.x=-Math.PI/2;inner.position.set(side*.36,.4,-template.len*.56);flame.add(inner);
  }
  mergeStatic(flame);body.add(flame);flame.visible=false;
  const shield=new THREE.Mesh(new THREE.SphereGeometry(2.4,12,8),new THREE.MeshBasicMaterial({color:'#b9cbd1',wireframe:true,transparent:true,opacity:.1}));shield.position.y=.8;shield.scale.set(.65,.65,1);shield.visible=false;car.add(shield);
  car.userData={wheels,body,flame,shield,paint:template.paint,brakeMaterial,shadowMaterial,suspension:{pitch:{value:0,velocity:0},roll:{value:0,velocity:0},heave:{value:0,velocity:0}}};return car;
}
let shadowMap;
function shadowTexture() {
  if(shadowMap)return shadowMap;
  const c=document.createElement('canvas');c.width=c.height=128;const ctx=c.getContext('2d');
  for(const [x,y,r,a] of [[64,68,60,.72],[64,66,44,.5],[64,64,30,.38]]){const g=ctx.createRadialGradient(x,y,r*.15,x,y,r);g.addColorStop(0,`rgba(0,0,0,${a})`);g.addColorStop(.62,`rgba(0,0,0,${a*.55})`);g.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=g;ctx.fillRect(0,0,128,128);}
  shadowMap=new THREE.CanvasTexture(c);return shadowMap;
}
let terrainMap;
function terrainTexture(){
  if(terrainMap)return terrainMap;
  const c=document.createElement('canvas');c.width=c.height=512;const ctx=c.getContext('2d'),image=ctx.createImageData(512,512);let seed=4177;
  for(let y=0;y<512;y++)for(let x=0;x<512;x++){
    const i=(y*512+x)*4;seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const grain=(seed%23)-11,coarse=Math.sin(x*.031+y*.017)*12+Math.sin(x*.087-y*.061)*7+Math.cos(x*.013)*6;
    const patch=Math.sin(x*.006+Math.sin(y*.009)*2.2)>0?9:-4,v=118+grain+coarse+patch;
    image.data[i]=v*.92;image.data[i+1]=v;image.data[i+2]=v*.82;image.data[i+3]=255;
  }
  ctx.putImageData(image,0,0);
  // Dry grass tufts and small stones break up the tiling at driving distance.
  let stone=99;const random=()=>{stone=(Math.imul(stone,1664525)+1013904223)>>>0;return stone/4294967296;};
  for(let i=0;i<2600;i++){const x=random()*512,y=random()*512;ctx.fillStyle=i%3?'rgba(72,80,52,.5)':'rgba(158,148,116,.55)';ctx.fillRect(x,y,1+random()*3,1+random()*2);}
  terrainMap=new THREE.CanvasTexture(c);terrainMap.wrapS=terrainMap.wrapT=THREE.RepeatWrapping;terrainMap.colorSpace=THREE.SRGBColorSpace;terrainMap.anisotropy=8;return terrainMap;
}
let roadTextures;
function roadMaterial(renderer) {
  if(!roadTextures){
    // Every low-frequency term is an integer harmonic of the canvas, so the
    // 14 m road UV repeat stays seamless instead of showing rectangle seams.
    const size=512,height=document.createElement('canvas');height.width=height.height=size;
    const hctx=height.getContext('2d'),hImage=hctx.createImageData(size,size);let seed=931;
    const TAU=Math.PI*2;
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const i=(y*size+x)*4;seed=(Math.imul(seed,1664525)+1013904223)>>>0;
      const grain=seed%21,trackWear=Math.pow(Math.cos(x/size*TAU),8)*6;
      const patch=Math.sin(TAU*(3*x/512+2*y/512))*2.6+Math.cos(TAU*(7*x/512-5*y/512))*1.9+Math.sin(TAU*(11*x/512+13*y/512))*1.2;
      const v=140+grain-trackWear+patch;hImage.data[i]=v;hImage.data[i+1]=v;hImage.data[i+2]=v;hImage.data[i+3]=255;
    }
    hctx.putImageData(hImage,0,0);
    // Aggregate speckle shared by the colour map and the derived normal map.
    let grit=531;const random=()=>{grit=(Math.imul(grit,1664525)+1013904223)>>>0;return grit/4294967296;};
    for(let i=0;i<5200;i++){const v=random()>.5?205:75;hctx.fillStyle=`rgba(${v},${v},${v},.45)`;hctx.fillRect(random()*size,random()*size,1+random()*2,1+random()*2);}
    const map=new THREE.CanvasTexture(height);map.wrapS=map.wrapT=THREE.RepeatWrapping;map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
    // Normal map from a blurred height field gives the aggregate surface a read
    // under the moving sun instead of a flat grey slab.
    const normals=document.createElement('canvas');normals.width=normals.height=size;const nctx=normals.getContext('2d'),nImage=nctx.createImageData(size,size),raw=hImage.data;
    const sample=(x,y)=>{x=(x+size)%size;y=(y+size)%size;return raw[(y*size+x)*4]/255;};
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const i=(y*size+x)*4,dx=(sample(x+1,y)-sample(x-1,y))*.9,dy=(sample(x,y+1)-sample(x,y-1))*.9;
      const nx=-dx*.45,ny=-dy*.45,nz=1,len=Math.hypot(nx,ny,nz);
      nImage.data[i]=(nx/len*.5+.5)*255;nImage.data[i+1]=(ny/len*.5+.5)*255;nImage.data[i+2]=(nz/len*.5+.5)*255;nImage.data[i+3]=255;
    }
    nctx.putImageData(nImage,0,0);
    const normalMap=new THREE.CanvasTexture(normals);normalMap.wrapS=normalMap.wrapT=THREE.RepeatWrapping;normalMap.colorSpace=THREE.NoColorSpace;normalMap.anisotropy=map.anisotropy;
    const roughness=map.clone();roughness.colorSpace=THREE.NoColorSpace;
    roadTextures={map,normalMap,roughness};
  }
  return new THREE.MeshPhysicalMaterial({color:'#6d747a',map:roadTextures.map,normalMap:roadTextures.normalMap,normalScale:new THREE.Vector2(.55,.55),roughnessMap:roadTextures.roughness,roughness:.88,metalness:.06,clearcoat:.28,clearcoatRoughness:.5,envMapIntensity:.5});
}
// Horizontal road bands and vertical guardrails share the same track geometry.
function ribbon(track,left,right,y1,y2,material,curb=false) {
  if(left>right&&y1===y2)[left,right]=[right,left];
  const positions=[],colors=[],uv=[],indices=[],count=Math.ceil(track.length/1.25);
  for(let i=0;i<=count;i++){const distance=i/count*track.length;for(const [lane,height] of [[left,y1],[right,y2]]){const p=track.sample(distance,lane);positions.push(p.x,p.y+height,p.z);uv.push(lane/14,distance/14);const c=new THREE.Color(Math.floor(distance/3)%2?'#c0c0b5':'#963d32');colors.push(c.r,c.g,c.b);}if(i<count){const n=i*2;indices.push(n,n+2,n+1,n+1,n+2,n+3);}}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(indices);geo.computeVertexNormals();
  if(curb){geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.78,metalness:.03,envMapIntensity:.5});}
  const mesh=new THREE.Mesh(geo,material);mesh.receiveShadow=true;return mesh;
}
let wearMap;
function roadWearTexture(){
  if(wearMap)return wearMap;
  const c=document.createElement('canvas');c.width=64;c.height=256;const ctx=c.getContext('2d'),image=ctx.createImageData(64,256);
  for(let y=0;y<256;y++)for(let x=0;x<64;x++){
    const i=(y*64+x)*4,u=(x-31.5)/31.5,v=Math.min(1,Math.min(y,255-y)/30);
    const edge=Math.max(0,1-u*u),grain=.7+((x*29+y*47)%19)/40;
    image.data[i]=image.data[i+1]=image.data[i+2]=255;image.data[i+3]=Math.round(90*edge*Math.min(1,v*1.3)*grain);
  }
  ctx.putImageData(image,0,0);wearMap=new THREE.CanvasTexture(c);return wearMap;
}
function roadWear(track){
  const material=new THREE.MeshBasicMaterial({map:roadWearTexture(),color:'#161a1c',transparent:true,opacity:.5,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,side:THREE.DoubleSide});
  const count=Math.max(1,Math.floor(track.length/7));
  const mesh=instance(new THREE.PlaneGeometry(1,1),material,count*4,(d,i)=>{
    const lane=[-5.4,-2.4,2.4,5.4][i%4],s=Math.floor(i/4)/count*track.length,p=track.sample(s,lane);
    d.position.set(p.x,p.y+.022,p.z);d.rotation.set(-Math.PI/2-Math.atan(track.slope(s)),p.yaw,0,'YXZ');d.scale.set(1.15,6.2,1);
  });
  mesh.receiveShadow=false;return mesh;
}
function terrain(track) {
  const geo=new THREE.PlaneGeometry(1150,1150,148,148);geo.rotateX(-Math.PI/2);const positions=geo.attributes.position,count=positions.count;
  const samples=[];for(let s=0;s<track.length;s+=4)samples.push(track.sample(s));
  const colors=new Float32Array(count*3),base=new THREE.Color(track.ground),rock=new THREE.Color(track.id==='canyon'?'#a0906f':track.id==='coast'?'#7f8d78':'#6f7782'),shade=new THREE.Color();
  let seed=90210;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<count;i++){
    const x=positions.getX(i),z=positions.getZ(i);let distance=Infinity,y=-18;
    for(const p of samples){const d=(x-p.x)**2+(z-p.z)**2;if(d<distance){distance=d;y=p.y;}}
    const d=Math.sqrt(distance),blend=clamp((d-13)/62,0,1),smooth=blend*blend*(3-2*blend);
    // Rolling ground beyond the verge breaks the old flat plane into readable terrain.
    const hills=(Math.sin(x*.018)*Math.cos(z*.021)*6.5+Math.sin(x*.043+z*.031)*3.2+Math.cos(x*.011-z*.027)*4)*smooth*clamp((d-22)/70,0,1);
    positions.setY(i,(y-1.5)*(1-smooth)+(-16+hills)*smooth);
    shade.copy(base).lerp(rock,clamp((d-45)/240,0,1)*.85).multiplyScalar(.84+random()*.3);
    colors[i*3]=shade.r;colors[i*3+1]=shade.g;colors[i*3+2]=shade.b;
  }
  // World UVs avoid visibly stretched ground grain on hills and wide screens.
  const uv=geo.attributes.uv;for(let i=0;i<uv.count;i++)uv.setXY(i,positions.getX(i)/14,positions.getZ(i)/14);
  geo.setAttribute('color',new THREE.BufferAttribute(colors,3));geo.computeVertexNormals();
  const mesh=new THREE.Mesh(geo,mat('#ffffff','terrainShaded'));mesh.receiveShadow=true;return mesh;
}
function sign(text,w=12,h=1.4,background='#202529',ink='#dedfd7') {
  const c=document.createElement('canvas');c.width=1024;c.height=128;const ctx=c.getContext('2d');ctx.fillStyle=background;ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle=ink;ctx.font='600 52px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,512,67);
  const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;return new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map,side:THREE.DoubleSide}));
}
const pickupStyles={rocket:{glyph:'»',body:'#82331f',band:'#ff8250',ink:'#fff0c8'},frost:{glyph:'❄',body:'#305975',band:'#8de5ff',ink:'#ebfcff'},random:{glyph:'?',body:'#95876a',band:'#d9c69a',ink:'#fff6d9'}};
function pickupMark(kind){
  const key=`pickup-mark:${kind}`,style=pickupStyles[kind];
  if(!materials.has(key)){
    const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const ctx=canvas.getContext('2d');
    ctx.fillStyle=style.body;ctx.fillRect(0,0,256,256);ctx.fillStyle=style.ink;ctx.font='900 180px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(style.glyph,128,139);
    const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;materials.set(key,new THREE.MeshBasicMaterial({map,side:THREE.DoubleSide,toneMapped:false}));
  }
  return materials.get(key);
}
function instance(geo,material,count,place) {
  const mesh=new THREE.InstancedMesh(geo,material,count),dummy=new THREE.Object3D();
  for(let i=0;i<count;i++){dummy.position.set(0,0,0);dummy.rotation.set(0,0,0);dummy.scale.set(1,1,1);place(dummy,i);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);}mesh.computeBoundingSphere();return mesh;
}
export class RaceRenderer {
  constructor(container) {
    this.adaptive=new AdaptiveQuality(navigator);this.quality=this.adaptive.profile;this.container=container;this.mode='garage';this.cameraMode='chase';
    this.renderer=new THREE.WebGLRenderer({antialias:this.adaptive.level>=2,powerPreference:'default',alpha:false});
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.05;this.renderer.shadowMap.type=THREE.PCFShadowMap;this.renderer.info.autoReset=false;
    this.renderer.domElement.setAttribute('aria-label','3D 赛车画面');container.append(this.renderer.domElement);
    this.camera=new THREE.PerspectiveCamera(54,1,.2,850);this.target=new THREE.Vector3();this.look=new THREE.Vector3();this.cameraAim=new THREE.Vector3();this.motionQuery=matchMedia('(prefers-reduced-motion: reduce)');this.cars=new Map();this.effects=new RaceEffects();this.speedFx=new SpeedStreaks(THREE,this.adaptive.level>=2?44:30);this.lastEvent=0;this.lastRender=0;this.renderElapsed=0;this.contextLost=false;this.retainedTextures=new Set();this.sky=null;this.scenery=null;this.outdoorEnv=null;this.post=new PostPipeline(this.renderer,this.quality,THREE);
    this.environment=this.buildEnvironment();this.asphalt=roadMaterial(this.renderer);
    this.garage=this.buildGarage();this.garageCar=makeCar('comet');this.garage.add(this.garageCar);
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);this.applyQuality();
    document.addEventListener('visibilitychange',()=>{this.adaptive.reset();this.lastRender=0;this.renderElapsed=0;});
    this.renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();this.contextLost=true;this.releaseContextResources();document.dispatchEvent(new CustomEvent('graphics-lost'));});
    this.renderer.domElement.addEventListener('webglcontextrestored',()=>{this.contextLost=false;this.environment=this.buildEnvironment();this.garage.environment=this.environment;this.post?.dispose();this.post=new PostPipeline(this.renderer,this.quality,THREE);this.resize();if(this.world&&this.track){this.world.environment=this.buildOutdoorEnvironment(this.track);this.sky=this.buildSky(this.track);}this.adaptive.reset();this.lastRender=0;this.applyQuality();this.cameraReady=false;document.dispatchEvent(new CustomEvent('graphics-restored'));});
  }
  releaseContextResources() {
    // Dispose GPU handles while the old context is still lost. CPU geometry and
    // canvas images survive and Three.js can upload them again after restoration.
    const showParent=this.lightShow?.group.parent;this.lightShow?.group.removeFromParent();this.lightShow?.releaseGPU();
    const geometries=new Set(sharedGeometries),mats=new Set(materials.values()),textures=new Set([shadowMap,terrainMap,carbonMap,liveryMap,this.asphalt.map,this.asphalt.roughnessMap,this.asphalt.normalMap]);
    mats.add(this.asphalt);
    for(const scene of [this.garage,this.world])scene?.traverse(o=>{
      if(o.shadow){o.shadow.map?.dispose();o.shadow.mapPass?.dispose();o.shadow.map=null;o.shadow.mapPass=null;}
      if(o.isMesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])mats.add(m);if(o.isInstancedMesh)o.dispose();}
    });
    if(showParent)showParent.add(this.lightShow.group);
    for(const m of mats){if(m.map)textures.add(m.map);if(m.normalMap)textures.add(m.normalMap);if(m.roughnessMap)textures.add(m.roughnessMap);m.dispose();m.needsUpdate=true;}
    geometries.forEach(g=>g.dispose());textures.forEach(t=>{if(t){t.dispose();t.needsUpdate=true;}});this.environmentTarget?.dispose();this.outdoorEnv?.dispose();this.outdoorEnv=null;this.post?.dispose();this.post=null;this.effects.releaseGPU();
  }
  buildEnvironment() {
    const scene=new THREE.Scene();scene.background=new THREE.Color('#bdc9c9');scene.add(new THREE.HemisphereLight('#e8edea','#3e4549',2));
    for(const side of [-1,1])box(scene,12,2,1,side*8,7,0,side<0?'#e6e6dd':'#bccbd1','light');
    box(scene,24,1,12,0,12,0,'#e4e4db','light');box(scene,30,1,30,0,-5,0,'#333a3d');
    const pmrem=new THREE.PMREMGenerator(this.renderer),target=pmrem.fromScene(scene,.08,.1,50,{size:128});pmrem.dispose();this.disposePrivate(scene);this.environmentTarget=target;return target.texture;
  }
  buildOutdoorEnvironment(track){
    this.outdoorEnv?.dispose();
    this.outdoorEnv=createOutdoorEnvironment(this.renderer,track,THREE);
    return this.outdoorEnv.texture;
  }
  buildGarage() {
    const scene=new THREE.Scene();scene.background=new THREE.Color('#111416');scene.environment=this.environment;scene.fog=new THREE.Fog('#111416',18,64);
    scene.add(new THREE.HemisphereLight('#dbe7ea','#3b3a35',1.15));const key=new THREE.DirectionalLight('#fff1d6',4.2);key.position.set(4,8,6);key.castShadow=true;this.configureShadow(key,9);scene.add(key,key.target);this.garageSun=key;
    const fill=new THREE.DirectionalLight('#aebbcf',1.7);fill.position.set(-6,3,-4);scene.add(fill);
    const rim=new THREE.SpotLight('#cfe4ff',70,26,.5,.6,1.4);rim.position.set(-3,7,-7);rim.target.position.set(0,1,0);scene.add(rim,rim.target);
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(90,90),new THREE.MeshPhysicalMaterial({color:'#2f3335',roughness:.3,metalness:.22,clearcoat:.75,clearcoatRoughness:.28,envMapIntensity:.9}));floor.rotation.x=-Math.PI/2;floor.position.y=-.015;floor.receiveShadow=true;scene.add(floor);
    const turntable=new THREE.Group();
    for(const radius of [3.1,3.35]){const ring=new THREE.Mesh(new THREE.TorusGeometry(radius,.018,4,96),mat('#9aa5a2','light'));ring.rotation.x=Math.PI/2;ring.position.y=.002;turntable.add(ring);}
    for(let i=0;i<36;i++){const a=i/36*Math.PI*2,mark=box(turntable,.22,.006,.045,Math.cos(a)*3.22,.002,Math.sin(a)*3.22,i%9?'#5a625f':'#c7b08a');mark.rotation.y=-a;}
    mergeStatic(turntable);turntable.traverse(o=>{if(o.isMesh)o.castShadow=false;});scene.add(turntable);
    const bay=new THREE.Group();box(bay,15,7,.5,0,3.5,-9,'#1e2325');box(bay,.5,7,16,-9,3.5,-1,'#1b2022');
    for(let i=0;i<7;i++)box(bay,.045,7,.05,-7.2+i*2.4,3.5,-8.72,'#343b3e');
    for(const y of [.55,1.6]){box(bay,14.4,.028,.03,0,y,-8.7,'#a8b6b6','light');}
    for(const x of [-4.5,4.5])box(bay,.035,.012,9,x,.01,0,'#b9aaa0');
    box(bay,9,.012,.035,0,.01,-4.5,'#b9aaa0');box(bay,9,.012,.035,0,.01,4.5,'#b9aaa0');
    for(const x of [-3,3])box(bay,1.2,.035,10,x,6.5,-1,'#f4efe1','light');
    // Low orange accent strips under the wall, echoing the interface accent.
    box(bay,12,.035,.02,0,.42,-8.69,'#c76949','light');mergeStatic(bay);bay.traverse(o=>{if(o.isMesh)o.castShadow=false;});scene.add(bay);
    const label=sign('JRC  /  PERFORMANCE DIVISION',8.6,.68,'#171b1d','#d8d3c6');label.position.set(-1.4,4.02,-8.68);scene.add(label);
    const badge=sign('SINCE 2026  ·  DRIVER FIRST',5.2,.36,'#131719','#a8bbba');badge.position.set(-1.4,3.22,-8.67);scene.add(badge);
    return scene;
  }
  configureShadow(light,range) {
    light.shadow.camera.near=.1;light.shadow.camera.far=280;Object.assign(light.shadow.camera,{left:-range,right:range,top:range,bottom:-range});light.shadow.bias=-.00055;light.shadow.normalBias=.035;
  }
  applyQuality() {
    this.quality=this.adaptive.profile;this.renderer.shadowMap.enabled=this.quality.shadows;
    for(const sun of [this.garageSun,this.sun])if(sun){sun.shadow.mapSize.set(this.quality.shadowSize,this.quality.shadowSize);sun.shadow.map?.dispose();sun.shadow.map=null;sun.shadow.needsUpdate=true;}
    if(this.detail)this.detail.visible=this.quality.detail;if(this.scenery?.detailGroup)this.scenery.detailGroup.visible=!!this.quality.detail;if(this.headlight)this.headlight.visible=isNightTrack(this.track);
    this.lightShow?.update(this.lightShow.lastTime??0,this.lightShow.playerS??0,this.motionQuery.matches,this.quality);
    // Only recompile when the shader-relevant state changes: shadow samplers,
    // direct-vs-post output, or the clearcoat detail split. Resize/DPR and bloom
    // mip changes must not trigger a full material recompile hitch mid-race.
    const signature=`${this.quality.shadows?1:0}|${this.quality.post>0?1:0}|${this.quality.detail?1:0}`;
    if(this._qualityShaderSignature!==signature){
      this._qualityShaderSignature=signature;
      for(const scene of [this.garage,this.world])scene?.traverse(o=>{if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material])m.needsUpdate=true;});
      for(const material of materials.values()){
        if(material.isMeshPhysicalMaterial){material.clearcoat=this.quality.detail?1:.55;material.clearcoatRoughness=this.quality.detail?.055:.24;}
        material.needsUpdate=true;
      }
    }
    this.post?.configure(this.quality);this.resize();this.sky?.setPixelScale?.(this.pixelRatio);document.dispatchEvent(new CustomEvent('graphics-quality',{detail:this.quality.name}));
  }
  resize() {const w=Math.max(1,this.container.clientWidth),h=Math.max(1,this.container.clientHeight);this.pixelRatio=renderRatio(this.adaptive.level,w,h,devicePixelRatio);this.renderer.setPixelRatio(this.pixelRatio);this.renderer.setSize(w,h);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.post?.setSize(w,h,this.pixelRatio);this.sky?.setPixelScale?.(this.pixelRatio);}
  setContainer(container) {this.resizeObserver.disconnect();this.container=container;container.append(this.renderer.domElement);this.resizeObserver.observe(container);this.resize();this.adaptive.reset();this.lastRender=0;this.renderElapsed=0;}
  setCar(id) {this.garage.remove(this.garageCar);this.disposePrivate(this.garageCar);this.garageCar=makeCar(id);this.garage.add(this.garageCar);}
  // Compile and submit the first race frame while the canvas is hidden. The
  // cold shader compile then happens once per theme before the countdown starts,
  // instead of stretching the countdown across many slow frames.
  warmRaceFrame(race,playerId){
    if(!this.world||this.mode!=='race'||!race)return false;
    const canvas=this.renderer.domElement,previous=canvas.style.visibility;
    canvas.style.visibility='hidden';
    try{this.render(race,playerId,1/60,performance.now()/1000);}
    catch(error){console.error('race warm-up failed',error);}
    finally{canvas.style.visibility=previous;}
    this.lastRender=0;this.renderElapsed=0;this.adaptive.reset();this.adaptive.warmup=1;
    return true;
  }
  disposePrivate(root) {
    if(this.lightShow&&(root===this.world||root===this.lightShow.group)){this.lightShow.dispose();this.lightShow=null;}
    if(root===this.world){this.sky?.dispose();this.sky=null;this.scenery?.dispose();this.scenery=null;}
    const geometries=new Set(),privateMaterials=new Set();root.traverse(o=>{if(o.shadow){o.shadow.map?.dispose();o.shadow.mapPass?.dispose();}if(!o.isMesh)return;if(o.isInstancedMesh)o.dispose();if(!sharedGeometries.has(o.geometry))geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])if(![...materials.values(),this.asphalt].includes(m))privateMaterials.add(m);});
    geometries.forEach(g=>g.dispose());
    // Procedural textures shared by sky/scenery are cached across races; only
    // scene-private maps are disposed here. Context loss re-uploads the cached ones.
    privateMaterials.forEach(m=>{
      for(const map of [m.map,m.normalMap,m.roughnessMap,m.alphaMap])if(map&&!this.retainedTextures.has(map)&&map!==shadowMap&&map!==terrainMap)map.dispose();
      m.dispose();
    });
  }
  buildSky(t) {
    this.sky?.dispose();
    const built=createSky(t,THREE);
    this.sky=built;
    for(const texture of built.retainedTextures||[])this.retainedTextures.add(texture);
    this.sky.setPixelScale?.(this.pixelRatio||1);
    this.world.add(built.group);
    return built;
  }
  buildScenery(t) {
    this.scenery?.dispose();
    const kit=buildSceneryKit(t,THREE,{quality:this.quality,reducedMotion:this.motionQuery.matches});
    this.scenery=kit;
    for(const texture of kit.retainedTextures||[])this.retainedTextures.add(texture);
    this.world.add(kit.group);
    if(kit.detailGroup)kit.detailGroup.visible=!!this.quality.detail;
    return kit;
  }
  postStyleFor(preset){
    const night=!!preset?.night,arcade=preset?.id==='arcade',canyon=preset?.id==='canyon';
    return {
      exposure:night?(arcade?1.22:1.16):(canyon?1.0:1.05),
      bloom:night?(arcade?.5:.42):(canyon?.5:.55),
      threshold:night?(arcade?1.0:1.1):(canyon?.95:1.0),
      radius:night?.42:.34,
      saturation:night?1.12:(canyon?1.11:1.07),
      contrast:night?1.09:(canyon?1.08:1.04),
      temperature:night?(arcade?-.28:-.16):(canyon?.34:.2),
      vignette:night?.34:(canyon?.28:.23),
      grain:.032,
      aberration:night?.45:.28,
      speed:.85,
    };
  }
  buildTrack(id,rules='circuit') {
    if(this.world){this.ghost=null;this.ghostPose=null;this.effects.group.removeFromParent();this.speedFx.group.removeFromParent();this.disposePrivate(this.world);}
    const t=this.track=getTrack(id),preset=this.skyPreset=skyPreset(t),night=preset.night,arcade=t.theme==='arcade';
    this.sunDir=preset.sunDir;
    this.world=new THREE.Scene();this.world.background=new THREE.Color(preset.fog.color);this.world.environment=this.buildOutdoorEnvironment(t);this.world.environmentIntensity=preset.envIntensity;
    this.world.fog=new THREE.Fog(preset.fog.color,preset.fog.near,preset.fog.far);this.detail=new THREE.Group();this.world.add(this.detail);
    this.renderer.toneMappingExposure=preset.exposure;this.post?.setStyle(this.postStyleFor(preset));
    this.buildSky(t);
    // Key / fill / rim: authored separation on the hero and track edges without
    // adding dozens of measured dynamic lights.
    this.world.add(new THREE.HemisphereLight(preset.horizon,preset.groundColor,night?1.5:(preset.id==='canyon'?1.45:1.95)));
    const fill=new THREE.DirectionalLight(night?'#9cb5d8':preset.haze,night?1.3:.6);fill.position.set(42,26,70);this.world.add(fill);
    const rim=new THREE.DirectionalLight(night?'#d7e0ff':preset.sunColor,night?1.65:1.35);rim.position.set(-58,44,-82);this.world.add(rim);
    this.heroFill=new THREE.DirectionalLight(night?'#b9d4ff':'#fff3d8',night?1.35:0);this.heroFill.castShadow=false;this.world.add(this.heroFill,this.heroFill.target);
    this.sun=new THREE.DirectionalLight(night?'#bfcce6':preset.sunColor,night?(arcade?2.3:2.2):(preset.id==='canyon'?3.9:3.7));this.sun.castShadow=true;this.configureShadow(this.sun,40);this.world.add(this.sun,this.sun.target);
    if(preset.id==='canyon'){this.world.fog.near=175;this.world.fog.far=880;}
    this.asphalt.color.set(night?'#5f6c7c':'#6a727c');
    Object.assign(this.asphalt,{roughness:night?.32:.86,clearcoat:night?.95:.3,clearcoatRoughness:night?.24:.5,metalness:night?.16:.05,envMapIntensity:night?1.3:.5});
    if(arcade){this.asphalt.color.set('#4b4a68');this.asphalt.roughness=.28;this.asphalt.envMapIntensity=1.45;}
    this.headlight=new THREE.SpotLight('#f5edcd',night?120:0,52,.48,.6,1.1);this.headlight.position.set(0,1,0);this.headlight.target.position.set(0,0,20);this.world.add(this.headlight,this.headlight.target);
    this.world.add(terrain(t));
    // The world kit owns the visible coast sea/headland band; no duplicate plane.
    // Layered verge: grass, gravel run-off, curb and painted edges.
    this.world.add(ribbon(t,-13.4,-12.2,-.15,-.15,mat(t.ground,'terrain')),ribbon(t,12.2,13.4,-.15,-.15,mat(t.ground,'terrain')));
    const gravel=night?'#6d7069':'#a29a83';
    this.world.add(ribbon(t,-12.2,-9.8,-.03,-.03,mat(gravel,'terrain')),ribbon(t,9.8,12.2,-.03,-.03,mat(gravel,'terrain')));
    this.world.add(ribbon(t,-ROAD_HALF,ROAD_HALF,.015,.015,this.asphalt));
    for(const side of [-1,1]) {
      this.world.add(ribbon(t,side*ROAD_HALF,side*(ROAD_HALF+.75),.04,.04,null,true));
      this.world.add(ribbon(t,side*(ROAD_HALF-.42),side*(ROAD_HALF-.24),.032,.032,mat('#e9e6d8','roadpaint')));
      for(const y of [.56,1.02]){const rail=ribbon(t,side*GUARDRAIL_OFFSET,side*GUARDRAIL_OFFSET,y,y+.22,mat('#96a0a3','metal'));rail.material.side=THREE.DoubleSide;this.world.add(rail);}
    }
    this.world.add(roadWear(t));
    const poles=instance(boxGeo,mat('#7c8587','metal'),Math.floor(t.length/7)*2,(d,i)=>{const p=t.sample(Math.floor(i/2)*7,(i%2?1:-1)*(GUARDRAIL_OFFSET+.05));d.position.set(p.x,p.y+.58,p.z);d.rotation.y=p.yaw;d.scale.set(.12,1.16,.12);});this.world.add(poles);
    const lanes=instance(boxGeo,mat('#e9e6d8','roadpaint'),Math.floor(t.length/12),(d,i)=>{const p=t.sample(i*12+4);d.position.set(p.x,p.y+.035,p.z);d.rotation.y=p.yaw;d.scale.set(.12,.018,4.6);});this.world.add(lanes);
    // Reflective delineator caps read at night and feed the bloom pass.
    const markerCount=Math.floor(t.length/24)*2,markerMaterial=mat(night?'#ffbf7a':'#e8e0cb','light');
    this.world.add(instance(boxGeo,mat('#d8d6ca','metal'),markerCount,(d,i)=>{const s=Math.floor(i/2)*24+8,p=t.sample(s,(i%2?1:-1)*(GUARDRAIL_OFFSET+.5));d.position.set(p.x,p.y+.55,p.z);d.rotation.y=p.yaw;d.scale.set(.09,1.1,.09);}));
    this.world.add(instance(boxGeo,markerMaterial,markerCount,(d,i)=>{const s=Math.floor(i/2)*24+8,p=t.sample(s,(i%2?1:-1)*(GUARDRAIL_OFFSET+.5));d.position.set(p.x,p.y+1.03,p.z);d.rotation.y=p.yaw;d.scale.set(.18,.11,.04);}));
    // Start grid boxes sit behind the line, aligned to the actual road heading.
    this.world.add(instance(boxGeo,mat('#e9e6d8','roadpaint'),12,(d,i)=>{const slot=Math.floor(i/2),side=i%2?-1:1,s=-9-slot*4.2,lane=side*(2.5+slot*.18),p=t.sample(s,lane);d.position.set(p.x,p.y+.034,p.z);d.rotation.y=p.yaw;d.scale.set(1.7,.016,.14);}));
    this.buildScenery(t);this.lightShow=new TrackLightShow(t,THREE,this.quality);this.world.add(this.lightShow.group);this.items=[];
    this.buildItems(t,rules);
    const straight=t.boostStraight,entry=t.sample(straight.s+12);
    const straightSign=sign(rules==='arcade'?'BOOST STRAIGHT / 320 m':'BRAKE BEFORE TURN / 320 m',6,.9);straightSign.position.set(entry.x+entry.nx*11.5,entry.y+3,entry.z+entry.nz*11.5);straightSign.rotation.y=entry.yaw+Math.PI;this.world.add(straightSign);
    this.buildStartGate(t);
    this.cars.clear();this.effects.reset();this.lastEvent=0;this.trapMeshes=new Map();this.cameraReady=false;this.shake=0;this.world.add(this.effects.group);this.world.add(this.speedFx.group);this.applyQuality();
  }
  buildStartGate(t) {
    const start=t.sample(0),gate=new THREE.Group();gate.position.set(start.x,start.y,start.z);gate.rotation.y=start.yaw;
    for(const side of [-1,1]){
      for(const offset of [-.3,.3])box(gate,.16,7,.16,side*10.3+offset,3.5,0,'#8a9394','metal');
      box(gate,.92,.22,.24,side*10.3,6.6,0,'#7d8788','metal');
      for(let y=.6;y<6.5;y+=.78){const brace=box(gate,.66,.05,.05,side*10.3,y,0,'#6f787a','metal');brace.rotation.z=(Math.round(y*10)%2?.56:-.56);}
      box(gate,.38,1.7,.38,side*10.3,7.35,0,'#222a2d','metal');
      box(gate,.52,.1,.3,side*10.3,8.2,0,side<0?'#ff5b3a':'#ffb347','light');
    }
    box(gate,21.4,.18,.3,0,6.95,0,'#7d8788','metal');box(gate,21.4,1.5,.34,0,7.75,0,'#1b2124','metal');
    for(let i=0;i<5;i++)box(gate,1.2,.16,.14,-4.8+i*2.4,8.6,0,'#ff3b2a','light');
    for(let row=0;row<2;row++)for(let col=0;col<18;col++)box(gate,1,.015,.7,col-8.5,.07,row*.7-.35,(row+col)%2?'#c8c9bf':'#282d2e');
    mergeStatic(gate);this.world.add(gate);
    const banner=sign('JRC  /  START — FINISH',16,.95,'#161b1e','#dedfd7');banner.position.set(0,7.75,.2);gate.add(banner);
    const line=sign('GRID  ·  DRIVER FIRST',5.6,.42,'#121619','#b9c7c6');line.position.set(0,3.2,.18);gate.add(line);
    return gate;
  }
  buildItems(t,rules='arcade') {
    for(const o of t.objects) {
      if(rules!=='arcade')continue;
      const p=t.sample(o.s,o.x),group=new THREE.Group();group.userData={trackObjectId:o.id,type:o.type};group.position.set(p.x,p.y+.04,p.z);group.rotation.set(-Math.atan(t.slope(o.s)),p.yaw,0,'YXZ');
      if(o.type==='box'){
        const cube=new THREE.Group(),size=PICKUP_BOX.size,kind=pickupStyles[o.itemKind]?o.itemKind:'random',style=pickupStyles[kind];
        group.userData.itemKind=kind;group.userData.pickupLabel=style.glyph;
        box(cube,size,size,size,0,size/2,0,style.body,'metal');box(cube,size+.025,.13,size+.025,0,size*.6,0,style.band,'light');
        const mark=pickupMark(kind);
        for(const side of [-1,1]){const face=new THREE.Mesh(new THREE.PlaneGeometry(.86,.86),mark);face.position.set(0,size*.5,side*(size/2+.025));face.rotation.y=side<0?Math.PI:0;cube.add(face);}
        const top=new THREE.Mesh(new THREE.PlaneGeometry(.86,.86),mark);top.rotation.x=-Math.PI/2;top.position.y=size+.025;cube.add(top);
        mergeStatic(cube);group.add(cube);this.items.push({group,cube,o});
      }
      if(o.type==='barrier'){box(group,2.5,1.05,1.1,0,.52,0,'#a65335');for(const x of [-.75,0,.75])box(group,.24,.85,1.13,x,.54,0,'#cfccb7');mergeStatic(group);}
      if(o.type==='oil'){const oil=new THREE.Mesh(new THREE.CircleGeometry(2,20),mat('#161b22'));oil.rotation.x=-Math.PI/2;oil.position.y=.02;group.add(oil);}
      if(o.type==='boost'){box(group,BOOST_PAD.width,.03,BOOST_PAD.length,0,.01,0,'#375756');for(let k=-2;k<=2;k++)for(const x of [-.65,.65]){const m=box(group,1.6,.025,.18,x,.045,k*1.4,'#a5bfb5','light');m.rotation.y=x>0?.5:-.5;}mergeStatic(group);}
      this.world.add(group);
    }
  }
  setRace(race,playerId) {this.mode='race';this.buildTrack(race.trackId,race.rules);this.guidance=new CourseGuidance(this.track,race.checkpoints||[]);this.world.add(this.guidance.group);for(const r of race.racers){const colors=['#a44834','#597073','#929998','#ad9a77','#4a535f','#c7c3b5'],car=makeCar(r.car,r.bot?colors[r.slot]:undefined);this.cars.set(r.id,car);this.world.add(car);}this.adaptive.reset();this.lastRender=0;this.renderElapsed=0;}
  setGhost(pose,carId='comet'){
    this.ghostPose=pose;
    if(!pose){if(this.ghost)this.ghost.visible=false;return;}
    if(!this.world||this.mode!=='race')return;
    if(this.ghost&&this.ghost.userData.carId!==carId){this.ghost.removeFromParent();this.disposePrivate(this.ghost);this.ghost=null;}
    if(!this.ghost){
      const model=makeCar(carId,'#7fcec5'),material=new THREE.MeshBasicMaterial({color:'#9de6dc',transparent:true,opacity:.25,depthWrite:false}),cached=new Set(materials.values()),privateMaterials=new Set();
      model.name='personal-best-ghost';
      model.traverse(object=>{if(!object.isMesh)return;for(const m of Array.isArray(object.material)?object.material:[object.material])if(!cached.has(m))privateMaterials.add(m);object.material=material;object.castShadow=false;object.receiveShadow=false;});
      privateMaterials.forEach(m=>m.dispose());
      model.userData.flame.visible=false;model.userData.shield.visible=false;
      // A replay is visual only: no race actor, collision, tyre effects or audio.
      const shadow=model.children.find(o=>o.isMesh&&o.geometry.type==='PlaneGeometry');if(shadow){shadow.removeFromParent();shadow.geometry.dispose();}
      model.userData.carId=carId;this.ghost=model;this.world.add(model);
    }
  }
  get cameraMode(){return this._cameraMode||'chase';}
  set cameraMode(mode){this.setCameraMode(mode);}
  setCameraMode(mode){
    if(!['chase','bonnet','wide'].includes(mode))return this.cameraMode;
    if(mode!==this._cameraMode){this._cameraMode=mode;this.cameraReady=false;}
    return this.cameraMode;
  }
  toggleCamera(){const modes=['chase','bonnet','wide'];return this.setCameraMode(modes[(modes.indexOf(this.cameraMode)+1)%modes.length]);}
  render(race,playerId,dt,time) {
    if(document.hidden||this.contextLost)return;
    this.renderElapsed+=dt;const now=time*1000,interval=1000/(this.mode==='garage'?30:this.quality.fps);
    if(this.lastRender&&now-this.lastRender<interval-.6)return;
    const elapsed=this.renderElapsed;this.renderElapsed=0;const frameSeconds=this.lastRender?(now-this.lastRender)/1000:1/60;this.lastRender=now;dt=Math.min(.1,elapsed);const start=performance.now();
    if(this.mode==='garage') {
      this.garageCar.rotation.y=-.38+Math.sin(time*.12)*.12;this.camera.position.set(6,3.15,7.75);this.camera.lookAt(0,.7,0);this.camera.fov=37;this.camera.updateProjectionMatrix();this.post?.update(dt,{speed01:0,boost01:0,reducedMotion:this.motionQuery.matches});this.renderer.info.reset();if(this.post?.enabled)this.post.render(this.garage,this.camera);else this.renderer.render(this.garage,this.camera);return;
    }
    if(!race)return;
    const me=race.racers.find(r=>r.id===playerId)||race.racers[0],t=this.track,carPos=t.sample(me.s,me.x);
    const reduced=this.motionQuery.matches;this.playerId=playerId;
    const resetEvent=race.events.some(e=>e.id>this.lastEvent&&e.racer===me.id&&e.type==='reset');
    const frame=cameraFrame(me,t,this.cameraMode,reduced,this.camera.aspect),rig=smoothCameraFrame(this.cameraRig||={},frame,dt,!this.cameraReady||resetEvent);
    if(rig.snapped){this.cameraReady=false;this.shake=0;this.effects.tyres.delete(me.id);}
    if(reduced)this.shake=0;
    for(const r of race.racers) {
      const car=this.cars.get(r.id);if(!car)continue;const p=t.sample(r.s,r.x);
      car.visible=Math.hypot(p.x-carPos.x,p.z-carPos.z)<220;
      if(!car.visible)continue;
      this.target.set(Number.isFinite(r.worldX)?r.worldX:p.x,p.y+.025,Number.isFinite(r.worldZ)?r.worldZ:p.z);if(!this.cameraReady||car.position.distanceToSquared(this.target)>24*24)car.position.copy(this.target);else car.position.lerp(this.target,1-Math.exp(-dt*22));
      const yaw=Number.isFinite(r.heading)?r.heading:p.yaw+(r.headingError??Math.atan2(r.vx,Math.max(8,r.v))),delta=mod(yaw-car.rotation.y+Math.PI,Math.PI*2)-Math.PI;
      if(!this.cameraReady)car.rotation.y=yaw;else car.rotation.y+=delta*(1-Math.exp(-dt*12));
      car.rotation.order='YXZ';car.rotation.x+=(-Math.atan(t.slope(r.s))-car.rotation.x)*(1-Math.exp(-dt*14));
      const pose=motionTargets(r,race.time),suspension=car.userData.suspension,body=car.userData.body;
      body.rotation.x=dampSpring(suspension.pitch,pose.pitch,dt,14);body.rotation.z=dampSpring(suspension.roll,reduced?0:pose.roll,dt,12);body.position.y=dampSpring(suspension.heave,pose.heave,dt,20);
      car.userData.brakeMaterial.emissiveIntensity+=( (r.braking?2.8:.4)-car.userData.brakeMaterial.emissiveIntensity)*(1-Math.exp(-dt*28));
      if(car.userData.shadowMaterial)car.userData.shadowMaterial.opacity=isNightTrack(t)?.84:.7;
      for(const w of car.userData.wheels){if(w.front)w.pivot.rotation.y=(r.steerAngle||0)*steeringLimit(r.v);w.roll.rotation.x+=(r.forwardSpeed??r.v)*dt/.43;}
      car.userData.flame.visible=!!(r.boosting||r.driftBoost>0||r.overdrive>0)&&r.engine!=='electric';car.userData.flame.scale.z=(r.overdrive>0?1.65:.85)+(reduced?0:Math.sin(race.time*53+r.slot)*.2);car.userData.shield.visible=r.shield>0||r.frozen>0;car.userData.shield.material.color.set(r.frozen>0?'#b9f2ff':'#b9cbd1');car.userData.shield.material.opacity=r.frozen>0?.28:.1;
      if(Math.hypot(p.x-carPos.x,p.z-carPos.z)<65)this.effects.emitTyres(r,car,t,dt,this.quality.particles,reduced);
    }
    if(this.ghost){
      const replay=this.ghostPose,distance=replay?Math.hypot(replay.worldX-carPos.x,replay.worldZ-carPos.z):0;
      this.ghost.visible=!!replay&&race.rules==='timeattack'&&distance>3&&distance<200;
      if(this.ghost.visible){const ground=t.sample(replay.s,replay.x);this.ghost.position.set(replay.worldX,ground.y+.04,replay.worldZ);this.ghost.rotation.set(-Math.atan(t.slope(replay.s)),replay.heading,0,'YXZ');for(const w of this.ghost.userData.wheels)w.roll.rotation.x+=replay.v*dt/.43;}
    }
    for(const item of this.items)item.group.visible=(me.pickupCooldowns?.[item.o.id]??-Infinity)<=race.time;
    const ids=new Set(race.traps.map(tr=>tr.id));for(const [id,m] of this.trapMeshes)if(!ids.has(id)){this.world.remove(m);m.geometry.dispose();this.trapMeshes.delete(id);}
    for(const tr of race.traps)if(!this.trapMeshes.has(tr.id)){const p=t.sample(tr.s,tr.x),m=new THREE.Mesh(new THREE.CircleGeometry(2.3,16),mat('#192026'));m.rotation.x=-Math.PI/2;m.position.set(p.x,p.y+.06,p.z);this.world.add(m);this.trapMeshes.set(tr.id,m);}
    for(const e of race.events){
      if(e.id<=this.lastEvent)continue;
      const car=this.cars.get(e.racer);
      if(car?.visible){
        const actor=race.racers.find(r=>r.id===e.racer);
        this.effects.itemEvent(e,car,this.quality.particles,reduced,actor?.item);
        if(e.type==='hit'&&!reduced)this.effects.impact(car,this.quality.particles,0,this.effects.itemColors[e.source]);
      }
      if(e.type==='hit'&&e.racer===playerId&&!reduced)this.shake=Math.min(.4,this.shake+.22);
      this.lastEvent=Math.max(this.lastEvent,e.id);
    }
    this.shake*=Math.exp(-dt*9);
    const jolt=reduced||rig.snapped?0:Math.sin(race.time*79)*this.shake*this.shake;
    this.camera.position.set(rig.position.x+jolt,rig.position.y,rig.position.z);
    this.cameraAim.set(rig.look.x,rig.look.y,rig.look.z);this.camera.lookAt(this.cameraAim);
    this.camera.rotateZ(rig.roll);this.camera.fov=rig.fov;this.camera.updateProjectionMatrix();this.cameraReady=true;
    const speed01=clamp(Math.abs(me.v)/62,0,1);
    this.speedFx.update(dt,this.camera,speed01,this.quality.detail,reduced);
    this.lightShow?.update(race.time,me.s,reduced,this.quality);
    this.effects.update(dt,this.camera,this.quality.particles,reduced);this.guidance?.update(race,me);
    this.sky?.update(dt,reduced,this.camera);
    this.scenery?.update(dt,time,reduced);
    if(this.headlight&&isNightTrack(t)){const yaw=Number.isFinite(me.heading)?me.heading:carPos.yaw+(me.headingError||0),sx=Math.sin(yaw),sz=Math.cos(yaw),x=Number.isFinite(me.worldX)?me.worldX:carPos.x,z=Number.isFinite(me.worldZ)?me.worldZ:carPos.z;this.headlight.position.set(x+sx*2,carPos.y+.75,z+sz*2);this.headlight.target.position.set(x+sx*24,carPos.y-.15,z+sz*24);}
    if(this.heroFill){this.heroFill.position.set(this.camera.position.x,this.camera.position.y+3.4,this.camera.position.z);this.heroFill.target.position.set(carPos.x,carPos.y+.6,carPos.z);}
    const sunDir=this.sunDir||{x:-.55,y:.62,z:-.56};
    this.sun.position.set(carPos.x+sunDir.x*130,carPos.y+sunDir.y*130,carPos.z+sunDir.z*130);this.sun.target.position.set(carPos.x,carPos.y,carPos.z);
    this.post?.update(dt,{speed01,boost01:reduced?0:(me.boosting||me.overdrive>0||me.driftBoost>0?1:0),reducedMotion:reduced});
    this.renderer.info.reset();
    if(this.post?.enabled)this.post.render(this.world,this.camera);else this.renderer.render(this.world,this.camera);
    if(this.adaptive.observe(frameSeconds,performance.now()-start))this.applyQuality();
  }
  get diagnostics(){const body=this.cars.get(this.playerId)?.userData.body;return {ghost:!!this.ghost?.visible,motion:body?{pitch:body.rotation.x,roll:body.rotation.z,heave:body.position.y}:null,quality:this.quality.name,level:this.adaptive.level,pixelRatio:this.pixelRatio,fps:Math.round(this.adaptive.fps),frameMs:Math.round(this.adaptive.frameMs*10)/10,targetFps:this.quality.fps,shadows:this.renderer.shadowMap.enabled,camera:this.cameraMode,cameraPose:{position:{x:this.camera.position.x,y:this.camera.position.y,z:this.camera.position.z},aim:{x:this.cameraAim.x,y:this.cameraAim.y,z:this.cameraAim.z},fov:this.camera.fov,roll:this.cameraRig?.roll||0,distance:this.cameraRig?.distance||0,reverse:!!this.cameraRig?.reverse,snapped:!!this.cameraRig?.snapped},reducedMotion:this.motionQuery.matches,itemVFX:this.effects.diagnostics.itemVFX,lightShow:this.lightShow?.diagnostics||{active:false,arches:0,panels:0,beams:0,phase:0,drawCalls:0},effects:this.effects.diagnostics,speedFx:this.speedFx.diagnostics,post:this.post?.diagnostics||{enabled:false,mode:0},sky:this.sky?{drawCalls:this.sky.drawCalls,night:!!this.sky.preset?.night}:null,scenery:this.scenery?.stats?{draws:this.scenery.stats.draws,triangles:this.scenery.stats.triangles,instances:this.scenery.stats.instances,layers:this.scenery.stats.layers,clearance:this.scenery.stats.clearance}:null,shadowMapSize:this.sun?.shadow?.mapSize?.x||0,calls:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles,geometries:this.renderer.info.memory.geometries,textures:this.renderer.info.memory.textures,materials:materials.size};}
}
