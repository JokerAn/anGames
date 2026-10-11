import { Soundscape } from './audio.js';
import { createLevel, THEMES, MODES, LEVELS, LEVEL_COUNT } from './levels.js';
import { Artwork, rounded, star } from './art.js';
import { normalizeSave } from './save.js';
import { MAX_AMMO, AMMO_PER_PICKUP, SHOT_COOLDOWN, MAX_PROJECTILES, BULLET_SPEED, BULLET_LIFETIME, advanceProjectiles } from './combat.js';

const $ = id => document.getElementById(id);
const canvas=$('scene'), ctx=canvas.getContext('2d',{alpha:false});
const art=new Artwork();
const STORAGE='windy-trails:v1';
let rawSave={};try{rawSave=JSON.parse(localStorage.getItem(STORAGE)||'{}');}catch{}
const saved=normalizeSave(rawSave,LEVEL_COUNT);
const sound=new Soundscape(saved.sound!==false);sound.music=saved.music!==false;
const state={mode:'home',difficulty:'easy',startLevel:0,level:createLevel(0),player:null,camera:0,coins:0,stars:0,ammo:0,projectiles:[],health:3,time:180,elapsed:0,checkpoint:120,particles:[],floaters:[],shake:0,toastTime:0,totalStars:0,levelStartCoins:0,deathTimer:0,winTimer:0};
const view={width:1280,height:720,dpr:1,portrait:false,offsetY:0};
const input=new Set(),heldKeys=new Set(),pointers=new Map(),activeKeyCodes=new Map();
let jumpBuffer=0,jumpHeld=false,dashQueued=false,shootQueued=false,lastHud='',lastTime=0,accumulator=0,animationTime=0,lastFocus=null,needsRender=true;
const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
const controls=[...document.querySelectorAll('[data-action]')];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const overlaps=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
function store(){try{localStorage.setItem(STORAGE,JSON.stringify(saved));}catch{}}
function resize(){
  needsRender=true;
  const box=canvas.getBoundingClientRect();
  view.portrait=box.height>box.width*1.12;view.height=view.portrait?1000:box.height<500?600:720;
  view.width=view.height*box.width/Math.max(1,box.height);view.offsetY=view.portrait?160:view.height===600?-90:0;
  view.dpr=Math.min(window.devicePixelRatio||1,2);
  canvas.width=Math.round(box.width*view.dpr);canvas.height=Math.round(box.height*view.dpr);
  ctx.setTransform(canvas.width/view.width,0,0,canvas.height/view.height,0,0);
  art.viewWidth=view.width;
  if(state.player)state.camera=clamp(state.player.x-view.width*.32,0,Math.max(0,state.level.length-view.width+100));
}
window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);resize();
function newPlayer(x=120){return{x,y:480,w:32,h:70,vx:0,vy:0,facing:1,grounded:false,coyote:0,dash:0,dashCooldown:0,invincible:0,shield:0,walk:0,crouch:false,support:null,shotCooldown:0,shotFlash:0};}
function notify(text){$('toast').textContent=text;$('toast').classList.add('visible');state.toastTime=3.5;}
function particle(x,y,color,count=8,speed=150){
  const budget=reduceMotion?Math.min(count,3):count;
  for(let i=0;i<budget&&state.particles.length<110;i++){const angle=Math.random()*Math.PI*2,v=speed*(.3+Math.random()*.7);state.particles.push({x,y,vx:Math.cos(angle)*v,vy:Math.sin(angle)*v-50,life:.5+Math.random()*.4,max:.9,size:2+Math.random()*3,color});}
}
function floating(text,x,y,color='#fff7d1'){if(state.floaters.length<12)state.floaters.push({text,x,y,life:1,color});}
function clearPendingActions(){jumpBuffer=0;dashQueued=false;shootQueued=false;}
function clearInput(){input.clear();heldKeys.clear();activeKeyCodes.clear();pointers.clear();clearPendingActions();jumpHeld=false;controls.forEach(b=>b.classList.remove('pressed'));}
function syncInput(){
  const previous=new Set(input);input.clear();heldKeys.forEach(a=>input.add(a));pointers.forEach(a=>{if(a)input.add(a);});
  const canAct=state.mode==='playing'&&state.deathTimer<=0;
  const jumping=input.has('jump')||input.has('up'),wasJumping=previous.has('jump')||previous.has('up');
  if(jumping&&!wasJumping&&canAct)jumpBuffer=.15;
  if(input.has('dash')&&!previous.has('dash')&&canAct)dashQueued=true;
  if(input.has('shoot')&&!previous.has('shoot')&&canAct)shootQueued=true;
  if(input.has('shoot')&&!previous.has('shoot')&&canAct&&state.ammo===0){sound.play('empty');notify('没有子弹了 · 寻找金色弹药包或补给宝箱');}
  jumpHeld=jumping;
  controls.forEach(b=>b.classList.toggle('pressed',input.has(b.dataset.action)));
}
function begin(index=0,keep=false){
  clearInput();closeModal();sound.unlock();
  state.level=createLevel(index,state.difficulty);state.player=newPlayer();state.camera=0;state.time=state.level.time;
  state.ammo=0;state.projectiles=[];state.elapsed=0;state.health=state.level.maxHealth;state.stars=0;state.checkpoint=120;state.particles=[];state.floaters=[];state.mode='playing';state.deathTimer=0;state.winTimer=0;state.shake=0;
  if(!keep){state.coins=0;state.totalStars=0;state.startLevel=index;}state.levelStartCoins=state.coins;
  $('welcome').hidden=true;$('scene-caption').hidden=true;$('bottom-note').hidden=true;$('hud').hidden=false;
  $('game-shell').classList.add('playing');$('game-shell').classList.toggle('night',!!state.level.theme.night);$('pause-button').disabled=false;
  $('level-label').innerHTML=`${String(index+1).padStart(2,'0')}/${String(LEVEL_COUNT).padStart(2,'0')} <i>/</i> ${state.level.theme.name}`;updateDifficultyUI();
  updateHud();notify(`${MODES[state.difficulty].name}模式 · ${state.level.hint}`);needsRender=true;
}
function home(){
  closeModal();clearInput();state.mode='home';state.level=createLevel(0);state.player=null;state.camera=0;state.particles=[];state.floaters=[];state.ammo=0;state.projectiles=[];updateHud();
  $('welcome').hidden=false;$('scene-caption').hidden=false;$('bottom-note').hidden=false;$('hud').hidden=true;$('pause-button').disabled=true;
  $('game-shell').classList.remove('playing','night');$('level-label').innerHTML=`01/${String(LEVEL_COUNT).padStart(2,'0')} <i>/</i> 微风原野`;updateDifficultyUI();needsRender=true;$('toast').classList.remove('visible');
}
function updateDifficultyUI(){
  const hard=state.difficulty==='hard';
  $('difficulty-badge').textContent=MODES[state.difficulty].name;
  $('game-shell').classList.toggle('hard-mode',hard);
  document.querySelectorAll('[data-difficulty]').forEach(button=>{
    const selected=button.dataset.difficulty===state.difficulty;
    button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));
  });
}
function showMap(){
  const record=saved.records?.[state.difficulty]?.levels||{};
  openModal({mark:'⌁',eyebrow:`${MODES[state.difficulty].name}模式 · ${LEVEL_COUNT} 座岛屿`,title:'选择下一段旅程',
    content:`<p>从所选关卡开启一段新旅程，金币与星光重新累计。</p><div class="level-grid">${LEVELS.map((level,i)=>`<button class="level-card" data-level="${i}" aria-label="第${i+1}关 ${THEMES[i].name}"><b>${String(i+1).padStart(2,'0')}</b><span>${THEMES[i].name}<small>${['奔跑与跳跃','升降浮台','连续沟壑','坍塌浮台','尖刺阵地','冰面惯性','移动浮桥','综合挑战'][i]}</small></span><em>${record[i]?'★'.repeat(record[i].stars)+'☆'.repeat(3-record[i].stars):'未完成'}</em></button>`).join('')}</div>`,
    actions:[['回到首页',closeModal,true]]});
  $('modal-content').querySelectorAll('[data-level]').forEach(button=>button.onclick=()=>begin(Number(button.dataset.level)));
  $('modal-content').querySelector('button')?.focus();
}
function openModal({mark='✦',eyebrow='TAKE A LITTLE BREAK',title,content='',actions=[]}){
  lastFocus=document.activeElement;clearInput();$('modal-mark').textContent=mark;$('modal-eyebrow').textContent=eyebrow;
  $('modal-title').textContent=title;$('modal-content').innerHTML=content;$('modal-actions').replaceChildren();
  for(const [label,handler,secondary]of actions){const b=document.createElement('button');b.className=secondary?'secondary-button':'primary-button';b.textContent=label;b.onclick=handler;$('modal-actions').append(b);}
  $('modal').hidden=false;$('modal').querySelector('.modal-card').scrollTop=0;queueMicrotask(()=>$('modal').querySelector('button')?.focus());
}
function closeModal(){$('modal').hidden=true;lastFocus?.focus?.();}
function pause(){if(state.mode!=='playing')return;state.mode='paused';openModal({title:'风会等你',content:'<p>歇一歇脚，再去看看前面的风景。<br>你的冒险进度会留在这里。</p>',actions:[['继续冒险',resume],['重新挑战本关',retry],['回到起点',home,true]]});}
function resume(){closeModal();clearInput();state.mode='playing';sound.unlock();lastTime=performance.now();accumulator=0;}
function help(){
  const previous=state.mode;if(previous==='playing')state.mode='paused';
  openModal({mark:'✧',eyebrow:'A LITTLE FIELD GUIDE',title:'冒险家的口袋指南',content:`<div class="help-grid"><b>移动</b><span>左侧 ← → 或键盘 A / D 移动。</span><b>跳跃</b><span>右侧跳跃 / ↑ / 空格。长按跳得更高，松开小跳；从上方踩扁蘑菇怪。</span><b>下蹲</b><span>↓ / S 下蹲；空中按住可快速下落。</span><b>冲刺</b><span>⚡ / Shift 短暂加速，可越过更远的沟壑。每次冷却 1.2 秒。</span><b>射击</b><span>拾取金色弹药包，按右侧射击 / J / F。长按连发，每发消耗 1 发弹药；子弹按朝向飞行，击败怪物得 2 枚金币，遇到地形会消失。简单模式每份 12 发，困难模式 8 发，上限 30 发。</span><b>探索</b><span>顶起 ? 宝箱，收集金币和每关 3 颗星光。叶子护盾抵挡一次伤害。</span><b>旅程</b><span>旗帜保存本关复活点，弹跳菇助你登高。简单模式 3 颗心，困难模式 2 颗心。共 ${LEVEL_COUNT} 关，抵达石门即可通关。</span><b>新障碍</b><span>尖刺只能跳过，护盾可挡一次伤害；裂纹浮台踩后坍塌并在 4 秒后恢复。冰面更滑，横移平台会带着你移动。</span><b>困难</b><span>沟壑更宽，敌人更多更快，计时更紧；跳跃手感与简单模式一致。</span></div>`,actions:[['知道了，出发！',()=>{closeModal();if(previous==='playing')resume();else if(previous==='home')begin(0);}]]});
}
function updateHud(){
  const key=`${state.level.maxHealth}/${state.health}/${state.coins}/${state.stars}/${state.ammo}/${Math.ceil(state.time)}`;if(key===lastHud)return;lastHud=key;
  $('hearts').innerHTML=Array.from({length:state.level.maxHealth},(_,i)=>i<state.health?'♥':'<span class="heart-lost">♥</span>').join(' ');$('hearts').setAttribute('aria-label',`${state.health}点生命`);
  $('ammo-count').textContent=String(state.ammo).padStart(2,'0');$('shoot-ammo').textContent=state.ammo;
  $('ammo-stat').setAttribute('aria-label',`剩余 ${state.ammo} 发子弹`);
  const shootButton=document.querySelector('[data-action="shoot"]');shootButton.classList.toggle('empty',state.ammo===0);shootButton.setAttribute('aria-label',state.ammo?`射击，剩余 ${state.ammo} 发子弹，长按连发`:'射击，先拾取弹药，长按连发');
  $('coin-count').textContent=String(state.coins).padStart(2,'0');$('star-count').textContent=Array.from({length:3},(_,i)=>i<state.stars?'★':'☆').join(' ');$('star-count').setAttribute('aria-label',`${state.stars}颗星光`);
  $('time-count').textContent=Math.max(0,Math.ceil(state.time));$('time-count').style.color=state.time<30?'#c76a4b':'';
}
function hurt(fall=false){
  const p=state.player;if(state.mode!=='playing'||state.deathTimer>0||(!fall&&p.invincible>0))return;
  if(!fall&&p.shield){p.shield=0;p.invincible=1.6;particle(p.x+16,p.y+25,'#d4ebbc',14);sound.play('block');notify('叶子护盾保护了你');return;}
  if(fall)clearPendingActions();
  if(fall||state.health<=1)state.projectiles=[];
  state.health--;sound.play('hurt');state.shake=reduceMotion?0:.22;particle(p.x+16,p.y+25,'#f8dba0',13);
  if(state.health<=0){state.mode='over';sound.play('lose');openModal({mark:'❧',eyebrow:'EVERY TRY IS A NEW STORY',title:'下一次，一定更远',content:`<p>阿屿需要休息一下。风景还在等你，<br>再给这段旅程一次机会吧。</p><div class="result-stats"><div><b>${state.coins}</b><span>收集金币</span></div><div><b>${state.stars} / 3</b><span>发现星光</span></div></div>`,actions:[['再试一次',()=>retry()],['回到起点',home,true]]});}
  else if(fall){state.deathTimer=.55;p.vx=0;p.vy=0;}
  else{p.invincible=2;p.vx=-p.facing*230;p.vy=-320;p.grounded=false;}
  updateHud();
}
function retry(){state.coins=state.levelStartCoins;begin(state.level.index,true);}
function finish(){
  if(state.mode!=='playing')return;
  state.mode='winning';state.winTimer=1.3;state.player.vx=0;state.player.shotFlash=0;state.projectiles=[];clearInput();sound.play('win');
  particle(state.level.goal.x,420,'#f7dc8b',35,240);
  state.totalStars+=state.stars;
  if(!saved.records||typeof saved.records!=='object')saved.records={};
  const record=saved.records[state.difficulty]||{bestCoins:0,bestStars:0,levels:{}};
  record.bestCoins=Math.max(record.bestCoins||0,state.coins);record.bestStars=Math.max(record.bestStars||0,state.totalStars);
  record.levels=record.levels||{};record.levels[state.level.index]={stars:Math.max(record.levels[state.level.index]?.stars||0,state.stars)};
  saved.records[state.difficulty]=record;store();
}
function showWin(){
  const last=state.level.index===LEVEL_COUNT-1;state.mode='complete';
  openModal({mark:state.stars===3?'✦ ✦ ✦':'✦',eyebrow:last?'UNTIL THE NEXT ADVENTURE':'A LITTLE FURTHER, A LITTLE BRAVER',title:last?'把风景装进口袋':'这一站，满载而归',content:`<p>${last?`你完成了${MODES[state.difficulty].name}模式的这段旅程。<br>${state.startLevel===0?'八座岛屿，都留下了你的足迹。':'新的风景，还在其他岛屿等你。'}`:`${state.level.theme.name}已完成。<br>下一阵风，会带来不一样的风景。`}</p><div class="result-stats"><div><b>${state.coins}</b><span>累计金币</span></div><div><b>${last?`${state.totalStars} / ${(LEVEL_COUNT-state.startLevel)*3}`:`${state.stars} / 3`}</b><span>${last?'旅途星光':'本关星光'}</span></div><div><b>${Math.ceil(state.time)}</b><span>剩余秒数</span></div></div>`,actions:last?[['再来一场冒险',()=>begin(0)],['回到起点',home,true]]:[['前往下一座岛屿 →',()=>begin(state.level.index+1,true)],['重新探索本关',()=>{state.totalStars-=state.stars;retry();},true]]});
}
function bumpBlock(b){
  if(b.broken)return;
  b.bump=1;sound.play('block');
  if(b.kind==='brick'){
    // Bricks shatter under a punch or a shot: they vanish and spit out a coin.
    b.broken=true;b.hidden=true;state.coins+=2;sound.play('hit');
    for(let i=0;i<10;i++)particle(b.x+22,b.y+22,'#d8b184',8,90);
    floating('+2',b.x+22,b.y-10);
    state.level.solids=state.level.solids.filter(s=>s!==b);
    return;
  }
  if(b.kind!=='question'||b.used)return;
  const reward=b.reward||'coin';
  if(reward==='ammo'&&state.ammo>=MAX_AMMO){notify('弹药已满 · 稍后再来取这份补给');return;}
  b.used=true;
  if(reward==='shield'){state.player.shield=1;sound.play('star');notify('获得叶子护盾 · 抵挡一次碰撞');particle(b.x+22,b.y,'#c6deaa',12);floating('叶子护盾',b.x+22,b.y-10,'#f4f8d0');}
  else if(reward==='ammo'){grantAmmo(AMMO_PER_PICKUP[state.difficulty],b.x+22,b.y);}
  else if(reward==='star'){state.player.invincible=Math.max(state.player.invincible,8);sound.play('star');notify('无敌星光 · 8 秒内碰不到伤害');particle(b.x+22,b.y,'#fff0aa',16,150);floating('无敌星光',b.x+22,b.y-10,'#fff2b0');}
  else if(reward==='mushroom'){state.player.scaleUp=Math.max(state.player.scaleUp||0,10);sound.play('star');notify('成长蘑菇 · 10 秒内体型与跳跃增强');particle(b.x+22,b.y,'#ff9c6b',14,130);floating('成长蘑菇',b.x+22,b.y-10,'#ffd9c0');}
  else{state.coins+=3;sound.play('coin');particle(b.x+22,b.y,'#f6d889',10);floating('+3',b.x+22,b.y-10);}
}
function grantAmmo(amount,x,y){
  const gained=Math.min(amount,MAX_AMMO-state.ammo);
  if(gained<=0){notify('弹药已满 · 最多携带 30 发');return 0;}
  state.ammo+=gained;sound.play('ammo');particle(x,y,'#f6d397',9,110);
  floating(`+${gained} 发`,x,y-12,'#fff0c3');notify(`获得 ${gained} 发子弹 · 长按射击可连发`);
  return gained;
}
function updateShooting(dt){
  const p=state.player,l=state.level;
  const requested=input.has('shoot')||shootQueued;shootQueued=false;
  if(requested&&p.shotCooldown<=0&&state.projectiles.length<MAX_PROJECTILES){
    const y=p.y+p.h-(p.crouch?18:40),x=p.x+p.w/2+p.facing*31;
    state.projectiles.push({x,y,originX:p.x+p.w/2,vx:p.facing*BULLET_SPEED,life:BULLET_LIFETIME});
    p.shotCooldown=SHOT_COOLDOWN;p.shotFlash=.09;sound.play('shoot');
  }
  if(!state.projectiles.length)return;
  const blockers=l.solids.concat(l.platforms.filter(platform=>platform.hiddenFor<=0));
  for(const hit of advanceProjectiles(state.projectiles,blockers,l.enemies,dt)){
    if(hit.kind==='enemy'){
      state.coins+=2;sound.play('hit');particle(hit.x,hit.y,'#ecc38c',9,120);floating('+2',hit.enemy.x+hit.enemy.w/2,hit.enemy.y);
    }else{
      // A shot that meets a brick shatters it instead of being swallowed.
      const brick=l.blocks.find(b=>!b.hidden&&b.kind==='brick'&&hit.x>=b.x-4&&hit.x<=b.x+b.w+4&&hit.y>=b.y-4&&hit.y<=b.y+b.h+4);
      if(brick)bumpBlock(brick);
      else{sound.play('block');particle(hit.x,hit.y,'#e9d4a9',3,65);}
    }
  }
}
function updatePlatforms(dt,p,l){
  for(const platform of l.platforms){
    platform.previousX=platform.x;platform.previousY=platform.y;
    if(platform.hiddenFor>0){
      platform.hiddenFor=Math.max(0,platform.hiddenFor-dt);
      if(platform.hiddenFor===0){platform.triggered=false;platform.remaining=MODES[state.difficulty].crumbleDelay;}
      continue;
    }
    if(platform.moving){
      const offset=Math.sin(state.elapsed*platform.speed+platform.phase)*platform.amplitude;
      if(platform.axis==='x')platform.x=platform.baseX+offset;else platform.y=platform.baseY+offset;
    }
    if(platform.crumble&&platform.triggered){
      platform.remaining-=dt;
      if(platform.remaining<=0){
        platform.hiddenFor=4;particle(platform.x+platform.w/2,platform.y,'#dac099',10,90);sound.play('block');
        if(p.support===platform){p.support=null;p.grounded=false;p.coyote=.1;}
        continue;
      }
    }
    if(p.grounded&&p.support===platform){p.x+=platform.x-platform.previousX;p.y+=platform.y-platform.previousY;}
  }
}
function physics(dt){
  if(state.mode!=='playing'||!state.player||!Number.isFinite(dt)||dt<=0)return;
  const p=state.player,l=state.level;state.elapsed+=dt;state.time-=dt;
  if(state.time<=0){state.time=l.time;hurt(true);if(state.mode==='playing')notify('时间到了 · 回到最近的旗帜');}
  if(state.mode!=='playing')return;
  for(const b of l.blocks)b.bump=Math.max(0,b.bump-dt*5);
  for(const s of l.springs)s.bounce=Math.max(0,s.bounce-dt);
  updatePlatforms(dt,p,l);
  if(state.deathTimer>0){state.deathTimer-=dt;if(state.deathTimer<=0){state.player=newPlayer(state.checkpoint);state.player.invincible=2;state.camera=clamp(state.checkpoint-view.width*.32,0,l.length-view.width+100);notify('拍拍灰尘，继续出发');}return;}
  p.shotCooldown=Math.max(0,p.shotCooldown-dt);p.shotFlash=Math.max(0,p.shotFlash-dt);
  p.invincible=Math.max(0,p.invincible-dt);p.dashCooldown=Math.max(0,p.dashCooldown-dt);p.dash=Math.max(0,p.dash-dt);jumpBuffer=Math.max(0,jumpBuffer-dt);
  p.coyote=p.grounded?.11:Math.max(0,p.coyote-dt);
  const horizontal=(input.has('right')?1:0)-(input.has('left')?1:0);
  p.crouch=input.has('down')&&p.grounded;
  if(horizontal)p.facing=horizontal;
  if(dashQueued){if(p.dashCooldown<=0&&!p.crouch){p.dash=.19;p.dashCooldown=1.2;sound.play('dash');particle(p.x+16,p.y+40,'#f5edd0',7,100);}dashQueued=false;}
  if(p.dash>0)p.vx=p.facing*610;
  else{const target=horizontal*(p.crouch?90:285),accel=p.grounded?(p.support?.ice?(horizontal?650:state.difficulty==='hard'?190:280):2200):1400;p.vx+=clamp(target-p.vx,-accel*dt,accel*dt);}
  if(jumpBuffer>0&&p.coyote>0&&!p.crouch){p.vy=-690;p.grounded=false;p.coyote=0;jumpBuffer=0;sound.play('jump');particle(p.x+16,p.y+p.h,'#d9dcb1',6,70);}
  let gravity=p.vy<0&&jumpHeld?1280:2050;
  if(input.has('down')&&!p.grounded){gravity=3300;p.vy=Math.max(p.vy,380);}
  p.vy=Math.min(p.vy+gravity*dt,1000);
  const solids=l.solids;
  const oldY=p.y,oldBottom=p.y+p.h;
  p.x+=p.vx*dt;p.x=clamp(p.x,0,l.length+50);
  for(const b of solids){if(Math.abs(b.x-p.x)>Math.max(b.w,view.width)+80)continue;if(overlaps(p,b)){if(p.vx>0)p.x=b.x-p.w;else if(p.vx<0)p.x=b.x+b.w;p.vx=0;}}
  p.y+=p.vy*dt;p.grounded=false;p.support=null;
  for(const b of solids){if(!overlaps(p,b))continue;if(p.vy>=0&&oldBottom<=b.y+12){p.y=b.y-p.h;p.vy=0;p.grounded=true;p.support=b;}
    else if(p.vy<0&&oldY>=b.y+b.h-12){p.y=b.y+b.h;p.vy=35;if(b.kind!=='ground')bumpBlock(b);}}
  for(const platform of l.platforms){
    if(platform.hiddenFor>0)continue;
    if(p.vy>=0&&p.x+p.w>platform.x&&p.x<platform.x+platform.w&&oldBottom<=Math.max(platform.previousY,platform.y)+8&&p.y+p.h>=platform.y){
      p.y=platform.y-p.h;p.vy=0;p.grounded=true;p.support=platform;
      if(platform.crumble&&!platform.triggered){platform.triggered=true;sound.play('block');}
    }
  }
  for(const spring of l.springs){if(p.vy>=0&&p.x+p.w>spring.x&&p.x<spring.x+spring.w&&oldBottom<=spring.y+12&&p.y+p.h>=spring.y){p.y=spring.y-p.h;p.vy=-970;p.grounded=false;spring.bounce=.5;sound.play('spring');particle(p.x+16,spring.y,'#ffdab0',10);}}
  if(p.grounded&&!horizontal)p.walk=0;else p.walk+=Math.abs(p.vx)*dt*.035;
  if(p.grounded&&Math.abs(p.vx)>200&&Math.random()<.16)particle(p.x+16,p.y+p.h,'#dfd9b4',1,30);
  for(const coin of l.coins){if(coin.taken||Math.abs(coin.x-p.x)>70)continue;if(overlaps(p,{x:coin.x-12,y:coin.y-15,w:24,h:30})){coin.taken=true;state.coins++;sound.play('coin');particle(coin.x,coin.y,'#f8d880',5,100);}}
  for(const s of l.stars){if(s.taken)continue;if(overlaps(p,{x:s.x-18,y:s.y-20,w:36,h:40})){s.taken=true;state.stars++;sound.play('star');particle(s.x,s.y,'#fff0aa',18,180);floating('发现星光 ✦',s.x,s.y-20);notify(`星光入袋 · ${state.stars} / 3`);}}
  for(const pickup of l.pickups){
    if(pickup.taken||state.ammo>=MAX_AMMO)continue;
    if(overlaps(p,{x:pickup.x-18,y:pickup.y-17,w:36,h:34})){pickup.taken=true;grantAmmo(pickup.amount,pickup.x,pickup.y);}
  }
  updateShooting(dt);
  for(const e of l.enemies){
    if(e.dead||Math.abs(e.x-p.x)>1000)continue; // Fixed activation distance keeps timing consistent across screen sizes.
    e.x+=e.vx*dt;
    const foot=e.vx>0?e.x+e.w+3:e.x-3;
    const safe=l.ground.some(g=>foot>=g.x&&foot<=g.x+g.w);
    if(Math.abs(e.x-e.origin)>e.range||!safe){e.vx*=-1;e.x+=e.vx*dt*2;}
    if(!overlaps(p,e))continue;
    if(p.vy>0&&oldBottom<=e.y+17){e.dead=true;p.vy=jumpHeld?-500:-350;p.grounded=false;state.coins+=2;sound.play('stomp');particle(e.x+19,e.y+20,'#e2bd8d',10);floating('+2',e.x+19,e.y);}
    else hurt();
  }
  for(const hazard of l.hazards){if(overlaps(p,{x:hazard.x+3,y:hazard.y+4,w:hazard.w-6,h:hazard.h-4}))hurt();}
  if(state.mode!=='playing')return;
  if(!l.checkpoint.active&&p.x>l.checkpoint.x-12){l.checkpoint.active=true;state.checkpoint=l.checkpoint.x+35;sound.play('checkpoint');notify('风之旗已点亮 · 复活点已保存');particle(l.checkpoint.x,440,'#d7e8af',18);}
  if(p.y>800)hurt(true);
  if(p.x>l.goal.x-28&&p.y<580&&p.grounded)finish();
  const target=clamp(p.x-view.width*.32,0,Math.max(0,l.length-view.width+100));state.camera+=(target-state.camera)*(1-Math.exp(-dt*7));
  document.querySelector('[data-action="dash"]').classList.toggle('cooldown',p.dashCooldown>0);
  updateHud();
}
function updateEffects(dt){
  for(let i=state.particles.length-1;i>=0;i--){const p=state.particles[i];p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=330*dt;if(p.life<=0)state.particles.splice(i,1);}
  for(let i=state.floaters.length-1;i>=0;i--){const f=state.floaters[i];f.life-=dt;f.y-=35*dt;if(f.life<=0)state.floaters.splice(i,1);}
  state.shake=Math.max(0,state.shake-dt);
  if(state.toastTime>0){state.toastTime-=dt;if(state.toastTime<=0)$('toast').classList.remove('visible');}
}
function renderHome(time){
  const w=view.width,t=THEMES[0],y=550;
  ctx.save();ctx.translate(0,view.offsetY);
  // The home vignette composes around the title: the island and traveler live on the right.
  const hx=view.portrait?w*.69:w*.735;
  art.tree(ctx,view.portrait?w+75:w*.91,y,view.portrait?.7:1.12,t);
  if(!view.portrait)art.tree(ctx,w*.57,y,.47,t);
  art.bush(ctx,hx+130,y,.8,t);art.bush(ctx,hx-115,y,.6,t);
  art.cameraX=0;art.ground(ctx,{x:0,y,w:w+128,h:600},t);
  for(let i=0;i<Math.ceil(w/180);i++)art.flowers(ctx,i*180+20,y,3,t);
  const platformY=view.portrait?y-2:y-50;
  if(!view.portrait){for(let i=0;i<3;i++)art.block(ctx,{x:hx-62+i*46,y:platformY,kind:i===1?'question':'brick',used:false,bump:0},t);}
  ellipseShadow(hx+3,platformY,45,7);
  art.drawFox(ctx,hx,platformY+Math.sin(time*1.7)*.7,{frame:8,scale:view.portrait?1.18:1.38});
  for(let i=0;i<3;i++)art.coin(ctx,hx-46+i*45,platformY-162-Math.sin(i/2*Math.PI)*18,time,i);
  if(!view.portrait){art.sign(ctx,hx-175,y,'向风出发 →');art.spring(ctx,{x:hx+126,y:y-28,bounce:0});art.enemy(ctx,{x:hx+230,y:y-34,phase:0},time);}
  else{art.spring(ctx,{x:hx-112,y:y-28,bounce:0});}
  // Foreground leaves frame the screen without hiding the mobile controls.
  art.bush(ctx,view.portrait?-20:10,y+112,view.portrait?1.3:1.8,t);art.bush(ctx,w+12,y+98,1.6,t);
  ctx.restore();
}
function ellipseShadow(x,y,rx,ry){ctx.fillStyle='#3d573b22';ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.fill();}
function renderWorld(time){
  const l=state.level,p=state.player,t=l.theme,left=state.camera,right=left+view.width;
  ctx.save();ctx.translate(-left,view.offsetY);
  if(state.shake>0)ctx.translate(Math.sin(time*95)*state.shake*18,Math.cos(time*90)*state.shake*10);
  art.cameraX=left;
  const visible=(x,w=100)=>x+w>left-100&&x<right+100;
  // Decorations are derived from ground segments so there is nothing floating over pits.
  for(const g of l.ground){if(!visible(g.x,g.w))continue;
    for(let x=Math.ceil(g.x/470)*470+180;x<g.x+g.w-50;x+=470){if(visible(x,200))art.tree(ctx,x,550,.55+((Math.floor(x/470)%3)*.16),t);}
    for(let x=Math.ceil(g.x/240)*240+48;x<g.x+g.w-30;x+=240){if(visible(x))art.bush(ctx,x,550,.55,t);}
    art.ground(ctx,g,t);
    if(g.ice){
      const from=Math.max(g.x,left),to=Math.min(g.x+g.w,right);ctx.fillStyle='#edfaffaa';ctx.fillRect(from,g.y,to-from,5);
      ctx.strokeStyle='#f3ffff88';ctx.lineWidth=1.5;ctx.beginPath();for(let x=Math.ceil(from/55)*55;x<to-10;x+=55){ctx.moveTo(x,g.y+12);ctx.lineTo(x+12,g.y+7);}ctx.stroke();
    }
    for(let x=Math.ceil(g.x/180)*180+28;x<g.x+g.w-40;x+=180)if(visible(x))art.flowers(ctx,x,550,x%7,t);
  }
  if(left<300)art.sign(ctx,270,550,l.ice?'冰面提前刹车 →':'沿着风前进 →');
  for(const hazard of l.hazards)if(visible(hazard.x,hazard.w))art.spikes(ctx,hazard);
  for(const b of l.blocks)if(visible(b.x,44))art.block(ctx,b,t);
  for(const platform of l.platforms)if(visible(platform.x,platform.w)){
    if(platform.hiddenFor>0){
      ctx.globalAlpha=.2;ctx.setLineDash([5,6]);ctx.strokeStyle=t.grassLight;ctx.strokeRect(platform.x,platform.y,platform.w,platform.h);ctx.setLineDash([]);ctx.globalAlpha=1;continue;
    }
    const trembling=platform.triggered&&!reduceMotion?Math.sin(time*65)*2:0;
    ctx.save();ctx.translate(trembling,0);
    rounded(ctx,platform.x,platform.y,platform.w,platform.h,7,platform.crumble?'#bc9272':t.soilDark);
    rounded(ctx,platform.x,platform.y,platform.w,8,4,platform.triggered?'#e5aa78':t.grassLight);
    if(platform.crumble){
      ctx.strokeStyle='#775e50';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(platform.x+platform.w*.45,platform.y+2);ctx.lineTo(platform.x+platform.w*.55,platform.y+10);ctx.lineTo(platform.x+platform.w*.4,platform.y+14);ctx.lineTo(platform.x+platform.w*.5,platform.y+22);ctx.stroke();
      if(platform.triggered){ctx.fillStyle='#efc67d';ctx.fillRect(platform.x,platform.y-4,platform.w*Math.max(0,platform.remaining/MODES[state.difficulty].crumbleDelay),2);}
    }else{
      ctx.strokeStyle=t.leaf;ctx.lineWidth=2;for(let j=0;j<Math.floor(platform.w/32);j++){ctx.beginPath();ctx.moveTo(platform.x+12+j*32,platform.y+18);ctx.quadraticCurveTo(platform.x+10+j*32,platform.y+37,platform.x+20+j*32,platform.y+42);ctx.stroke();}
      if(platform.axis==='x'){ctx.fillStyle='#fff4d4';ctx.font='11px sans-serif';ctx.textAlign='center';ctx.fillText('↔',platform.x+platform.w/2,platform.y+18);}
    }
    ctx.restore();
  }
  for(const pickup of l.pickups)if(!pickup.taken&&visible(pickup.x,40))art.ammoPickup(ctx,pickup.x,pickup.y,time);
  for(const bullet of state.projectiles)if(visible(bullet.x,28))art.bullet(ctx,bullet);
  for(const coin of l.coins)if(!coin.taken&&visible(coin.x,15))art.coin(ctx,coin.x,coin.y,time,coin.x*.03);
  for(const s of l.stars)if(!s.taken&&visible(s.x,25)){
    const sy=s.y+Math.sin(time*2.2)*5;ctx.globalAlpha=.16+Math.sin(time*2)*.05;ctx.fillStyle='#ffe7a0';ctx.beginPath();ctx.arc(s.x,sy,30,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
    star(ctx,s.x,sy,18,'#b69046',.07);star(ctx,s.x,sy-2,15,'#ffe7a0',.07);star(ctx,s.x-3,sy-5,5,'#fff8d3',.07);
  }
  for(const e of l.enemies)if(!e.dead&&visible(e.x,40))art.enemy(ctx,e,time);
  for(const s of l.springs)if(visible(s.x,50))art.spring(ctx,s);
  if(visible(l.checkpoint.x,45)){
    const cp=l.checkpoint;rounded(ctx,cp.x,434,5,116,2,'#dad6ad');
    ctx.beginPath();ctx.moveTo(cp.x+5,437);ctx.quadraticCurveTo(cp.x+25,433+Math.sin(time*4)*3,cp.x+47,442);ctx.lineTo(cp.x+39,457);ctx.quadraticCurveTo(cp.x+24,449+Math.sin(time*4)*4,cp.x+5,455);ctx.closePath();ctx.fillStyle=cp.active?'#edbd70':'#7e9a79';ctx.fill();
    star(ctx,cp.x+21,446,5,'#fff3cf');ellipseShadow(cp.x+2,550,15,4);
  }
  if(visible(l.goal.x,80))art.gate(ctx,l.goal.x,550,t,time);
  if(p&&state.deathTimer<=0){
    if(p.grounded)ellipseShadow(p.x+16,p.y+p.h+2,22,4);
    if(p.shield){ctx.strokeStyle='#e6f5bfaa';ctx.lineWidth=2;ctx.fillStyle='#e6f5bf16';ctx.beginPath();ctx.ellipse(p.x+16,p.y+25,39,47,0,0,Math.PI*2);ctx.fill();ctx.stroke();}
    const frame=!p.grounded?9:Math.abs(p.vx)>20?Math.floor(p.walk)%8:8;
    if(p.dash>0&&!reduceMotion){art.drawFox(ctx,p.x+16-p.facing*32,p.y+p.h,{frame,facing:p.facing,scale:.8,alpha:.16});art.drawFox(ctx,p.x+16-p.facing*16,p.y+p.h,{frame,facing:p.facing,scale:.8,alpha:.24});}
    // Growth mushroom makes the traveler visibly bigger; invincibility gives a glow.
    const growing=(p.scaleUp||0)>0,size=growing?1.12:.8;
    if(growing){ctx.save();ctx.shadowColor='#ffb27a';ctx.shadowBlur=18;}
    art.drawFox(ctx,p.x+16,p.y+p.h,{frame,facing:p.facing,scale:size,crouch:p.crouch,alpha:p.invincible>0&&Math.floor(p.invincible*12)%2?.4:1});
    if(growing)ctx.restore();
    if(p.invincible>1.6&&p.shield<=0){ctx.strokeStyle='#fff0aab0';ctx.lineWidth=2;ctx.fillStyle='#fff0aa14';ctx.beginPath();ctx.ellipse(p.x+16,p.y+30,34,42,0,0,Math.PI*2);ctx.fill();ctx.stroke();}
    if(state.ammo>0||p.shotFlash>0)art.blaster(ctx,p.x+16,p.y+p.h-(p.crouch?15:23),p.facing,p.shotFlash>0);
  }
  for(const v of state.particles){ctx.globalAlpha=clamp(v.life/v.max,0,1);ctx.fillStyle=v.color;ctx.fillRect(v.x,v.y,v.size,v.size);}ctx.globalAlpha=1;
  for(const f of state.floaters){ctx.globalAlpha=clamp(f.life*2,0,1);ctx.fillStyle=f.color;ctx.font='bold 15px system-ui';ctx.textAlign='center';ctx.fillText(f.text,f.x,f.y);}ctx.globalAlpha=1;
  ctx.restore();
}
function render(time){
  art.background(ctx,view.width,view.height,state.level.theme,time,state.camera,view.portrait);
  if(state.mode==='home')renderHome(time);else renderWorld(time);
  // A bounded set of wind-blown motes adds movement without allocating per frame.
  if(!reduceMotion){for(let i=0;i<12;i++){const x=((i*173.1+time*(10+i%3*6))%(view.width+80))-40,y=220+((i*97+Math.sin(time+i)*17)%390);ctx.save();ctx.translate(x,y);ctx.rotate(time*.3+i);ctx.globalAlpha=.25;ctx.fillStyle='#fff3c4';ctx.beginPath();ctx.ellipse(0,0,3,1.5,0,0,Math.PI*2);ctx.fill();ctx.restore();}}
}
function tick(now){
  if(now-lastTime<1000/60-.5){requestAnimationFrame(tick);return;}
  const dt=Math.min((now-(lastTime||now))/1000,.05);lastTime=now;
  if(!document.hidden){
    const animate=state.mode==='home'||state.mode==='playing'||state.mode==='winning';
    if(animate)animationTime+=dt;
    if(state.mode==='playing'){accumulator+=dt;let steps=0;while(accumulator>=1/60&&steps<3&&state.mode==='playing'){physics(1/60);accumulator-=1/60;steps++;}}
    else accumulator=0;
    if(animate)updateEffects(dt);
    if(state.mode==='winning'){state.winTimer-=dt;if(state.winTimer<=0)showWin();}
    sound.update(state.mode==='playing');sound.musicTrack();if(animate||needsRender){render(animationTime);needsRender=false;}
  }
  requestAnimationFrame(tick);
}
for(const button of controls){
  button.addEventListener('pointerdown',event=>{event.preventDefault();if(state.mode!=='playing')return;sound.unlock();button.setPointerCapture(event.pointerId);pointers.set(event.pointerId,button.dataset.action);syncInput();});
  const release=event=>{
    if(!pointers.has(event.pointerId))return;
    const action=pointers.get(event.pointerId);pointers.delete(event.pointerId);syncInput();
    // A normal tap keeps its buffered action. Cancellation must not fire later.
    if(event.type!=='pointerup'){
      if(action==='shoot'&&!input.has('shoot'))shootQueued=false;
      if(action==='dash'&&!input.has('dash'))dashQueued=false;
      if((action==='up'||action==='jump')&&!input.has('up')&&!input.has('jump'))jumpBuffer=0;
    }
  };
  button.addEventListener('pointerup',release);button.addEventListener('pointercancel',release);button.addEventListener('lostpointercapture',release);
  // Slide between directional arrows while maintaining pointer capture.
  button.addEventListener('pointermove',event=>{
    if(!pointers.has(event.pointerId)||!button.classList.contains('direction'))return;
    const target=document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-action]');
    const action=target?.classList.contains('direction')?target.dataset.action:null,previous=pointers.get(event.pointerId);
    if(previous!==action){
      pointers.set(event.pointerId,action);syncInput();
      if(!action&&previous==='up'&&!input.has('up')&&!input.has('jump'))jumpBuffer=0;
    }
  });
  button.addEventListener('contextmenu',event=>event.preventDefault());
}
const keys={ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right',ArrowUp:'up',KeyW:'up',ArrowDown:'down',KeyS:'down',Space:'jump',ShiftLeft:'dash',ShiftRight:'dash',KeyJ:'shoot',KeyF:'shoot'};
// Analog movement stick replaces the old on-screen D-pad. It feeds the same
// left/right/up/down actions the D-pad used, so game logic is unchanged. The
// stick is only active while a finger is on it: lifting the finger clears the
// direction immediately, so the character cannot keep walking after release.
const joystick=$('joystick'),joystickKnob=$('joystick-knob');
let stickId=null,stickAxis=0;
function setStick(axis){stickAxis=axis;pointers.forEach((action,id)=>{if(action==='left'||action==='right'||action==='up'||action==='down')pointers.delete(id);});if(axis<-.28)pointers.set('stick',axis<-.7?'left':'left');else if(axis>.28)pointers.set('stick','right');else pointers.delete('stick');syncInput();}
function updateStick(event){
  const rect=joystick.getBoundingClientRect(),radius=rect.width*.34;
  let dx=event.clientX-(rect.left+rect.width/2),dy=event.clientY-(rect.top+rect.height/2),len=Math.hypot(dx,dy);
  if(len>radius){dx=dx/len*radius;dy=dy/len*radius;}
  joystickKnob.style.transform=`translate(${dx}px,${dy}px)`;
  const axis=dx/radius;stickAxis=axis;
  pointers.forEach((action,id)=>{if(id!=='stick'&&(action==='left'||action==='right'||action==='up'||action==='down'))pointers.delete(id);});
  if(axis<-.24)pointers.set('stick','left');else if(axis>.24)pointers.set('stick','right');else pointers.delete('stick');
  syncInput();
}
function releaseStick(event){
  if(event.pointerId!==stickId)return;
  stickId=null;stickAxis=0;pointers.delete('stick');joystickKnob.style.transform='';joystick.classList.remove('active');
  if(!input.has('left')&&!input.has('right'))jumpBuffer=0;
  syncInput();
}
if(joystick){
  joystick.addEventListener('pointerdown',event=>{event.preventDefault();if(state.mode!=='playing'||stickId!==null)return;sound.unlock();joystick.setPointerCapture(event.pointerId);stickId=event.pointerId;joystick.classList.add('active');updateStick(event);});
  joystick.addEventListener('pointermove',event=>{if(event.pointerId===stickId)updateStick(event);});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])joystick.addEventListener(type,releaseStick);
  joystick.addEventListener('contextmenu',event=>event.preventDefault());
}
window.addEventListener('keydown',event=>{
  if(!$('modal').hidden&&event.code==='Tab'){const focusable=[...$('modal').querySelectorAll('button')];const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}return;}
  if(event.code==='Escape'||event.code==='KeyP'){event.preventDefault();if(event.repeat)return;if(state.mode==='playing')pause();else if(state.mode==='paused')resume();else if(state.mode==='home'&&!$('modal').hidden)closeModal();return;}
  const action=keys[event.code];if(!action||state.mode!=='playing')return;event.preventDefault();if(event.repeat)return;activeKeyCodes.set(event.code,action);heldKeys.add(action);syncInput();
});
window.addEventListener('keyup',event=>{if(!keys[event.code])return;activeKeyCodes.delete(event.code);heldKeys.clear();activeKeyCodes.forEach(a=>heldKeys.add(a));syncInput();});
window.addEventListener('blur',()=>{activeKeyCodes.clear();clearInput();pause();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){activeKeyCodes.clear();clearInput();pause();sound.suspend();}else{lastTime=performance.now();accumulator=0;}});
document.querySelectorAll('[data-difficulty]').forEach(button=>button.onclick=()=>{state.difficulty=button.dataset.difficulty;updateDifficultyUI();});
$('map-button').onclick=showMap;
$('start-button').onclick=()=>begin(0);$('help-button').onclick=help;$('pause-button').onclick=()=>{if(state.mode==='playing')pause();};
// Long-press / double-click the note toggles just the background music; a normal
// tap keeps toggling all sound, so the existing habit still works.
function updateSoundButton(){$('sound-button').classList.toggle('muted',!sound.enabled);$('sound-button').setAttribute('aria-label',sound.enabled?'关闭声音':'开启声音');$('sound-button').title=sound.enabled?'关闭声音':'开启声音';}
$('sound-button').onclick=()=>{sound.unlock();saved.sound=sound.toggle();store();updateSoundButton();};updateSoundButton();
const musicButton=$('music-button');
function updateMusicButton(){if(!musicButton)return;musicButton.classList.toggle('muted',!sound.music);musicButton.setAttribute('aria-label',sound.music?'关闭背景音乐':'开启背景音乐');musicButton.title=sound.music?'关闭背景音乐':'开启背景音乐';}
if(musicButton)musicButton.onclick=()=>{sound.unlock();saved.music=sound.toggleMusic();store();updateMusicButton();};updateMusicButton();
$('fullscreen-button').onclick=async()=>{
  try{if(document.fullscreenElement){await document.exitFullscreen();}else if($('game-shell').requestFullscreen){await $('game-shell').requestFullscreen();}else{notify('可用浏览器「添加到主屏幕」获得沉浸体验');}}catch{notify('当前浏览器未开放全屏，可添加到主屏幕游玩');}
};
document.addEventListener('fullscreenchange',()=>{$('fullscreen-button').setAttribute('aria-label',document.fullscreenElement?'退出全屏':'进入全屏');resize();});
// Opt-in diagnostics: inert in ordinary play and scoped to this game's page.
if(new URLSearchParams(location.search).has('debug'))window.__windy={state,input,view,begin,physics,hurt,finish,art,sound,resize,showMap,showWin};
requestAnimationFrame(tick);
