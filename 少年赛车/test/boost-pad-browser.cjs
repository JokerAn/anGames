// Optional real WebGL/UI regression: a car brushes the pad with throttle released.
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const BASE=process.env.RACER_URL||'http://localhost:3210';
(async()=>{
  const browser=await chromium.launch({channel:process.env.CHROME_CHANNEL||'chrome',headless:true}),errors=[],results=[];
  try {
    for(const [name,cores,memory] of [['low',2,2],['high',8,8]]) {
      const context=await browser.newContext({viewport:{width:844,height:390},hasTouch:true,isMobile:true,deviceScaleFactor:2});
      await context.addInitScript(({cores,memory})=>{Object.defineProperty(navigator,'hardwareConcurrency',{get:()=>cores});Object.defineProperty(navigator,'deviceMemory',{get:()=>memory});},{cores,memory});
      const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(['error','warning'].includes(m.type()))errors.push(m.text());});await page.goto(BASE);
      await page.locator('#rules').selectOption('arcade');await page.locator('#auto-throttle').uncheck();await page.locator('#start').tap();await page.keyboard.down('KeyW');
      const pad=await page.evaluate(async()=>{const {getTrack}=await import('/src/tracks.js');return getTrack(__racerDebug.track).objects.find(o=>o.type==='boost');});
      let steering='',released=false,previous=null,trigger=null;const deadline=Date.now()+16000;
      while(Date.now()<deadline) {
        const state=await page.evaluate(()=>{const d=__racerDebug;return {me:d.racers.find(r=>r.id===d.playerId),input:d.input,render:d.render};});
        const error=pad.x+3.25-state.me.x,next=Math.abs(error)>.18?(error>0?'ArrowLeft':'ArrowRight'):'';
        if(steering!==next){if(steering)await page.keyboard.up(steering);if(next)await page.keyboard.down(next);steering=next;}
        if(!released&&state.me.s>pad.s-15){await page.keyboard.up('KeyW');released=true;}
        if(state.me.boost>0){trigger=state;break;}
        previous=state;await page.waitForTimeout(35);
      }
      if(steering)await page.keyboard.up(steering);await page.keyboard.up('KeyW');
      assert.ok(trigger,`${name} 设备的车身擦边必须触发`);assert.equal(released,true);assert.equal(trigger.input.throttle,false);assert.equal(trigger.input.nitro,false);
      assert.equal(trigger.me.boosting,true);assert.ok(trigger.me.boost>=3.5&&trigger.me.boost<=3.7);assert.ok(trigger.me.v>previous.me.v+5,'接触采样必须看到明显提速');
      assert.ok(Math.abs(trigger.me.x-pad.x)>pad.width,'车中心在加速带之外，靠车身擦边触发');
      await page.waitForFunction(()=>/^加速 \d\.\d 秒$/.test(document.getElementById('nitro-label').textContent));
      await page.screenshot({path:path.join(__dirname,'artifacts',`boost-pad-${name}-mobile.png`),scale:'css'});
      results.push({device:name,boostSeconds:trigger.me.boost,previousSpeedKmh:Number((previous.me.v*3.6).toFixed(1)),boostedSpeedKmh:Number((trigger.me.v*3.6).toFixed(1)),carOffset:Number((trigger.me.x-pad.x).toFixed(2)),padHalfWidth:pad.width,throttle:trigger.input.throttle,quality:trigger.render.quality});
      await context.close();
    }
    assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,results,errors},null,2));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
