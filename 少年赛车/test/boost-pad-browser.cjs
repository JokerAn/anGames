// A controlled, real LAN/WebGL contact regression. Traffic is parked by the
// test-owned server so an AI collision cannot alter the contact line mid-test.
const assert=require('node:assert/strict');
const path=require('node:path');
const {WebSocket}=require('../node_modules/ws');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
  const {createGameServer}=await import('../server.js'),{getTrack}=await import('../src/tracks.js'),app=createGameServer();
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;
  const browser=await chromium.launch({channel:process.env.CHROME_CHANNEL||'chrome',headless:true}),errors=[],results=[];
  try {
    for(const [name,cores,memory,code] of [['low',2,2,'4821'],['high',8,8,'4822']]) {
      const context=await browser.newContext({viewport:{width:844,height:390},hasTouch:true,isMobile:true,deviceScaleFactor:2});
      let peer;
      try {
        await context.addInitScript(({cores,memory})=>{Object.defineProperty(navigator,'hardwareConcurrency',{get:()=>cores});Object.defineProperty(navigator,'deviceMemory',{get:()=>memory});},{cores,memory});
        const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(['error','warning'].includes(m.type()))errors.push(m.text());});await page.goto(base);
        await page.locator('#rules').selectOption('arcade');await page.locator('#auto-throttle').uncheck();await page.locator('[data-mode="lan"]').tap();await page.locator('#room-code').fill(code);await page.locator('#start').tap();await page.locator('#room-dialog').waitFor({state:'visible'});
        peer=new WebSocket(base.replace('http:','ws:'));await new Promise((resolve,reject)=>{peer.once('open',resolve);peer.once('error',reject);});
        peer.send(JSON.stringify({type:'join',room:code,name:'测试对手'}));peer.send(JSON.stringify({type:'ready',ready:true}));await page.locator('#ready').tap();await page.waitForFunction(()=>!document.getElementById('room-start').disabled);await page.locator('#room-start').tap();await page.waitForFunction(()=>__racerDebug.active);
        const room=app.rooms.get(code),race=room.race,me=race.racers.find(r=>r.id===room.host),pad=getTrack(race.trackId).objects.find(o=>o.type==='boost');
        race.time=1;race.status='racing';race.racers.filter(r=>r!==me).forEach(r=>{r.finishTime=0;r.s=-300;r.v=0;});
        Object.assign(me,{s:pad.s-12,x:pad.x+3.35,v:35,vx:0,headingError:0,steerAngle:0,input:{throttle:false},boost:0,boostContacts:{}});
        await page.waitForFunction(s=>{const d=__racerDebug,r=d.racers.find(r=>r.id===d.playerId);return r.s>s-14;},pad.s);
        let previous=await page.evaluate(()=>__racerDebug.racers.find(r=>r.id===__racerDebug.playerId)),trigger=null;
        const deadline=Date.now()+4000;
        while(Date.now()<deadline){const state=await page.evaluate(()=>{const d=__racerDebug;return {me:d.racers.find(r=>r.id===d.playerId),input:d.input,render:d.render};});if(state.me.boost>0){trigger=state;break;}previous=state.me;await page.waitForTimeout(15);}
        assert.ok(trigger,`${name} 设备车身擦边必须触发`);assert.equal(trigger.input.throttle,false);assert.equal(trigger.input.nitro,false);assert.equal(trigger.me.boosting,true);
        assert.ok(trigger.me.boost>=3.5&&trigger.me.boost<=3.7);assert.ok(trigger.me.v>previous.v+5);assert.ok(Math.abs(trigger.me.x-pad.x)>pad.width,'车中心在带外，车身接触触发');
        await page.waitForFunction(()=>/^加速 \d\.\d 秒$/.test(document.getElementById('nitro-label').textContent));await page.screenshot({path:path.join(__dirname,'artifacts',`boost-pad-${name}-mobile.png`),scale:'css'});
        results.push({device:name,boostSeconds:trigger.me.boost,previousSpeedKmh:Number((previous.v*3.6).toFixed(1)),boostedSpeedKmh:Number((trigger.me.v*3.6).toFixed(1)),carOffset:Number((trigger.me.x-pad.x).toFixed(2)),padHalfWidth:pad.width,throttle:trigger.input.throttle,quality:trigger.render.quality});
      }finally{peer?.terminate();await context.close();}
    }
    assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,results,errors},null,2));
  }finally{await browser.close();await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
