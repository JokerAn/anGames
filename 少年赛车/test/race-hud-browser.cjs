const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium} = require('/Users/anshunli/gitHub/anGames/少年枪王/node_modules/playwright');
const origin = process.env.RACE_ORIGIN || 'http://localhost:3210';
const overlaps = (a, b) => a && b && Math.min(a.x+a.width,b.x+b.width) - Math.max(a.x,b.x) > 1 && Math.min(a.y+a.height,b.y+b.height) - Math.max(a.y,b.y) > 1;
(async () => {
  const browser = await chromium.launch({headless:true,channel:process.env.CHROME_CHANNEL || 'chrome'});
  try {
    const context = await browser.newContext({viewport:{width:1440,height:900}, reducedMotion:'reduce'});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // Isolate the presentation contract from the game's in-progress integration.
    await page.route('**/src/game.js*', route => route.fulfill({contentType:'application/javascript',body:''}));
    await page.goto(origin, {waitUntil:'networkidle'});
    assert.equal(await page.locator('#laps').inputValue(), '2');
    assert.equal(await page.locator('#rules option').count(), 3);
    assert.equal(await page.locator('#auto-throttle').isDisabled(), true);
    assert.equal(await page.locator('script[type=module]').getAttribute('src'), '/src/game.js?v=3.1');
    assert.match(await page.locator('.version-tag').innerText(), /3\.1 · 手动竞速/);
    const ids = await page.locator('[id]').evaluateAll(elements=>elements.map(element=>element.id));
    assert.equal(ids.length, new Set(ids).size, 'IDs must be unique');
    if(fs.existsSync('/tmp/race-hud-original-ids.json')) for(const id of JSON.parse(fs.readFileSync('/tmp/race-hud-original-ids.json'))) assert(ids.includes(id), `Legacy ID removed: ${id}`);
    await page.evaluate(async () => {
      const {RaceHud, renderRaceSummary} = await import('/src/race-hud.js');
      window.resetCalls=0;window.restartCalls=0;
      window.hud=new RaceHud({onReset:()=>window.resetCalls++,onRestart:()=>window.restartCalls++});
      window.renderSummary=renderRaceSummary;
      window.me={id:'local',name:'少年车手',car:'comet',engine:'balanced',nextCheckpoint:5,checkpointsPassed:2,completedLaps:1,validLap:true,penaltyTime:2.5,finishTime:null,resultTime:null,v:40,rank:2};
      window.race={trackId:'coast',rules:'circuit',laps:2,time:2,status:'racing',checkpoints:[1,2,3,4,5,6,7,8],racers:[window.me]};
      window.corner={direction:'left',distance:78,speed:20,severity:'tight'};
      document.getElementById('garage').hidden=true;
      document.getElementById('race-screen').hidden=false;
      document.getElementById('throttle-button').hidden=false;
      document.getElementById('leaderboard').innerHTML='<div class="rank-row">1 林越</div><div class="rank-row me">2 少年车手</div><div class="rank-row">3 陈驰</div><div class="rank-row">4 周远</div><div class="rank-row">5 沈锋</div><div class="rank-row">6 陆衡</div>';
      document.getElementById('race-screen').classList.add('circuit');
      window.hud.sync(window.race,window.me,{},window.corner);
    });
    for (const [rules, expected] of [['circuit',/手动油门 · 检查点 · 走线.*Shift/],['arcade',/加速带 · 火箭／冰冻 · 全部道具/],['timeattack',/无碰撞干净圈 · 挑战奖牌.*Shift/]]) {
      await page.locator('#rules').selectOption(rules,{force:true});
      assert.match(await page.locator('#rules-note').textContent(),expected);
      assert.equal(await page.locator('[data-mode=solo] span').textContent(),rules==='timeattack'?'无 AI':'1 人 + 5 AI');
      assert.equal(await page.locator('[data-mode=lan] span').textContent(),rules==='timeattack'?'双人计时':'2 人 + 4 AI');
    }
    await page.locator('#rules').selectOption('circuit',{force:true});
    assert.match(await page.locator('#help-dialog').textContent(),/干净完赛即使未获奖牌也可记录个人最佳/);
    assert.match(await page.locator('.driving-keys').textContent(),/Shift.*主动氮气/);
    assert.equal(await page.locator('[data-control=drift] small').textContent(),'按住 · 松开');
    await page.evaluate(()=>{
      const me={...window.me,rank:1};
      document.getElementById('position').textContent='1';
      window.hud.sync({...window.race,rules:'timeattack',racers:[me]},me,{},window.corner);
    });
    assert.equal((await page.locator('.position-card').textContent()).replace(/\s/g,''),'1/1POSITION');
    for(const count of [2,6]) {
      await page.evaluate(count=>window.hud.sync({...window.race,racers:Array.from({length:count},()=>window.me)},window.me,{},window.corner),count);
      assert.equal(await page.locator('#racer-count').textContent(),String(count));
    }
    await page.evaluate(()=>{document.getElementById('position').textContent='2';window.race.racers=Array.from({length:6},()=>window.me);});
    assert.equal(await page.locator('#corner-title').textContent(),'左急弯');
    assert.equal(await page.locator('#corner-speed').textContent(),'72');
    assert.equal(await page.locator('#corner-distance').textContent(),'78 米');
    assert.equal(await page.locator('#corner-advice').textContent(),'先刹车，再转向');
    assert.equal(await page.locator('#checkpoint-meter').getAttribute('aria-valuenow'),'25');
    assert.equal(await page.locator('#penalty-time').textContent(),'罚时 +2.50 秒');
    await page.evaluate(()=>{window.me.checkpointsPassed=8;window.me.nextCheckpoint=0;window.hud.sync(window.race,window.me,{},window.corner);});
    assert.equal(await page.locator('#checkpoint-progress').textContent(),'检查点 8 / 8');
    assert.equal(await page.locator('#checkpoint-meter').getAttribute('aria-valuenow'),'100');
    await page.evaluate(()=>{window.me.checkpointsPassed=2;window.me.nextCheckpoint=5;window.hud.sync(window.race,window.me,{},window.corner);});
    await page.locator('#race-reset').click();
    assert.equal(await page.evaluate(()=>window.resetCalls),1);
    assert.equal(await page.locator('#race-reset').isDisabled(),true);
    assert(await page.evaluate(()=>{const pending=window.hud.resetPendingUntil;window.hud.sync({...window.race},window.me,{},window.corner);return window.hud.resetPendingUntil===pending;}),'Network snapshots must preserve reset click guard');
    await page.locator('#dismiss-driving-coach').click();
    assert.equal(await page.locator('#driving-coach').isHidden(),true);
    await page.evaluate(()=>{document.getElementById('pause-dialog').showModal();});
    await page.locator('#hud-restart').click();
    assert.equal(await page.evaluate(()=>window.restartCalls),1);
    await page.evaluate(()=>{document.getElementById('pause-dialog').close();});
    for(const [patch, expected] of [[{wrongWayTime:1},'逆行'],[{wrongWayTime:0,offTrackTime:1},'越界'],[{offTrackTime:0,_missedCheckpoint:true},'漏过检查点'],[{_missedCheckpoint:false,checkpointMissed:true},'漏过检查点'],[{checkpointMissed:false,validLap:false},'本圈不计最快圈']]) {
      await page.evaluate(patch=>{Object.assign(window.me,patch);window.hud.sync(window.race,window.me,{},window.corner);},patch);
      assert.match(await page.locator('#race-warning').textContent(),new RegExp(expected));
    }
    await page.evaluate(()=>window.hud.sync(window.race,window.me,{},undefined));
    assert.equal(await page.locator('#corner-speed').textContent(),'—');
    const layouts=[];
    for(const [width,height] of [[1440,900],[390,844],[320,568],[844,390],[667,375]]) {
      await page.setViewportSize({width,height});
      for (const rules of ['circuit','arcade']) {
        await page.evaluate(rules=>{
          window.hud.resetPendingUntil=0; window.hud.coachSeen=false;window.race.rules=rules;window.me.wrongWayTime=2;
          document.getElementById('race-screen').classList.toggle('circuit',rules!=='arcade');
          window.hud.sync(window.race,window.me,{},window.corner);
        },rules);
        const selectors = ['#race-reset','#throttle-button','[data-control=brake]','[data-control=drift]','[data-control=nitro]','#joy-steer','#race-guide','#lap-integrity','.race-side','.speedometer','#driving-coach'];
        const boxes={};for(const selector of selectors) boxes[selector]=await page.locator(selector).boundingBox();
        await page.screenshot({path:`/tmp/race-hud-${width}x${height}-${rules}.png`});
        for(const [selector,box] of Object.entries(boxes)) {
          assert(box && box.x>=-1 && box.y>=-1 && box.x+box.width<=width+1 && box.y+box.height<=height+1,`${width}x${height} ${rules}: ${selector} outside viewport ${JSON.stringify(box)}`);
        }
        for(const selector of selectors.filter(selector=>selector!=='#race-reset')) assert(!overlaps(boxes['#race-reset'],boxes[selector]),`${width}x${height} ${rules}: reset overlaps ${selector}: ${JSON.stringify([boxes['#race-reset'],boxes[selector]])}`);
        for(const selector of ['#throttle-button','[data-control=brake]','#joy-steer','#race-guide','#lap-integrity','.race-side','.speedometer']) assert(!overlaps(boxes['#driving-coach'],boxes[selector]),`${width}x${height} ${rules}: tutorial overlaps ${selector}`);
        assert(!overlaps(boxes['#race-guide'],boxes['#lap-integrity']),`${width}x${height}: corner overlaps checkpoints`);
        await page.evaluate(()=>{window.me.wrongWayTime=0;window.hud.sync(window.race,window.me,{},window.corner);});
        assert.equal(await page.locator('#race-warning').textContent(),'本圈不计最快圈；请依次过检查点');
        await page.screenshot({path:`/tmp/race-hud-${width}x${height}-${rules}-dirty.png`});
        const dirtyPanel=await page.locator('#lap-integrity').boundingBox();
        for(const selector of ['.speedometer','#race-guide','#race-reset','#driving-coach']) assert(!overlaps(dirtyPanel,await page.locator(selector).boundingBox()),`${width}x${height} ${rules}: dirty-lap guidance overlaps ${selector}: ${JSON.stringify([dirtyPanel,await page.locator(selector).boundingBox()])}`);
        layouts.push(`${width}×${height} ${rules}`);
      }
    }
    await page.setViewportSize({width:390,height:844});
    const summary = await page.evaluate(()=>{
      window.hud.dismissCoach();
      const race={trackId:'hud-test-track',rules:'timeattack',laps:2,difficulty:'normal',time:100,status:'finished',racers:[]};
      const me={id:'local',name:'<img src=x onerror=alert(1)>',car:'comet',engine:'balanced',rank:2,finishTime:100,penaltyTime:2.5,resultTime:102.5,completedLaps:2,cleanLaps:2,medal:'gold'};
      const invalid={id:'other',name:'无效车手',rank:1,finishTime:95,penaltyTime:0,resultTime:null,completedLaps:1,cleanLaps:1};
      race.racers=[invalid,me];
      for(let i=localStorage.length-1;i>=0;i--){const key=localStorage.key(i);if(key.includes('hud-test-track')) localStorage.removeItem(key);}
      window.renderSummary(race,me); const first=document.getElementById('timeattack-feedback').textContent;
      window.renderSummary(race,me); const repeated=document.getElementById('timeattack-feedback').textContent;
      const faster={...race,racers:[{...me,finishTime:97,resultTime:99.5}]};window.renderSummary(faster,faster.racers[0]);
      const better=document.getElementById('timeattack-feedback').textContent;
      window.renderSummary(race,me);document.getElementById('result-dialog').showModal();
      return {first,repeated,better,rows:[...document.querySelectorAll('#result-list .detailed-result')].map(row=>row.textContent),injected:document.querySelectorAll('#result-list img').length};
    });
    assert.match(summary.first,/金牌.*首次有效完赛/);
    assert.equal(summary.first,summary.repeated);
    assert.match(summary.better,/刷新个人最佳.*快了 3.00 秒/);
    assert.match(summary.rows[0],/原始用时01:40.00罚时\+2.50 秒有效成绩01:42.50/);
    assert.match(summary.rows[1],/无有效成绩/);
    assert.equal(summary.injected,0);
    assert((await page.locator('#result-list').evaluate(e=>e.scrollWidth<=e.clientWidth)),'Results overflow');
    await page.screenshot({path:'/tmp/race-hud-results-mobile.png'});
    const cleanRules=await page.evaluate(()=>{
      const scoreKeys=()=>Object.entries(localStorage).filter(([key])=>key.includes('hud-test-track')).sort();
      const before=JSON.stringify(scoreKeys());
      const dirty={id:'solo',name:'单车计时',car:'comet',engine:'balanced',finishTime:10,resultTime:10,penaltyTime:0,completedLaps:2,cleanLaps:1,medal:'none'};
      const race={trackId:'hud-test-track',rules:'timeattack',laps:2,difficulty:'normal',status:'finished',racers:[dirty]};
      window.renderSummary(race,dirty);
      const rejected={feedback:document.getElementById('timeattack-feedback').textContent,row:document.getElementById('result-list').textContent,unchanged:before===JSON.stringify(scoreKeys())};
      for(const key of Object.keys(localStorage)) if(key.includes('hud-test-slow')) localStorage.removeItem(key);
      const slow={...dirty,finishTime:300,resultTime:300,cleanLaps:2};
      window.renderSummary({...race,trackId:'hud-test-slow',racers:[slow]},slow);
      const accepted={feedback:document.getElementById('timeattack-feedback').textContent,rows:document.querySelectorAll('#result-list .detailed-result').length,stored:Object.entries(localStorage).filter(([key])=>key.includes('hud-test-slow')).map(([,value])=>value)};
      return {rejected,accepted};
    });
    assert.equal(cleanRules.rejected.unchanged,true);
    assert.match(cleanRules.rejected.feedback,/没有有效成绩/);
    assert.match(cleanRules.rejected.row,/无有效成绩/);
    assert.match(cleanRules.accepted.feedback,/未获奖牌.*首次有效完赛.*个人最佳 05:00.00/);
    assert.equal(cleanRules.accepted.rows,1);
    assert.deepEqual(cleanRules.accepted.stored,['300']);
    await page.screenshot({path:'/tmp/race-hud-solo-timeattack.png'});
    await page.evaluate(()=>{
      document.getElementById('result-dialog').close();
      window.race.status='countdown';window.hud.sync(window.race,window.me,{},window.corner);
    });
    assert.equal(await page.locator('#race-reset').isDisabled(),true);
    await page.evaluate(()=>{
      window.race.status='racing';window.race.time=10;window.hud.coachSeen=false;window.hud.sync(window.race,window.me,{},window.corner);
    });
    assert.equal(await page.locator('#driving-coach').isHidden(),true);
    await page.evaluate(()=>{window.hud.destroy();document.body.replaceChildren();window.hud=new window.hud.constructor();window.hud.sync(window.race,window.me,{},null);window.hud.results(window.race,window.me);window.hud.destroy();});
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({status:'passed',layouts,checks:['legacy IDs','manual setup','dynamic racer count including 1/1 timeattack','timeattack tabs and manual handbrake copy','final boost-pad mode copy and Shift instructions','corner units and warnings','checkpoint count priority and final gate wrap','reset/restart callbacks','dismiss/auto-dismiss teaching','effective result sort','invalid result exclusion','medal and personal best','dirty timeattack excluded','slow clean solo PB without medal','dirty-lap guidance priority and layout','safe text rendering','missing DOM','reduced motion'],screenshots:'/tmp/race-hud-*.png'},null,2));
    await context.close();
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
