import { pathToFileURL } from 'node:url';
const source=process.env.SIMULATION_MODULE?pathToFileURL(process.env.SIMULATION_MODULE).href:new URL('../src/simulation.js',import.meta.url).href;
const {Match,defaultConfig}=await import(source);
const results=[];
for(const map of ['blocks','harbor','desert'])for(const difficulty of ['easy','hard']){
  const trials=[];
  for(const initial of [1,7,19,42,73]){
    let seed=initial;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
    const config=defaultConfig();config.map=map;config.target=100;config.bots.red=Array.from({length:4},()=>({difficulty,weapon:'random'}));
    const m=new Match(config,[{id:'human',team:'blue',name:'玩家',weapon:'blaster'}],random);let firstHit=null,hits=0,damage=0;
    for(let i=0;i<2700;i++){m.step(1/60);for(const e of m.drainEvents())if(e.type==='hit'&&e.target==='human'){firstHit??=+m.time.toFixed(2);hits++;damage+=e.damage;}}
    trials.push({seed:initial,firstHit,hits,damage:+damage.toFixed(1),deaths:m.actors[0].deaths});
  }
  results.push({map,difficulty,trials});
}
console.log(JSON.stringify({source,simulatedSeconds:45,results},null,2));
