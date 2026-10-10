// Reusable with an existing Playwright Page. No dependency is added to the game.
// Call await verify(page, 'http://127.0.0.1:8765') in an isolated browser context.
export async function verify(page, base='http://127.0.0.1:8765') {
  await page.goto(`${base}/?debug`);
  await page.waitForFunction(()=>!!window.__windy);
  const result=await page.evaluate(()=>{
    const g=window.__windy,checks=[];
    g.sound.enabled=false;
    const key=(type,code)=>window.dispatchEvent(new KeyboardEvent(type,{code,bubbles:true}));
    const step=n=>{for(let i=0;i<n&&g.state.mode==='playing';i++)g.physics(1/60);};
    const check=(name,fn)=>{const result=fn();checks.push({name,...result});};
    check('default easy',()=>({pass:g.state.difficulty==='easy'}));
    check('crumble collapses and regenerates',()=>{
      g.begin(3);const p=g.state.player,platform=g.state.level.platforms.find(p=>p.crumble);
      p.x=platform.x+20;p.y=platform.y-p.h;p.vy=0;step(2);const triggered=platform.triggered;
      step(70);const collapsed=platform.hiddenFor>0;step(260);
      return{pass:triggered&&collapsed&&platform.hiddenFor===0&&!platform.triggered};
    });
    check('horizontal platform carries a standing player',()=>{
      g.begin(6);const p=g.state.player,platform=g.state.level.platforms.find(p=>p.axis==='x');
      p.x=platform.x+20;p.y=platform.y-p.h;p.grounded=true;p.support=platform;
      const offset=p.x-platform.x;step(30);
      return{pass:Math.abs(p.x-platform.x-offset)<.01&&Math.abs(p.y+p.h-platform.y)<.01};
    });
    check('ice has inertia, ordinary ground brakes quickly',()=>{
      const distance=index=>{g.begin(index);step(4);key('keydown','ArrowRight');step(30);key('keyup','ArrowRight');const start=g.state.player.x;step(20);return g.state.player.x-start;};
      const normal=distance(0),ice=distance(5);return{pass:ice>normal+35,normal,ice};
    });
    check('spikes hurt; shield absorbs a hit',()=>{
      g.begin(4);const hazard=g.state.level.hazards[0],p=g.state.player;
      p.x=hazard.x;p.y=480;p.shield=1;step(1);const blocked=g.state.health===3&&p.shield===0;
      p.invincible=0;p.x=hazard.x;p.y=480;p.vy=0;step(1);return{pass:blocked&&g.state.health===2};
    });
    check('hard retries retain mode and start with two hearts',()=>{
      g.state.difficulty='hard';g.begin(4);g.state.health=1;g.hurt(true);
      document.querySelector('#modal-actions button').click();
      return{pass:g.state.mode==='playing'&&g.state.difficulty==='hard'&&g.state.health===2&&g.state.level.index===4};
    });
    const collectAmmo=(difficulty='easy')=>{
      g.state.difficulty=difficulty;g.begin(0);g.state.player.x=280;step(1);
    };
    check('ammo pickups respect difficulty and only grant once',()=>{
      collectAmmo();const easy=g.state.ammo;step(5);const once=g.state.ammo===easy;
      collectAmmo('hard');return{pass:easy===12&&once&&g.state.ammo===8};
    });
    check('full inventory preserves ground supplies; partial refill caps at 30',()=>{
      g.state.difficulty='easy';g.begin(0);g.state.ammo=30;g.state.player.x=280;step(1);
      const retained=!g.state.level.pickups[0].taken;
      g.state.ammo=25;step(1);return{pass:retained&&g.state.ammo===30&&g.state.level.pickups[0].taken};
    });
    check('a fast tap still fires once; holding fire is rate limited',()=>{
      collectAmmo();key('keydown','KeyJ');key('keyup','KeyJ');step(1);
      const tap=g.state.ammo===11&&g.state.projectiles.length===1;
      collectAmmo();key('keydown','KeyJ');let maximum=0;
      for(let i=0;i<60;i++){step(1);maximum=Math.max(maximum,g.state.projectiles.length);}
      key('keyup','KeyJ');const used=12-g.state.ammo,remaining=g.state.ammo;step(20);
      return{pass:tap&&used>=3&&used<=5&&maximum<=6&&g.state.ammo===remaining,used,maximum};
    });
    check('shots face left and right, defeat enemies, award coins once',()=>{
      const outcomes=[];
      for(const direction of [1,-1]){
        collectAmmo();const p=g.state.player;p.x=direction===1?400:750;p.facing=direction;g.state.ammo=1;
        key('keydown','KeyJ');key('keyup','KeyJ');step(35);
        const hit=g.state.level.enemies[0].dead&&g.state.coins===2&&g.state.ammo===0;
        step(35);outcomes.push(hit&&g.state.coins===2);
      }
      return{pass:outcomes.every(Boolean)};
    });
    check('terrain blocks shots in the actual game loop',()=>{
      collectAmmo();g.state.player.x=400;g.state.ammo=1;
      g.state.level.solids.push({x:470,y:500,w:8,h:45,kind:'brick'});
      key('keydown','KeyJ');key('keyup','KeyJ');step(35);
      return{pass:!g.state.level.enemies[0].dead&&g.state.projectiles.length===0&&g.state.coins===0};
    });
    check('jumping and shooting can happen together',()=>{
      collectAmmo();key('keydown','Space');key('keydown','KeyJ');step(1);key('keyup','Space');key('keyup','KeyJ');
      return{pass:g.state.player.y<480&&g.state.projectiles.length===1&&g.state.projectiles[0].y<527&&g.state.ammo===11};
    });
    check('empty ammo cannot create bullets',()=>{
      g.state.difficulty='easy';g.begin(0);key('keydown','KeyJ');step(45);key('keyup','KeyJ');
      return{pass:g.state.ammo===0&&g.state.projectiles.length===0};
    });
    check('ammo boxes wait when full, then award only once',()=>{
      g.begin(0);const b=g.state.level.blocks.find(b=>b.kind==='question'&&b.reward==='ammo');
      const bump=()=>{const p=g.state.player;p.x=b.x+5;p.y=480;p.vy=-650;step(10);};
      g.state.ammo=30;bump();const retained=!b.used;
      g.state.ammo=20;bump();const granted=g.state.ammo===30&&b.used;
      g.state.ammo=20;bump();return{pass:retained&&granted&&g.state.ammo===20};
    });
    check('fall clears shots but keeps ammo; retry resets supplies',()=>{
      collectAmmo();key('keydown','KeyJ');key('keyup','KeyJ');step(1);const ammo=g.state.ammo;
      g.hurt(true);const cleared=g.state.projectiles.length===0;step(40);
      const retained=g.state.ammo===ammo&&g.state.level.pickups[0].taken;
      g.state.health=1;g.hurt(true);document.querySelector('#modal-actions button').click();
      return{pass:cleared&&retained&&g.state.ammo===0&&g.state.projectiles.length===0&&!g.state.level.pickups[0].taken};
    });
    check('pause cancels a held shot, and next stage starts with no ammo',()=>{
      collectAmmo();key('keydown','KeyJ');step(1);key('keydown','KeyP');
      const ammo=g.state.ammo,paused=g.state.mode==='paused'&&g.input.size===0;
      document.querySelector('#modal-actions button').click();step(10);
      const noGhostShot=g.state.ammo===ammo;
      g.finish();const cleared=g.state.projectiles.length===0;g.begin(1,true);
      return{pass:paused&&noGhostShot&&cleared&&g.state.ammo===0};
    });
    const touch=(action,endType)=>{
      const button=document.querySelector(`[data-action="${action}"]`),capture=button.setPointerCapture;
      button.setPointerCapture=()=>{};
      try{
        button.dispatchEvent(new PointerEvent('pointerdown',{pointerId:91,pointerType:'touch'}));
        button.dispatchEvent(new PointerEvent(endType,{pointerId:91,pointerType:'touch'}));
        if(endType==='pointerup')button.dispatchEvent(new PointerEvent('lostpointercapture',{pointerId:91,pointerType:'touch'}));
      }finally{button.setPointerCapture=capture;}
    };
    for(const endType of ['pointercancel','lostpointercapture'])check(`${endType} removes pending touch actions`,()=>{
      const outcomes=[];
      for(const action of ['shoot','dash','jump','up']){
        g.begin(0);step(2);g.state.ammo=5;touch(action,endType);step(1);
        outcomes.push(g.state.ammo===5&&g.state.projectiles.length===0&&g.state.player.dashCooldown===0&&g.state.player.y===480&&g.input.size===0);
      }
      return{pass:outcomes.every(Boolean)};
    });
    check('normal quick touch remains buffered after automatic capture release',()=>{
      g.begin(0);g.state.ammo=5;touch('shoot','pointerup');step(1);
      return{pass:g.state.ammo===4&&g.state.projectiles.length===1};
    });
    check('cancelled touch does not release an independently held keyboard action',()=>{
      g.begin(0);g.state.ammo=5;key('keydown','KeyJ');touch('shoot','pointercancel');step(1);
      const active=g.input.has('shoot')&&g.state.ammo===4;key('keyup','KeyJ');return{pass:active};
    });
    check('taps during respawn cannot become delayed shots, dashes or jumps',()=>{
      g.begin(0);g.state.ammo=5;g.hurt(true);
      for(const code of ['KeyJ','ShiftLeft','Space']){key('keydown',code);key('keyup',code);}
      step(40);return{pass:g.state.ammo===5&&g.state.projectiles.length===0&&g.state.player.dashCooldown===0&&g.state.player.y===480};
    });
    check('point-blank shots hit overlapping enemies in either direction',()=>{
      const outcomes=[];
      for(const direction of [1,-1]){
        g.begin(0);g.state.ammo=1;const p=g.state.player,e=g.state.level.enemies[0];
        p.x=400;p.facing=direction;p.invincible=1;e.x=e.origin=direction===1?399:393;
        key('keydown','KeyJ');key('keyup','KeyJ');step(1);
        outcomes.push(e.dead&&g.state.coins===2&&g.state.ammo===0);
      }
      return{pass:outcomes.every(Boolean)};
    });
    check('muzzle cannot appear beyond a nearby wall and shoot through it',()=>{
      g.begin(0);g.state.ammo=1;g.state.player.x=400;
      g.state.level.enemies[0].x=g.state.level.enemies[0].origin=500;
      g.state.level.solids.push({x:433,y:500,w:6,h:45,kind:'brick'});
      key('keydown','KeyJ');key('keyup','KeyJ');step(15);
      return{pass:!g.state.level.enemies[0].dead&&g.state.projectiles.length===0};
    });
    check('paused physics cannot advance timers or projectiles',()=>{
      g.begin(0);g.state.ammo=1;key('keydown','KeyJ');key('keyup','KeyJ');step(1);key('keydown','KeyP');
      const snapshot=()=>JSON.stringify({time:g.state.time,elapsed:g.state.elapsed,player:g.state.player,shots:g.state.projectiles});
      const before=snapshot();g.physics(1);const unchanged=before===snapshot();
      document.querySelector('#modal-actions button').click();return{pass:unchanged};
    });
    // Recorded successful control policies. These use only normal key events and
    // the fixed-step game loop: no teleport, collision bypass or health edits.
    const easy=Array.from({length:8},()=>({hold:40,gap:65,spike:100,allEdge:32}));
    easy[0]={hold:40,gap:85,spike:70};easy[4]={hold:28,gap:65,spike:70};easy[5]={hold:40,gap:85,spike:70};
    const hard=[
      {hold:28,gap:85,spike:70},
      {hold:40,gap:65,spike:70,dash:true},
      {hold:40,gap:35,spike:55,enemy:90,spikeHold:12,dash:true,dashVy:-150,dashLead:0,bridgeEdge:45},
      {hold:40,gap:85,spike:70,dash:true},
      {hold:40,gap:55,spike:95,enemy:90,spikeHold:12,dash:true,dashVy:-150,dashLead:0,bridgeEdge:45},
      {hold:28,gap:85,spike:100,dash:true},
      {hold:40,gap:65,spike:100,allEdge:32},
      {hold:40,gap:35,spike:55,enemy:90,spikeHold:28,dash:true,dashVy:-150,dashLead:0,bridgeEdge:45}
    ];
    const runs=[];
    for(const difficulty of ['easy','hard']){
      g.state.difficulty=difficulty;
      for(let index=0;index<8;index++){
        const policy=(difficulty==='easy'?easy:hard)[index];
        g.begin(index,index>0);key('keydown','ArrowRight');let age=999,hold=policy.hold;
        for(let frame=0;frame<3200&&g.state.mode==='playing';frame++){
          const p=g.state.player,l=g.state.level;
          const gap=l.gaps.find(([a])=>p.x+p.w<a+10&&a-p.x-p.w<policy.gap);
          const enemy=l.enemies.find(e=>!e.dead&&e.x>p.x&&e.x-p.x<(policy.enemy||110));
          const block=l.blocks.find(b=>b.x>p.x&&b.x-p.x<110);
          const spike=l.hazards.find(h=>h.x>p.x&&h.x-p.x<policy.spike);
          const edge=p.support?.kind==='platform'&&((policy.allEdge&&p.support.x+p.support.w-p.x-p.w<policy.allEdge)||(policy.bridgeEdge&&(p.support.crumble||p.support.axis==='x')&&p.support.x+p.support.w-p.x-p.w<policy.bridgeEdge));
          if(p.grounded&&age>8&&(gap||enemy||block||spike||edge)){
            key('keyup','Space');key('keydown','Space');age=0;
            hold=policy.spikeHold&&spike&&!gap&&!block&&!edge?policy.spikeHold:policy.hold;
          }
          if(age===hold)key('keyup','Space');
          if(policy.dash&&!p.grounded&&p.vy>(policy.dashVy??-80)&&p.dashCooldown<=0&&l.gaps.some(([a,b])=>p.x+p.w>a+(policy.dashLead??-30)&&p.x<b-(policy.dashLead===0?30:35))){key('keyup','ShiftLeft');key('keydown','ShiftLeft');}
          else key('keyup','ShiftLeft');
          age++;g.physics(1/60);
        }
        runs.push({difficulty,level:index+1,pass:g.state.mode==='winning',health:g.state.health,x:Math.round(g.state.player.x)});
      }
      g.showWin();
      checks.push({name:`${difficulty} final screen`,pass:document.getElementById('modal-title').textContent==='把风景装进口袋'&&document.getElementById('modal-content').textContent.includes('/ 24')});
    }
    const records=JSON.parse(localStorage.getItem('windy-trails:v1'))?.records;
    checks.push({name:'separate mode completion records',pass:Object.keys(records?.easy?.levels||{}).length===8&&Object.keys(records?.hard?.levels||{}).length===8});
    g.state.mode='paused';
    return{checks,runs};
  });
  const failures=[...result.checks,...result.runs].filter(r=>!r.pass);
  if(failures.length)throw new Error(JSON.stringify({failures,result}));
  return result;
}
