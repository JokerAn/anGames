import test from 'node:test';
import assert from 'node:assert/strict';
import {WebSocket} from 'ws';
import {createGameServer} from '../server.js';
class Client {
  constructor(url){this.messages=[];this.ws=new WebSocket(url);this.ws.on('message',raw=>this.messages.push(JSON.parse(raw)));}
  async wait(type,predicate=()=>true){const until=Date.now()+4000;while(Date.now()<until){const i=this.messages.findIndex(m=>m.type===type&&predicate(m));if(i>=0)return this.messages.splice(i,1)[0];await new Promise(r=>setTimeout(r,10));}throw new Error(`timeout: ${type}`);}
  send(data){this.ws.send(JSON.stringify(data));}
}
test('双人房间完整流程、隔离、满员、权限、断线接管与清理',{timeout:15000},async()=>{
  const app=createGameServer();await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const port=app.server.address().port,url=`ws://127.0.0.1:${port}`;const clients=[];
  try{
    const make=async()=>{const c=new Client(url);clients.push(c);c.id=(await c.wait('welcome')).id;return c;};
    const a=await make(),b=await make(),c=await make();
    a.send({type:'join',room:'bad'});assert.match((await a.wait('error')).message,/4–8/);
    a.send({type:'join',room:'2026',name:'车手A',track:'canyon',car:'titan',laps:2});await a.wait('lobby');
    b.send({type:'join',room:'2026',name:'车手B',track:'neon',car:'bolt'});const lobby=await b.wait('lobby');assert.equal(lobby.players.length,2);assert.equal(lobby.track,'canyon');assert.equal(lobby.host,a.id);
    c.send({type:'join',room:'2026'});assert.match((await c.wait('error')).message,/已满/);
    c.send({type:'join',room:'7777'});await c.wait('lobby');assert.equal(app.rooms.size,2);
    a.send({type:'start'});assert.match((await a.wait('error')).message,/准备/);
    a.send({type:'ready',ready:true});b.send({type:'ready',ready:true});await a.wait('lobby',m=>m.players.every(p=>p.ready));
    b.send({type:'start'});await new Promise(r=>setTimeout(r,40));assert.equal(app.rooms.get('2026').race,null);
    a.send({type:'start'});const ar=await a.wait('race'),br=await b.wait('race');assert.deepEqual(ar.state,br.state);assert.equal(ar.state.racers.filter(r=>!r.bot).length,2);assert.equal(ar.state.racers[0].car,'titan');assert.equal(ar.state.racers[1].car,'bolt');
    a.send({type:'input',input:{steer:999,throttle:true,s:9999999}});await new Promise(r=>setTimeout(r,60));assert.equal(app.rooms.get('2026').race.racers[0].input.steer,1);assert.ok(app.rooms.get('2026').race.racers[0].s<0);
    assert.equal(c.messages.filter(m=>m.type==='state'||m.type==='race').length,0);
    b.ws.close();await a.wait('notice');assert.equal(app.rooms.get('2026').race.racers.find(r=>r.id===b.id).bot,true);
    a.send({type:'leave'});await new Promise(r=>setTimeout(r,50));assert.equal(app.rooms.has('2026'),false);
    const html=await fetch(`http://127.0.0.1:${port}/`);assert.equal(html.status,200);assert.match(await html.text(),/少年赛车/);
    for(const route of ['/server.js','/package.json','/test/network.test.js','/.env'])assert.equal((await fetch(`http://127.0.0.1:${port}${route}`)).status,404);
    assert.equal((await fetch(`http://127.0.0.1:${port}/vendor/three.module.js`)).status,200);
  }finally{clients.forEach(c=>c.ws.terminate());await app.close();}
});
test('房主离开后移交权限，剩余玩家可在结算后返回房间再战',{timeout:8000},async()=>{
  const app=createGameServer();await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const url=`ws://127.0.0.1:${app.server.address().port}`;const a=new Client(url),b=new Client(url);
  try{
    a.id=(await a.wait('welcome')).id;b.id=(await b.wait('welcome')).id;
    a.send({type:'join',room:'3456'});await a.wait('lobby');b.send({type:'join',room:'3456'});await b.wait('lobby');a.send({type:'ready',ready:true});b.send({type:'ready',ready:true});await a.wait('lobby',m=>m.players.every(p=>p.ready));a.send({type:'start'});await b.wait('race');
    app.rooms.get('3456').race.status='finished';a.ws.close();const notice=await b.wait('notice');assert.equal(notice.host,b.id);assert.equal(app.rooms.get('3456').host,b.id);
    b.send({type:'rematch'});const lobby=await b.wait('lobby',m=>m.players.length===1);assert.equal(lobby.host,b.id);assert.equal(lobby.players[0].ready,false);assert.equal(app.rooms.get('3456').race,null);
  }finally{a.ws.terminate();b.ws.terminate();await app.close();}
});
test('异常昵称不会制造无法清理的空房间',{timeout:6000},async()=>{
  const app=createGameServer();await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const c=new Client(`ws://127.0.0.1:${app.server.address().port}`);
  try{
    await c.wait('welcome');c.send({type:'join',room:'9876',name:{toString:null}});
    const room=await c.wait('lobby');assert.equal(room.players[0].name,'少年车手');assert.equal(app.rooms.size,1);
    c.ws.close();const until=Date.now()+2000;while(app.rooms.size&&Date.now()<until)await new Promise(r=>setTimeout(r,10));assert.equal(app.rooms.size,0);
  }finally{c.ws.terminate();await app.close();}
});
