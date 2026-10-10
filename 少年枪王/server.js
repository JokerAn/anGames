import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { Match, defaultConfig, sanitizeConfig, isWeapon } from './src/simulation.js';
const ROOT=path.dirname(fileURLToPath(import.meta.url));
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.json':'application/json; charset=utf-8'};
export function lanAddresses(port){return Object.values(networkInterfaces()).flat().filter(n=>n?.family==='IPv4'&&!n.internal).map(n=>`http://${n.address}:${port}`);}
export function createGameServer(){
  const rooms=new Map(),clients=new Set();
  const server=http.createServer(async(req,res)=>{
    try{
      const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      if(pathname==='/api/network'){res.setHeader('Content-Type',MIME['.json']);res.end(JSON.stringify({addresses:lanAddresses(server.address().port)}));return;}
      let file=pathname==='/'?'index.html':pathname.slice(1);
      if(file.startsWith('vendor/'))file='node_modules/three/build/'+file.slice(7);
      else if(!['index.html','style.css'].includes(file)&&!file.startsWith('src/')&&!file.startsWith('assets/')){res.writeHead(404);res.end('Not found');return;}
      const resolved=path.resolve(ROOT,file);
      if(!resolved.startsWith(ROOT+path.sep)||file.includes('..')){res.writeHead(403);res.end();return;}
      const data=await readFile(resolved);res.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(data);
    }catch{res.writeHead(404);res.end('Not found');}
  });
  const wss=new WebSocketServer({server,maxPayload:32768});
  const send=(ws,data)=>{if(ws.readyState===WebSocket.OPEN&&ws.bufferedAmount<512000)ws.send(JSON.stringify(data));};
  const broadcast=(room,data)=>{for(const c of room.members)send(c.ws,data);};
  const roomState=room=>({type:'room',host:room.host,phase:room.match?'playing':'lobby',config:room.config,members:room.members.map(c=>({id:c.id,name:c.name,team:c.team,weapon:c.weapon}))});
  const update=room=>broadcast(room,roomState(room));
  function leave(c){
    const room=c.room;if(!room)return;c.room=null;room.members=room.members.filter(m=>m!==c);
    if(!room.members.length){rooms.delete(room.key);return;}
    if(room.host===c.id)room.host=room.members[0].id;
    if(room.match){room.match.actors=room.match.actors.filter(a=>a.id!==c.id);broadcast(room,{type:'notice',message:`${c.name}已离开房间`});}
    update(room);
  }
  wss.on('connection',(ws,req)=>{
    // LAN pages may have any local hostname, but cross-origin browser joins are rejected.
    if(req.headers.origin){try{if(new URL(req.headers.origin).host!==req.headers.host){ws.close(1008,'Origin mismatch');return;}}catch{ws.close(1008);return;}}
    const c={id:randomUUID(),ws,room:null,name:'小小冒险家',team:'blue',weapon:'blaster',alive:true,rate:0,lastInput:0};clients.add(c);
    send(ws,{type:'hello',id:c.id});ws.on('pong',()=>c.alive=true);
    ws.on('message',raw=>{
      if(++c.rate>180)return;
      try{
        const msg=JSON.parse(raw.toString());
        if(msg.type==='join'){
          if(c.room)throw new Error('请先离开当前房间');
          const password=String(msg.password||'').trim();if(password.length<4||password.length>24)throw new Error('房间密码需要 4～24 个字符');
          const key=createHash('sha256').update(password).digest('hex');let room=rooms.get(key);
          if(room?.members.length>=2)throw new Error('这个房间已经有两位玩家了，换一个密码试试');
          if(room?.match)throw new Error('这个房间正在游戏，请等待伙伴返回大厅');
          if(!room){if(rooms.size>=32)throw new Error('房间暂时已满');room={key,host:c.id,members:[],config:sanitizeConfig(msg.config||defaultConfig()),match:null};rooms.set(key,room);}
          c.name=String(msg.name||'小小冒险家').trim().slice(0,12)||'小小冒险家';c.team=msg.team==='red'?'red':'blue';c.weapon=isWeapon(msg.weapon)||msg.weapon==='random'?msg.weapon:'blaster';c.room=room;room.members.push(c);update(room);
        }else if(msg.type==='leave')leave(c);
        else if(msg.type==='ping')send(ws,{type:'pong',at:msg.at});
        else{
          const room=c.room;if(!room)throw new Error('请先加入房间');
          if(msg.type==='profile'){
            if(room.match)throw new Error('本局结束后可以换队');c.team=msg.team==='red'?'red':'blue';c.weapon=isWeapon(msg.weapon)||msg.weapon==='random'?msg.weapon:'blaster';update(room);
          }else if(msg.type==='config'){
            if(room.host!==c.id||room.match)throw new Error('只有房主可以在大厅设置人机');room.config=sanitizeConfig(msg.config);update(room);
          }else if(msg.type==='start'){
            if(room.host!==c.id||room.match)throw new Error('请等待房主开始');
            const counts={blue:room.config.bots.blue.length,red:room.config.bots.red.length};room.members.forEach(m=>counts[m.team]++);
            if(!counts.blue||!counts.red)throw new Error('红蓝双方都需要至少一名队员');
            room.match=new Match(room.config,room.members.map(m=>({id:m.id,name:m.name,team:m.team,weapon:m.weapon})));room.members.forEach(m=>m.lastInput=Date.now());broadcast(room,{type:'start',state:room.match.snapshot()});
          }else if(msg.type==='input'&&room.match){room.match.setInput(c.id,msg.input);c.lastInput=Date.now();}
          else if(msg.type==='lobby'){
            if(room.host!==c.id)throw new Error('请等待房主返回房间');room.match=null;update(room);
          }
        }
      }catch(e){send(ws,{type:'error',message:e instanceof SyntaxError?'消息格式错误':e.message});}
    });
    ws.on('close',()=>{leave(c);clients.delete(c);});ws.on('error',()=>{});
  });
  let ticks=0;
  const loop=setInterval(()=>{
    for(const room of rooms.values())if(room.match&&!room.match.ended){
      for(const c of room.members)if(Date.now()-c.lastInput>600)room.match.stopInput(c.id);
      room.match.step(1/30);
      if(ticks%2===0||room.match.ended)broadcast(room,{type:'state',state:room.match.snapshot(),events:room.match.drainEvents()});
    }ticks++;
  },1000/30);
  const heartbeat=setInterval(()=>{for(const c of clients){if(!c.alive){c.ws.terminate();continue;}c.alive=false;c.ws.ping();}},15000);
  const rate=setInterval(()=>{for(const c of clients)c.rate=0;},1000);
  return {server,rooms,close:async()=>{clearInterval(loop);clearInterval(heartbeat);clearInterval(rate);for(const c of clients)c.ws.terminate();wss.close();await new Promise(resolve=>server.close(resolve));}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const app=createGameServer(),port=Number(process.env.PORT)||3000;
  app.server.on('error',e=>{console.error(e.code==='EADDRINUSE'?`端口 ${port} 已被占用。请运行 PORT=3001 npm start`:e.message);process.exit(1);});
  app.server.listen(port,'0.0.0.0',()=>{console.log(`\n  少年枪王 · 泡泡竞技场\n  电脑打开：http://localhost:${port}\n  同一 Wi-Fi 的手机打开：\n${lanAddresses(port).map(a=>'  '+a).join('\n')}\n\n  保持这个窗口打开，按 Ctrl+C 停止。\n`);});
}
