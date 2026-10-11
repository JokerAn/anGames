import * as THREE from '/vendor/three.module.js';
import {CARS,getTrack,ROAD_HALF,PICKUP_BOX,BOOST_PAD,steeringLimit,mod,clamp} from './tracks.js';
import {AdaptiveQuality,renderRatio} from './quality.js';
const materials=new Map(),sharedGeometries=new Set();
const boxGeo=new THREE.BoxGeometry(1,1,1);sharedGeometries.add(boxGeo);
function mat(color,kind='default') {
  if(typeof kind==='boolean')kind=kind?'light':'default';
  const key=`${color}:${kind}`;
  if(!materials.has(key)) {
    const spec={color,roughness:.8,metalness:.05};
    if(kind==='paint')Object.assign(spec,{roughness:.26,metalness:.48});
    if(kind==='glass')Object.assign(spec,{roughness:.16,metalness:.55});
    if(kind==='metal')Object.assign(spec,{roughness:.32,metalness:.78});
    if(kind==='terrain')Object.assign(spec,{map:terrainTexture(),roughness:1,metalness:0});
    if(kind==='rubber')Object.assign(spec,{roughness:.97,metalness:0});
    if(kind==='light')Object.assign(spec,{emissive:color,emissiveIntensity:1.1,roughness:.4});
    materials.set(key,kind==='paint'?new THREE.MeshPhysicalMaterial({...spec,clearcoat:0,clearcoatRoughness:.18}):new THREE.MeshStandardMaterial(spec));
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
    list.forEach(g=>g.dispose());geo.computeBoundingSphere();const mesh=new THREE.Mesh(geo,material);mesh.castShadow=true;group.add(mesh);
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
    const paint=mat(color,'paint'),carbon=mat('#171b1d'),glass=mat('#20303a','glass');
    const body=new THREE.Mesh(coachwork(formula?[[-2.3,.62,.3,.64],[-1.4,.76,.28,.83],[.2,.65,.28,.77],[1.4,.36,.3,.6],[2.3,.22,.34,.45]]:[[-len/2,w*.88,.3,.67],[-1.3,w,.28,.91],[-.2,w*.99,.28,.81],[1.25,w*.95,.3,.72],[len/2,w*.82,.37,.57]]),paint);g.add(body);
    if(!formula) {
      const cabin=new THREE.Mesh(coachwork([[-1.42,w*.68,.73,.91],[-.7,w*.7,.73,gt?1.52:1.35],[.28,w*.65,.71,gt?1.49:1.32],[1.05,w*.7,.7,.77]]),glass);g.add(cabin);
      box(g,w*1.3,.045,.92,0,gt?1.52:1.35,-.24,paint);
      for(const side of [-1,1]) {
        const pillar=box(g,.055,.56,.06,side*w*.67,1.02,.64,paint);pillar.rotation.x=-.85;
        box(g,.2,.09,.22,side*(w+.08),.95,.53,carbon);
        box(g,.04,.05,1.65,side*(w+.005),.66,-.14,carbon);
      }
    } else {
      box(g,.54,.14,1.25,0,.8,-.35,carbon);
      const helmet=new THREE.Mesh(new THREE.SphereGeometry(.19,12,8),mat('#e9e7df'));helmet.position.set(0,1,-.35);g.add(helmet);
      const hoop=new THREE.Mesh(new THREE.TorusGeometry(.33,.055,6,16,Math.PI),carbon);hoop.position.set(0,.95,-.75);g.add(hoop);
      box(g,2.15,.08,.6,0,.27,2.07,carbon);box(g,1.9,.1,.62,0,1,-2.09,paint);
    }
    box(g,w*1.9,.075,.34,0,.27,len*.48,carbon);box(g,w*1.86,.15,.28,0,.37,-len*.49,carbon);
    const lights=mat('#e9e5d5','light'),tail=mat('#e84632','light');
    for(const side of [-1,1]) {
      box(g,.5,.055,.055,side*w*.6,.61,len*.49,lights);
      box(g,formula?.36:.63,.035,.055,side*w*.51,.69,-len*.501,tail);
      box(g,.32,.15,.06,side*w*.55,.43,len*.501,carbon);
      box(g,.12,.03,.66,side*w*.48,.81,-1.37,carbon);
      if(!formula)box(g,.055,.24,.09,side*w*.67,.99,-len*.43,carbon);
      const pipe=new THREE.Mesh(new THREE.CylinderGeometry(.075,.075,.2,10),mat('#8c9699','metal'));pipe.rotation.x=Math.PI/2;pipe.position.set(side*.36,.4,-len*.51);g.add(pipe);
    }
    if(!formula)box(g,w*1.8,.045,.38,0,1.08,-len*.43,carbon);
    box(g,.42,.14,.025,0,.55,-len*.513,mat('#cfccc3'));
    if(!formula)for(const side of [-1,1])for(const z of [len*.285,-len*.29]){const arch=new THREE.Mesh(new THREE.TorusGeometry(.475,.085,6,20,Math.PI),paint);arch.rotation.y=Math.PI/2;arch.position.set(side*w*.94,.43,z);g.add(arch);}
    mergeStatic(g);
    const wheelDefs=[];
    for(const side of [-1,1])for(const z of [len*.285,-len*.29]) {
      const pivot=new THREE.Group();pivot.position.set(side*(formula?1.03:w*.91),.43,z);const roll=new THREE.Group();pivot.add(roll);
      const tyre=new THREE.Mesh(new THREE.CylinderGeometry(.43,.43,.32,20),mat('#151719','rubber'));tyre.rotation.z=Math.PI/2;roll.add(tyre);
      const rim=new THREE.Mesh(new THREE.CylinderGeometry(.285,.285,.335,16),mat('#454e53','metal'));rim.rotation.z=Math.PI/2;roll.add(rim);
      for(let i=0;i<5;i++){const spoke=box(roll,.34,.045,.49,0,0,0,'#b8c0c1','metal');spoke.rotation.x=i*Math.PI/5;}
      mergeStatic(roll);g.add(pivot);wheelDefs.push({pivot,roll,front:z>0});
    }
    // Geometry is immutable and reused on rematch; dispose only scene-owned assets.
    g.traverse(o=>{if(o.isMesh)sharedGeometries.add(o.geometry);});
    template={g,wheelDefs,len,paint,tail};carTemplates.set(key,template);
  }
  const car=template.g.clone(true),wheels=[];
  for(const child of car.children)if(child.isGroup)wheels.push({pivot:child,roll:child.children[0],front:child.position.z>0});
  const shadow=new THREE.Mesh(new THREE.PlaneGeometry(2.65,5.2),new THREE.MeshBasicMaterial({map:shadowTexture(),transparent:true,opacity:.62,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=.035;car.add(shadow);
  const flame=new THREE.Group();for(const side of [-1,1]){const m=new THREE.Mesh(new THREE.ConeGeometry(.09,.65,6),mat('#d2a369','light'));m.rotation.x=-Math.PI/2;m.position.set(side*.36,.4,-template.len*.57);flame.add(m);}mergeStatic(flame);car.add(flame);flame.visible=false;
  const shield=new THREE.Mesh(new THREE.SphereGeometry(2.4,12,8),new THREE.MeshBasicMaterial({color:'#b9cbd1',wireframe:true,transparent:true,opacity:.1}));shield.position.y=.8;shield.scale.set(.65,.65,1);shield.visible=false;car.add(shield);
  car.userData={wheels,flame,shield,paint:template.paint,tail:template.tail};return car;
}
let shadowMap;
function shadowTexture() {
  if(shadowMap)return shadowMap;
  const c=document.createElement('canvas');c.width=c.height=64;const ctx=c.getContext('2d'),g=ctx.createRadialGradient(32,32,4,32,32,32);g.addColorStop(0,'rgba(0,0,0,.85)');g.addColorStop(.65,'rgba(0,0,0,.5)');g.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=g;ctx.fillRect(0,0,64,64);shadowMap=new THREE.CanvasTexture(c);return shadowMap;
}
let terrainMap;
function terrainTexture(){
  if(terrainMap)return terrainMap;const c=document.createElement('canvas');c.width=c.height=256;const ctx=c.getContext('2d');ctx.fillStyle='#999';ctx.fillRect(0,0,256,256);
  for(let i=0;i<8000;i++){const x=mod(i*53.3,256),y=mod(i*31.79,256);ctx.fillStyle=i%3?'#808080':'#b2b2b2';ctx.fillRect(x,y,i%7+1,1);}
  terrainMap=new THREE.CanvasTexture(c);terrainMap.wrapS=terrainMap.wrapT=THREE.RepeatWrapping;terrainMap.colorSpace=THREE.SRGBColorSpace;return terrainMap;
}
let foliageMap,cloudMap;
function foliageTexture() {
  if(foliageMap)return foliageMap;
  const c=document.createElement('canvas');c.width=c.height=256;const ctx=c.getContext('2d');let seed=1741;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<2200;i++){const x=random()*256,y=random()*256,dx=(x-128)/105,dy=(y-126)/114;if(dx*dx+dy*dy>1+random()*.14)continue;const v=45+Math.floor(random()*65)+(256-y)*.12;ctx.fillStyle=`rgb(${v*.76|0},${v|0},${v*.65|0})`;ctx.beginPath();ctx.ellipse(x,y,3+random()*6,2+random()*4,random()*3,0,Math.PI*2);ctx.fill();}
  foliageMap=new THREE.CanvasTexture(c);foliageMap.colorSpace=THREE.SRGBColorSpace;return foliageMap;
}
function cloudTexture() {
  if(cloudMap)return cloudMap;
  const c=document.createElement('canvas');c.width=1024;c.height=512;const ctx=c.getContext('2d');
  for(let i=0;i<160;i++){const x=mod(i*173.21,1024),y=95+Math.sin(i*8.71)*55+Math.cos(i*3)*35,r=25+mod(i*7.91,44),g=ctx.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,'rgba(236,235,225,.34)');g.addColorStop(1,'rgba(236,235,225,0)');ctx.save();ctx.translate(x,y);ctx.scale(2.4,.55);ctx.translate(-x,-y);ctx.fillStyle=g;ctx.fillRect(x-r,y-r,r*2,r*2);ctx.restore();}
  cloudMap=new THREE.CanvasTexture(c);cloudMap.colorSpace=THREE.SRGBColorSpace;return cloudMap;
}
function roadMaterial(renderer) {
  const c=document.createElement('canvas');c.width=c.height=256;const ctx=c.getContext('2d'),image=ctx.createImageData(256,256);let seed=931;
  for(let i=0;i<image.data.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const v=118+(seed%23);image.data[i]=v;image.data[i+1]=v;image.data[i+2]=v;image.data[i+3]=255;}ctx.putImageData(image,0,0);
  const map=new THREE.CanvasTexture(c);map.wrapS=map.wrapT=THREE.RepeatWrapping;map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());
  return new THREE.MeshStandardMaterial({color:'#777c7d',map,roughness:.95,metalness:.02});
}
// Horizontal road bands and vertical guardrails share the same track geometry.
function ribbon(track,left,right,y1,y2,material,curb=false) {
  if(left>right&&y1===y2)[left,right]=[right,left];
  const positions=[],colors=[],uv=[],indices=[],count=Math.ceil(track.length/1.25);
  for(let i=0;i<=count;i++){const distance=i/count*track.length;for(const [lane,height] of [[left,y1],[right,y2]]){const p=track.sample(distance,lane);positions.push(p.x,p.y+height,p.z);uv.push(lane/14,distance/14);const c=new THREE.Color(Math.floor(distance/3)%2?'#c0c0b5':'#963d32');colors.push(c.r,c.g,c.b);}if(i<count){const n=i*2;indices.push(n,n+2,n+1,n+1,n+2,n+3);}}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(indices);geo.computeVertexNormals();
  if(curb){geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.92});}
  const mesh=new THREE.Mesh(geo,material);mesh.receiveShadow=true;return mesh;
}
function terrain(track) {
  const geo=new THREE.PlaneGeometry(1050,1050,105,105);geo.rotateX(-Math.PI/2);const positions=geo.attributes.position;
  const samples=[];for(let s=0;s<track.length;s+=5)samples.push(track.sample(s));
  for(let i=0;i<positions.count;i++){
    const x=positions.getX(i),z=positions.getZ(i);let distance=Infinity,y=-18;
    for(const p of samples){const d=(x-p.x)**2+(z-p.z)**2;if(d<distance){distance=d;y=p.y;}}
    const blend=clamp((Math.sqrt(distance)-13)/70,0,1),smooth=blend*blend*(3-2*blend);
    positions.setY(i,(y-1.5)*(1-smooth)-18*smooth);
  }
  // World UVs avoid visibly stretched ground grain on hills and wide screens.
  const uv=geo.attributes.uv;for(let i=0;i<uv.count;i++)uv.setXY(i,positions.getX(i)/14,positions.getZ(i)/14);
  geo.computeVertexNormals();const mesh=new THREE.Mesh(geo,mat(track.ground,'terrain'));mesh.receiveShadow=true;return mesh;
}
function sign(text,w=12,h=1.4,background='#202529',ink='#dedfd7') {
  const c=document.createElement('canvas');c.width=1024;c.height=128;const ctx=c.getContext('2d');ctx.fillStyle=background;ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle=ink;ctx.font='600 52px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,512,67);
  const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;return new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map,side:THREE.DoubleSide}));
}
function instance(geo,material,count,place) {
  const mesh=new THREE.InstancedMesh(geo,material,count),dummy=new THREE.Object3D();
  for(let i=0;i<count;i++){dummy.position.set(0,0,0);dummy.rotation.set(0,0,0);dummy.scale.set(1,1,1);place(dummy,i);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);}mesh.computeBoundingSphere();return mesh;
}
export class RaceRenderer {
  constructor(container) {
    this.adaptive=new AdaptiveQuality(navigator);this.quality=this.adaptive.profile;this.container=container;this.mode='garage';this.cameraMode='chase';
    this.renderer=new THREE.WebGLRenderer({antialias:this.adaptive.level>=2,powerPreference:'default',alpha:false});
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.05;this.renderer.shadowMap.type=THREE.PCFShadowMap;
    this.renderer.domElement.setAttribute('aria-label','3D 赛车画面');container.append(this.renderer.domElement);
    this.camera=new THREE.PerspectiveCamera(54,1,.2,850);this.target=new THREE.Vector3();this.look=new THREE.Vector3();this.cameraAim=new THREE.Vector3();this.cars=new Map();this.particles=[];this.lastEvent=0;this.lastRender=0;this.renderElapsed=0;this.contextLost=false;
    this.environment=this.buildEnvironment();this.asphalt=roadMaterial(this.renderer);
    this.particleMesh=new THREE.InstancedMesh(boxGeo,new THREE.MeshBasicMaterial({vertexColors:false,color:'#cead82'}),96);this.particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.particleMesh.frustumCulled=false;this.particleDummy=new THREE.Object3D();
    this.garage=this.buildGarage();this.garageCar=makeCar('comet');this.garage.add(this.garageCar);
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);this.applyQuality();
    document.addEventListener('visibilitychange',()=>{this.adaptive.reset();this.lastRender=0;this.renderElapsed=0;});
    this.renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();this.contextLost=true;this.releaseContextResources();document.dispatchEvent(new CustomEvent('graphics-lost'));});
    this.renderer.domElement.addEventListener('webglcontextrestored',()=>{this.contextLost=false;this.environment=this.buildEnvironment();this.garage.environment=this.environment;if(this.world)this.world.environment=this.environment;this.adaptive.reset();this.lastRender=0;this.applyQuality();this.cameraReady=false;document.dispatchEvent(new CustomEvent('graphics-restored'));});
  }
  releaseContextResources() {
    // Dispose GPU handles while the old context is still lost. CPU geometry and
    // canvas images survive and Three.js can upload them again after restoration.
    const geometries=new Set(sharedGeometries),mats=new Set(materials.values()),textures=new Set([shadowMap,foliageMap,cloudMap,terrainMap,this.asphalt.map]);
    mats.add(this.asphalt);mats.add(this.particleMesh.material);
    for(const scene of [this.garage,this.world])scene?.traverse(o=>{
      if(o.shadow){o.shadow.map?.dispose();o.shadow.mapPass?.dispose();o.shadow.map=null;o.shadow.mapPass=null;}
      if(o.isMesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])mats.add(m);if(o.isInstancedMesh)o.dispose();}
    });
    for(const m of mats){if(m.map)textures.add(m.map);m.dispose();m.needsUpdate=true;}
    geometries.forEach(g=>g.dispose());textures.forEach(t=>{if(t){t.dispose();t.needsUpdate=true;}});this.environmentTarget?.dispose();
  }
  buildEnvironment() {
    const scene=new THREE.Scene();scene.background=new THREE.Color('#bdc9c9');scene.add(new THREE.HemisphereLight('#e8edea','#3e4549',2));
    for(const side of [-1,1])box(scene,12,2,1,side*8,7,0,side<0?'#e6e6dd':'#bccbd1','light');
    box(scene,24,1,12,0,12,0,'#e4e4db','light');box(scene,30,1,30,0,-5,0,'#333a3d');
    const pmrem=new THREE.PMREMGenerator(this.renderer),target=pmrem.fromScene(scene,.08,.1,50,{size:128});pmrem.dispose();this.disposePrivate(scene);this.environmentTarget=target;return target.texture;
  }
  buildGarage() {
    const scene=new THREE.Scene();scene.background=new THREE.Color('#141719');scene.environment=this.environment;scene.fog=new THREE.Fog('#141719',18,60);
    scene.add(new THREE.HemisphereLight('#dce6e6','#42413b',1.3));const key=new THREE.DirectionalLight('#fff2da',3.4);key.position.set(3,7,5);key.castShadow=true;this.configureShadow(key,8);scene.add(key,key.target);this.garageSun=key;
    const fill=new THREE.DirectionalLight('#b3c3d0',1.8);fill.position.set(-5,3,-4);scene.add(fill);
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(90,90),mat('#383b3b'));floor.rotation.x=-Math.PI/2;floor.position.y=-.015;floor.receiveShadow=true;scene.add(floor);
    const bay=new THREE.Group();box(bay,15,7,.5,0,3.5,-9,'#24292b');box(bay,.5,7,16,-9,3.5,-1,'#202527');
    for(let i=0;i<5;i++)box(bay,.045,7,.05,-6+i*3,3.5,-8.72,'#41484b');
    for(const x of [-4.5,4.5])box(bay,.035,.012,9,x,.01,0,'#b9aaa0');
    box(bay,9,.012,.035,0,.01,-4.5,'#b9aaa0');box(bay,9,.012,.035,0,.01,4.5,'#b9aaa0');
    for(const x of [-3,3])box(bay,1.2,.035,10,x,6.5,-1,'#f4efe1','light');mergeStatic(bay);scene.add(bay);
    const label=sign('JRC  /  PERFORMANCE DIVISION',12,.9);label.position.set(0,3.8,-8.7);scene.add(label);return scene;
  }
  configureShadow(light,range) {
    light.shadow.camera.near=.1;light.shadow.camera.far=160;Object.assign(light.shadow.camera,{left:-range,right:range,top:range,bottom:-range});light.shadow.bias=-.0006;light.shadow.normalBias=.04;
  }
  applyQuality() {
    this.quality=this.adaptive.profile;this.renderer.shadowMap.enabled=this.quality.shadows;
    for(const sun of [this.garageSun,this.sun])if(sun){sun.shadow.mapSize.set(this.quality.shadowSize,this.quality.shadowSize);sun.shadow.map?.dispose();sun.shadow.map=null;sun.shadow.needsUpdate=true;}
    if(this.detail)this.detail.visible=this.quality.detail;
    // Shadow samplers change when shadows are disabled. Scene-owned asphalt,
    // curbs and foliage also need recompilation, not only cached car materials.
    for(const scene of [this.garage,this.world])scene?.traverse(o=>{if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material])m.needsUpdate=true;});
    for(const material of materials.values()){if(material.isMeshPhysicalMaterial)material.clearcoat=this.quality.detail?.55:0;material.needsUpdate=true;}
    this.resize();document.dispatchEvent(new CustomEvent('graphics-quality',{detail:this.quality.name}));
  }
  resize() {const w=Math.max(1,this.container.clientWidth),h=Math.max(1,this.container.clientHeight);this.pixelRatio=renderRatio(this.adaptive.level,w,h,devicePixelRatio);this.renderer.setPixelRatio(this.pixelRatio);this.renderer.setSize(w,h);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();}
  setContainer(container) {this.resizeObserver.disconnect();this.container=container;container.append(this.renderer.domElement);this.resizeObserver.observe(container);this.resize();this.adaptive.reset();this.lastRender=0;this.renderElapsed=0;}
  setCar(id) {this.garage.remove(this.garageCar);this.disposePrivate(this.garageCar);this.garageCar=makeCar(id);this.garage.add(this.garageCar);}
  disposePrivate(root) {
    const geometries=new Set(),privateMaterials=new Set();root.traverse(o=>{if(o.shadow){o.shadow.map?.dispose();o.shadow.mapPass?.dispose();}if(!o.isMesh)return;if(!sharedGeometries.has(o.geometry)&&o!==this.particleMesh)geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])if(![...materials.values(),this.asphalt,this.particleMesh?.material].includes(m))privateMaterials.add(m);});
    geometries.forEach(g=>g.dispose());privateMaterials.forEach(m=>{if(m.map!==shadowMap&&m.map!==foliageMap&&m.map!==cloudMap)m.map?.dispose();m.dispose();});
  }
  buildSky(t) {
    const night=t.id==='neon',geo=new THREE.SphereGeometry(700,24,12),colors=[],pos=geo.attributes.position;
    for(let i=0;i<pos.count;i++){const f=clamp(pos.getY(i)/700,0,1),horizon=new THREE.Color(t.sky),zenith=new THREE.Color(night?'#060c15':'#688a9e');horizon.lerp(zenith,Math.pow(f,.55));colors.push(horizon.r,horizon.g,horizon.b);}geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    this.world.add(new THREE.Mesh(geo,new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.BackSide,depthWrite:false,fog:false})));
    if(!night){const clouds=new THREE.Mesh(new THREE.SphereGeometry(690,32,16),new THREE.MeshBasicMaterial({map:cloudTexture(),transparent:true,opacity:.32,side:THREE.BackSide,depthWrite:false,fog:false}));clouds.rotation.y=1.2;this.world.add(clouds);}
    const sun=new THREE.Mesh(new THREE.SphereGeometry(night?3:10,16,8),new THREE.MeshBasicMaterial({color:night?'#d9d9cd':'#ece2c7',fog:false}));sun.position.set(-360,night?320:260,-430);this.world.add(sun);
  }
  buildScenery(t) {
    const night=t.id==='neon',count=170;
    const place=i=>t.sample(i/count*t.length,(i%2?1:-1)*(21+Math.abs(Math.sin(i*27.2))*28));
    if(!night) {
      const trunks=instance(new THREE.CylinderGeometry(.12,.28,1,6),mat('#665d4a'),count,(d,i)=>{const p=place(i),h=4+Math.abs(Math.sin(i*13))*3;d.position.set(p.x,p.y+h/2-1,p.z);d.scale.set(1,h,1);});
      const foliage=foliageTexture(),leafMat=new THREE.MeshStandardMaterial({map:foliage,alphaTest:.5,side:THREE.DoubleSide,roughness:1,color:t.id==='canyon'?'#9eaa8c':'#b3b39a'});
      const leaves=instance(new THREE.PlaneGeometry(1,1),leafMat,count*3,(d,j)=>{const i=Math.floor(j/3),k=j%3,p=place(i),h=4+Math.abs(Math.sin(i*13))*3;d.position.set(p.x,p.y+h+1.4,p.z);d.rotation.y=i*1.73+k*Math.PI/3;d.scale.set(6+Math.sin(i*7)*1.6,h+3,1);});this.world.add(trunks,leaves);
      const rocks=instance(new THREE.DodecahedronGeometry(1,0),mat('#72776c'),40,(d,i)=>{const maxRadius=Math.max(...t.points.map(p=>Math.hypot(p.x,p.z))),a=t.id==='coast'?-Math.PI/2+i/40*Math.PI:i/40*Math.PI*2,r=maxRadius+100+Math.abs(Math.sin(i*17))*35;d.position.set(Math.cos(a)*r,-10,Math.sin(a)*r);d.rotation.set(i*.2,i*2,.2);d.scale.set(26+Math.abs(Math.sin(i))*24,35+Math.abs(Math.sin(i*5))*38,25);});this.world.add(rocks);
      const distant=instance(new THREE.DodecahedronGeometry(1,1),mat('#67716b'),22,(d,i)=>{const a=i/22*Math.PI*2;d.position.set(Math.cos(a)*490,-45,Math.sin(a)*490);d.rotation.y=i;d.scale.set(115,125+Math.sin(i*8)*40,95);});this.world.add(distant);
    } else {
      const towers=instance(boxGeo,mat('#202930'),80,(d,i)=>{const p=t.sample(i/80*t.length,(i%2?1:-1)*(30+Math.abs(Math.sin(i*7))*40)),h=15+Math.abs(Math.sin(i*23))*70;d.position.set(p.x,p.y+h/2-4,p.z);d.scale.set(9,h,11);});this.world.add(towers);
      const windows=instance(boxGeo,mat('#a49870','light'),480,(d,j)=>{const i=Math.floor(j/6),k=j%6,p=t.sample(i/80*t.length,(i%2?1:-1)*(30+Math.abs(Math.sin(i*7))*40)),h=15+Math.abs(Math.sin(i*23))*70;d.position.set(p.x+4.53,p.y+k*h/7+4,p.z);d.scale.set(.04,.3,7);});this.detail.add(windows);
    }
    // Trackside lamps use emissive lenses, avoiding dozens of dynamic point lights.
    const lamps=new THREE.Group();for(let i=0;i<32;i++){const p=t.sample(i/32*t.length,ROAD_HALF+2);box(lamps,.12,7,.12,p.x,p.y+3.5,p.z,'#5d676a','metal');box(lamps,.8,.1,.45,p.x,p.y+7,p.z,'#d7cfb1','light');}mergeStatic(lamps);this.world.add(lamps);
  }
  buildTrack(id,rules='circuit') {
    if(this.world){this.world.remove(this.particleMesh);this.disposePrivate(this.world);}
    const t=this.track=getTrack(id),night=id==='neon';this.world=new THREE.Scene();this.world.background=new THREE.Color(t.sky);this.world.environment=this.environment;this.world.fog=new THREE.Fog(t.sky,95,470);this.detail=new THREE.Group();this.world.add(this.detail);this.buildSky(t);
    this.world.add(new THREE.HemisphereLight(night?'#acbfd3':'#dce4e3',t.ground,night?1.35:1.7));this.sun=new THREE.DirectionalLight(night?'#bccbdd':'#ffe7c3',night?1.9:3);this.sun.castShadow=true;this.configureShadow(this.sun,36);this.world.add(this.sun,this.sun.target);
    this.world.add(terrain(t));
    if(id==='coast'){const water=new THREE.Mesh(new THREE.PlaneGeometry(1800,1800),mat('#476f7c','glass'));water.rotation.x=-Math.PI/2;water.position.set(-1170,-16,0);this.world.add(water);}
    this.world.add(ribbon(t,-13.4,-ROAD_HALF-.8,-.15,-.15,mat(t.ground,'terrain')),ribbon(t,ROAD_HALF+.8,13.4,-.15,-.15,mat(t.ground,'terrain')));
    this.world.add(ribbon(t,-ROAD_HALF,ROAD_HALF,.015,.015,this.asphalt));
    for(const side of [-1,1]) {
      this.world.add(ribbon(t,side*ROAD_HALF,side*(ROAD_HALF+.75),.04,.04,null,true));
      this.world.add(ribbon(t,side*(ROAD_HALF-.32),side*(ROAD_HALF-.2),.032,.032,mat('#c4c5b9')));
      for(const y of [.56,1.02]){const rail=ribbon(t,side*(ROAD_HALF+1.35),side*(ROAD_HALF+1.35),y,y+.22,mat('#8c9698','metal'));rail.material.side=THREE.DoubleSide;this.world.add(rail);}
    }
    const poles=instance(boxGeo,mat('#757e80','metal'),Math.floor(t.length/7)*2,(d,i)=>{const p=t.sample(Math.floor(i/2)*7,(i%2?1:-1)*(ROAD_HALF+1.4));d.position.set(p.x,p.y+.58,p.z);d.rotation.y=p.yaw;d.scale.set(.12,1.16,.12);});this.world.add(poles);
    const lanes=instance(boxGeo,mat('#aaa99f'),Math.floor(t.length/14),(d,i)=>{const p=t.sample(i*14);d.position.set(p.x,p.y+.035,p.z);d.rotation.y=p.yaw;d.scale.set(.1,.016,4);});this.world.add(lanes);
    this.buildScenery(t);this.items=[];
    this.buildItems(t,rules);
    const straight=t.boostStraight,entry=t.sample(straight.s+12);
    const straightSign=sign('BOOST STRAIGHT / 320 m',6,.9);straightSign.position.set(entry.x+entry.nx*11.5,entry.y+3,entry.z+entry.nz*11.5);straightSign.rotation.y=entry.yaw+Math.PI;this.world.add(straightSign);
    const start=t.sample(0),gate=new THREE.Group();gate.position.set(start.x,start.y,start.z);gate.rotation.y=start.yaw;
    box(gate,.24,6.5,.24,-10.3,3.25,0,'#7e8686','metal');box(gate,.24,6.5,.24,10.3,3.25,0,'#7e8686','metal');box(gate,20.8,1.2,.32,0,6.25,0,'#242b2e');
    for(let row=0;row<2;row++)for(let col=0;col<18;col++)box(gate,1,.015,.7,col-8.5,.07,row*.7-.35,(row+col)%2?'#c8c9bf':'#282d2e');mergeStatic(gate);
    const banner=sign('JRC  /  START — FINISH',18,1.05);banner.position.set(0,6.25,.18);gate.add(banner);this.world.add(gate);
    // Distance boards before technical corners give braking a visible reference.
    for(let i=0;i<10;i++){const s=t.length*(.08+i*.085),p=t.sample(s,-ROAD_HALF-2.3);const board=sign(`${i%2?50:100}`,1.5,1.8,'#d6d4c7','#20282a');board.material.map.colorSpace=THREE.SRGBColorSpace;board.position.set(p.x,p.y+2,p.z);board.rotation.y=p.yaw+Math.PI;this.world.add(board);}
    this.cars.clear();this.particles=[];this.lastEvent=0;this.trapMeshes=new Map();this.cameraReady=false;this.shake=0;this.world.add(this.particleMesh);this.applyQuality();
  }
  buildItems(t,rules='arcade') {
    for(const o of t.objects) {
      if(rules!=='arcade'&&o.type!=='boost')continue;
      const p=t.sample(o.s,o.x),group=new THREE.Group();group.userData={trackObjectId:o.id,type:o.type};group.position.set(p.x,p.y+.04,p.z);group.rotation.set(-Math.atan(t.slope(o.s)),p.yaw,0,'YXZ');
      if(o.type==='box'){const cube=new THREE.Group(),size=PICKUP_BOX.size;box(cube,size,size,size,0,size/2,0,'#95876a','metal');box(cube,size+.025,.13,size+.025,0,size*.6,0,'#d9c69a');mergeStatic(cube);group.add(cube);this.items.push({group,cube,o});}
      if(o.type==='barrier'){box(group,2.5,1.05,1.1,0,.52,0,'#a65335');for(const x of [-.75,0,.75])box(group,.24,.85,1.13,x,.54,0,'#cfccb7');mergeStatic(group);}
      if(o.type==='oil'){const oil=new THREE.Mesh(new THREE.CircleGeometry(2,20),mat('#161b22'));oil.rotation.x=-Math.PI/2;oil.position.y=.02;group.add(oil);}
      if(o.type==='boost'){box(group,BOOST_PAD.width,.03,BOOST_PAD.length,0,.01,0,'#375756');for(let k=-2;k<=2;k++)for(const x of [-.65,.65]){const m=box(group,1.6,.025,.18,x,.045,k*1.4,'#a5bfb5','light');m.rotation.y=x>0?.5:-.5;}mergeStatic(group);}
      this.world.add(group);
    }
  }
  setRace(race,playerId) {this.mode='race';this.buildTrack(race.trackId,race.rules);for(const r of race.racers){const colors=['#a44834','#597073','#929998','#ad9a77','#4a535f','#c7c3b5'],car=makeCar(r.car,r.bot?colors[r.slot]:undefined);this.cars.set(r.id,car);this.world.add(car);}this.adaptive.reset();}
  toggleCamera(){this.cameraMode=this.cameraMode==='chase'?'bonnet':'chase';this.cameraReady=false;return this.cameraMode;}
  particle(position,burst=false) {if(this.particles.length>=this.quality.particles)return;this.particles.push({x:position.x,y:position.y+.2,z:position.z,vx:(Math.random()-.5)*(burst?12:2),vy:Math.random()*(burst?4:1.5),vz:(Math.random()-.5)*8,life:burst?.45:.7,smoke:!burst});}
  updateParticles(dt) {
    let count=0;const dummy=this.particleDummy;
    for(let i=this.particles.length-1;i>=0;i--){const p=this.particles[i];p.life-=dt;if(p.life<=0){this.particles.splice(i,1);continue;}p.x+=p.vx*dt;p.y+=p.vy*dt;p.z+=p.vz*dt;p.vy-=dt*5;dummy.position.set(p.x,p.y,p.z);dummy.rotation.set(p.life*5,p.life*8,0);dummy.scale.setScalar((p.smoke?.07:.06)*Math.min(1,p.life*5));dummy.updateMatrix();this.particleMesh.setMatrixAt(count++,dummy.matrix);}
    this.particleMesh.count=count;this.particleMesh.instanceMatrix.needsUpdate=true;
  }
  render(race,playerId,dt,time) {
    if(document.hidden||this.contextLost)return;
    this.renderElapsed+=dt;const now=time*1000,interval=1000/(this.mode==='garage'?30:this.quality.fps);
    if(this.lastRender&&now-this.lastRender<interval-.6)return;
    const elapsed=this.renderElapsed;this.renderElapsed=0;const frameSeconds=this.lastRender?(now-this.lastRender)/1000:1/60;this.lastRender=now;dt=Math.min(.1,elapsed);const start=performance.now();
    if(this.mode==='garage') {
      this.garageCar.rotation.y=-.38+Math.sin(time*.12)*.12;this.camera.position.set(6,3.15,7.75);this.camera.lookAt(0,.7,0);this.camera.fov=37;this.camera.updateProjectionMatrix();this.renderer.render(this.garage,this.camera);return;
    }
    if(!race)return;
    const me=race.racers.find(r=>r.id===playerId)||race.racers[0],t=this.track,carPos=t.sample(me.s,me.x);
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    for(const r of race.racers) {
      const car=this.cars.get(r.id);if(!car)continue;const p=t.sample(r.s,r.x);
      car.visible=Math.hypot(p.x-carPos.x,p.z-carPos.z)<220;
      if(!car.visible)continue;
      this.target.set(p.x,p.y+.025,p.z);if(!this.cameraReady)car.position.copy(this.target);else car.position.lerp(this.target,1-Math.exp(-dt*22));
      const yaw=p.yaw+(r.headingError??Math.atan2(r.vx,Math.max(8,r.v)))*(r.drifting?1.08:1),delta=mod(yaw-car.rotation.y+Math.PI,Math.PI*2)-Math.PI;
      if(!this.cameraReady)car.rotation.y=p.yaw;else car.rotation.y+=delta*(1-Math.exp(-dt*12));
      car.rotation.order='YXZ';const pitch=-Math.atan(t.slope(r.s))+clamp(r.acceleration||0,-36,30)*.0007,roll=clamp(r.vx*.004,-.055,.055);
      car.rotation.x+=(pitch-car.rotation.x)*(1-Math.exp(-dt*8));car.rotation.z+=(-roll-car.rotation.z)*(1-Math.exp(-dt*7));
      for(const w of car.userData.wheels){if(w.front)w.pivot.rotation.y=(r.steerAngle||0)*steeringLimit(r.v);w.roll.rotation.x+=r.v*dt/.43;}
      car.userData.flame.visible=!!r.boosting&&r.engine!=='electric';car.userData.shield.visible=r.shield>0;
      if(r.drifting&&!reduced&&Math.random()<dt*24)this.particle(car.position);
    }
    for(const item of this.items)item.group.visible=(me.pickupCooldowns?.[item.o.id]??-Infinity)<=race.time;
    const ids=new Set(race.traps.map(tr=>tr.id));for(const [id,m] of this.trapMeshes)if(!ids.has(id)){this.world.remove(m);m.geometry.dispose();this.trapMeshes.delete(id);}
    for(const tr of race.traps)if(!this.trapMeshes.has(tr.id)){const p=t.sample(tr.s,tr.x),m=new THREE.Mesh(new THREE.CircleGeometry(2.3,16),mat('#192026'));m.rotation.x=-Math.PI/2;m.position.set(p.x,p.y+.06,p.z);this.world.add(m);this.trapMeshes.set(tr.id,m);}
    for(const e of race.events){if(e.id>this.lastEvent&&e.racer===playerId&&e.type==='hit'){const car=this.cars.get(playerId);if(car&&!reduced)for(let i=0;i<12;i++)this.particle(car.position,true);this.shake=.2;}this.lastEvent=Math.max(this.lastEvent,e.id);}
    this.updateParticles(dt);this.shake*=Math.exp(-dt*7);
    const speed=clamp(me.v/65,0,1),bonnet=this.cameraMode==='bonnet',behind=t.sample(me.s-(bonnet?-.8:9.4+speed*2.1),bonnet?me.x:me.x*.85),ahead=t.sample(me.s+13+speed*8,me.x*.65);
    const jolt=reduced?0:Math.sin(time*79)*this.shake;
    this.target.set(behind.x+jolt,carPos.y+(bonnet?1.25:3.65+speed*.35),behind.z);
    this.look.set(ahead.x,carPos.y+(bonnet?1.15:1.1),ahead.z);
    if(!this.cameraReady){this.camera.position.copy(this.target);this.cameraAim.copy(this.look);this.cameraReady=true;}else{this.camera.position.lerp(this.target,1-Math.exp(-dt*(bonnet?18:8)));this.cameraAim.lerp(this.look,1-Math.exp(-dt*10));}
    this.camera.lookAt(this.cameraAim);const fov=bonnet?66:51+speed*8+(me.boosting&&!reduced?3:0);this.camera.fov+=(fov-this.camera.fov)*(1-Math.exp(-dt*3));this.camera.updateProjectionMatrix();
    this.sun.position.set(carPos.x+35,carPos.y+65,carPos.z+25);this.sun.target.position.set(carPos.x,carPos.y,carPos.z);this.renderer.render(this.world,this.camera);
    if(this.adaptive.observe(frameSeconds,performance.now()-start))this.applyQuality();
  }
  get diagnostics(){return {quality:this.quality.name,level:this.adaptive.level,pixelRatio:this.pixelRatio,fps:Math.round(this.adaptive.fps),frameMs:Math.round(this.adaptive.frameMs*10)/10,targetFps:this.quality.fps,shadows:this.renderer.shadowMap.enabled,camera:this.cameraMode,calls:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles,geometries:this.renderer.info.memory.geometries,textures:this.renderer.info.memory.textures};}
}
