import test from 'node:test';
import assert from 'node:assert/strict';
import {Match,WEAPONS,MAX_HP,defaultConfig,aimAngles,cameraPose,viewDirection,traceRay,sanitizeInput} from '../src/simulation.js';
const seeded=initial=>{let seed=initial;return ()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};};
function duel(difficulty='easy',weapon='blaster'){
  const match=new Match({map:'blocks',duration:60,target:100,bots:{blue:[],red:[{difficulty,weapon}]}},[{id:'human',team:'blue',weapon:'blaster'}],seeded(73));
  const human=match.actors[0],bot=match.actors[1];Object.assign(human,{x:44,z:0,y:0,shield:0,hp:1000000});Object.assign(bot,{x:44,z:20,y:0,shield:0,yaw:0,cooldown:0});return {match,human,bot};
}
test('enemy bots prioritize a real player over a closer bot firefight',()=>{
  const {match,human,bot}=duel();const ally=match.addActor({id:'friend',team:'blue',bot:true,difficulty:'easy',weapon:'blaster'});Object.assign(ally,{x:44,z:12,hp:100,shield:0});
  match.ai(bot,1/60);assert.equal(bot.targetId,human.id);
});
test('taking a hit records its source and triggers retaliation',()=>{
  const {match,human,bot}=duel();match.addHuman({id:'near',team:'blue',weapon:'blaster'});const second=match.actors.find(a=>a.id==='near');Object.assign(second,{x:44,z:8,shield:0});
  Object.assign(human,aimAngles(human,{x:bot.x,y:1.12,z:bot.z}));match.shoot(human,false);assert.equal(bot.lastAttacker,human.id);bot.thinkTime=0;match.ai(bot,1/60);assert.equal(bot.targetId,human.id);
});
test('both AI difficulties can actually damage a real player with all four weapons',()=>{
  for(const difficulty of ['easy','hard'])for(const weapon of Object.keys(WEAPONS)){
    const {match,human}=duel(difficulty,weapon);let hits=0;
    for(let i=0;i<720;i++){match.step(1/60);hits+=match.drainEvents().filter(e=>e.type==='hit'&&e.target===human.id).length;}
    assert.ok(hits>0,`${difficulty}/${weapon} never hit the player`);assert.ok(human.hp<1000000);
  }
});
test('AI respects turning and reaction time instead of shooting backward immediately',()=>{
  const {match,bot}=duel('hard');bot.yaw=Math.PI;
  const input=match.ai(bot,1/60);assert.equal(input.fire,false);assert.ok(Math.abs(input.yaw-bot.yaw)<.11);assert.ok(bot.fireReadyAt>match.time);
});
test('AI cannot fire through cover or damage protected players',()=>{
  const {match,human,bot}=duel('hard');Object.assign(bot,{x:0,z:16,yaw:0,targetId:human.id});Object.assign(human,{x:0,z:-16,hp:100,shield:0});match.shoot(bot,true);assert.equal(human.hp,100);
  Object.assign(bot,{x:44,z:16,yaw:0});Object.assign(human,{x:44,z:0,shield:2});for(let i=0;i<10;i++)match.shoot(bot,true);assert.equal(human.hp,100);
});
test('default easy enemies hit an idle real player on every map across five fixed seeds',()=>{
  for(const map of ['blocks','harbor','desert'])for(const seed of [1,7,19,42,73]){
    const config=defaultConfig();config.map=map;config.target=100;const match=new Match(config,[{id:'human',team:'blue',weapon:'blaster'}],seeded(seed));let hit=false;
    // The arena is 4x larger, so an idle player is reached from farther away.
    for(let i=0;i<6000&&!hit;i++){match.step(1/60);hit=match.drainEvents().some(e=>e.type==='hit'&&e.target==='human');}
    assert.ok(hit,`${map} seed ${seed}: no human damage in 100 seconds`);
  }
});
test('reticle and muzzle stay aligned across phone portrait, landscape and desktop aspect ratios',()=>{
  for(const viewAspect of [.46,1,16/9,844/390])for(const aim of [false,true])for(const distance of [3,8,20]){
    const {match,human,bot}=duel();Object.assign(human,{x:44,z:40,viewAspect});Object.assign(bot,{x:44,z:40-distance,hp:MAX_HP});
    Object.assign(human,aimAngles(human,{x:bot.x,y:1.2,z:bot.z},aim));const camera=cameraPose(human,human.yaw,human.pitch,aim,'blocks');
    assert.equal(traceRay(camera,viewDirection(human.yaw,human.pitch),60,match.actors,human,'blocks').victim?.id,bot.id);
    match.random=()=>.5;match.shoot(human,aim);assert.equal(bot.hp,MAX_HP-44,`${viewAspect}/${aim}/${distance}`);
  }
  assert.equal(sanitizeInput({viewAspect:99}).viewAspect,3);assert.equal(sanitizeInput({viewAspect:-9}).viewAspect,.4);
});
