import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createGameServer } from '../server.js';
import { defaultConfig } from '../src/simulation.js';
async function client(url){const ws=new WebSocket(url),queue=[],waiters=[];ws.on('message',raw=>{const data=JSON.parse(raw);const index=waiters.findIndex(w=>w.check(data));if(index>=0){const w=waiters.splice(index,1)[0];clearTimeout(w.timer);w.resolve(data);}else queue.push(data);});await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});return {ws,send:o=>ws.send(JSON.stringify(o)),next:(type,predicate=()=>true)=>{const check=d=>d.type===type&&predicate(d),index=queue.findIndex(check);if(index>=0)return Promise.resolve(queue.splice(index,1)[0]);return new Promise((resolve,reject)=>{const w={check,resolve,timer:setTimeout(()=>{const i=waiters.indexOf(w);if(i>=0)waiters.splice(i,1);reject(new Error(`Timed out waiting for ${type}`));},4000)};waiters.push(w);});}};}
async function setup(t){const app=createGameServer();await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());const port=app.server.address().port;return {app,url:`ws://127.0.0.1:${port}`,http:`http://127.0.0.1:${port}`};}
test('real LAN room: password matching, teams, roster authority, play, replay and host transfer',async t=>{
  const {url,app}=await setup(t),a=await client(url),b=await client(url),c=await client(url);const ah=await a.next('hello'),bh=await b.next('hello');await c.next('hello');
  a.send({type:'join',password:'friends',name:'小蓝',team:'blue',weapon:'blaster',config:defaultConfig()});let room=await a.next('room');assert.equal(room.host,ah.id);assert.equal(room.members.length,1);
  b.send({type:'join',password:'friends',name:'小红',team:'red',weapon:'sniper'});room=await b.next('room');assert.equal(room.host,ah.id);assert.equal(room.members.length,2);assert.equal(room.members[1].team,'red');
  c.send({type:'join',password:'friends',name:'第三人'});assert.match((await c.next('error')).message,/两位/);
  b.send({type:'config',config:{}});assert.match((await b.next('error')).message,/房主/);
  b.send({type:'profile',team:'blue',weapon:'shotgun'});room=await b.next('room',r=>r.members.every(m=>m.team==='blue'));assert.equal(room.members[1].weapon,'shotgun');
  const mixed=defaultConfig();mixed.bots.red=[{difficulty:'hard',weapon:'sniper'},...Array.from({length:10},()=>({difficulty:'easy',weapon:'smg'}))];mixed.bots.blue=[{difficulty:'easy',weapon:'random'}];a.send({type:'config',config:mixed});await b.next('room',r=>r.config.bots.red.length===11);
  a.send({type:'start'});const sa=await a.next('start'),sb=await b.next('start');assert.equal(sa.state.actors.length,14);assert.equal(sb.state.actors.filter(x=>x.team==='blue').length,3);assert.equal(sb.state.actors.filter(x=>x.difficulty==='hard').length,1);
  const before=sa.state.actors.find(x=>x.id===ah.id);a.send({type:'input',input:{moveX:1,moveZ:0,yaw:0,pitch:0,fire:true}});const moving=await b.next('state',d=>d.state.actors.find(x=>x.id===ah.id).x!==before.x);assert.notEqual(moving.state.actors.find(x=>x.id===ah.id).x,before.x);
  b.send({type:'profile',team:'red'});assert.match((await b.next('error')).message,/结束后/);
  const active=[...app.rooms.values()][0];active.match.time=active.config.duration-.01;await a.next('state',d=>d.state.ended);await b.next('state',d=>d.state.ended);
  a.send({type:'lobby'});await b.next('room',r=>r.phase==='lobby');b.send({type:'profile',team:'red',weapon:'sniper'});await b.next('room',r=>r.members.find(m=>m.id===bh.id).team==='red');
  a.send({type:'start'});const duel=await b.next('start');assert.equal(duel.state.actors.find(x=>x.id===bh.id).team,'red');
  a.ws.close();const transferred=await b.next('room',r=>r.host===bh.id);assert.equal(transferred.members.length,1);assert.ok(!active.match.actors.some(x=>x.id===ah.id));
  b.send({type:'lobby'});await b.next('room',r=>r.phase==='lobby');b.send({type:'leave'});b.ws.close();c.ws.close();
});
test('password isolation and invalid empty opponents',async t=>{const {url}=await setup(t),a=await client(url),b=await client(url);await a.next('hello');await b.next('hello');a.send({type:'join',password:'room-A',team:'blue',config:{bots:{blue:[],red:[]}}});const ra=await a.next('room');b.send({type:'join',password:'room-B',team:'red'});const rb=await b.next('room');assert.notEqual(ra.host,rb.host);a.send({type:'start'});assert.match((await a.next('error')).message,/双方/);a.ws.close();b.ws.close();});
test('static server exposes browser assets and LAN addresses, not server code',async t=>{const {http}=await setup(t);assert.equal((await fetch(http)).status,200);assert.equal((await fetch(http+'/vendor/three.module.js')).status,200);assert.equal((await fetch(http+'/vendor/three.core.js')).status,200);assert.equal((await fetch(http+'/server.js')).status,404);assert.equal((await fetch(http+'/package.json')).status,404);assert.equal((await fetch(http+'/src/%2e%2e%2fserver.js')).status,403);assert.ok(Array.isArray((await (await fetch(http+'/api/network')).json()).addresses));});

test('simultaneous rooms retain distinct authoritative maps',async t=>{
  const {url,app}=await setup(t),a=await client(url),b=await client(url);await a.next('hello');await b.next('hello');
  a.send({type:'join',password:'harbor-room',team:'blue',config:{...defaultConfig(),map:'harbor'}});await a.next('room');
  b.send({type:'join',password:'desert-room',team:'blue',config:{...defaultConfig(),map:'desert'}});await b.next('room');
  a.send({type:'start'});b.send({type:'start'});assert.equal((await a.next('start')).state.config.map,'harbor');assert.equal((await b.next('start')).state.config.map,'desert');
  const maps=[...app.rooms.values()].map(r=>r.match.config.map);assert.deepEqual(maps.sort(),['desert','harbor']);
  a.send({type:'config',config:{...defaultConfig(),map:'blocks'}});assert.match((await a.next('error')).message,/大厅/);assert.ok([...app.rooms.values()].some(r=>r.match.config.map==='harbor'));
  a.ws.close();b.ws.close();
});
test('network weapon validation and idle-input timeout preserve a valid match and player facing',async t=>{
  const {url,app}=await setup(t),a=await client(url),b=await client(url);const hello=await a.next('hello');await b.next('hello');
  a.send({type:'join',password:'idle-test',team:'blue',weapon:'constructor',config:{...defaultConfig(),bots:{blue:[],red:[]}}});assert.equal((await a.next('room')).members[0].weapon,'blaster');
  b.send({type:'join',password:'idle-test',team:'red',weapon:'toString'});assert.equal((await b.next('room')).members[1].weapon,'blaster');
  a.send({type:'start'});await a.next('start');await b.next('start');a.send({type:'input',input:{yaw:2,pitch:.4,fire:true,moveX:1,weapon:'__proto__'}});
  const snapshot=(await b.next('state',d=>d.state.time>.85)).state,actor=snapshot.actors.find(x=>x.id===hello.id);
  assert.equal(actor.yaw,2);assert.equal(actor.pitch,.4);assert.equal(actor.weapon,'blaster');assert.ok(Number.isFinite(actor.x));
  const internal=[...app.rooms.values()][0].match.actors.find(x=>x.id===hello.id);assert.equal(internal.input.fire,false);assert.equal(internal.input.moveX,0);
  a.ws.close();b.ws.close();
});
