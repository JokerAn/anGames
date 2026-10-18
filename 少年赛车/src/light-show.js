// Three is supplied by RaceRenderer so the scene and these batches always use
// the same local vendor build. No textures, post-processing or gameplay state.
import {clamp,mod,shortDistance} from './tracks.js';
import {GUARDRAIL_OFFSET} from './driving.js';
const finite=(value,fallback=0)=>Number.isFinite(value)?value:fallback;
export const isNightTrack=track=>!!(track.night||track.id==='neon'||track.theme==='arcade');
export class TrackLightShow {
  constructor(track,three,quality={particles:36}) {
    this.track=track;this.THREE=three;this.group=new three.Group();this.group.name='track-light-show';
    this.enabled=track.lightShow!==false&&(track.lightShow===true||track.theme==='arcade');this.group.visible=this.enabled;
    this.disposed=false;this.phase=0;this.lastTime=null;this.reduced=false;this.batches=new Map();this.localLights=[];
    this.geometries=new Set();this.materials=new Set();this.dummy=new three.Object3D();this.tint=new three.Color();
    this.counts={arches:0,panels:0,beams:0,edgeLights:0,groundPools:0,landmark:false,drawCalls:0,localLights:0};
    if(!this.enabled)return;
    const box=new three.BoxGeometry(1,1,1),cone=new three.ConeGeometry(3.6,26,12,1,true);
    cone.rotateZ(Math.PI);cone.translate(0,13,0);
    const disc=new three.CircleGeometry(1,24),wheel=new three.TorusGeometry(18,.22,6,72);
    this.geometries=new Set([box,cone,disc,wheel]);
    const structure=new three.MeshStandardMaterial({color:'#241c38',roughness:.55,metalness:.45,emissive:'#150d24',emissiveIntensity:.25});
    const led=new three.MeshBasicMaterial({color:'#ffffff',toneMapped:false});
    const additive=opacity=>new three.MeshBasicMaterial({color:'#ffffff',transparent:true,opacity,depthWrite:false,side:three.DoubleSide,forceSinglePass:true,blending:three.AdditiveBlending,toneMapped:false});
    const halo=additive(.12),beam=additive(.085),pool=additive(.32);
    // Soft geometry gradients stand in for bloom without lighting the whole screen.
    for(const [material,kind] of [[beam,'beam'],[pool,'pool']]){
      material.onBeforeCompile=shader=>{
        shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 showUv;').replace('#include <begin_vertex>','#include <begin_vertex>\nshowUv = uv;');
        const fade=kind==='pool'?'pow(max(0.0, 1.0 - length(showUv - 0.5) * 2.0), 2.0)':'(0.25 + 0.75 * showUv.y)';
        shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec2 showUv;').replace('#include <color_fragment>',`#include <color_fragment>\ndiffuseColor.a *= ${fade};`);
      };
      material.customProgramCacheKey=()=>`race-light-show-${kind}`;
    }
    this.materials=new Set([structure,led,halo,beam,pool]);
    for(const [name,geometry,material] of [['architecture',box,structure],['arches',box,led],['halos',box,halo],['edges',box,led],['panels',box,led],['facades',box,led],['beams',cone,beam],['pools',disc,pool],['wheel',wheel,led]])this.batches.set(name,{geometry,material,records:[],active:[],mesh:null});
    this.buildLayout();
    for(const [name,b] of this.batches){
      const mesh=b.mesh=new three.InstancedMesh(b.geometry,b.material,Math.max(1,b.records.length));mesh.name=`light-show-${name}`;mesh.frustumCulled=false;mesh.count=0;
      mesh.instanceMatrix.setUsage(three.DynamicDrawUsage);mesh.setColorAt(0,this.tint.set('#ffffff'));mesh.instanceColor.setUsage(three.DynamicDrawUsage);
      mesh.castShadow=mesh.receiveShadow=false;mesh.renderOrder=b.material.transparent?2:0;this.group.add(mesh);
    }
    for(let i=0;i<2;i++){const light=new three.PointLight('#a09aff',110,38,2);light.castShadow=false;this.localLights.push(light);this.group.add(light);}
    this.update(0,0,false,quality);
  }
  record(name,s,lane,y,width,height,depth,hue=0,options={}) {
    s=mod(s,this.track.length);const p=this.track.sample(s,lane),grade=options.flat?0:Math.atan(this.track.slope(s)),d=this.dummy;
    d.position.set(p.x,p.y+y,p.z);d.rotation.set((options.planar?-Math.PI/2:0)-grade,p.yaw,options.roll||0,'YXZ');d.scale.set(width,height,depth);d.updateMatrix();
    const record={s,lane,y,hue,index:options.index||0,family:options.family||name,gate:options.gate,matrix:d.matrix.clone(),yaw:p.yaw};
    this.batches.get(name).records.push(record);return record;
  }
  bar(name,s,x1,y1,x2,y2,thickness,depth,hue,options={}){
    return this.record(name,s,(x1+x2)/2,(y1+y2)/2,Math.hypot(x2-x1,y2-y1),thickness,depth,hue,{...options,roll:Math.atan2(y2-y1,x2-x1)});
  }
  buildLayout(){
    const length=this.track.length,rail=GUARDRAIL_OFFSET,span=rail+1.9,clusters=Math.ceil(length/76);
    // Three successive portals form short open tunnels with a clear view of bends.
    for(let cluster=0;cluster<clusters;cluster++)for(let n=0;n<3;n++){
      const gate=cluster*3+n,s=32+cluster*length/clusters+n*8,hue=cluster*.17+n*.08,options={family:'arch',index:gate,gate};
      const segments=[[-span,0,-span,6.8],[span,0,span,6.8],[-span,6.8,-8.3,9],[span,6.8,8.3,9],[-8.3,9,8.3,9]];
      for(const [x1,y1,x2,y2] of segments){
        this.bar('architecture',s,x1,y1,x2,y2,.52,.7,hue,options);
        this.bar('arches',s-.42,x1,y1,x2,y2,.15,.18,hue,options);
        this.bar('halos',s-.44,x1,y1,x2,y2,.38,.26,hue,options);
      }
    }
    const edgeCount=Math.ceil(length/5);
    for(let i=0;i<edgeCount;i++)for(const side of [-1,1])this.record('edges',i*length/edgeCount,side*(rail+.65),1.32,.17,.16,length/edgeCount-.35,i*.05+(side<0?.5:0),{index:i});
    const panelCount=Math.ceil(length/14);
    for(let i=0;i<panelCount;i++)for(const side of [-1,1]){
      const s=i*length/panelCount,lane=side*(rail+2.1),hue=i*.11+(side<0?.33:0);
      this.record('architecture',s,lane,1.55,.8,3.1,1.65,hue,{family:'panelPost',index:i});
      for(let row=0;row<3;row++)this.record('panels',s,lane-side*.43,.7+row*.85,.12,.53,1.35,hue+row*.04,{index:i});
    }
    for(let i=0;i<Math.ceil(length/26);i++)for(const side of [-1,1])this.record('pools',i*26,side*(rail+1.7),.075,8,6,1,i*.13,{planar:true,index:i});
    for(let i=0;i<Math.ceil(length/72);i++){
      const side=i%2?1:-1;this.record('beams',i*72+36,side*(rail+13),.8,1,1,1,i*.19,{flat:true,index:i});
    }
    // Readable city silhouettes and neon facade ribs, all beyond the rail.
    for(let i=0;i<Math.ceil(length/38);i++){
      const side=i%2?1:-1,s=i*38+10,lane=side*(rail+23+(i%3)*9),height=14+(Math.sin(i*17)*.5+.5)*26,hue=i*.27;
      const options={flat:true,family:'city',index:i};
      this.record('architecture',s,lane,height/2,7,height,9,hue,options);
      for(const x of [-3.52,3.52])this.record('facades',s,lane+x,height/2,.16,height,9.05,hue,options);
      this.record('facades',s,lane,height,7.2,.23,9.2,hue,options);
      for(let row=1;row<=4;row++)this.record('facades',s,lane-side*3.55,row*height/5,.13,.2,7,hue+row*.04,options);
    }
    // A stationary Ferris wheel is a landmark even with animation disabled.
    const s=96,centre=-rail-35,y=26,options={flat:true,family:'landmark'};
    this.record('wheel',s,centre,y,1,1,1,.52,options);
    for(const x of [-7,7])this.bar('architecture',s,centre+x,0,centre,y,.7,1,.6,options);
    for(let i=0;i<16;i++){
      const a=i/16*Math.PI*2,x=centre+Math.cos(a)*18,h=y+Math.sin(a)*18;
      this.bar('facades',s,centre,y,x,h,.11,.12,i/16,options);
      this.record('panels',s,x,h,1.65,1.6,1.2,i/16,options);
    }
  }
  update(time,playerS,reduced=false,quality={particles:36}){
    if(!this.enabled||this.disposed)return;
    time=finite(time,this.lastTime??0);playerS=mod(finite(playerS),this.track.length);this.playerS=playerS;
    const dt=this.lastTime===null?0:clamp(time-this.lastTime,0,.1);this.lastTime=time;this.reduced=!!reduced;
    if(!reduced)this.phase=mod(this.phase+dt*.5,Math.PI*2);
    const particles=finite(quality?.particles,36),level=particles<=18?0:particles<=36?1:particles<=64?2:3;
    this.level=level;const stride=[3,2,1,1][level],panelStride=[4,2,1,1][level],ahead=[240,300,360,420][level];
    const gates=new Set();let landmark=false;
    for(const [name,b] of this.batches){
      const active=b.active;active.length=0;
      for(const r of b.records){
        const distance=shortDistance(r.s,playerS,this.track.length);
        if(distance< -75||distance>(r.family==='landmark'?520:ahead))continue;
        if(r.family==='arch'&&r.index%stride||r.family==='panelPost'&&r.index%panelStride||r.family==='panels'&&r.index%panelStride||r.family==='edges'&&r.index%stride||r.family==='city'&&r.index%(level===0?3:1)||r.family==='pools'&&r.index%stride)continue;
        if(name==='halos'&&level<2||name==='beams'&&(level===0||distance< -10||active.length>=level*2))continue;
        const index=active.length;active.push(r);
        if(name==='beams'){
          r.matrix.decompose(this.dummy.position,this.dummy.quaternion,this.dummy.scale);
          this.dummy.rotation.set(.06*Math.sin(this.phase+r.index),r.yaw,(r.lane>0?-1:1)*(.2+.08*Math.sin(this.phase*.7+r.index)),'YXZ');this.dummy.updateMatrix();b.mesh.setMatrixAt(index,this.dummy.matrix);
        }else b.mesh.setMatrixAt(index,r.matrix);
        const chase=name==='edges'?.63+.37*Math.sin(r.s*.34-this.phase*9):1;
        this.tint.setHSL(mod(r.hue+this.phase*.025,1),.8,.64).multiplyScalar(chase);b.mesh.setColorAt(index,this.tint);
        if(name==='arches')gates.add(r.gate);if(r.family==='landmark')landmark=true;
      }
      b.mesh.count=active.length;b.mesh.instanceMatrix.needsUpdate=true;b.mesh.instanceColor.needsUpdate=true;
    }
    for(let i=0;i<this.localLights.length;i++){
      const p=this.track.sample(playerS+16+i*28,(i?1:-1)*(GUARDRAIL_OFFSET+1.8)),light=this.localLights[i];
      light.position.set(p.x,p.y+3.6,p.z);light.color.setHSL(mod(.56+i*.28+this.phase*.025,1),.6,.7);
    }
    this.counts={arches:gates.size,panels:this.batches.get('panels').mesh.count,beams:this.batches.get('beams').mesh.count,edgeLights:this.batches.get('edges').mesh.count,groundPools:this.batches.get('pools').mesh.count,landmark,drawCalls:[...this.batches.values()].filter(b=>b.mesh.count>0).length,localLights:this.localLights.length};
  }
  get diagnostics(){return {active:this.enabled&&!this.disposed,...this.counts,phase:this.phase,reducedMotion:this.reduced,level:this.level??0};}
  releaseGPU(){
    if(this.disposed)return;
    for(const b of this.batches.values()){b.mesh.dispose();b.mesh.instanceMatrix.needsUpdate=true;b.mesh.instanceColor.needsUpdate=true;}
    for(const g of this.geometries)g.dispose();for(const m of this.materials){m.dispose();m.needsUpdate=true;}
  }
  dispose(){
    if(this.disposed)return;this.releaseGPU();this.disposed=true;this.enabled=false;
    this.group.removeFromParent();this.group.clear();for(const b of this.batches.values())b.mesh.count=0;
    this.counts={arches:0,panels:0,beams:0,edgeLights:0,groundPools:0,landmark:false,drawCalls:0,localLights:0};
  }
}
