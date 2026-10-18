const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {createManualDriver}=require('./v3-driver.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const output=path.join(__dirname,'artifacts');fs.mkdirSync(output,{recursive:true});
const BASE=process.env.RACER_URL||'http://localhost:3210';
(async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.CHROME_CHANNEL||'chrome'}),errors=[],warnings=[],report=[];
 try{
  const context=await browser.newContext({viewport:{width:1280,height:800},hasTouch:true});
  await context.addInitScript(()=>{if(!localStorage.getItem('junior-racers'))localStorage.setItem('junior-racers',JSON.stringify({autoThrottle:true,controlVersion:2,laps:3,sound:false}));});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());if(m.type()==='warning')warnings.push(m.text());});
  await page.goto(BASE+'/?v=3');await page.waitForFunction(()=>__racerDebug?.version==='3.1');
  assert.equal(await page.locator('#auto-throttle').isChecked(),false);assert.equal(await page.locator('#auto-throttle').isEnabled(),false);assert.equal(await page.locator('#laps').inputValue(),'2');assert.equal(await page.locator('#rules option').count(),3);
  await page.click('#start');await page.waitForFunction(()=>__racerDebug.time>4);
  let me=await page.evaluate(()=>__racerDebug.racers.find(r=>r.id===__racerDebug.playerId));assert.equal(me.v,0);assert.equal(me.completedLaps,0);assert.equal(me.checkpointsPassed,0);assert.equal(me.bot,false);
  report.push({case:'legacy-settings-no-autopilot',speed:me.v,checkpoints:me.checkpointsPassed});console.log('PASS legacy auto-throttle is disabled; no-input player stays parked');
  await page.keyboard.down('KeyW');await page.waitForFunction(()=>Math.abs(__racerDebug.racers.find(r=>r.id===__racerDebug.playerId).x)>9,{},{timeout:12000});await page.keyboard.up('KeyW');
  me=await page.evaluate(()=>__racerDebug.racers.find(r=>r.id===__racerDebug.playerId));assert.equal(me.completedLaps,0);assert.equal(me.finishTime,null);assert.ok(Math.abs(me.headingError)>.2);await page.screenshot({path:path.join(output,'feel-v3-throttle-only-off-track.png')});
  const beforeReset=me.penaltyTime;await page.keyboard.press('KeyR');await page.waitForFunction(()=>__racerDebug.racers.find(r=>r.id===__racerDebug.playerId).resetCount===1);
  me=await page.evaluate(()=>__racerDebug.racers.find(r=>r.id===__racerDebug.playerId));assert.ok(me.penaltyTime>=beforeReset+3-1e-8);assert.ok(Math.abs(me.x)<.1);assert.ok(me.s<10);assert.equal(me.validLap,false);
  await page.waitForTimeout(700);assert.equal(await page.evaluate(()=>__racerDebug.racers.find(r=>r.id===__racerDebug.playerId).resetCount),1);
  await page.keyboard.down('KeyS');await page.waitForFunction(()=>__racerDebug.racers.find(r=>r.id===__racerDebug.playerId).reversing,{},{timeout:4000});await page.waitForFunction(()=>document.querySelector('#gear').textContent==='R');await page.keyboard.up('KeyS');
  await page.click('#race-reset');await page.waitForFunction(()=>__racerDebug.racers.find(r=>r.id===__racerDebug.playerId).resetCount===2);
  await page.click('#pause');await page.click('#hud-restart');await page.waitForFunction(()=>__racerDebug.time<0&&__racerDebug.racers.find(r=>r.id===__racerDebug.playerId).resetCount===0);
  await page.click('#pause');await page.click('#quit');report.push({case:'manual-risk-reverse-reset-and-restart',offTrack:true,resetPenalty:3});console.log('PASS throttle alone runs wide; reverse, penalized reset and immediate restart work');
  await page.selectOption('#rules','timeattack');await page.locator('[data-track="coast"]').click();await page.setViewportSize({width:844,height:390});await page.click('#start');
  await page.waitForFunction(()=>__racerDebug.status==='racing');assert.equal(await page.evaluate(()=>__racerDebug.racers.length),1);
  const driver=await createManualDriver(page),deadline=Date.now()+145000;let state,lastCheckpoint=-1;
  while(Date.now()<deadline){
    state=await driver.step();if(state.me.checkpointsPassed!==lastCheckpoint){lastCheckpoint=state.me.checkpointsPassed;console.log(`Driving: lap ${state.me.completedLaps+1}, checkpoint ${lastCheckpoint}/8, ${Math.round(state.me.v*3.6)}km/h`);}
    if(state.me.completedLaps>=2||state.status==='finished')break;
    await page.waitForTimeout(35);
  }
  await driver.release();await page.waitForSelector('#result-dialog[open]',{timeout:5000});
  me=await page.evaluate(()=>__racerDebug.racers[0]);assert.equal(me.completedLaps,2);assert.ok(me.finishTime>0);assert.ok(Number.isFinite(me.resultTime));
  assert.ok(['gold','silver','bronze'].includes(me.medal),JSON.stringify(me));assert.ok(await page.locator('#timeattack-feedback').innerText());
  await page.screenshot({path:path.join(output,'feel-v3-timeattack-finish.png')});report.push({case:'real-touch-two-lap-timeattack',finishTime:me.finishTime,resultTime:me.resultTime,medal:me.medal});console.log('PASS real touch/pedal inputs complete two valid laps and earn a medal');
  const recording=await page.evaluate(()=>__racerDebug.ghost);assert.equal(recording.hasBest,true);assert.equal(recording.recording,false);assert.ok(recording.sampleCount>600,JSON.stringify(recording));assert.ok(Math.abs(recording.bestTime-me.resultTime)<.001);
  await page.click('#again');await page.waitForFunction(()=>__racerDebug.time>3);
  const replay=await page.evaluate(()=>({ghost:__racerDebug.ghost,render:__racerDebug.render,car:__racerDebug.racers[0],count:__racerDebug.racers.length}));
  assert.equal(replay.count,1);assert.equal(replay.car.bot,false);assert.equal(replay.car.v,0);assert.equal(replay.car.completedLaps,0);assert.equal(replay.ghost.hasBest,true);assert.equal(replay.ghost.progressAvailable,true);assert.equal(replay.render.ghost,true,JSON.stringify(replay));
  await page.locator('#ghost-toggle').focus();await page.keyboard.press('Space');await page.waitForFunction(()=>__racerDebug.ghost.enabled===false);assert.equal(await page.evaluate(()=>__racerDebug.input.drift),false);assert.equal(await page.locator('#ghost-toggle').getAttribute('aria-pressed'),'false');
  await page.reload();await page.waitForFunction(()=>__racerDebug?.version==='3.1');await page.click('#start');await page.waitForFunction(()=>__racerDebug.time>.5);
  const stored=await page.evaluate(()=>__racerDebug.ghost);assert.equal(stored.hasBest,true);assert.equal(stored.enabled,false);assert.ok(Math.abs(stored.bestTime-me.resultTime)<.001);
  await page.locator('#ghost-toggle').click();assert.equal(await page.locator('#ghost-toggle').getAttribute('aria-pressed'),'true');
  await page.screenshot({path:path.join(output,'feel-v31-personal-best-ghost.png')});report.push({case:'saved-replayed-and-reloaded-personal-best',samples:recording.sampleCount,bestTime:recording.bestTime,passivePlayerSpeed:replay.car.v});console.log('PASS personal-best ghost saves, replays without controlling the player and survives reload; Space toggle does not apply handbrake');
  await page.click('#pause');await page.click('#quit');await page.selectOption('#rules','arcade');await page.setViewportSize({width:390,height:844});await page.click('#start');await page.waitForFunction(()=>__racerDebug.render);
  for(const selector of ['#joy-steer','#throttle-button','[data-control="brake"]','#race-reset','#race-guide','#lap-integrity']){const box=await page.locator(selector).boundingBox();assert.ok(box&&box.x>=0&&box.y>=0&&box.x+box.width<=391&&box.y+box.height<=845,`${selector}: ${JSON.stringify(box)}`);}
  await page.screenshot({path:path.join(output,'feel-v3-mobile-portrait.png')});
  assert.deepEqual(errors,[]);assert.deepEqual(warnings,[]);fs.writeFileSync(path.join(output,'feel-v3-browser-results.json'),JSON.stringify({report,errors,warnings},null,2));console.log(JSON.stringify({report,errors,warnings},null,2));await context.close();
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
