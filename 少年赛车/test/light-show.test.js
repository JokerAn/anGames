import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {readFile} from 'node:fs/promises';
import {getTrack} from '../src/tracks.js';
import {GUARDRAIL_OFFSET} from '../src/driving.js';
const lighting=await import('../src/light-show.js').catch(()=>({}));
const high={particles:96,detail:true},low={particles:18,detail:false};
function show(id='arcade',quality=high){assert.equal(typeof lighting.TrackLightShow,'function','TrackLightShow is available');return new lighting.TrackLightShow(getTrack(id),THREE,quality);}
function arrays(s){return [...s.batches.values()].map(b=>({matrix:Array.from(b.mesh.instanceMatrix.array),color:Array.from(b.mesh.instanceColor.array),count:b.mesh.count}));}
function lights(s){const result=[];s.group.traverse(o=>{if(o.isLight)result.push(o);});return result;}

test('configured arcade and neon show real batches while daytime courses stay unmodified',()=>{
  for(const id of ['arcade','neon','coast','canyon']){
    const s=show(id);s.update(0,0,false,high);
    assert.equal(s.diagnostics.active,['arcade','neon'].includes(id));
    if(s.diagnostics.active){assert.ok(s.diagnostics.arches>=3);assert.ok(s.diagnostics.panels>10);assert.ok(s.diagnostics.groundPools>0);assert.ok(s.diagnostics.landmark);assert.ok(s.diagnostics.drawCalls>0&&s.diagnostics.drawCalls<25);}
    else{assert.equal(s.group.children.length,0);assert.equal(s.diagnostics.drawCalls,0);}
    s.dispose();
  }
});
test('arcade track geometry and the night flag drive lighting independently of the old neon id',()=>{
  assert.equal(typeof lighting.isNightTrack,'function');assert.equal(lighting.isNightTrack(getTrack('arcade')),true);assert.equal(lighting.isNightTrack(getTrack('neon')),true);assert.equal(lighting.isNightTrack(getTrack('coast')),false);assert.equal(lighting.isNightTrack({id:'other',night:true}),true);
  assert.deepEqual(getTrack('arcade').radius,[205,118]);
});
test('all physical light-show structures clear the guardrails or cross at least six metres above the road',()=>{
  const s=show(),batch=s.batches.get('architecture');assert.ok(batch.records.length>0);
  for(const record of batch.records){
    const p=s.track.sample(record.s);
    for(const x of [-.5,.5])for(const y of [-.5,.5])for(const z of [-.5,.5]){
      const v=new THREE.Vector3(x,y,z).applyMatrix4(record.matrix),lane=(v.x-p.x)*p.nx+(v.z-p.z)*p.nz;
      if(Math.abs(lane)<=GUARDRAIL_OFFSET)assert.ok(v.y-p.y>=6,`structure intersects road: lane ${lane}, height ${v.y-p.y}`);
    }
  }
  s.dispose();
});
test('instanced LED colours and transparent light geometry use bounded shared resources and upload updates',()=>{
  const s=show();s.update(0,0,false,high);
  const geometry=new Set(),materials=new Set();s.group.traverse(o=>{if(o.isMesh){assert.equal(o.castShadow,false);geometry.add(o.geometry);materials.add(o.material);assert.ok(o.isInstancedMesh);assert.ok(o.instanceColor?.version>0);assert.ok(o.instanceMatrix.version>0);}});
  assert.ok(geometry.size<=5);assert.ok(materials.size<=6);
  for(const name of ['halos','beams','pools']){const m=s.batches.get(name).mesh.material;assert.equal(m.transparent,true);assert.equal(m.depthWrite,false);assert.equal(m.blending,THREE.AdditiveBlending);assert.equal(m.forceSinglePass,true);}
  assert.ok(lights(s).length>=2&&lights(s).length<=3);assert.ok(lights(s).every(l=>!l.castShadow));s.dispose();
});
test('low quality reduces density and scanning beams while keeping readable static lights and the same buffers',()=>{
  const s=show();s.update(0,100,false,high);const before=s.diagnostics,refs=[...s.batches.values()].map(b=>[b.mesh.instanceMatrix.array,b.mesh.instanceColor.array]);
  s.update(.016,100,false,low);const after=s.diagnostics;
  assert.ok(after.panels<before.panels);assert.ok(after.edgeLights<before.edgeLights);assert.equal(after.beams,0);assert.ok(after.arches>0);assert.ok(after.localLights>=2);assert.ok(after.drawCalls<25);
  [...s.batches.values()].forEach((b,i)=>{assert.equal(b.mesh.instanceMatrix.array,refs[i][0]);assert.equal(b.mesh.instanceColor.array,refs[i][1]);});s.dispose();
});
test('reduced motion freezes chase colours and scan matrices but retains static RGB lighting',()=>{
  const s=show();s.update(0,100,false,high);s.update(.1,100,false,high);s.update(.2,100,true,high);const before=arrays(s),phase=s.diagnostics.phase;
  for(const t of [1,8,100])s.update(t,100,true,high);
  assert.equal(s.diagnostics.phase,phase);assert.deepEqual(arrays(s),before);assert.ok(s.diagnostics.panels>0);assert.ok(s.diagnostics.arches>0);
  s.update(100.016,100,false,high);assert.ok(s.diagnostics.phase>phase);assert.ok(s.diagnostics.phase-phase<.1);assert.notDeepEqual(arrays(s),before);s.dispose();
});
test('light-show motion is deterministic and settles equally at 30/60/120Hz',()=>{
  const frames=[];
  for(const hz of [30,60,120]){const s=show();s.update(0,50,false,high);for(let i=1;i<=hz;i++)s.update(i/hz,50,false,high);frames.push(s.diagnostics.phase);s.dispose();}
  assert.ok(Math.max(...frames)-Math.min(...frames)<1e-9);
});
test('lap wrapping and invalid update inputs keep all light positions finite',()=>{
  const s=show();s.update(0,30,false,high);const before=arrays(s);s.update(0,30+s.track.length,false,high);assert.deepEqual(arrays(s),before);
  s.update(NaN,Infinity,false,low);for(const light of lights(s))assert.ok([light.position.x,light.position.y,light.position.z].every(Number.isFinite));assert.ok(Number.isFinite(s.diagnostics.phase));s.dispose();
});
test('context resource release preserves CPU state and rebuildable attributes; disposal is complete and idempotent',()=>{
  const s=show();s.update(0,30,false,high);const before=arrays(s),resources=new Set();s.group.traverse(o=>{if(o.isMesh){resources.add(o.geometry);resources.add(o.material);}});
  const calls=new Map([...resources].map(r=>[r,0]));for(const r of resources)r.addEventListener('dispose',()=>calls.set(r,calls.get(r)+1));
  s.releaseGPU();assert.ok([...calls.values()].every(n=>n===1));s.update(.016,30,true,high);assert.deepEqual(arrays(s),before);assert.ok(s.diagnostics.active);
  const root=new THREE.Scene();root.add(s.group);s.dispose();assert.ok([...calls.values()].every(n=>n===2));assert.equal(s.group.parent,null);assert.equal(s.diagnostics.active,false);assert.equal(s.diagnostics.drawCalls,0);
  s.dispose();s.update(1,40,false,high);assert.ok([...calls.values()].every(n=>n===2));
});

const loaded=new Map();
async function moduleUrl(name){
  if(loaded.has(name))return loaded.get(name);
  let source=await readFile(new URL(`../src/${name}`,import.meta.url),'utf8');
  for(const match of [...source.matchAll(/from '([^']+)'/g)]){
    const spec=match[1];let url;
    if(spec==='/vendor/three.module.js')url=import.meta.resolve('three');
    else if(['./effects.js','./course-guidance.js'].includes(spec))url=await moduleUrl(spec.slice(2));
    else url=new URL(spec,new URL(`../src/${name}`,import.meta.url)).href;
    source=source.replace(`from '${spec}'`,`from '${url}'`);
  }
  const url=`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;loaded.set(name,url);return url;
}
const {RaceEffects}=await import(await moduleUrl('effects.js'));
const {RaceRenderer}=await import(await moduleUrl('renderer.js'));
function withCanvas(fn){
  const previous=globalThis.document;globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>({createRadialGradient:()=>({addColorStop(){}}),fillRect(){},fillText(){}})})};
  try{return fn();}finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
}
test('rocket and frost feedback carry distinct colours, hit origin and full no-target guards',()=>{
  const effects=withCanvas(()=>new RaceEffects()),car=new THREE.Group();
  try{
    effects.itemEvent({type:'item',item:'rocket',used:true},car,36);effects.itemEvent({type:'hit',source:'frost',attacker:'opponent'},car,36);effects.update(.016,new THREE.PerspectiveCamera(),36);
    const colours=[new THREE.Color(),new THREE.Color()];effects.rings.getColorAt(0,colours[0]);effects.rings.getColorAt(1,colours[1]);assert.ok(colours[0].r>colours[0].b,'rocket orange/red');assert.ok(colours[1].b>colours[1].r&&colours[1].g>colours[1].r,'frost blue/white');
    assert.equal(effects.diagnostics.activeItemVFX[1].item,'frost');assert.equal(effects.diagnostics.activeItemVFX[1].attacker,'opponent');
    const pool=structuredClone(effects.itemPool);effects.itemEvent({type:'item',item:'frost',used:false,reason:'no-target'},car,36);assert.deepEqual(structuredClone(effects.itemPool),pool);
  }finally{effects.releaseGPU();}
});
test('directed rocket/frost pickups have distinct marks and random boxes retain their question mark',()=>{
  const renderer=Object.create(RaceRenderer.prototype);renderer.world=new THREE.Scene();renderer.items=[];
  const t=getTrack('arcade'),objects=[...t.objects.filter(o=>o.type==='box').slice(0,2),{id:'random-test',type:'box',s:250,x:0}];
  withCanvas(()=>renderer.buildItems({...t,objects},'arcade'));
  assert.equal(renderer.items.length,3);assert.deepEqual(renderer.items.map(i=>i.group.userData.itemKind),['rocket','frost','random']);assert.deepEqual(renderer.items.map(i=>i.group.userData.pickupLabel),['»','❄','?']);
  renderer.disposePrivate(renderer.world);
});
test('disposing a renderer world also disposes its owned show without touching a replacement scene',()=>{
  const renderer=Object.create(RaceRenderer.prototype),s=show();renderer.world=new THREE.Scene();renderer.lightShow=s;renderer.world.add(s.group);renderer.disposePrivate(renderer.world);assert.equal(s.diagnostics.active,false);assert.equal(s.group.parent,null);
});
