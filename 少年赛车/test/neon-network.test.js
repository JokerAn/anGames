import test from 'node:test';
import assert from 'node:assert/strict';
import {WebSocket} from 'ws';
import {createGameServer} from '../server.js';
import {getTrack} from '../src/tracks.js';
import {syncVehiclePose} from '../src/driving.js';
import {earnRaceProgress} from './race-fixtures.js';
class Client{
 constructor(url){this.messages=[];this.ws=new WebSocket(url);this.ws.on('message',raw=>this.messages.push(JSON.parse(raw)));}
 send(value){this.ws.send(JSON.stringify(value));}
 async wait(type,predicate=()=>true){const end=Date.now()+4000;while(Date.now()<end){const i=this.messages.findIndex(m=>m.type===type&&predicate(m));if(i>=0)return this.messages.splice(i,1)[0];await new Promise(r=>setTimeout(r,10));}throw Error(`timed out: ${type}`);}
}
test('new course and rocket/frost effects use the same authoritative two-client room',{timeout:10000},async()=>{
 const app=createGameServer();await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const url=`ws://127.0.0.1:${app.server.address().port}`,clients=[];
 try{
  const connect=async()=>{const c=new Client(url);clients.push(c);c.id=(await c.wait('welcome')).id;return c;},a=await connect(),b=await connect();
  a.send({type:'join',room:'889911',track:'arcade',rules:'arcade',name:'A'});await a.wait('lobby');b.send({type:'join',room:'889911',name:'B'});
  const lobby=await b.wait('lobby');assert.equal(lobby.track,'arcade');assert.equal(lobby.rules,'arcade');a.send({type:'ready',ready:true});b.send({type:'ready',ready:true});await a.wait('lobby',m=>m.players.every(p=>p.ready));a.send({type:'start'});
  const startA=await a.wait('race'),startB=await b.wait('race');assert.equal(startA.state.trackId,'arcade');assert.deepEqual(startA.state,startB.state);
  const race=app.rooms.get('889911').race,track=getTrack('arcade'),me=race.racers.find(r=>r.id===a.id),other=race.racers.find(r=>r.id===b.id);race.time=10;race.racers.filter(r=>r.bot).forEach(r=>r.finishTime=0);
  earnRaceProgress(race,[[me,track.boostStraight.s+20],[other,track.boostStraight.s+45]]);
  for(const r of [me,other]){Object.assign(r,{v:30,x:-5,headingError:0});syncVehiclePose(r,track);}
  me.item='frost';a.send({type:'input',input:{throttle:true,itemPress:1,frozen:99,overdrive:99}});b.send({type:'input',input:{throttle:true}});
  const frozenA=await a.wait('state',m=>m.state.racers.find(r=>r.id===b.id)?.frozen>0),frozenB=await b.wait('state',m=>m.state.racers.find(r=>r.id===b.id)?.frozen>0);
  for(const packet of [frozenA,frozenB]){const victim=packet.state.racers.find(r=>r.id===b.id),attacker=packet.state.racers.find(r=>r.id===a.id);assert.ok(victim.frozen<=2.4&&victim.slow>0);assert.equal(attacker.overdrive,0);assert.equal(attacker.frozen,0);assert.ok(packet.state.events.some(e=>e.source==='frost'&&e.attacker===a.id&&e.racer===b.id));}
  me.item='rocket';a.send({type:'input',input:{throttle:true,itemPress:2}});
  for(const c of [a,b]){const packet=await c.wait('state',m=>m.state.racers.find(r=>r.id===a.id)?.overdrive>0);const r=packet.state.racers.find(r=>r.id===a.id);assert.ok(r.overdrive<=2.2);assert.equal(r.boosting,true);assert.equal(r.item,null);assert.ok(packet.state.events.some(e=>e.type==='item'&&e.item==='rocket'));}
 }finally{for(const c of clients)c.ws.terminate();await app.close();}
});
