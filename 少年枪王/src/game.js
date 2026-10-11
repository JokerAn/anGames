import { Match, WEAPONS, MAX_HP, MAPS, getMap, aimAngles, defaultConfig, sanitizeConfig, visible, clamp } from './simulation.js';
import { ArenaRenderer } from './renderer.js';
import { GameAudio } from './audio.js';
import { Controls } from './controls.js';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=o=>JSON.parse(JSON.stringify(o));
const audio=new GameAudio();
let mode='solo',config=defaultConfig(),draft=null,selectedWeapon='blaster',activeWeapon='blaster',weaponRequest=undefined,renderer=null,match=null,state=null,playerId='local',room=null,socket=null,connectionEpoch=0,playing=false,paused=false,ended=false,accumulator=0,lastSend=0,lastPing=0,ping=0,lastHud=0,toastTimer,messageTimer,hitTimer,damageTimer,lastHealth=100,lastRespawn=false,seenEvents=new Set(),networkAddresses=[];
let settings={volume:65,sensitivity:70,assist:true,music:true,touch:'auto',quality:'balanced',muted:false};
try{settings={...settings,...JSON.parse(localStorage.getItem('junior-settings')||'{}')};$('#player-name').value=localStorage.getItem('junior-name')||'小小冒险家';}catch{}
function saveSettings(){try{localStorage.setItem('junior-settings',JSON.stringify(settings));}catch{}}
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,4200);}
function message(text,ms=2300){$('#battle-message').textContent=text;clearTimeout(messageTimer);messageTimer=setTimeout(()=>$('#battle-message').textContent='',ms);}
function send(data){if(socket?.readyState===WebSocket.OPEN){socket.send(JSON.stringify(data));return true;}return false;}
function weaponSVG(key){const w=WEAPONS[key],len=key==='sniper'?125:key==='smg'?77:100;return `<svg viewBox="0 0 180 85" aria-hidden="true"><g transform="translate(13 14)"><path d="M28 27h${len}v20H28z" fill="${w.color}"/><path d="M15 28h18v17H15z" fill="#93a291"/><path d="M${len+24} 31h20v12h-20z" fill="#f4ddae"/><path d="M${len+40} 33h10v8h-10z" fill="#567369"/><path d="M48 44h15l-5 20H43z" fill="#5a7165"/><path d="M70 46h16v15H72z" fill="#d4c391"/><path d="M45 23h36v5H45z" fill="#536d63"/><path d="M62 31h27v7H62z" fill="#fff2d1"/>${key==='sniper'?'<rect x="72" y="11" width="39" height="12" rx="5" fill="#54766a"/><path d="M90 22v7" stroke="#54766a" stroke-width="5"/>':''}${key==='shotgun'?'<path d="M85 40h35v12H85z" fill="#ead687"/>':''}</g></svg>`;}
function renderWeapons(){
  $('#weapon-grid').innerHTML=Object.entries(WEAPONS).map(([key,w],i)=>`<button class="weapon-card ${selectedWeapon===key?'selected':''}" data-weapon="${key}" aria-pressed="${selectedWeapon===key}"><span class="weapon-tag">${['均衡','速射','近战','远程'][i]}</span><span class="check">●</span>${weaponSVG(key)}<h3>${w.short}</h3><p>${w.desc}</p></button>`).join('');
  $('#random-weapon').style.color=selectedWeapon==='random'?'#dd8348':'';
}
function ownTeam(){return $('#player-team').value;}
function renderMaps(){
  const map=getMap(config.map),guest=room&&room.host!==playerId;
  $('#map-picker').innerHTML=Object.values(MAPS).map((m,i)=>`<button class="map-option ${m.id===map.id?'selected':''}" data-map="${m.id}" aria-pressed="${m.id===map.id}" ${guest?'disabled':''}><span class="map-number">0${i+1}</span><span><strong>${m.name}</strong><small>${m.tag}</small></span><i>${m.id===map.id?'✓':'↗'}</i></button>`).join('');
  $('#map-title').textContent=map.name;$('#map-description').textContent=map.description;$('#preview').setAttribute('aria-label',`${map.name} 3D 竞技场预览`);
  $('#map-count').textContent=`0${Object.keys(MAPS).indexOf(map.id)+1} / 03`;$('#map-caption').textContent=guest?'房主选择地图 · 第三人称':`${map.tag} / 第三人称`;
  renderer?.setMap(map.id);
}
function renderLobby(){
  renderMaps();
  const team=ownTeam(),enemy=team==='blue'?'red':'blue',allies=config.bots[team];
  const other=room?.members.find(m=>m.id!==playerId&&m.team===team);
  let cards=`<div class="squad-member me"><span class="avatar">♟</span><strong>你 · ${team==='blue'?'蓝':'红'}队</strong></div>`;
  if(other)cards+=`<div class="squad-member"><span class="avatar">☺</span><strong>${escape(other.name)}</strong></div>`;
  for(let i=0;i<Math.min(allies.length,other?1:2);i++)cards+=`<div class="squad-member"><span class="avatar">▣</span><strong>${allies[i].difficulty==='hard'?'困难':'简单'}伙伴 ${i+1}</strong></div>`;
  if(!allies.length&&!other)cards+='<div class="squad-member"><span class="avatar">＋</span><strong>点击配置添加伙伴</strong></div>';
  if(allies.length>(other?1:2))cards+=`<div class="squad-member"><span class="avatar">＋</span><strong>${allies.length-(other?1:2)} 位伙伴</strong></div>`;
  $('#squad-preview').innerHTML=cards;
  const easy=config.bots[enemy].filter(b=>b.difficulty==='easy').length,hard=config.bots[enemy].length-easy,enemyHuman=room?.members.filter(m=>m.team===enemy).length||0;
  $('#enemy-summary').textContent=[easy?`${easy} 简单`:null,hard?`${hard} 困难`:null,enemyHuman?`${enemyHuman} 位玩家`:null].filter(Boolean).join(' + ')||'等待添加对手';
  $('#duration').value=config.duration;$('#target').value=config.target;
  const guest=room&&room.host!==playerId;
  if(ended&&room){$('#play-again').disabled=guest;$('#play-again').textContent=guest?'等待房主开启下一局':'再来一局 ↗';}
  for(const sel of ['#configure-team','#configure-enemy','#duration','#target'])$(sel).disabled=!!guest;
  const start=$('#start-game');start.disabled=mode==='lan'&&(!room||guest);start.firstElementChild.textContent=mode==='solo'?'开始冒险':!room?'先加入好友房间':guest?'等待房主开始':'全员出发';
  $('#start-note').innerHTML=mode==='lan'?room?'双方选好队伍后，房主就能开始':'先连接同一 Wi-Fi，再输入同一个密码':'<span>∞</span> 无限弹药，尽情发光';
  if(room){$('#room-members').innerHTML=room.members.map(m=>`<div class="member-row ${m.team}"><i></i><span>${escape(m.name)}</span><span>${m.team==='blue'?'蓝队':'红队'} · ${m.id===room.host?'房主':'伙伴'}</span></div>`).join('')+(room.members.length===1?'<div class="member-row">等待一位小伙伴加入…</div>':'');}
  $('#join-room').hidden=!!room;$('#leave-room').hidden=!room;$('#room-password').disabled=!!room;
}
function setMode(next){
  if(room&&next!==mode)disconnect();
  if(mode!==next){const team=ownTeam();if(next==='lan'&&config.bots[team].length===2)config.bots[team].pop();if(next==='solo'&&config.bots[team].length===1)config.bots[team].push({difficulty:'easy',weapon:'random'});}
  mode=next;$$('[data-mode]').forEach(b=>b.classList.toggle('selected',b.dataset.mode===mode));$('#lan-panel').hidden=mode!=='lan';$('#mode-description').textContent=mode==='solo'?'和人机小伙伴一起，练练你的好身手。':'同一个 Wi-Fi，同一个密码，就能一起玩。';renderLobby();
}
function renderEditor(){
  $('#bot-editor').innerHTML=['blue','red'].map(team=>`<section class="bot-team ${team}"><h3>● ${team==='blue'?'蓝色':'红色'}小队 <small>(${draft.bots[team].length})</small></h3><div class="bot-list">${draft.bots[team].map((b,i)=>`<div class="bot-row"><span>${i+1}</span><select data-team="${team}" data-index="${i}" data-field="difficulty" aria-label="${team==='blue'?'蓝':'红'}队人机${i+1}难度"><option value="easy" ${b.difficulty==='easy'?'selected':''}>简单</option><option value="hard" ${b.difficulty==='hard'?'selected':''}>困难</option></select><select class="weapon-select" data-team="${team}" data-index="${i}" data-field="weapon" aria-label="${team==='blue'?'蓝':'红'}队人机${i+1}武器"><option value="random">随机武器</option>${Object.entries(WEAPONS).map(([k,w])=>`<option value="${k}" ${b.weapon===k?'selected':''}>${w.short}</option>`).join('')}</select><button data-remove="${i}" data-team="${team}" aria-label="移除${team==='blue'?'蓝':'红'}队人机${i+1}">×</button></div>`).join('')}</div><button class="add-bot" data-add="${team}" ${draft.bots[team].length>=24?'disabled':''}>＋ 添加人机</button></section>`).join('');
  $('#bot-total').textContent=`共 ${draft.bots.blue.length+draft.bots.red.length} 位人机 · 真人队伍在大厅选择`;
}
function openConfig(){if(room&&room.host!==playerId)return;draft=clone(config);renderEditor();$('#config-dialog').showModal();}
function publishConfig(){config=sanitizeConfig(config);if(room)send({type:'config',config});renderLobby();}
function applySettings(){
  settings.volume=clamp(Number(settings.volume)||0,0,100);settings.sensitivity=clamp(Number(settings.sensitivity)||70,20,150);
  $('#volume').value=settings.volume;$('#sensitivity').value=settings.sensitivity;$('#aim-assist').checked=settings.assist;$('#music').checked=settings.music;$('#touch-mode').value=settings.touch;$('#quality').value=settings.quality;
  audio.muted=!!settings.muted;audio.setVolume(settings.volume/100);audio.music=settings.music;controls.sensitivity=settings.sensitivity/100;controls.setTouchMode(settings.touch);renderer?.setQuality(settings.quality);updateSoundButtons();saveSettings();
}
function updateSoundButtons(){for(const s of ['#sound-toggle','#game-sound']){$(s).textContent=audio.muted?'♪̸':'♫';$(s).setAttribute('aria-label',audio.muted?'开启声音':'关闭声音');}}
function toggleSound(){audio.unlock();audio.toggle();settings.muted=audio.muted;saveSettings();updateSoundButtons();toast(audio.muted?'声音已关闭':'声音已开启');}
async function joinRoom(){
  const password=$('#room-password').value.trim();if(password.length<4||password.length>24){toast('和伙伴约定一个 4～24 位的密码吧');return;}
  audio.unlock();$('#join-room').disabled=true;$('#join-room').textContent='正在连接…';const epoch=++connectionEpoch;
  if(socket)socket.close();socket=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}`);const ws=socket;
  const timeout=setTimeout(()=>{if(epoch===connectionEpoch&&!room){ws.close();toast('连接超时，请确认电脑上的游戏服务仍在运行');}},7000);
  ws.addEventListener('open',()=>{if(epoch!==connectionEpoch)return;send({type:'join',password,name:$('#player-name').value,team:ownTeam(),weapon:selectedWeapon,config});});
  ws.addEventListener('message',event=>{
    if(epoch!==connectionEpoch)return;let data;try{data=JSON.parse(event.data);}catch{return;}
    if(data.type==='hello')playerId=data.id;
    if(data.type==='room'){
      clearTimeout(timeout);const wasPlaying=playing;room=data;config=sanitizeConfig(data.config);const me=data.members.find(m=>m.id===playerId);if(me){$('#player-team').value=me.team;selectedWeapon=me.weapon;renderWeapons();}
      if(data.phase==='lobby'&&wasPlaying)backToLobby(false);renderLobby();$('#join-room').disabled=false;$('#join-room').textContent='创建 / 加入房间 →';
      if(data.members.length===2&&!wasPlaying)toast('伙伴已到齐！选择同队合作，或不同队对战');
    }
    if(data.type==='start')beginMatch(data.state);
    if(data.type==='state'){state=data.state;handleEvents(data.events||[]);if(state.ended&&!ended)showResult();}
    if(data.type==='pong')ping=Math.max(0,Date.now()-data.at);
    if(data.type==='notice')toast(data.message);
    if(data.type==='error'){clearTimeout(timeout);toast(data.message);$('#join-room').disabled=false;$('#join-room').textContent='创建 / 加入房间 →';if(!room){ws.close();}}
  });
  ws.addEventListener('close',()=>{clearTimeout(timeout);if(epoch!==connectionEpoch)return;const hadRoom=!!room;room=null;socket=null;$('#join-room').disabled=false;$('#join-room').textContent='创建 / 加入房间 →';$('#room-members').textContent='';if(playing)backToLobby(false);renderLobby();if(hadRoom)toast('连接已断开。确认 Wi-Fi 和电脑服务后，用原密码重新加入。');});
  ws.addEventListener('error',()=>{if(epoch===connectionEpoch)toast('暂时连不上房间，请确认电脑和手机连接同一 Wi-Fi');});
}
function disconnect(){connectionEpoch++;if(socket){if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'leave'}));socket.close();}socket=null;room=null;$('#room-members').textContent='';$('#join-room').disabled=false;$('#join-room').textContent='创建 / 加入房间 →';renderLobby();}
async function startGame(){
  await audio.unlock();if(!renderer){toast('3D 画面尚未准备好，请使用支持 WebGL 的浏览器');return;}
  try{localStorage.setItem('junior-name',$('#player-name').value);}catch{}
  config.duration=Number($('#duration').value);config.target=Number($('#target').value);
  if(mode==='lan'){send({type:'config',config});send({type:'start'});return;}
  const counts={blue:config.bots.blue.length,red:config.bots.red.length};counts[ownTeam()]++;if(!counts.blue||!counts.red){toast('给对面添加至少一位小对手吧');openConfig();return;}
  playerId='local';match=new Match(config,[{id:playerId,name:$('#player-name').value||'小小冒险家',team:ownTeam(),weapon:selectedWeapon}]);beginMatch(match.snapshot());
  if(controls.touch){try{await document.documentElement.requestFullscreen?.();await screen.orientation?.lock?.('landscape');}catch{}}
  else controls.lock();
}
function beginMatch(snapshot){
  state=snapshot;weaponRequest=undefined;playing=true;paused=false;ended=false;accumulator=0;seenEvents.clear();lastHealth=100;lastRespawn=false;
  $$('dialog[open]').forEach(d=>d.close());$('#app').hidden=true;$('#game-screen').hidden=false;document.body.classList.add('playing');$('#kill-feed').replaceChildren();$('#respawn-overlay').hidden=true;renderer.setMap(state.config.map);renderer.setMode('game');$('#map-badge').textContent=`${getMap(state.config.map).name} · 第三人称`;controls.setActive(true);audio.playing=true;
  const me=state.actors.find(a=>a.id===playerId);if(me){controls.yaw=me.yaw;controls.pitch=me.pitch;activeWeapon=me.weapon;$('#player-badge').textContent=me.team==='blue'?'● 蓝色小队':'● 红色小队';$('#player-badge').style.background=me.team==='blue'?'#356678a6':'#b77165aa';}
  message('出发吧，小小勇士！',2700);audio.respawn();updateHud();
}
function pauseGame(){if(!playing||paused||ended)return;paused=true;controls.setActive(false);send({type:'input',input:controls.input(weaponRequest)});$('#pause-description').textContent=mode==='solo'?'单人对局已暂停，准备好再继续。':'联机对局仍在进行，伙伴正在等你回来。';$('#pause-dialog').showModal();}
function resumeGame(){if(!playing||ended)return;$('#pause-dialog').close();paused=false;accumulator=0;controls.setActive(true);audio.unlock();controls.lock();}
function backToLobby(notify=true){
  playing=false;paused=false;ended=false;match=null;state=null;controls.setActive(false);audio.playing=false;$$('dialog[open]').forEach(d=>d.close());$('#game-screen').hidden=true;$('#app').hidden=false;document.body.classList.remove('playing','aiming');renderer?.setMode('preview');clearTimeout(messageTimer);$('#battle-message').textContent='';
  if(notify&&room){if(room.host===playerId)send({type:'lobby'});else disconnect();}
  if(document.fullscreenElement)document.exitFullscreen?.().catch(()=>{});renderLobby();
}
function showResult(){
  if(ended||!state)return;ended=true;paused=false;controls.setActive(false);$('#pause-dialog').close();$('#settings-dialog').close();$('#respawn-overlay').hidden=true;
  const me=state.actors.find(a=>a.id===playerId),won=state.winner===me?.team,draw=state.winner==='draw';
  $('#result-title').textContent=draw?'旗鼓相当，都很棒！':won?'胜利啦，小小勇士！':'勇敢尝试，就是进步！';$('#result-subtitle').textContent=draw?'这次打成了平手，下次再来比一比。':`${state.winner==='blue'?'蓝色':'红色'}小队率先收获了更多快乐。`;
  $('#result-score').innerHTML=`<span>${state.score.blue}</span> : <span>${state.score.red}</span>`;$('#result-stats').innerHTML=`<div><strong>${me?.kills||0}</strong><span>快乐得分</span></div><div><strong>${me?.deaths||0}</strong><span>勇敢返场</span></div><div><strong>${Math.round(state.time)}s</strong><span>冒险时光</span></div>`;
  $('#play-again').disabled=!!room&&room.host!==playerId;$('#play-again').textContent=room&&room.host!==playerId?'等待房主开启下一局':'再来一局 ↗';$('#result-dialog').showModal();audio.victory();
}
function switchWeapon(index){if(!playing||paused||ended)return;const keys=Object.keys(WEAPONS);activeWeapon=keys[index??(keys.indexOf(activeWeapon)+1)%keys.length];weaponRequest=activeWeapon;audio.click();message(`已切换 · ${WEAPONS[activeWeapon].short}`,1100);}
const controls=new Controls({onPause:pauseGame,onSwitch:switchWeapon,onJump:()=>audio.jump()});
function handleEvents(events){
  for(const e of events){if(seenEvents.has(e.id))continue;seenEvents.add(e.id);if(seenEvents.size>2500)seenEvents.delete(seenEvents.values().next().value);renderer?.effect(e,playerId);
    const me=state?.actors.find(a=>a.id===playerId);
    if(e.type==='shot'){
      const dist=me?Math.hypot(e.origin.x-me.x,e.origin.z-me.z):100,own=e.actor===playerId;
      if(own||dist<27){const angle=Math.atan2(e.origin.x-(me?.x||0),e.origin.z-(me?.z||0));audio.shot(e.weapon,own?1:Math.max(0,1-dist/27)*.26,own?0:Math.sin(angle+controls.yaw));}
    }
    if(e.type==='hit'&&e.actor===playerId){audio.hit();$('#hit-marker').style.opacity=1;clearTimeout(hitTimer);hitTimer=setTimeout(()=>$('#hit-marker').style.opacity=0,120);}
    if(e.type==='hit'&&e.target===playerId){audio.hurt();$('#damage-flash').style.opacity=.7;clearTimeout(damageTimer);damageTimer=setTimeout(()=>$('#damage-flash').style.opacity=0,230);}
    if(e.type==='pop'){
      const actor=state?.actors.find(a=>a.id===e.actor),victim=state?.actors.find(a=>a.id===e.target),row=document.createElement('div');row.innerHTML=`<span class="${e.team}">${escape(actor?.name||'小伙伴')}</span> ✦ ${escape(victim?.name||'小伙伴')} 返场中`;$('#kill-feed').prepend(row);while($('#kill-feed').children.length>4)$('#kill-feed').lastChild.remove();setTimeout(()=>row.remove(),5000);
      if(e.actor===playerId){audio.pop();message('✦ 漂亮！为小队 +1 分',1400);}
    }
    if(e.type==='respawn'&&e.actor===playerId){controls.yaw=me?.yaw||0;controls.pitch=me?.pitch??-.12;controls.setFreeLook(false);activeWeapon=me?.weapon||activeWeapon;weaponRequest=undefined;audio.respawn();message('能量满满，重新出发！',1800);}
  }
}
function updateHud(){if(!state)return;$('#blue-score').textContent=state.score.blue;$('#red-score').textContent=state.score.red;const remaining=Math.max(0,Math.ceil(state.config.duration-state.time));$('#game-time').textContent=`${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}`;$('#goal-label').textContent=`目标 ${state.config.target}`;
  const me=state.actors.find(a=>a.id===playerId);if(!me)return;$('#health-value').textContent=Math.ceil(me.hp);$('#health-bar').style.width=`${Math.max(0,me.hp/MAX_HP*100)}%`;$('#health-bar').style.background=me.hp<MAX_HP*.35?'#ffcc8c':'#defaab';$('#shield-label').textContent=me.shield>0?'✦ 返场保护':'';$('#current-weapon-name').textContent=WEAPONS[me.weapon].short;$('#respawn-overlay').hidden=me.hp>0||ended;$('#respawn-seconds').textContent=Math.max(1,Math.ceil(me.respawn));
  const respawning=me.hp<=0;if(respawning&&!lastRespawn)controls.fire=false;lastRespawn=respawning;lastHealth=me.hp;
  $('#connection-label').textContent=mode==='solo'?'单人冒险 · 本地运行':`好友联机 · ${ping} ms`;
  renderer?.minimap($('#minimap'),state,playerId);
}
function assist(dt){if(!settings.assist||!controls.touch||!state||!controls.active||controls.freeLook)return;const me=state.actors.find(a=>a.id===playerId);if(!me||me.hp<=0)return;let best=null,score=.14;
  for(const a of state.actors){if(a.team===me.team||a.hp<=0||a.shield>0)continue;const angles=aimAngles({...me,viewAspect:controls.viewAspect},{x:a.x,y:a.y+1.1,z:a.z},controls.aim),yaw=angles.yaw,diff=Math.atan2(Math.sin(yaw-controls.yaw),Math.cos(yaw-controls.yaw)),distance=Math.hypot(a.x-me.x,a.z-me.z);if(distance>35)continue;const pitch=angles.pitch;if(Math.abs(diff)<score&&Math.abs(pitch-controls.pitch)<.14&&visible(me,a,state.config.map)){best={diff,pitch};score=Math.abs(diff);}}
  if(best){controls.yaw+=best.diff*Math.min(1,dt*3);controls.pitch+=(best.pitch-controls.pitch)*Math.min(1,dt*2);}
}
function bindUI(){
  document.addEventListener('click',e=>{if(e.target.closest('button')){audio.unlock();if(!playing)audio.click();}});
  $('#map-picker').onclick=e=>{const b=e.target.closest('[data-map]');if(!b||b.disabled||room&&room.host!==playerId)return;config.map=b.dataset.map;publishConfig();};
  $$('[data-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));$('#try-lan').onclick=()=>{setMode('lan');$('#room-password').scrollIntoView({behavior:'smooth',block:'center'});};
  $('#weapon-grid').onclick=e=>{const b=e.target.closest('[data-weapon]');if(!b)return;selectedWeapon=b.dataset.weapon;renderWeapons();if(room)send({type:'profile',team:ownTeam(),weapon:selectedWeapon});};
  $('#random-weapon').onclick=()=>{selectedWeapon='random';renderWeapons();if(room)send({type:'profile',team:ownTeam(),weapon:selectedWeapon});toast('每次返场都会获得一把随机武器');};
  $('#player-team').onchange=()=>{if(room)send({type:'profile',team:ownTeam(),weapon:selectedWeapon});renderLobby();};
  $('#configure-team').onclick=openConfig;$('#configure-enemy').onclick=openConfig;$('#squad-preview').onclick=openConfig;
  $('#bot-editor').onchange=e=>{const t=e.target;if(t.dataset.field)draft.bots[t.dataset.team][Number(t.dataset.index)][t.dataset.field]=t.value;};
  $('#bot-editor').onclick=e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.add&&draft.bots[b.dataset.add].length<24)draft.bots[b.dataset.add].push({difficulty:'easy',weapon:'random'});if(b.dataset.remove!==undefined)draft.bots[b.dataset.team].splice(Number(b.dataset.remove),1);renderEditor();};
  $$('[data-preset]').forEach(b=>b.onclick=()=>{const team=ownTeam(),enemy=team==='blue'?'red':'blue';draft.bots={blue:[],red:[]};if(b.dataset.preset!=='duel'){draft.bots[team]=Array.from({length:mode==='solo'?2:1},()=>({difficulty:'easy',weapon:'random'}));const counts=b.dataset.preset==='swarm'?[10,1]:b.dataset.preset==='challenge'?[1,5]:[3,0];draft.bots[enemy]=[...Array.from({length:counts[0]},()=>({difficulty:'easy',weapon:'random'})),...Array.from({length:counts[1]},()=>({difficulty:'hard',weapon:'random'}))];}renderEditor();});
  $('#save-config').onclick=()=>{config=sanitizeConfig(draft);publishConfig();$('#config-dialog').close();};
  for(const s of ['#duration','#target'])$(s).onchange=()=>{config.duration=Number($('#duration').value);config.target=Number($('#target').value);publishConfig();};
  $$('.close-dialog').forEach(b=>b.onclick=()=>{const d=b.closest('dialog');d.close();if(d.id==='settings-dialog'&&playing&&paused&&!ended)$('#pause-dialog').showModal();});
  $$('dialog').forEach(d=>d.addEventListener('cancel',e=>{if(d.id==='pause-dialog'){e.preventDefault();resumeGame();}else if(d.id==='result-dialog')e.preventDefault();else if(d.id==='settings-dialog'&&playing&&paused){setTimeout(()=>$('#pause-dialog').showModal(),0);}}));
  $('#guide-open').onclick=()=>$('#guide-dialog').showModal();$('.close-guide').onclick=()=>$('#guide-dialog').close();$('#settings-open').onclick=()=>$('#settings-dialog').showModal();
  $('#sound-toggle').onclick=toggleSound;$('#game-sound').onclick=toggleSound;$('#start-game').onclick=startGame;$('#join-room').onclick=joinRoom;$('#room-password').onkeydown=e=>{if(e.key==='Enter'&&!room)joinRoom();};$('#leave-room').onclick=disconnect;
  $('#pause-game').onclick=pauseGame;$('#resume-game').onclick=resumeGame;$('#quit-game').onclick=()=>backToLobby();$('#pause-settings').onclick=()=>{$('#pause-dialog').close();$('#settings-dialog').showModal();};$('#current-weapon').onclick=()=>switchWeapon();
  $('#result-lobby').onclick=()=>backToLobby();$('#play-again').onclick=()=>{if(room){send({type:'lobby'});send({type:'start'});}else{backToLobby(false);startGame();}};
  const settingMap={'volume':'volume','sensitivity':'sensitivity','aim-assist':'assist','music':'music','touch-mode':'touch','quality':'quality'};
  for(const [id,key] of Object.entries(settingMap))$('#'+id).oninput=e=>{settings[key]=e.target.type==='checkbox'?e.target.checked:e.target.type==='range'?Number(e.target.value):e.target.value;applySettings();};
  window.addEventListener('game-render-error',()=>{pauseGame();toast('画面暂时中断，请返回大厅后刷新页面恢复');});
}
async function init(){
  renderWeapons();renderLobby();bindUI();applySettings();
  try{renderer=new ArenaRenderer($('#preview'),$('#game-canvas'));renderer.setQuality(settings.quality);renderMaps();}catch(e){console.error(e);$('#preview').innerHTML='<span class="loading">无法启动 3D，请开启浏览器硬件加速后刷新。</span>';$('#start-game').disabled=true;toast('浏览器不支持 WebGL，建议使用 Safari 或 Chrome');}
  try{const response=await fetch('/api/network');const data=await response.json();networkAddresses=data.addresses||[];const addresses=networkAddresses.length?networkAddresses:[location.origin];$('#network-address').innerHTML=`手机连接同一 Wi-Fi 后打开：<br>${addresses.map(a=>`<code>${escape(a)}</code>`).join('<br>')}`;}catch{$('#network-address').textContent='请通过 npm start 启动，再用电脑的局域网地址访问。';}
  let previous=performance.now();
  function frame(now){requestAnimationFrame(frame);const dt=Math.min((now-previous)/1000,.06);previous=now;if(document.hidden)return;
    if(playing&&state){
      if(!ended){assist(dt);const input=controls.input(weaponRequest);
        if(mode==='solo'&&match&&!paused){accumulator+=dt;match.setInput(playerId,input);while(accumulator>=1/60){match.step(1/60);accumulator-=1/60;}state=match.snapshot();handleEvents(match.drainEvents());if(state.ended)showResult();}
        if(mode==='lan'&&now-lastSend>33){send({type:'input',input});lastSend=now;}if(mode==='lan'&&now-lastPing>2500){send({type:'ping',at:Date.now()});lastPing=now;}
        const me=state.actors.find(a=>a.id===playerId);if(me?.weapon===weaponRequest)weaponRequest=undefined;if(me&&me.hp>0&&!paused&&(Math.abs(input.moveX||0)+Math.abs(input.moveZ||0)>.1)&&me.y===0)audio.step(now/1000);
      }
      renderer?.sync(state,playerId,dt,controls);if(now-lastHud>70){updateHud();lastHud=now;}
    }
    renderer?.render(dt);
  }
  requestAnimationFrame(frame);
}
init();
