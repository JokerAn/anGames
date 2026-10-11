import {CARS,ENGINES,TRACKS,getTrack,clamp,mod} from './tracks.js';
import {createRace,stepRace,ITEMS} from './simulation.js';
import {RaceRenderer} from './renderer.js';
import {Controls} from './controls.js';
import {AudioEngine} from './audio.js';
const $=id=>document.getElementById(id);
const controls=new Controls(),audio=new AudioEngine();
let graphics, mode='solo',race=null,playerId='local',paused=false,ws=null,lobby=null,joined=false,lastStateAt=0,lastEvent=0,lastCount='',resultShown=false,gameActive=false;
let choice={car:'comet',engine:'balanced',track:'coast',laps:3,difficulty:'normal',rules:'circuit'},saved={};
try{saved=JSON.parse(localStorage.getItem('junior-racers')||'{}');if(!saved||typeof saved!=='object'||Array.isArray(saved))saved={};if(CARS.some(c=>c.id===saved.car))choice.car=saved.car;if(ENGINES.some(c=>c.id===saved.engine))choice.engine=saved.engine;if(TRACKS.some(c=>c.id===saved.track))choice.track=saved.track;$('nickname').value=String(saved.name||'').slice(0,12);$('auto-throttle').checked=saved.controlVersion===2&&saved.autoThrottle===true;if(saved.laps===2)choice.laps=2;if(saved.difficulty==='easy')choice.difficulty='easy';$('laps').value=String(choice.laps);$('difficulty').value=choice.difficulty;if(saved.rules==='arcade')choice.rules='arcade';$('rules').value=choice.rules;}catch{}
audio.enabled=saved.sound===true;$('sound').querySelector('span').textContent=audio.enabled?'音效开':'音效关';$('sound').setAttribute('aria-label',audio.enabled?'关闭音效':'开启音效');
function save(){try{localStorage.setItem('junior-racers',JSON.stringify({...choice,name:$('nickname').value,controlVersion:2,autoThrottle:$('auto-throttle').checked,sound:audio.enabled}));}catch{}}
let toastTimer;function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4000);}
function carSVG(c){return `<svg viewBox="0 0 140 58" aria-hidden="true"><ellipse cx="72" cy="48" rx="57" ry="5" fill="#071321" opacity=".5"/><path d="M15 35l14-7 22-15h40l20 16 16 6v10H15z" fill="${c.color}"/><path d="M52 18h17v13H36zm21 0h16l14 13H73z" fill="#203d50"/><path d="M15 38h110v7H15z" fill="#183142"/><circle cx="38" cy="44" r="10" fill="#0c1623"/><circle cx="38" cy="44" r="5" fill="#91a9b8"/><circle cx="103" cy="44" r="10" fill="#0c1623"/><circle cx="103" cy="44" r="5" fill="#91a9b8"/><path d="M119 33h9v5h-9" fill="#eaffd8"/></svg>`;}
function trackSVG(config){
  const t=getTrack(config.id),points=[],b=t.bounds,margin=25;
  for(let i=0;i<=160;i++){const p=t.sample(i/160*t.length);points.push(`${p.x.toFixed(1)},${p.z.toFixed(1)}`);}
  const start=t.sample(0),a=t.sample(t.boostStraight.s),end=t.sample(t.boostStraight.s+t.boostStraight.length);
  return `<svg viewBox="${b.minX-margin} ${b.minZ-margin} ${b.width+margin*2} ${b.height+margin*2}" aria-hidden="true"><polyline points="${points.join(' ')}" fill="none" stroke="${config.color}" stroke-width="9" stroke-linejoin="round"/><path d="M${a.x} ${a.z}L${end.x} ${end.z}" stroke="#d3b591" stroke-width="10"/><rect x="${start.x-8}" y="${start.z-8}" width="16" height="16" fill="#e6e0d4"/></svg>`;
}
function renderOptions(){
  $('car-options').innerHTML=CARS.map(c=>`<button class="car-option ${c.id===choice.car?'active':''}" data-car="${c.id}" aria-pressed="${c.id===choice.car}">${c.id===choice.car?'<span class="selected-check">✓</span>':''}${carSVG(c)}<strong>${c.name}</strong><small>${c.tag}</small></button>`).join('');
  $('engine-options').innerHTML=ENGINES.map(e=>`<button class="engine-option ${e.id===choice.engine?'active':''}" data-engine="${e.id}" aria-pressed="${e.id===choice.engine}"><strong>${e.name}</strong><small>${e.tag}</small></button>`).join('');
  $('track-options').innerHTML=TRACKS.map(t=>`<button class="track-option ${t.id===choice.track?'active':''}" data-track="${t.id}" aria-pressed="${t.id===choice.track}" title="${t.desc}"><div class="track-art ${t.id}">${trackSVG(t)}</div><span class="track-level">${t.difficulty}</span><strong>${t.name}</strong><small>${t.tag}</small></button>`).join('');
  const c=CARS.find(c=>c.id===choice.car);$('car-title').innerHTML=`${c.name} <span>0${CARS.indexOf(c)+1}</span>`;$('car-tag').textContent=c.tag;
  $('car-stats').innerHTML=c.stats.map((v,i)=>`<div class="stat"><span>${['极速','加速',choice.car==='titan'?'耐撞':'操控'][i]}</span><div class="stat-bar"><i style="width:${v}%"></i></div></div>`).join('');
  document.querySelectorAll('[data-car]').forEach(b=>b.onclick=()=>{choice.car=b.dataset.car;graphics?.setCar(choice.car);renderOptions();save();});
  document.querySelectorAll('[data-engine]').forEach(b=>b.onclick=()=>{choice.engine=b.dataset.engine;renderOptions();save();});
  document.querySelectorAll('[data-track]').forEach(b=>b.onclick=()=>{choice.track=b.dataset.track;renderOptions();save();});
}
renderOptions();
try{graphics=new RaceRenderer($('garage-view'));graphics.setCar(choice.car);$('loading').remove();}catch(error){$('loading').textContent='3D 画面启动失败，请使用支持 WebGL 2 的浏览器。';$('start').disabled=true;console.error(error);}
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{if(gameActive||joined)return;if(ws)leaveRoom();mode=b.dataset.mode;document.querySelectorAll('[data-mode]').forEach(x=>x.classList.toggle('active',x===b));$('lan-settings').hidden=mode!=='lan';$('start-text').textContent=mode==='lan'?'创建 / 加入房间':'进入赛道';});
$('laps').onchange=()=>{choice.laps=Number($('laps').value);save();};$('difficulty').onchange=()=>{choice.difficulty=$('difficulty').value;save();};$('auto-throttle').onchange=save;$('rules').onchange=()=>{choice.rules=$('rules').value;$('rules-note').textContent=choice.rules==='arcade'?'补给、漂移蓄能与道具对决':'弯道走线 · 直线连续加速';save();};$('rules').dispatchEvent(new Event('change'));
$('sound').onclick=async()=>{const on=await audio.toggle();$('sound').querySelector('span').textContent=on?'音效开':'音效关';$('sound').setAttribute('aria-label',on?'关闭音效':'开启音效');$('race-sound').textContent=on?'关闭音效':'开启音效';save();};$('race-sound').onclick=()=>$('sound').click();
$('help').onclick=()=>$('help-dialog').showModal();document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
function send(data){if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(data));}
$('start').onclick=()=>{if(audio.enabled)void audio.unlock();save();if(mode==='solo')startSolo();else connect();};
function startSolo(){playerId='local';beginRace(createRace({...choice,players:[{id:'local',car:choice.car,engine:choice.engine,name:$('nickname').value||'你'}]}));}
function beginRace(state){
  race=state;accumulator=0;hudAccum=0;inputAccum=0;paused=false;lastEvent=0;lastCount='';resultShown=false;gameActive=true;lastStateAt=performance.now();
  document.querySelectorAll('dialog[open]').forEach(d=>d.close());$('garage').hidden=true;$('race-screen').hidden=false;$('spectating').hidden=true;
  $('race-sound').textContent=audio.enabled?'关闭音效':'开启音效';$('camera').textContent=graphics.cameraMode==='chase'?'跟车':'引擎盖';controls.autoThrottle=$('auto-throttle').checked;controls.enabled=true;controls.reset();$('throttle-button').hidden=controls.autoThrottle;
  $('race-screen').classList.toggle('circuit',race.rules!=='arcade');graphics.setContainer($('race-view'));graphics.setRace(race,playerId);$('hud-track').textContent=getTrack(race.trackId).name;
  $('race-message').textContent='';$('speed-lines').style.opacity=0;window.scrollTo(0,0);armBackGuard();
}
function connect(){
  const room=$('room-code').value.trim();
  if(!/^\d{4,8}$/.test(room)){toast('输入一个 4–8 位数字房间号，例如 2026。');$('room-code').focus();return;}
  if(ws)leaveRoom();
  joined=false;$('start').disabled=true;$('start-text').textContent='正在连接…';
  const socket=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}`);
  ws=socket;
  // This deadline covers both opening the socket and receiving the room acknowledgement.
  const timer=setTimeout(()=>{
    if(ws===socket&&!joined){socket.close();toast('加入房间超时，请检查电脑服务和 Wi-Fi。');}
  },6000);
  socket.onopen=()=>{
    if(ws!==socket||mode!=='lan'){socket.close();return;}
    socket.send(JSON.stringify({type:'join',room,...choice,name:$('nickname').value}));
  };
  socket.onmessage=e=>{
    // Closed/replaced sockets may still have queued callbacks. They cannot change a new game.
    if(ws!==socket||mode!=='lan')return;
    let msg;try{msg=JSON.parse(e.data);}catch{return;}
    if(msg.type==='welcome')playerId=msg.id;
    if(msg.type==='error'){
      toast(msg.message);
      if(!joined){clearTimeout(timer);$('start').disabled=false;$('start-text').textContent='创建 / 加入房间';socket.close();}
    }
    if(msg.type==='notice'){if(lobby&&msg.host){lobby.host=msg.host;if(resultShown)$('again').hidden=lobby.host!==playerId;}toast(msg.message);}
    if(msg.type==='lobby'){
      clearTimeout(timer);lobby=msg;joined=true;race=null;gameActive=false;paused=false;resultShown=false;
      controls.enabled=false;controls.reset();audio.update(null,false);
      $('pause-dialog').close();$('result-dialog').close();$('garage').hidden=false;$('race-screen').hidden=true;
      graphics.mode='garage';graphics.setContainer($('garage-view'));renderLobby();
    }
    if(msg.type==='race'&&joined)beginRace(msg.state);
    if(msg.type==='state'&&joined&&gameActive){race=msg.state;lastStateAt=performance.now();}
  };
  socket.onerror=()=>{if(ws===socket)toast('无法连接房间服务，请从电脑提供的地址打开游戏。');};
  socket.onclose=()=>{
    clearTimeout(timer);if(ws!==socket)return;
    ws=null;$('start').disabled=false;$('start-text').textContent=mode==='lan'?'创建 / 加入房间':'进入赛道';
    if(!joined)return;
    joined=false;$('room-dialog').close();controls.enabled=false;controls.reset();
    if(gameActive&&!resultShown){
      paused=true;$('pause-title').textContent='连接已断开';
      $('pause-description').textContent='无法继续同步比赛，请返回车库重新加入。';$('resume').hidden=true;
      if(!$('pause-dialog').open)$('pause-dialog').showModal();
    }else if(resultShown){$('again').hidden=true;}
    toast('已与房间服务断开连接。');
  };
}
function renderLobby(){
  $('room-number').textContent=lobby.room;$('room-track').textContent=`${getTrack(lobby.track).name} · ${lobby.laps} 圈 · ${lobby.difficulty==='easy'?'入门练习':'赛道挑战'} · ${lobby.rules==='arcade'?'道具竞速':'赛道竞速'} · 房主确定赛道`;
  $('room-players').replaceChildren();for(const p of lobby.players){const row=document.createElement('div');row.className='room-player';const name=document.createElement('div');name.textContent=`${p.name}${p.id===playerId?'（你）':''}${p.id===lobby.host?' · 房主':''}`;const car=document.createElement('small');car.textContent=`${CARS.find(c=>c.id===p.car).name} / ${ENGINES.find(e=>e.id===p.engine).name}`;name.append(car);const status=document.createElement('span');status.className=p.ready?'ready':'';status.textContent=p.ready?'✓ 已准备':'尚未准备';row.append(name,status);$('room-players').append(row);}
  const me=lobby.players.find(p=>p.id===playerId),host=lobby.host===playerId;
  $('ready').textContent=me?.ready?'取消准备':'我准备好了';$('room-start').hidden=!host;$('room-start').disabled=lobby.players.length!==2||!lobby.players.every(p=>p.ready);
  $('room-status').textContent=lobby.players.length===1?'等待好友输入相同房间号加入…':lobby.players.every(p=>p.ready)?'全员就绪，等待房主发车。':'两位车手到齐，准备好后即可发车。';
  if(!$('room-dialog').open)$('room-dialog').showModal();
}
$('ready').onclick=()=>send({type:'ready',ready:!lobby.players.find(p=>p.id===playerId).ready});$('room-start').onclick=()=>send({type:'start'});
function leaveRoom(){joined=false;send({type:'leave'});if(ws){const old=ws;ws=null;old.close();}lobby=null;$('room-dialog').close();$('start').disabled=false;$('start-text').textContent=mode==='lan'?'创建 / 加入房间':'进入赛道';}
$('leave-room').onclick=leaveRoom;$('room-dialog').addEventListener('cancel',e=>{e.preventDefault();leaveRoom();});
function showPause(){if(!gameActive||resultShown)return;controls.reset();controls.enabled=false;if(mode==='lan')send({type:'input',input:controls.read()});paused=mode==='solo';$('pause-title').textContent=mode==='solo'?'比赛已暂停':'比赛菜单';$('pause-description').textContent=mode==='solo'?'比赛已暂停，准备好再出发。':'联机比赛仍在继续，当前车辆会刹车停车。';$('resume').hidden=false;if(!$('pause-dialog').open)$('pause-dialog').showModal();}
function resume(){if(!gameActive||mode==='lan'&&!joined)return;$('pause-dialog').close();paused=false;controls.enabled=true;}
$('camera').onclick=()=>{$('camera').textContent=graphics.toggleCamera()==='chase'?'跟车':'引擎盖';};window.addEventListener('keydown',e=>{if(e.code==='KeyC'&&gameActive&&!e.repeat&&!$('pause-dialog').open)$('camera').click();});$('pause').onclick=showPause;$('resume').onclick=resume;$('pause-dialog').addEventListener('cancel',e=>{e.preventDefault();resume();});
window.addEventListener('keydown',e=>{if(e.code==='Escape'&&gameActive&&!resultShown){e.preventDefault();$('pause-dialog').open?resume():showPause();}});
document.addEventListener('visibilitychange',()=>{if(document.hidden){audio.update(null,false);if(gameActive){controls.reset();showPause();}}});
document.addEventListener('graphics-quality',e=>{$('garage-quality').textContent=`自动画质 · ${e.detail}`;$('quality-label').textContent=e.detail;});if(graphics){$('garage-quality').textContent=`自动画质 · ${graphics.quality.name}`;$('quality-label').textContent=graphics.quality.name;}
document.addEventListener('graphics-restored',()=>toast('图形画面已恢复，可继续比赛。'));
document.addEventListener('graphics-lost',()=>{if(gameActive)showPause();toast('图形画面暂时中断，正在等待浏览器恢复。');});
function backToGarage(){leaveRoom();document.querySelectorAll('dialog[open]').forEach(d=>d.close());race=null;gameActive=false;paused=false;controls.enabled=false;controls.reset();$('garage').hidden=false;$('race-screen').hidden=true;graphics.mode='garage';graphics.setContainer($('garage-view'));audio.update(null,false);}
$('quit').onclick=backToGarage;$('result-back').onclick=backToGarage;$('again').onclick=()=>{if(mode==='solo')startSolo();else send({type:'rematch'});};
const formatTime=t=>`${String(Math.floor(Math.max(0,t)/60)).padStart(2,'0')}:${(Math.max(0,t)%60).toFixed(2).padStart(5,'0')}`;
let leaderboardSignature='';
const mapCtx=$('minimap').getContext('2d');
function drawMap(){
  const t=getTrack(race.trackId),ctx=mapCtx,b=t.bounds,scale=Math.min(212/b.width,152/b.height),xy=p=>[120+(p.x-b.centerX)*scale,90+(p.z-b.centerZ)*scale];
  ctx.clearRect(0,0,240,180);ctx.beginPath();
  for(let i=0;i<=140;i++){const [x,y]=xy(t.sample(i/140*t.length));i?ctx.lineTo(x,y):ctx.moveTo(x,y);}
  ctx.strokeStyle='#8aa2b777';ctx.lineWidth=7;ctx.lineJoin='round';ctx.stroke();
  const straight=t.boostStraight,a=xy(t.sample(straight.s)),end=xy(t.sample(straight.s+straight.length));
  ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...end);ctx.strokeStyle='#d3b591';ctx.lineWidth=4;ctx.stroke();
  const start=xy(t.sample(0));ctx.fillStyle='#fff2d3';ctx.fillRect(start[0]-4,start[1]-4,8,8);
  for(const r of race.racers){const [x,y]=xy(t.sample(r.s));ctx.beginPath();ctx.arc(x,y,r.id===playerId?5:3.5,0,Math.PI*2);ctx.fillStyle=r.id===playerId?'#b0ffdf':r.bot?'#f2ba80':'#c0a9ff';ctx.fill();}
}
function updateHUD(){
  if(!race)return;const me=race.racers.find(r=>r.id===playerId);if(!me)return;
  $('position').textContent=me.rank;$('lap').textContent=`第 ${Math.min(me.lap,race.laps)} / ${race.laps} 圈`;$('race-time').textContent=formatTime(me.finishTime??race.time);$('best-lap').textContent=me.bestLap?`最快单圈 ${formatTime(me.bestLap)}`:mode==='lan'?'LAN · 实时同步':'计时圈待记录';
  $('speed').textContent=Math.round(me.v*3.6);$('gear').textContent=me.v<.8?'N':me.engine==='electric'?'D':String(me.gear||1);$('rpm-fill').style.width=`${clamp((me.rpm||900)/7800*100,0,100)}%`;$('rpm-fill').classList.toggle('redline',(me.rpm||0)>6200);$('rpm-label').textContent=`${Math.round((me.rpm||900)/100)*100} RPM`;$('drive-state').textContent=me.braking?'BRAKING':me.drifting?'DRIFT':me.gripUsage>1.1?'GRIP LIMIT':me.boosting?'BOOST':'TRACTION';$('drive-state').classList.toggle('warning',!!me.braking||me.gripUsage>1.1);$('nitro-fill').style.width=`${me.nitro}%`;$('nitro-label').textContent=me.drifting&&race.rules==='arcade'?`漂移蓄能 ${Math.round(me.driftCharge/1.8*100)}%`:me.boosting&&me.boost>0?`加速 ${me.boost.toFixed(1)} 秒`:me.drifting?'轮胎滑移 / DRIFT':`NITRO ${Math.round(me.nitro)}%`;
  $('item-icon').textContent=me.item?ITEMS[me.item].icon:'◇';$('item-name').textContent=me.item?ITEMS[me.item].name:'等待道具';document.querySelector('[data-control="item"]').classList.toggle('available',!!me.item);
  $('speed-lines').style.opacity=me.boosting?1:0;$('hit-flash').style.opacity=me.hit;
  const count=race.time<0?String(Math.ceil(-race.time)):race.time<.8?'GO!':'';$('countdown').textContent=count;if(count&&count!==lastCount)audio.effect('count');lastCount=count;
  $('spectating').hidden=me.finishTime===null||race.status==='finished';
  for(const e of race.events){if(e.id>lastEvent&&e.racer===playerId){$('race-message').textContent=e.text;audio.effect(e.type==='hit'?'crash':e.type);if(e.type==='hit'&&!matchMedia('(prefers-reduced-motion: reduce)').matches)navigator.vibrate?.(35);}lastEvent=Math.max(lastEvent,e.id);}
  if(me.boosting&&!lastBoosting)audio.effect('boost');
  lastBoosting=!!me.boosting;
  const recent=race.events.filter(e=>e.racer===playerId&&race.time-e.time<1.7);if(!recent.length)$('race-message').textContent='';
  const signature=race.racers.map(r=>`${r.id}:${r.rank}:${r.name}:${r.bot}:${r.finishTime}`).join('|');if(signature!==leaderboardSignature){leaderboardSignature=signature;$('leaderboard').replaceChildren();for(const r of [...race.racers].sort((a,b)=>a.rank-b.rank).slice(0,6)){const row=document.createElement('div');row.className=`rank-row ${r.id===playerId?'me':''}`;const num=document.createElement('b');num.textContent=r.rank;const name=document.createElement('span');name.textContent=r.id===playerId?'你':r.name;const tag=document.createElement('span');tag.textContent=r.finishTime!==null?'FIN':r.bot?'AI':r.id===playerId?'YOU':'P2';row.append(num,name,tag);$('leaderboard').append(row);}}
  drawMap();if(race.status==='finished'&&!resultShown)showResult();
}
function showResult(){
  resultShown=true;controls.enabled=false;controls.reset();$('pause-dialog').close();$('result-list').replaceChildren();const me=race.racers.find(r=>r.id===playerId);
  $('result-title').textContent=me.rank===1&&me.finishTime!==null?'P1 · 本场冠军':me.finishTime!==null?'比赛成绩已记录':'本场未完赛';
  $('result-subtitle').textContent=`${getTrack(race.trackId).name} · ${race.laps} 圈${me.finishTime!==null?` · 用时 ${formatTime(me.finishTime)}`:' · 本次未完赛'}`;
  for(const r of [...race.racers].sort((a,b)=>a.rank-b.rank)){const row=document.createElement('div');row.className=`result-row ${r.id===playerId?'me':''}`;const rank=document.createElement('b');rank.textContent=r.rank;const name=document.createElement('span');name.textContent=`${r.name}${r.id===playerId?'（你）':''}`;const time=document.createElement('span');time.textContent=r.finishTime===null?'DNF':formatTime(r.finishTime);row.append(rank,name,time);$('result-list').append(row);}
  $('again').hidden=mode==='lan'&&lobby?.host!==playerId;$('again').textContent=mode==='lan'?'回房间再战':'再跑一场 ↗';$('result-dialog').showModal();audio.effect('finish');
}
$('result-dialog').addEventListener('cancel',e=>e.preventDefault());
// Old phones' browsers treat an edge drag as back/forward navigation, which
// yanks the player out mid-race. Swallow horizontal edge swipes on the document.
const EDGE=28;
document.addEventListener('touchmove',e=>{if(!gameActive)return;const t=e.touches[0];if(!t)return;const atEdge=t.clientX<EDGE||t.clientX>innerWidth-EDGE;if(atEdge)e.preventDefault();},{passive:false});
// Keep a sentinel history entry so the hardware/gesture back closes the race and
// returns to the garage instead of leaving the page entirely.
function armBackGuard(){history.pushState({screen:'race'},'');}
window.addEventListener('popstate',()=>{if(gameActive){backToGarage();toast('已返回车库');}});

let prev=performance.now(),accumulator=0,hudAccum=0,inputAccum=0,lastBoosting=false;
function frame(now){const dt=Math.min(.1,(now-prev)/1000);prev=now;
  if(race&&gameActive){
    const input=controls.read();
    if(mode==='solo'&&!paused){race.racers.find(r=>r.id===playerId).input=input;accumulator+=dt;while(accumulator>=1/60){stepRace(race,1/60);accumulator-=1/60;}}
    if(mode==='lan'&&joined){inputAccum+=dt;if(inputAccum>1/30){send({type:'input',input});inputAccum=0;}if(now-lastStateAt>6000&&!$('pause-dialog').open){showPause();$('pause-title').textContent='网络暂时没有响应';$('pause-description').textContent='请检查 Wi-Fi，恢复后点击继续比赛。';}}
    // Render interpolation only; race rules are evaluated by the server in LAN mode.
    let display=race;
    if(mode==='lan'&&race.status==='racing'){const ahead=Math.min(.1,(now-lastStateAt)/1000);display={...race,racers:race.racers.map(r=>({...r,s:r.s+(r.finishTime===null?r.v*Math.max(0,Math.cos(r.headingError||0))*ahead:0)}))};}
    if(!paused)graphics?.render(display,playerId,dt,now/1000);
    hudAccum+=dt;if(hudAccum>.08){updateHUD();hudAccum=0;}audio.update(race.racers.find(r=>r.id===playerId),!paused&&race.status==='racing');
  }else {graphics?.render(null,null,dt,now/1000);audio.update(null,false);}
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// Read-only diagnostics for smoke tests and FPS / multiplayer checks.
Object.defineProperty(window,'__racerDebug',{get:()=>({mode,active:gameActive,paused,playerId,room:lobby?.room,track:race?.trackId,time:race?.time,status:race?.status,racers:race?.racers.map(r=>({id:r.id,s:r.s,x:r.x,v:r.v,rank:r.rank,bot:r.bot,car:r.car,headingError:r.headingError,vx:r.vx,gear:r.gear,rpm:r.rpm,boost:r.boost,boosting:r.boosting,boostContacts:Object.keys(r.boostContacts||{}).filter(id=>r.boostContacts[id]),braking:r.braking,gripUsage:r.gripUsage,finishTime:r.finishTime})),input:controls.read(),rules:race?.rules,render:graphics?.diagnostics||null})});
