import * as THREE from '/vendor/three.module.js';
import {CARS, getTrack, ROAD_HALF, PICKUP_BOX, mod} from './tracks.js';
const UP = new THREE.Vector3(0,1,0);
const materials = new Map();
// PBR material library with a clearcoat-style sheen: cars read as painted metal,
// glass as tinted transparent, tyres as matte rubber, chrome as polished mirror.
function makeMaterial(color,kind){
  const spec={};
  if(kind==='car')Object.assign(spec,{roughness:.22,metalness:.55,envMapIntensity:1.35,clearcoat:1,clearcoatRoughness:.08});
  else if(kind==='glass')Object.assign(spec,{roughness:.06,metalness:.1,transparent:true,opacity:.55,envMapIntensity:2.0,clearcoat:1});
  else if(kind==='tyre')Object.assign(spec,{roughness:.92,metalness:.02});
  else if(kind==='chrome')Object.assign(spec,{roughness:.15,metalness:1,envMapIntensity:1.6});
  else if(kind==='emissive')Object.assign(spec,{roughness:.35,metalness:.3,emissive:color,emissiveIntensity:1.6,envMapIntensity:1.2});
  else Object.assign(spec,{roughness:.55,metalness:.25});
  return new THREE.MeshStandardMaterial({color,...spec});
}
function mat(color, emissive = false) {const key=`${color}-${emissive}`;if(!materials.has(key))materials.set(key,makeMaterial(color,emissive?'emissive':'default'));return materials.get(key);}
function pmat(color,kind){const key=`p:${color}-${kind}`;if(!materials.has(key))materials.set(key,makeMaterial(color,kind));return materials.get(key);}
const boxGeo=new THREE.BoxGeometry(1,1,1), wheelGeo=new THREE.CylinderGeometry(.43,.43,.3,12);
// Heuristic for how much eye-candy a device can afford. Conservative on old
// phones (few cores / little RAM / coarse touch screens) to keep the frame rate up.
function detectQuality(){
  const nav=typeof navigator!=='undefined'?navigator:{};
  const cores=nav.hardwareConcurrency||4, mem=nav.deviceMemory||4;
  const mobile=typeof matchMedia==='function'&&matchMedia('(pointer:coarse)').matches;
  // Very weak: tiny RAM or very few cores. Phones also get a bump down because a
  // mobile GPU is far slower than a desktop one with the same core count.
  const weak=mem<=2||cores<=2||(mem<=4&&cores<=4);
  const mid=!weak&&(mem<=4||cores<=6||mobile);
  if(weak)return{weak:true,mid:false,antialias:false,shadows:false,pixelRatioMax:.85,particles:.25,envDetail:false};
  if(mid)return{weak:false,mid:true,antialias:false,shadows:false,pixelRatioMax:1.2,particles:.55,envDetail:false};
  return{weak:false,mid:false,antialias:true,shadows:true,pixelRatioMax:1.6,particles:1,envDetail:true};
}
function box(parent,w,h,d,x,y,z,color,emissive=false) {const m=new THREE.Mesh(boxGeo,mat(color,emissive));m.scale.set(w,h,d);m.position.set(x,y,z);parent.add(m);return m;}
export function makeCar(id, colorOverride) {
  const config=CARS.find(c=>c.id===id)||CARS[0], color=colorOverride||config.color, g=new THREE.Group(), suv=id==='titan', formula=id==='bolt';
  const bodyY=suv?.85:.5;
  const paint=pmat(color,'car'), glassMat=pmat('#0a1722','glass'), rubber=pmat('#0c1015','tyre'), chrome=pmat('#dfe6ea','chrome');
  // Shared sports-car silhouette: long sculpted nose, low cabin, wide haunches.
  const w=formula?1.55:1.86, len=formula?4.2:4.5, dark='#0e1a26';
  const shell=(pw,ph,pd,px,py,pz,m)=>box(g,pw,ph,pd,px,py,pz,m?m:color);
  // Lower sill / floor pan that reads as a real underbody.
  box(g,w*.94,.22,len*.94,0,.34,0,dark);
  // Main body: taper from a slim nose to a fuller tail (three stacked stages).
  box(g,w,.42,len*.62,0,bodyY,0,paint);
  box(g,w*.86,.36,len*.26,0,bodyY-.02,len*.36,paint);        // nose wedge
  box(g,w*.92,.5,len*.22,0,bodyY+.02,-len*.34,paint);        // rear haunch
  // Front splitter + intakes.
  box(g,w*.9,.12,.5,0,.32,len*.5,dark);
  box(g,w*.24,.16,.3,-w*.28,.42,len*.48,dark);box(g,w*.24,.16,.3,w*.28,.42,len*.48,dark);
  // Cabin: a glass canopy (dark tinted) with a body-coloured roof strip.
  const cabin=new THREE.Mesh(new THREE.BoxGeometry(w*.82,formula?.5:.52,formula?1.3:1.9),glassMat);
  cabin.position.set(0,bodyY+.42,-.15);g.add(cabin);
  box(g,w*.74,.08,formula?1.1:1.6,0,bodyY+(formula?.68:.66),-.25,paint); // roof
  // Front windshield slam + rear deck lid.
  box(g,w*.7,.06,1.0,0,bodyY+.24,len*.14,dark);
  box(g,w*.86,.14,len*.3,0,bodyY+.2,-len*.34,paint);
  // Rear wing / spoiler on two struts (skipped for the open-wheel formula car).
  if(!formula){
    box(g,.1,.34,.12,-w*.4,bodyY+.5,-len*.45,dark);box(g,.1,.34,.12,w*.4,bodyY+.5,-len*.45,dark);
    box(g,w*.96,.07,.5,0,bodyY+.72,-len*.46,paint);
  } else {
    box(g,w*1.02,.06,.46,0,bodyY+.52,-len*.46,paint);
  }
  // Side mirrors, door crease, and a centre racing stripe.
  for(const x of [-1,1]){box(g,.22,.1,.14,x*w*.5,bodyY+.46,len*.06,dark);box(g,.05,.34,len*.7,x*w*.5,bodyY+.05,-.1,dark);box(g,.11,.1,1.1,x*w*.52,bodyY+.7,-.2,paint);}
  box(g,.5,.03,len*.62,0,bodyY+.23,-.05,'#f2ecdd');
  box(g,.24,.03,len*.62,0,bodyY+.23,-.05,color);
  // Vents on the rear deck.
  for(const x of [-.34,.34])for(let k=0;k<3;k++)box(g,.28,.03,.06,x,bodyY+.28,-len*.36-k*.14,dark);
  // Head/taillight clusters: bright emissive lenses plus a grille.
  for(const x of [-1,1]){
    const head=new THREE.Mesh(new THREE.BoxGeometry(.42,.16,.1),mat('#d5fff6',true));
    head.position.set(x*w*.32,bodyY+.16,len*.5);g.add(head);
    box(g,.12,.2,.12,x*w*.32,bodyY+.16,len*.5+0.05,'#cfe9ff');
    const tail=new THREE.Mesh(new THREE.BoxGeometry(.5,.15,.07),mat('#ff493d',true));
    tail.position.set(x*w*.34,bodyY+.2,-len*.5);g.add(tail);
    // Big round-ish tail lamp rings (classic sports car light bar).
    const ring=new THREE.Mesh(new THREE.RingGeometry(.09,.16,16),mat('#7a0d0d',true));
    ring.position.set(x*w*.34,bodyY+.2,-len*.5-.04);g.add(ring);
  }
  box(g,w*.5,.14,.1,0,bodyY+.08,len*.5,dark); // front grille
  // Wheels with low-profile tyres and machined multi-spoke hubs.
  const tyreGeo=new THREE.CylinderGeometry(.45,.45,.34,20), hubGeo=new THREE.CylinderGeometry(.26,.26,.36,16);
  for(const x of [-1,1]) {
    for(const z of [len*.28,-len*.3]) {
      const wheel=new THREE.Mesh(tyreGeo,rubber);wheel.rotation.z=Math.PI/2;wheel.position.set(x*(formula?w*.72:w*.5),.45,z);wheel.castShadow=true;g.add(wheel);
      const hub=new THREE.Mesh(hubGeo,chrome);hub.rotation.z=Math.PI/2;hub.position.copy(wheel.position);g.add(hub);
      for(let k=0;k<5;k++){const spoke=new THREE.Mesh(new THREE.BoxGeometry(.05,.46,.05),chrome);spoke.rotation.z=Math.PI/2;spoke.rotation.x=k*Math.PI/5;spoke.position.copy(wheel.position);g.add(spoke);}
      // Wing mirror + brake caliper make the wheel look real.
      const caliper=new THREE.Mesh(new THREE.BoxGeometry(.12,.2,.1),mat('#e0503a'));caliper.position.set(x*(formula?w*.72:w*.5),.4,z+.18);g.add(caliper);
    }
  }
  // Twin exhausts at the diffuser.
  for(const x of [-.3,.3]){const pipe=new THREE.Mesh(new THREE.CylinderGeometry(.08,.08,.2,10),chrome);pipe.rotation.x=Math.PI/2;pipe.position.set(x,.42,-len*.52);g.add(pipe);}
  // Body panels cast a real shadow onto the road/garage floor.
  g.traverse(o=>{if(o.isMesh&&!o.isRingGeometry)o.castShadow=true;});
  const flame=new THREE.Group();
  for(const x of [-.5,.5]) {const mesh=new THREE.Mesh(new THREE.ConeGeometry(.23,1.7,7),mat('#48e9fa',true));mesh.rotation.x=-Math.PI/2;mesh.position.set(x,.48,-len*.62);flame.add(mesh);}
  g.add(flame);flame.visible=false;
  const shield=new THREE.Mesh(new THREE.SphereGeometry(2.4,16,10),new THREE.MeshBasicMaterial({color:'#75fff0',wireframe:true,transparent:true,opacity:.22}));shield.position.y=.8;shield.scale.set(.65,.65,1);g.add(shield);shield.visible=false;
  const shadow=new THREE.Mesh(new THREE.CircleGeometry(1,20),new THREE.MeshBasicMaterial({color:'#081520',transparent:true,opacity:.32,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.scale.set(1.35,2.4,1);shadow.position.y=.045;g.add(shadow);
  // Dynamic lights: a tail light that flares under braking, and a spill light
  // under the car so boost reads as real illumination, not just a bright mesh.
  const brake=new THREE.PointLight('#ff4133',0,9,2);brake.position.set(0,bodyY+.3,-len*.55);g.add(brake);
  const glow=new THREE.PointLight('#5df0ff',0,7,2);glow.position.set(0,.5,-len*.62);g.add(glow);
  g.userData={flame,shield,cabin,brake,glow};return g;
}
function strip(track,left,right,height,color,checker=false) {
  const pos=[],colors=[],indices=[],count=track.points?Math.min(1400,track.points.length-1):560;
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
  // A tiny procedural sky/ground cube rendered through PMREM into a prefiltered
  // environment map — gives PBR surfaces believable reflections for free.
  buildEnvironment() {
    const pmrem=new THREE.PMREMGenerator(this.renderer);pmrem.compileCubemapShader();
    const sky=new THREE.Scene();
    const grad=new THREE.Mesh(new THREE.SphereGeometry(50,24,16),new THREE.MeshBasicMaterial({side:THREE.BackSide}));
    const geo=grad.geometry,pos=geo.attributes.position,col=[];
    for(let i=0;i<pos.count;i++){const y=pos.getY(i)/50;const t=(y+1)/2;const c=new THREE.Color().setHSL(.58,.5,.18+.42*t);col.push(c.r,c.g,c.b);}
    geo.setAttribute('color',new THREE.Float32BufferAttribute(col,3));grad.material.vertexColors=true;sky.add(grad);
    const env=pmrem.fromScene(sky,.04).texture;pmrem.dispose();return env;
  }
  constructor(container) {
    // Adaptive quality: weak/old phones drop resolution, shadows, AA and effects
    // so the race stays playable instead of stuttering.
    this.quality=detectQuality();
    this.renderer=new THREE.WebGLRenderer({antialias:this.quality.antialias,powerPreference:this.quality.weak?'default':'high-performance'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,this.quality.pixelRatioMax));this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.05;
    this.renderer.shadowMap.enabled=this.quality.shadows;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute('aria-label','3D 赛车画面');container.append(this.renderer.domElement);
    this.container=container;this.camera=new THREE.PerspectiveCamera(52,1,.1,1400);this.cars=new Map();this.mode='garage';this.lastEvent=0;this.particles=[];
    // Procedural environment map: mirrors the sky/ground so painted metal, glass
    // and chrome pick up real specular reflections instead of looking flat.
    this.envMap=this.quality.envDetail?this.buildEnvironment():null;
    this.garage=new THREE.Scene();this.garage.background=new THREE.Color('#0c1626');if(this.envMap)this.garage.environment=this.envMap;this.garage.fog=new THREE.Fog('#0c1626',26,72);
    this.garage.add(new THREE.HemisphereLight('#deffff','#24415c',1.4));const light=new THREE.DirectionalLight('#fff0d2',3.4);light.position.set(3,8,4);light.castShadow=true;light.shadow.mapSize.set(1024,1024);light.shadow.camera.near=1;light.shadow.camera.far=40;light.shadow.camera.left=-9;light.shadow.camera.right=9;light.shadow.camera.top=9;light.shadow.camera.bottom=-9;light.shadow.bias=-.0016;this.garage.add(light);this.garage.add(light.target);
    const platform=new THREE.Mesh(new THREE.CylinderGeometry(3.8,4, .25,64),mat('#22374b'));platform.position.y=-.17;platform.receiveShadow=true;this.garage.add(platform);
    const ring=new THREE.Mesh(new THREE.TorusGeometry(3.8,.026,5,80),mat('#56d8cb',true));ring.rotation.x=Math.PI/2;ring.position.y=-.01;this.garage.add(ring);
    const grid=new THREE.GridHelper(100,70,'#2c5064','#1c3346');grid.position.y=-.35;this.garage.add(grid);
    // Three-point studio rig: key + cool fill + warm rim, so bodywork reads in 3D.
    const fill=new THREE.PointLight('#7fd7ff',24,34,2);fill.position.set(-6,4,3);this.garage.add(fill);
    const rim=new THREE.PointLight('#ffb066',20,34,2);rim.position.set(3,5,-6);this.garage.add(rim);
    this.garageCar=makeCar('comet');this.garage.add(this.garageCar);
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);this.resize();this.watchPerf();
    this.renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();document.dispatchEvent(new CustomEvent('graphics-lost'));});
  }
  // Scenery is themed per track. Mountains stay where the road opens out, but the
  // palette and silhouettes differ: a lit night city skyline, a wooded creek pass,
  // or a neon-drenched cyberpunk sprawl with holographic signs.
  buildScenery(t,theme,dummy){
    const count=110;
    const place=(i)=>{const p=t.sample(i/count*t.length,(i%2?1:-1)*(16+(Math.sin(i*79)*.5+.5)*34));const scale=.7+(Math.sin(i*22)*.5+.5)*1.4;return {p,scale};};
    if(theme==='coast'){
      const trunks=new THREE.InstancedMesh(new THREE.CylinderGeometry(.22,.45,5,5),mat('#776c4a'),count);
      const tops=new THREE.InstancedMesh(new THREE.ConeGeometry(3,2,5),mat('#4b9377'),count);
      for(let i=0;i<count;i++){const {p,scale}=place(i);
        dummy.position.set(p.x,p.y+2,p.z);dummy.rotation.set(0,i*1.9,0);dummy.scale.set(1,scale,1);dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix);
        dummy.position.y=p.y+5*scale;dummy.scale.set(scale,scale,scale);dummy.updateMatrix();tops.setMatrixAt(i,dummy.matrix);}
      this.world.add(trunks,tops);return;
    }
    if(theme==='creek'){
      // Wooded valley: layered pines and low shrubs hug both banks.
      const trunks=new THREE.InstancedMesh(new THREE.CylinderGeometry(.2,.4,4.4,5),mat('#7a5a3d'),count);
      const tops=new THREE.InstancedMesh(new THREE.ConeGeometry(3.4,9,6),mat('#3f6f4e'),count);
      for(let i=0;i<count;i++){const {p,scale}=place(i);
        dummy.position.set(p.x,p.y+2,p.z);dummy.rotation.set(0,i*1.9,0);dummy.scale.set(1,scale,1);dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix);
        dummy.position.y=p.y+4.4*scale+2.4;dummy.scale.set(scale,scale,scale);dummy.updateMatrix();tops.setMatrixAt(i,dummy.matrix);
        if(i%3===0)box(this.world,.8,.8,.8,p.x+(i%2?3:-3),p.y+.5,p.z+(i%2?-2:2),'#5c8a4e');}
      this.world.add(trunks,tops);
      // A few rocks and a low stone wall along the creek edge.
      for(let i=0;i<22;i++){const {p,scale}=place((i*5)%count);box(this.world,1.4*scale,1*scale,1.2*scale,p.x*1.06,p.y-.1,p.z*1.06,'#8b8378');}
      return;
    }
    // cyber (= neon): a glowing city skyline with holographic billboards.
    const towers=new THREE.InstancedMesh(boxGeo,mat('#1b2444'),count);
    for(let i=0;i<count;i++){const {p,scale}=place(i);const h=10+scale*22;
      dummy.position.set(p.x,h/2,p.z);dummy.rotation.set(0,i*1.9,0);dummy.scale.set(4+scale*3,h,5+scale*3);dummy.updateMatrix();towers.setMatrixAt(i,dummy.matrix);
      if(i%2===0){const sign=box(this.world,.16,h*.7,4.4,p.x+3.2,h*.5,p.z,i%4?'#47c9d1':'#aa73fa',true);sign.rotation.y=i*1.9;}
      if(i%5===0){const beam=new THREE.Mesh(new THREE.CircleGeometry(2,16),mat(i%2?'#61f4ff':'#ff5fd2',true));beam.rotation.x=-Math.PI/2;beam.position.set(p.x,0.6,p.z);this.world.add(beam);}
    }
    this.world.add(towers);
  }
  resize(){const w=Math.max(1,this.container.clientWidth),h=Math.max(1,this.container.clientHeight);this.renderer.setSize(w,h);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();}
  setContainer(container){this.resizeObserver.disconnect();this.container=container;container.append(this.renderer.domElement);this.resizeObserver.observe(container);this.resize();}
  setCar(id){this.garage.remove(this.garageCar);this.disposePrivate(this.garageCar);this.garageCar=makeCar(id);this.garage.add(this.garageCar);}
  disposePrivate(root) {root.traverse(o=>{if(o.isMesh){if(o.geometry!==boxGeo&&o.geometry!==wheelGeo)o.geometry.dispose();if(![...materials.values()].includes(o.material)){o.material.map?.dispose();o.material.dispose();}}});}
  buildTrack(id) {
    if(this.world)this.disposePrivate(this.world);
    this.world=new THREE.Scene();this.track=getTrack(id);const t=this.track,night=id==='neon';
    this.world.background=new THREE.Color(t.sky);this.world.fog=new THREE.Fog(t.sky,110,520);if(this.envMap)this.world.environment=this.envMap;
    const theme=t.theme||(id==='neon'?'cyber':id==='canyon'?'creek':'coast');
    const dark=theme==='cyber'||night;
    this.world.add(new THREE.HemisphereLight(dark?'#a6bcff':'#e2faff',t.ground,dark?2.8:2.7));const sun=new THREE.DirectionalLight(dark?'#a4b4ff':'#fff0d3',dark?2.2:2.7);sun.position.set(100,170,80);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.near=40;sun.shadow.camera.far=420;sun.shadow.camera.left=-60;sun.shadow.camera.right=60;sun.shadow.camera.top=60;sun.shadow.camera.bottom=-60;sun.shadow.bias=-.0022;this.world.add(sun);this.world.add(sun.target);
    // Drop the world floor under the lowest road point so a downhill section can
    // never dip below it (that was clipping cars through the ground on creek).
    let roadMinY=Infinity;for(let s=0;s<t.length;s+=2)roadMinY=Math.min(roadMinY,t.sample(s).y);
    const groundY=Math.min(-8,roadMinY-6);
    const ground=new THREE.Mesh(new THREE.PlaneGeometry(2400,2400),mat(t.ground));ground.rotation.x=-Math.PI/2;ground.position.y=groundY;ground.receiveShadow=true;this.world.add(ground);
    if(theme==='coast'){const water=new THREE.Mesh(new THREE.PlaneGeometry(2000,2000),mat('#559ea9'));water.rotation.x=-Math.PI/2;water.position.set(-1190,groundY+.15,0);this.world.add(water);}
    if(theme==='creek'){const stream=new THREE.Mesh(new THREE.PlaneGeometry(260,1400),mat('#5f9ec0'));stream.rotation.x=-Math.PI/2;stream.position.set(-260,groundY+.2,0);this.world.add(stream);}
    this.world.add(strip(t,-65,-ROAD_HALF-1.3,-.15,t.ground),strip(t,ROAD_HALF+1.3,65,-.15,t.ground));
    this.world.add(strip(t,-ROAD_HALF-1.3,ROAD_HALF+1.3,-.08,t.ground));this.world.add(strip(t,-ROAD_HALF,ROAD_HALF,.02,t.road));
    this.world.add(strip(t,-ROAD_HALF-.55,-ROAD_HALF,.06,'#ffffff',true),strip(t,ROAD_HALF,ROAD_HALF+.55,.06,'#ffffff',true));
    const railColor=theme==='cyber'?'#c198ff':theme==='creek'?'#a8815a':'#a6bdc4';
    this.world.add(strip(t,-ROAD_HALF-.8,-ROAD_HALF-.55,.8,railColor),strip(t,ROAD_HALF+.55,ROAD_HALF+.8,.8,theme==='cyber'?'#48dbc5':railColor));
    const dummy=new THREE.Object3D(),dashCount=Math.floor(t.length/9)*2;
    const dashes=new THREE.InstancedMesh(boxGeo,mat(theme==='cyber'?'#7ff0ff':'#c3d0ca'),dashCount);let n=0;
    for(let s=0;s<t.length-9;s+=9) for(const x of [-3,3]) {const p=t.sample(s,x);dummy.position.set(p.x,p.y+.04,p.z);dummy.rotation.set(0,p.yaw,0);dummy.scale.set(.09,.025,3.6);dummy.updateMatrix();dashes.setMatrixAt(n++,dummy.matrix);} dashes.count=n;this.world.add(dashes);
    this.buildScenery(t,theme,dummy);
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
    this.cars.clear();this.particles=[];this.lastEvent=0;this.trapMeshes=new Map();this.cameraReady=false;this.shake=0;
  }
  // If the frame rate collapses (old phone, thermal throttle) drop resolution and
  // turn off shadows on the fly, so play stays smooth.
  watchPerf(){
    if(typeof performance==='undefined'||typeof requestAnimationFrame!=='function')return;
    let frames=0,last=performance.now(),steps=0;
    const tick=()=>{
      const now=performance.now();frames++;
      if(now-last>=1000){
        const fps=frames*1000/(now-last);frames=0;last=now;
        if(fps<48&&this.quality.step<3){
          this.quality.step++;steps=this.quality.step;
          if(steps===1){this.quality.pixelRatioMax=Math.max(1,this.quality.pixelRatioMax*.8);this.renderer.setPixelRatio(Math.min(devicePixelRatio,this.quality.pixelRatioMax));this.quality.particles*=.6;}
          else if(steps===2){this.renderer.shadowMap.enabled=false;this.quality.shadows=false;}
          else {this.quality.particles*=.6;this.quality.pixelRatioMax=1;this.renderer.setPixelRatio(1);}
          this.resize();
        }
      }
      this.perfId=requestAnimationFrame(tick);
    };
    this.quality.step=0;this.perfId=requestAnimationFrame(tick);
  }
  setRace(race,playerId){this.mode='race';this.buildTrack(race.trackId);for(const r of race.racers){const m=makeCar(r.car,r.bot?['#ffa261','#6bd7c0','#9aabff','#f5da89','#eb89aa','#75badc'][r.slot]:undefined);if(r.id===playerId)this.addOutline(m);this.cars.set(r.id,m);this.world.add(m);}}
  // A pulsing rim + marker floating over the player's car so "which one am I"
  // is obvious — the marker is a downward chevron plus a coloured halo.
  addOutline(car){
    const color='#7ef7dd';
    const halo=new THREE.Mesh(new THREE.TorusGeometry(2.1,.09,8,44),mat(color,true));halo.rotation.x=Math.PI/2;halo.position.y=.06;car.add(halo);
    const ring=new THREE.Mesh(new THREE.TorusGeometry(1.9,.045,6,44),mat('#ffffff',true));ring.rotation.x=Math.PI/2;ring.position.y=.05;car.add(ring);
    const marker=new THREE.Group();
    const chevron=new THREE.Mesh(new THREE.ConeGeometry(.42,.85,4),mat(color,true));chevron.rotation.x=Math.PI;chevron.position.y=3.5;marker.add(chevron);
    const halo2=new THREE.PointLight(color,6,9,2);halo2.position.y=3.2;marker.add(halo2);
    car.add(marker);
    car.userData.outline={halo,ring,marker};
  }
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
      const o=m.userData.outline;
      if(o){const pulse=1+Math.sin(time*4)*.06;o.halo.scale.set(pulse,pulse,1);o.ring.rotation.z=-time*1.2;o.marker.position.y=Math.sin(time*3)*.16;o.marker.rotation.y=time*1.4;}
      // Brake/lift tail light flares red; boost spills cyan from under the car.
      const braking=!r.boosting&&r.input?.throttle===false;
      if(m.userData.brake)m.userData.brake.intensity+=((braking?2.6:0)-m.userData.brake.intensity)*Math.min(1,dt*8);
      if(m.userData.glow)m.userData.glow.intensity+=((r.boosting?3.2:0)-m.userData.glow.intensity)*Math.min(1,dt*8);
      if(r.drifting&&Math.random()<(this.quality?.particles??1)*.45)this.particle(m.position,r.driftCharge>.65?'#57e5f4':'#ffc57b');
    }
    for(const item of this.items) {
      item.group.visible=(me.pickupCooldowns?.[item.o.id] ?? -Infinity) <= race.time;
      item.cube.rotation.y=time*.65;
    }
    const ids=new Set(race.traps.map(tr=>tr.id));for(const [id,m] of this.trapMeshes)if(!ids.has(id)){this.world.remove(m);m.geometry.dispose();this.trapMeshes.delete(id);}
    for(const tr of race.traps)if(!this.trapMeshes.has(tr.id)){const p=t.sample(tr.s,tr.x),m=new THREE.Mesh(new THREE.CircleGeometry(2.3,16),mat('#443154'));m.rotation.x=-Math.PI/2;m.position.set(p.x,p.y+.12,p.z);this.world.add(m);this.trapMeshes.set(tr.id,m);}
    for(const e of race.events){if(e.id>this.lastEvent&&e.racer===playerId){const m=this.cars.get(playerId);if(m&&(e.type==='hit'||e.type==='shield')){for(let i=0;i<16;i++)this.particle(m.position,e.type==='shield'?'#75fff0':'#ffce84',true);if(e.type==='hit')this.shake=Math.max(this.shake,.5);}}this.lastEvent=Math.max(this.lastEvent,e.id);}
    for(let i=this.particles.length-1;i>=0;i--){const p=this.particles[i];p.life-=dt;p.mesh.position.addScaledVector(p.vel,dt);p.vel.y-=dt*8;p.mesh.scale.multiplyScalar(.97);if(p.life<=0){this.world.remove(p.mesh);this.particles.splice(i,1);}}
    const carPos=t.sample(me.s,me.x),behind=t.sample(me.s-(me.boosting?15:13),me.x*.5),ahead=t.sample(me.s+15,me.x*.35);
    // Impact shake decays on its own and adds a lateral jolt on top of the hit timer.
    this.shake*=Math.exp(-dt*4);
    const shake=(me.hit>0?Math.sin(time*83)*me.hit*.3:0)+Math.sin(time*67)*this.shake*.5;
    const desired=new THREE.Vector3(behind.x+shake,carPos.y+6.3,behind.z);
    if(!this.cameraReady){this.camera.position.copy(desired);this.cameraReady=true;}else this.camera.position.lerp(desired,1-Math.exp(-dt*7));
    this.camera.lookAt(ahead.x,carPos.y+1.5,ahead.z);this.camera.fov+=( (me.boosting?70:58)-this.camera.fov)*Math.min(1,dt*3);this.camera.updateProjectionMatrix();this.renderer.render(this.world,this.camera);
  }
  particle(position,color,burst=false){if(this.particles.length>70)return;const mesh=new THREE.Mesh(boxGeo,mat(color,true));mesh.scale.setScalar(.12+Math.random()*.12);mesh.position.copy(position);mesh.position.y+=.4;this.world.add(mesh);this.particles.push({mesh,life:.6,vel:new THREE.Vector3((Math.random()-.5)*(burst?15:3),Math.random()*5,(Math.random()-.5)*10)});}
}
