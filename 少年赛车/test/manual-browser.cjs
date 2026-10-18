const assert=require('node:assert/strict');
const path=require('node:path');
const {createManualDriver}=require('./v3-driver.cjs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const BASE=process.env.RACER_URL||'http://localhost:3210';
(async()=>{
  const browser=await chromium.launch({channel:process.env.CHROME_CHANNEL||'chrome',headless:true}),errors=[],report=[];
  try {
    const context=await browser.newContext({viewport:{width:844,height:390},hasTouch:true,isMobile:true});
    // A legacy saved preference must never re-enable automatic human input.
    await context.addInitScript(()=>{if(!localStorage.getItem('junior-racers'))localStorage.setItem('junior-racers',JSON.stringify({autoThrottle:true,controlVersion:2,car:'comet',rules:'timeattack'}));});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(['error','warning'].includes(m.type()))errors.push(m.text());});
    await page.goto(BASE);await page.waitForFunction(()=>window.__racerDebug?.version==='3.1');
    const assertManual=async()=>{assert.equal(await page.locator('#auto-throttle').isChecked(),false,'旧自动油门配置必须失效');assert.equal(await page.locator('#auto-throttle').isEnabled(),false);assert.equal(await page.locator('#auto-throttle').isVisible(),false);};
    await assertManual();await page.reload();await page.waitForFunction(()=>!!window.__racerDebug?.render);await assertManual();
    const me=()=>page.evaluate(()=>__racerDebug.racers.find(r=>r.id===__racerDebug.playerId));
    await page.locator('#start').tap();await page.waitForFunction(()=>__racerDebug.time>1);const idle=await me();await page.waitForTimeout(500);const still=await me();
    assert.equal(still.v,0);assert.equal(still.forwardSpeed,0);assert.equal(still.worldX,idle.worldX);assert.equal(still.worldZ,idle.worldZ);assert.equal(still.completedLaps,0);assert.equal(still.checkpointsPassed,0);assert.equal(still.bot,false);assert.equal(await page.evaluate(()=>__racerDebug.input.throttle),false);
    assert.equal(await page.locator('#throttle-button').isVisible(),true);
    await page.keyboard.down('KeyW');await page.waitForTimeout(1100);const accelerating=await me();assert.ok(accelerating.v>10);
    await page.keyboard.up('KeyW');await page.waitForTimeout(600);const coasting=await me();assert.ok(coasting.v<accelerating.v);assert.equal(await page.evaluate(()=>__racerDebug.input.throttle),false);
    report.push({case:'legacy-config-cannot-drive',idleSpeed:idle.v,pressedSpeed:accelerating.v,releasedSpeed:coasting.v});
    await page.keyboard.down('KeyW');
    try {await page.waitForFunction(()=>__racerDebug.racers.find(r=>r.id===__racerDebug.playerId).offRoad,{},{timeout:12000});}finally{await page.keyboard.up('KeyW');}
    const unattended=await me();assert.ok(Math.abs(unattended.x)>9);assert.ok(Math.abs(unattended.headingError)>.2);assert.equal(unattended.completedLaps,0);assert.equal(unattended.finishTime,null);
    await page.screenshot({path:path.join(__dirname,'artifacts','manual-no-auto-steering.png'),scale:'css'});
    report.push({case:'throttle-only-leaves-road',s:unattended.s,x:unattended.x,heading:unattended.heading,worldX:unattended.worldX,worldZ:unattended.worldZ});
    const pressBefore=await page.evaluate(()=>__racerDebug.input.resetPress);
    await page.keyboard.press('KeyR');await page.waitForFunction(count=>__racerDebug.racers.find(r=>r.id===__racerDebug.playerId).resetCount===count,unattended.resetCount+1);
    const reset=await me();assert.ok(reset.penaltyTime>=unattended.penaltyTime+3-1e-8);assert.ok(Math.abs(reset.x)<.1);assert.ok(reset.v<.1);assert.equal(reset.validLap,false);assert.equal(await page.evaluate(()=>__racerDebug.input.resetPress),pressBefore+1);
    assert.ok(await page.evaluate(()=>__racerDebug.events.some(e=>e.racer===__racerDebug.playerId&&e.type==='reset')));
    await page.waitForTimeout(400);assert.equal((await me()).resetCount,reset.resetCount);report.push({case:'reset-press-penalty-once',penalty:reset.penaltyTime-unattended.penaltyTime,resetCount:reset.resetCount});
    await page.locator('#pause').tap();await page.locator('#quit').tap();await assertManual();await page.locator('#rules').selectOption('timeattack');await page.locator('#start').tap();await page.waitForFunction(()=>__racerDebug.status==='racing');
    const start=await me(),driver=await createManualDriver(page);let state;const deadline=Date.now()+8000;
    try{
      while(Date.now()<deadline){state=await driver.step();if(state.me.s>140&&state.me.checkpointsPassed>=1)break;await page.waitForTimeout(35);}
    }finally{await driver.release();}
    const driven=await me();assert.ok(driven.s>140,JSON.stringify(driven));assert.ok(driven.checkpointsPassed>=1);assert.ok(Math.hypot(driven.worldX-start.worldX,driven.worldZ-start.worldZ)>50);assert.ok(Math.abs(driven.x)<5);assert.equal(driven.offRoad,false);assert.equal(driven.resetCount,0);assert.equal(driven.penaltyTime,0);assert.equal(driven.validLap,true);assert.equal(driven.finishTime,null);
    await page.waitForTimeout(100);const input=await page.evaluate(()=>__racerDebug.input);assert.equal(input.throttle,false);assert.equal(input.steer,0);assert.equal(input.brake,false);assert.equal(input.nitro,false);
    await page.screenshot({path:path.join(__dirname,'artifacts','manual-active-driving.png'),scale:'css'});report.push({case:'real-touch-manual-driving',s:driven.s,x:driven.x,speedKmh:Math.round(driven.v*3.6),checkpoints:driven.checkpointsPassed,worldX:driven.worldX,worldZ:driven.worldZ});
    await context.close();assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,report,errors},null,2));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
