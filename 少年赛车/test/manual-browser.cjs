const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const BASE=process.env.RACER_URL||'http://localhost:3210';
(async()=>{
  const browser=await chromium.launch({channel:process.env.CHROME_CHANNEL||'chrome',headless:true}),errors=[],report=[];
  try {
    const context=await browser.newContext({viewport:{width:844,height:390},hasTouch:true,isMobile:true});
    await context.addInitScript(()=>{if(!localStorage.getItem('junior-racers'))localStorage.setItem('junior-racers',JSON.stringify({autoThrottle:true,car:'comet',rules:'circuit'}));});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(['error','warning'].includes(m.type()))errors.push(m.text());});
    await page.goto(BASE);await page.waitForFunction(()=>!!window.__racerDebug?.render);assert.equal(await page.locator('#auto-throttle').isChecked(),false,'旧自动油门默认设置应迁移为手动');
    await page.locator('#start').tap();await page.waitForTimeout(4700);
    const me=()=>page.evaluate(()=>__racerDebug.racers.find(r=>r.id===__racerDebug.playerId));const idle=await me();assert.equal(idle.v,0);assert.equal(idle.s,-12);assert.equal(await page.locator('#throttle-button').isVisible(),true);
    const cdp=await context.newCDPSession(page),pedal=await page.locator('#throttle-button').boundingBox(),gas={x:pedal.x+pedal.width/2,y:pedal.y+pedal.height/2,id:1};
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[gas]});await page.waitForTimeout(1100);const accelerating=await me();assert.ok(accelerating.v>10);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(600);const coasting=await me();assert.ok(coasting.v<accelerating.v);assert.equal(await page.evaluate(()=>__racerDebug.input.throttle),false);report.push({case:'manual-default',idleSpeed:idle.v,pressedSpeed:accelerating.v,releasedSpeed:coasting.v});
    await page.locator('#pause').tap();await page.locator('#quit').tap();await page.locator('#auto-throttle').check();await page.reload();await page.waitForFunction(()=>!!window.__racerDebug?.render);assert.equal(await page.locator('#auto-throttle').isChecked(),true,'用户主动选定后应保存');
    await page.locator('#start').tap();await page.waitForTimeout(12000);const unattended=await me();assert.ok(Math.abs(unattended.x)>6);assert.ok(Math.abs(unattended.headingError)>.2);assert.ok(unattended.s<300);assert.equal(unattended.finishTime,null);
    await page.screenshot({path:path.join(__dirname,'artifacts','manual-no-auto-steering.png'),scale:'css'});report.push({case:'auto-throttle-without-steering',s:unattended.s,x:unattended.x,heading:unattended.headingError,v:unattended.v});
    await page.locator('#pause').tap();await page.locator('#quit').tap();await page.locator('#auto-throttle').uncheck();await page.locator('#start').tap();
    const gasBox=await page.locator('#throttle-button').boundingBox(),stickBox=await page.locator('#joy-steer').boundingBox(),throttle={x:gasBox.x+gasBox.width/2,y:gasBox.y+gasBox.height/2,id:1};
    const centre={x:stickBox.x+stickBox.width/2,y:stickBox.y+stickBox.height/2,id:2},radius=stickBox.width*.42;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[throttle,centre]});
    const pads=new Set(),deadline=Date.now()+25000;let state;
    while(Date.now()<deadline){
      state=await page.evaluate(async()=>{const {getTrack,steeringLimit}=await import('/src/tracks.js'),d=__racerDebug,r=d.racers.find(r=>r.id===d.playerId),t=getTrack(d.track);return {me:r,curvature:t.curvature(r.s),maxSteer:steeringLimit(r.v),grip:r.gripUsage,end:t.boostStraight.s+t.boostStraight.length};});
      const r=state.me,maxSteer=state.maxSteer,desired=state.curvature*r.v+(Math.atan2(-r.x,14)-r.headingError)*4;
      const steer=Math.max(-1,Math.min(1,Math.atan(2.8*desired/Math.max(5,r.v/(1+Math.max(0,state.grip-1)*.45)))/maxSteer));
      const raw=Math.abs(steer)<.01?0:-Math.sign(steer)*(.14+.86*Math.abs(steer));
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[throttle,{...centre,x:centre.x+raw*radius}]});
      for(const id of r.boostContacts)if(id.startsWith('boost-straight-'))pads.add(id);
      if(pads.size===3)break;await page.waitForTimeout(35);
    }
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});assert.equal(pads.size,3,`手动油门与真实摇杆修正可以通过三个直线加速带: ${JSON.stringify(state.me)}`);
    await page.screenshot({path:path.join(__dirname,'artifacts','manual-straight-boost.png'),scale:'css'});report.push({case:'manual-throttle-and-steering',pads:[...pads],speedKmh:Math.round(state.me.v*3.6),s:state.me.s});
    await context.close();assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,report,errors},null,2));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
