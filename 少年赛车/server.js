import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {WebSocketServer, WebSocket} from 'ws';
import {createRace, cleanChoice, cleanInput, stepRace, snapshot} from './src/simulation.js';
import {TRACKS} from './src/tracks.js';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MIME = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8'};
export function createGameServer() {
  const rooms = new Map(), clients = new Map();
  const server = http.createServer(async (req,res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname === '/api/info') {res.writeHead(200, {'Content-Type': MIME['.json']}); res.end(JSON.stringify({addresses: Object.values(os.networkInterfaces()).flat().filter(a=>a.family==='IPv4'&&!a.internal).map(a=>a.address)})); return;}
      const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
      const allow = requested === 'index.html' || requested === 'style.css' || requested === 'icon.svg' || /^src\/[a-z-]+\.js$/.test(requested) || /^vendor\/three\.(module|core)\.js$/.test(requested);
      if (!allow) {res.writeHead(404); res.end('Not found'); return;}
      const file = requested.startsWith('vendor/') ? path.join(ROOT,'node_modules/three/build',path.basename(requested)) : path.join(ROOT,requested);
      const data = await readFile(file);
      res.writeHead(200, {'Content-Type': MIME[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'}); res.end(data);
    } catch {res.writeHead(404); res.end('Not found');}
  });
  const wss = new WebSocketServer({server, maxPayload: 4096});
  const send = (ws,data) => {if(ws.readyState===WebSocket.OPEN && ws.bufferedAmount < 256000) ws.send(JSON.stringify(data));};
  const broadcast = (room,data) => room.players.forEach(p=>send(p.ws,data));
  function lobby(room) {broadcast(room,{type:'lobby',room:room.code,host:room.host,track:room.track,laps:room.laps,difficulty:room.difficulty,players:room.players.map(({ws,...p})=>p)});}
  function leave(client) {
    const room = rooms.get(client.room); client.room = null;
    if (!room) return;
    room.players = room.players.filter(p=>p.id!==client.id);
    if (!room.players.length) {rooms.delete(room.code); return;}
    room.host = room.players[0].id;
    if(room.race) {const racer=room.race.racers.find(r=>r.id===client.id); if(racer) {racer.bot=true; racer.name += ' · AI';} broadcast(room,{type:'notice',host:room.host,message:'对方已离开，AI 接管车辆，本局继续。'});}
    else lobby(room);
  }
  wss.on('connection', ws => {
    const client = {id: randomUUID(), room: null, lastInput: 0, window: Date.now(), count:0, alive:true}; clients.set(ws,client);
    send(ws,{type:'welcome',id:client.id});
    ws.on('pong',()=>client.alive=true);
    ws.on('message', raw => {
      try {
        const now=Date.now(); if(now-client.window>1000) {client.window=now;client.count=0;} if(++client.count>90) return;
        const data=JSON.parse(raw); if(!data || typeof data!=='object') return;
        if(data.type==='join') {
          const code=String(data.room||'').trim(); if(!/^\d{4,8}$/.test(code)) return send(ws,{type:'error',message:'房间号需要 4–8 位数字。'});
          if(client.room===code) return;
          let room=rooms.get(code);
          if(room?.race) return send(ws,{type:'error',message:'这个房间正在比赛，请换一个房间号。'});
          if(room?.players.length>=2) return send(ws,{type:'error',message:'房间已满（最多两名玩家）。'});
          if(!room&&rooms.size>=100) return send(ws,{type:'error',message:'房间数量已满，请稍后再试。'});
          leave(client);
          if(!room) {room={code,host:client.id,track:TRACKS.some(t=>t.id===data.track)?data.track:'coast',laps:data.laps===2?2:3,difficulty:data.difficulty==='easy'?'easy':'normal',players:[],race:null};rooms.set(code,room);}
          room.players.push({id:client.id,...cleanChoice(data),ready:false,ws}); client.room=code; lobby(room); return;
        }
        const room=rooms.get(client.room); if(!room) return;
        if(data.type==='leave') {leave(client);return;}
        if(data.type==='ready'&&!room.race) {room.players.find(p=>p.id===client.id).ready=!!data.ready;lobby(room);}
        if(data.type==='start'&&!room.race&&room.host===client.id) {
          if(room.players.length!==2||!room.players.every(p=>p.ready)) return send(ws,{type:'error',message:'两位车手准备后，房主才能发车。'});
          room.race=createRace({track:room.track,laps:room.laps,difficulty:room.difficulty,players:room.players});
          broadcast(room,{type:'race',state:snapshot(room.race)});
        }
        if(data.type==='input'&&room.race) {
          const racer=room.race.racers.find(r=>r.id===client.id); if(racer) {racer.input=cleanInput(data.input);client.lastInput=now;}
        }
        if(data.type==='rematch'&&room.race?.status==='finished'&&room.host===client.id) {room.race=null;room.players.forEach(p=>p.ready=false);lobby(room);}
      } catch {send(ws,{type:'error',message:'无法识别房间消息。'});}
    });
    ws.on('close',()=>{leave(client);clients.delete(ws);}); ws.on('error',()=>{});
  });
  let previous=performance.now(), accumulator=0, tick=0;
  const timer=setInterval(()=>{
    const now=performance.now();accumulator+=Math.min(.2,(now-previous)/1000);previous=now;
    while(accumulator>=1/60) {
      for(const room of rooms.values()) if(room.race) {
        for(const p of room.players) {const c=clients.get(p.ws); if(c&&Date.now()-c.lastInput>900) {const r=room.race.racers.find(r=>r.id===p.id);if(r) r.input={throttle:false,brake:true};}}
        stepRace(room.race,1/60);
      }
      accumulator-=1/60;tick++;
      if(tick%3===0) for(const room of rooms.values()) if(room.race) broadcast(room,{type:'state',state:snapshot(room.race)});
    }
  },1000/60);
  const heartbeat=setInterval(()=>{for(const [ws,c] of clients) {if(!c.alive){ws.terminate();continue;}c.alive=false;ws.ping();}},15000);
  async function close() {clearInterval(timer);clearInterval(heartbeat);for(const ws of clients.keys()) ws.terminate();await new Promise(resolve=>wss.close(resolve));await new Promise(resolve=>server.close(resolve));}
  return {server,rooms,wss,close};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const app=createGameServer(),port=Number(process.env.PORT)||3210;
  app.server.listen(port,'0.0.0.0',()=>{
    console.log(`\n少年赛车已启动：http://localhost:${port}`);
    for(const info of Object.values(os.networkInterfaces()).flat()) if(info.family==='IPv4'&&!info.internal) console.log(`手机同 Wi-Fi 打开：http://${info.address}:${port}`);
    console.log('双人联机：两台设备输入相同房间号，准备后由房主发车。\n');
  });
  app.server.on('error',e=>{console.error(`启动失败：${e.message}`);process.exitCode=1;});
}
