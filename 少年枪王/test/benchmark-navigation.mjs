// Optional benchmark: compare identical workloads against a source snapshot.
// SIMULATION_MODULE=/absolute/path/simulation.js node test/benchmark-navigation.mjs
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
const source=process.env.SIMULATION_MODULE?pathToFileURL(process.env.SIMULATION_MODULE).href:new URL('../src/simulation.js',import.meta.url).href;
const sim=await import(source);
let nav=null;try{nav=await import(new URL('./navigation.js',source));}catch{}
const median=a=>a.sort((a,b)=>a-b)[Math.floor(a.length/2)];
const result={runtime:process.version,source,pathQueries:[],matches:[]};
for(const map of Object.keys(sim.MAPS)){
  const starts=[];for(let z=-22;z<=22;z+=2)for(let x=-22;x<=22;x+=2)if(!sim.blocked(x,z,.65,map))starts.push({x,z});
  const target={x:0,z:-22},repeats=1200,samples=[];
  for(let round=0;round<5;round++){
    nav?.clearNavigationCache();const start=performance.now();let length=0;
    for(let i=0;i<repeats;i++)length+=sim.findPath(starts[i%starts.length],target,map).length;
    samples.push(performance.now()-start);if(!length)throw Error('No routes produced');
  }
  result.pathQueries.push({map,queries:repeats,medianMs:+median(samples).toFixed(2),cache:nav?.navigationStats()||null});
  const timings=[];let last;
  for(let round=0;round<4;round++){
    let seed=73;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
    const bots=()=>Array.from({length:24},(_,i)=>({difficulty:i%2?'hard':'easy',weapon:'random'}));
    nav?.clearNavigationCache();const match=new sim.Match({map,duration:180,target:100,bots:{blue:bots(),red:bots()}},[{id:'p1',team:'blue',weapon:'blaster'},{id:'p2',team:'red',weapon:'blaster'}],random);
    const start=performance.now();let shots=0;
    for(let i=0;i<600;i++){match.step(1/60);for(const e of match.drainEvents())if(e.type==='shot')shots++;}
    const elapsed=performance.now()-start;if(round)timings.push(elapsed);last={shots,cache:nav?.navigationStats()||null};
    if(!match.actors.every(a=>Number.isFinite(a.x)&&!sim.blocked(a.x,a.z,.46,map)))throw Error('Invalid actor position');
  }
  const ms=median(timings);result.matches.push({map,actors:50,simulatedSeconds:10,medianMs:+ms.toFixed(2),msPerStep:+(ms/600).toFixed(3),...last});
}
console.log(JSON.stringify(result,null,2));
