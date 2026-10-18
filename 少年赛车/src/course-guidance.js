import * as THREE from '/vendor/three.module.js';
import {clamp,ROAD_HALF,shortDistance,CARS} from './tracks.js';
import {GUARDRAIL_OFFSET,brakingCue,recommendedCornerSpeed} from './driving.js';

// Readable, physical course cues. These meshes never modify the player's input.
// Gate segments and arrow cards are HDR-bright so the finishing bloom pass can
// make the next checkpoint readable from a distance without extra light sources.
// Checkpoint labels and every turn board share two small atlases: one merged draw
// for all boards and one shared material for labels instead of a texture per sign.
function labelAtlas(){
  if(labelAtlas.map)return labelAtlas.map;
  const c=document.createElement('canvas');c.width=2048;c.height=256;const ctx=c.getContext('2d');
  ctx.clearRect(0,0,2048,256);
  for(let i=0;i<8;i++){
    const x=(i%4)*512,y=Math.floor(i/4)*128;
    ctx.fillStyle='#0e1c22e6';ctx.fillRect(x,y,512,128);
    for(let n=0;n<16;n++){ctx.fillStyle=n%2?'#d5ddd4':'#1d2a2d';ctx.fillRect(x+n*32,y,32,11);ctx.fillStyle=n%2?'#1d2a2d':'#d5ddd4';ctx.fillRect(x+n*32,y+117,32,11);}
    ctx.fillStyle='#bff4e7';ctx.font='700 42px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(i===0?'START / FINISH':`CHECKPOINT ${i+1}`,x+256,y+66);
  }
  const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;labelAtlas.map=texture;return texture;
}
function turnAtlas(){
  if(turnAtlas.map)return turnAtlas.map;
  const c=document.createElement('canvas');c.width=512;c.height=512;const ctx=c.getContext('2d');
  for(let i=0;i<4;i++){
    const left=i<2,distance=i%2?30:60,x=(i%2)*256,y=Math.floor(i/2)*256;
    ctx.fillStyle='#0f1b20';ctx.fillRect(x,y,256,256);ctx.fillStyle='#e8ddc4';ctx.fillRect(x+8,y+8,240,240);
    ctx.fillStyle='#132126';ctx.fillRect(x+14,y+14,228,228);
    ctx.fillStyle='#f4e9ce';ctx.textAlign='center';ctx.font='900 92px system-ui';ctx.fillText(left?'‹':'›',x+128,y+110);
    ctx.font='700 44px ui-monospace,monospace';ctx.fillText(`${distance}m`,x+128,y+178);
  }
  const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;turnAtlas.map=texture;return texture;
}
function applyAtlasUv(geometry,col,row,cols,rows){
  const uv=geometry.attributes.uv;
  for(let i=0;i<uv.count;i++){
    const u=uv.getX(i),v=uv.getY(i);
    uv.setXY(i,(col+u)/cols,((rows-1-row)+v)/rows);
  }
  uv.needsUpdate=true;return geometry;
}
// Fixed shader keeps the merged sign meshes readable without lights.
function mergeSignMeshes(group){
  group.updateMatrixWorld(true);const batches=new Map();
  for(const mesh of [...group.children]){
    if(!mesh.isMesh)continue;
    const geo=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry.clone();
    geo.applyMatrix4(mesh.matrix);const list=batches.get(mesh.material)||[];list.push(geo);batches.set(mesh.material,list);
    group.remove(mesh);mesh.geometry.dispose();
  }
  for(const [material,list] of batches){
    const geo=new THREE.BufferGeometry();
    for(const key of ['position','normal','uv']){
      if(!list.every(g=>g.getAttribute(key)))continue;
      const size=list[0].getAttribute(key).itemSize,total=list.reduce((n,g)=>n+g.getAttribute(key).array.length,0),values=new Float32Array(total);
      let cursor=0;for(const g of list){values.set(g.getAttribute(key).array,cursor);cursor+=g.getAttribute(key).array.length;}
      geo.setAttribute(key,new THREE.BufferAttribute(values,size));
    }
    list.forEach(g=>g.dispose());geo.computeBoundingSphere();group.add(new THREE.Mesh(geo,material));
  }
}

export class CourseGuidance {
  constructor(track,checkpoints=[]){
    this.track=track;this.group=new THREE.Group();this.group.name='race-checkpoints-and-braking-cues';this.checkpoints=checkpoints;this.labels=[];
    const material=new THREE.MeshBasicMaterial({color:'#ffffff',toneMapped:false}),box=new THREE.BoxGeometry(1,1,1);
    this.gates=new THREE.InstancedMesh(box,material,Math.max(1,checkpoints.length*5));this.gates.frustumCulled=false;this.group.add(this.gates);
    this.dummy=new THREE.Object3D();this.safe=new THREE.Color('#5fd7c1');this.warning=new THREE.Color('#ffab6d');this.idle=new THREE.Color('#3d5560');
    const labelsMaterial=new THREE.MeshBasicMaterial({map:labelAtlas(),side:THREE.DoubleSide,transparent:true,depthWrite:false,toneMapped:false});
    labelsMaterial.color.setScalar(1.08);
    for(let i=0;i<checkpoints.length;i++){
      const p=track.sample(checkpoints[i].s),span=GUARDRAIL_OFFSET+1;
      const segments=[
        // posts, overhead beam, then two inner light strips that frame the gate.
        {x:-span,y:2.9,sx:.18,sy:5.8,sz:.2},{x:span,y:2.9,sx:.18,sy:5.8,sz:.2},
        {x:0,y:5.8,sx:span*2,sy:.2,sz:.22},
        {x:-span+.42,y:2.9,sx:.07,sy:4.9,sz:.26},{x:span-.42,y:2.9,sx:.07,sy:4.9,sz:.26},
      ];
      for(let k=0;k<segments.length;k++){
        const seg=segments[k];this.dummy.position.set(p.x+p.nx*seg.x,p.y+seg.y,p.z+p.nz*seg.x);this.dummy.rotation.set(0,p.yaw,0);this.dummy.scale.set(seg.sx,seg.sy,seg.sz);this.dummy.updateMatrix();this.gates.setMatrixAt(i*5+k,this.dummy.matrix);this.gates.setColorAt(i*5+k,this.idle);
      }
      const geometry=applyAtlasUv(new THREE.PlaneGeometry(5.6,1.05),i%4,Math.floor(i/4),4,2);
      const label=new THREE.Mesh(geometry,labelsMaterial);label.position.set(p.x,p.y+6.35,p.z);label.rotation.y=p.yaw+Math.PI;this.labels.push(label);this.group.add(label);
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-.42,0,-.35,.42,0,-.35,0,0,.52],3));geometry.computeVertexNormals();
    this.line=new THREE.InstancedMesh(geometry,new THREE.MeshBasicMaterial({color:'#ffffff',transparent:true,opacity:.8,side:THREE.DoubleSide,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,toneMapped:false}),18);this.line.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.line.frustumCulled=false;this.group.add(this.line);
    this.buildTurnBoards();
  }
  buildTurnBoards(){
    const t=this.track,peaks=[];
    for(let s=40;s<t.length;s+=8){const curvature=t.curvature(s);if(Math.abs(curvature)>.009&&Math.abs(curvature)>=Math.abs(t.curvature(s-14))&&Math.abs(curvature)>=Math.abs(t.curvature(s+14))&&peaks.every(p=>Math.abs(shortDistance(s,p.s,t.length))>65))peaks.push({s,curvature});}
    const boardMaterial=new THREE.MeshBasicMaterial({map:turnAtlas(),side:THREE.DoubleSide,toneMapped:false});
    const boards=new THREE.Group();
    for(const peak of peaks.slice(0,18))for(const distance of [60,30]){
      const p=t.sample(peak.s-distance,peak.curvature>0?-ROAD_HALF-3:ROAD_HALF+3);
      const col=peak.curvature>0?0:1,row=distance===60?0:1;
      const board=new THREE.Mesh(applyAtlasUv(new THREE.PlaneGeometry(1.55,1.16),col,row,2,2),boardMaterial);
      board.position.set(p.x,p.y+2,p.z);board.rotation.y=p.yaw+Math.PI;boards.add(board);
    }
    mergeSignMeshes(boards);this.group.add(boards);
  }
  update(race,me){
    const t=this.track,grip=(CARS.find(c=>c.id===me.car)||CARS[0]).grip*(me.offRoad?.52:1),pulse=1.3+Math.sin((race.time||0)*5.2)*.25;
    for(let i=0;i<this.checkpoints.length;i++){
      const next=i===me.nextCheckpoint;
      for(let k=0;k<5;k++)this.gates.setColorAt(i*5+k,next?this._scaled(this.safe,pulse):this.idle);
      this.labels[i].visible=Math.abs(shortDistance(this.checkpoints[i].s,me.s,t.length))<190;
    }
    if(this.gates.instanceColor)this.gates.instanceColor.needsUpdate=true;
    this.line.visible=race.status!=='finished';
    for(let i=0;i<18;i++){
      const s=me.s+8+i*7,curve=t.curvature(s+10),p=t.sample(s,clamp(-curve*100,-2.8,2.8)),safeSpeed=recommendedCornerSpeed(curve,grip),cue=brakingCue(me.v,safeSpeed,8+i*7,grip,t.slope(s));
      this.dummy.position.set(p.x,p.y+.075,p.z);this.dummy.rotation.set(-Math.atan(t.slope(s)),p.yaw,0,'YXZ');this.dummy.scale.setScalar(i<3?.85:1.05);this.dummy.updateMatrix();this.line.setMatrixAt(i,this.dummy.matrix);
      this.line.setColorAt(i,cue.brakeNow?this._scaled(this.warning,2.4):this._scaled(this.safe,1.5));
    }
    this.line.instanceMatrix.needsUpdate=true;this.line.instanceColor.needsUpdate=true;
  }
  _scaled(color,scale){return (this._color||(this._color=new THREE.Color())).copy(color).multiplyScalar(scale);}
}
