import { WORLD, getMap } from './maps.js';

export const NAVIGATION = Object.freeze({cellSize:2,gridSize:25,radius:.48,nodeClearance:.55,maxFieldsPerMap:64});
const SIZE=NAVIGATION.gridSize,COUNT=SIZE*SIZE,STEP=NAVIGATION.cellSize;
const caches=new Map();
const cellIndex=(x,z)=>Math.max(0,Math.min(SIZE-1,Math.floor((z+WORLD)/STEP)))*SIZE+Math.max(0,Math.min(SIZE-1,Math.floor((x+WORLD)/STEP)));
const point=i=>({x:(i%SIZE)*STEP-WORLD+STEP/2,z:Math.floor(i/SIZE)*STEP-WORLD+STEP/2});

function walkable(p,map,radius=NAVIGATION.radius){
  return Number.isFinite(p.x)&&Number.isFinite(p.z)&&Math.abs(p.x)<=WORLD-radius&&Math.abs(p.z)<=WORLD-radius&&!map.obstacles.some(o=>Math.abs(p.x-o.x)<o.w/2+radius&&Math.abs(p.z-o.z)<o.d/2+radius);
}

// A ground sweep uses the actor's full radius, regardless of obstacle height.
// Seeing over a low crate is not permission to walk through it.
export function groundClear(a,b,mapId='blocks',radius=NAVIGATION.radius){
  return clearSegment(a,b,getMap(mapId),radius);
}
function clearSegment(a,b,map,radius){
  if(!walkable(a,map,radius)||!walkable(b,map,radius))return false;
  const dx=b.x-a.x,dz=b.z-a.z;
  for(const o of map.obstacles){
    const minX=o.x-o.w/2-radius,maxX=o.x+o.w/2+radius,minZ=o.z-o.d/2-radius,maxZ=o.z+o.d/2+radius;
    let near=0,far=1;
    if(Math.abs(dx)<1e-10){if(a.x<minX||a.x>maxX)continue;}
    else{const p=(minX-a.x)/dx,q=(maxX-a.x)/dx;near=Math.max(near,Math.min(p,q));far=Math.min(far,Math.max(p,q));}
    if(near>far)continue;
    if(Math.abs(dz)<1e-10){if(a.z<minZ||a.z>maxZ)continue;}
    else{const p=(minZ-a.z)/dz,q=(maxZ-a.z)/dz;near=Math.max(near,Math.min(p,q));far=Math.min(far,Math.max(p,q));}
    if(near<=far)return false;
  }
  return true;
}

function graphFor(mapId){
  const map=getMap(mapId);let graph=caches.get(map.id);
  if(graph?.map===map)return graph;
  const points=Array.from({length:COUNT},(_,i)=>point(i));
  const walk=Uint8Array.from(points,p=>Number(walkable(p,map,NAVIGATION.nodeClearance)));
  const neighbors=Array.from({length:COUNT},()=>[]);
  for(let i=0;i<COUNT;i++)if(walk[i]){
    const x=i%SIZE,z=Math.floor(i/SIZE);
    // Insert each undirected edge once, in both directions.
    for(const next of [x+1<SIZE?i+1:-1,z+1<SIZE?i+SIZE:-1])if(next>=0&&walk[next]&&clearSegment(points[i],points[next],map,NAVIGATION.nodeClearance)){
      neighbors[i].push(next);neighbors[next].push(i);
    }
  }
  const components=new Int16Array(COUNT).fill(-1);let component=0;
  for(let start=0;start<COUNT;start++)if(walk[start]&&components[start]<0){
    const queue=[start];components[start]=component;
    for(let head=0;head<queue.length;head++)for(const next of neighbors[queue[head]])if(components[next]<0){components[next]=component;queue.push(next);}
    component++;
  }
  graph={map,points,walk,neighbors,components,fields:new Map(),stats:{requests:0,hits:0,builds:0,evictions:0,expanded:0}};
  caches.set(map.id,graph);return graph;
}

function attach(position,graph){
  if(!walkable(position,graph.map))return -1;
  const home=cellIndex(position.x,position.z);
  if(graph.walk[home]&&clearSegment(position,graph.points[home],graph.map,NAVIGATION.radius))return home;
  // A legal world position may quantize to a blocked cell. Project only through
  // clear ground segments, never to a node on the other side of a wall.
  const hx=home%SIZE,hz=Math.floor(home/SIZE);let best=-1,bestDistance=Infinity;
  const consider=i=>{
    if(!graph.walk[i])return;const p=graph.points[i],d=(p.x-position.x)**2+(p.z-position.z)**2;
    if(d<bestDistance&&clearSegment(position,p,graph.map,NAVIGATION.radius)){best=i;bestDistance=d;}
  };
  for(let z=Math.max(0,hz-3);z<=Math.min(SIZE-1,hz+3);z++)for(let x=Math.max(0,hx-3);x<=Math.min(SIZE-1,hx+3);x++)consider(z*SIZE+x);
  if(best<0)for(let i=0;i<COUNT;i++)consider(i);
  return best;
}

function fieldFor(graph,goal){
  const {fields,stats}=graph;stats.requests++;
  if(fields.has(goal)){
    const field=fields.get(goal);fields.delete(goal);fields.set(goal,field);stats.hits++;return field;
  }
  const distance=new Int16Array(COUNT).fill(-1),next=new Int16Array(COUNT).fill(-1),queue=new Uint16Array(COUNT);
  let head=0,tail=1;queue[0]=goal;distance[goal]=0;next[goal]=goal;
  while(head<tail){const current=queue[head++];for(const neighbor of graph.neighbors[current])if(distance[neighbor]<0){
    distance[neighbor]=distance[current]+1;next[neighbor]=current;queue[tail++]=neighbor;
  }}
  const field={distance,next};stats.builds++;stats.expanded+=tail;
  if(fields.size>=NAVIGATION.maxFieldsPerMap){fields.delete(fields.keys().next().value);stats.evictions++;}
  fields.set(goal,field);return field;
}

export function navigationGoal(target,mapId='blocks'){return attach(target,graphFor(mapId));}

export function findPath(start,target,mapId='blocks'){
  const graph=graphFor(mapId),from=attach(start,graph),goal=attach(target,graph);
  if(from<0||goal<0||graph.components[from]!==graph.components[goal])return [];
  const field=fieldFor(graph,goal);if(field.distance[from]<0)return [];
  const path=[];let current=from;
  if(Math.hypot(start.x-graph.points[from].x,start.z-graph.points[from].z)>.001)path.push({...graph.points[from]});
  while(current!==goal){current=field.next[current];path.push({...graph.points[current]});}
  // The caller owns these points; advancing one bot cannot mutate a shared field.
  return path;
}

// No actor ids, room state or mutable route arrays are retained in the cache.
// Static map identity + destination node fully specifies the field.
export function navigationStats(){
  const maps=[...caches.values()].map(g=>({map:g.map.id,...g.stats,fields:g.fields.size,maxFields:NAVIGATION.maxFieldsPerMap,cacheBytes:g.fields.size*COUNT*Int16Array.BYTES_PER_ELEMENT*2,walkableNodes:g.walk.reduce((a,b)=>a+b,0)}));
  return {maps,requests:maps.reduce((s,m)=>s+m.requests,0),hits:maps.reduce((s,m)=>s+m.hits,0),builds:maps.reduce((s,m)=>s+m.builds,0),cacheBytes:maps.reduce((s,m)=>s+m.cacheBytes,0)};
}
export function clearNavigationCache(){caches.clear();}
