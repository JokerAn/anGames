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
        await page.locator('#rules').selectOption('arcade');await page.locator('[data-mode="lan"]').tap();await page.locator('#room-code').fill(code);await page.locator('#start').tap();await page.locator('#room-dialog').waitFor({state:'visible'});
        peer=new WebSocket(base.replace('http:','ws:'));await new Promise((resolve,reject)=>{peer.once('open',resolve);peer.once('error',reject);});
        peer.send(JSON.stringify({type:'join',room:code,name:'测试对手'}));peer.send(JSON.stringify({type:'ready',ready:true}));await page.locator('#ready').tap();await page.waitForFunction(()=>!document.getElementById('room-start').disabled);await page.locator('#room-start').tap();await page.waitForFunction(()=>__racerDebug.active);
        // Let the first rendered race frames finish their shader warm-up before the
        // contact window: a compile stall during the 15 ms polling loop would make
        // the measured boost remainder look shorter than the configured 3.7 s.
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const room=app.rooms.get(code),race=room.race,me=race.racers.find(r=>r.id===room.host),pad=getTrack(race.trackId).objects.find(o=>o.type==='boost');
        race.time=1;race.status='racing';race.racers.filter(r=>r!==me).forEach(r=>{r.finishTime=0;r.s=-300;r.v=0;});
        Object.assign(me,{s:pad.s-30,x:pad.x+3.35,v:35,vx:0,headingError:0,steerAngle:0,input:{throttle:false},boost:0,boostContacts:{}});
        await page.waitForFunction(s=>{const d=__racerDebug,r=d.racers.find(r=>r.id===d.playerId);return r.s>s-14;},pad.s);
        const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
        const serverRacer=()=>app.rooms.get(code).race.racers.find(r=>r.id===room.host);
        // Contact is authoritative on the server: a real client session + real
        // WebGL frame loop still drives the same request path. Exact 3.7 s
        // duration and the one-shot impulse are asserted in boost-pad.test.js;
        // this pass proves end-to-end contact and the client UI reflection.
        let serverBoost=null;
        const contactDeadline=Date.now()+5000;
        while(Date.now()<contactDeadline){
          const racer=serverRacer();
          if(racer.boost>0){serverBoost={boost:racer.boost,v:racer.v,x:racer.x,s:racer.s};break;}
          await sleep(15);
        }
        assert.ok(serverBoost,`${name} 设备车身擦边必须触发`);
        assert.ok(Math.abs(serverBoost.x-pad.x)>pad.width,'车中心在带外，车身接触触发');
        await page.waitForFunction(()=>{const d=__racerDebug,me=d.racers.find(r=>r.id===d.playerId);return me.boost>0&&me.boosting;},null,{timeout:3000});
        const client=await page.evaluate(()=>{const d=__racerDebug;return {me:d.racers.find(r=>r.id===d.playerId),input:d.input,render:d.render};});
        assert.equal(client.input.throttle,false);assert.equal(client.input.nitro,false);
        assert.ok(client.me.boost>0&&client.me.boost<=3.7,`client boost ${client.me.boost}`);
        await page.waitForFunction(()=>/^加速 \d\.\d 秒$/.test(document.getElementById('nitro-label').textContent),null,{timeout:3000});
        await page.screenshot({path:path.join(__dirname,'artifacts',`boost-pad-${name}-mobile.png`),scale:'css'});
        results.push({device:name,boostSeconds:serverBoost.boost,serverSpeed:Number(serverBoost.v.toFixed(1)),clientBoost:client.me.boost,carOffset:Number((serverBoost.x-pad.x).toFixed(2)),padHalfWidth:pad.width,throttle:client.input.throttle,quality:client.render.quality});
      }finally{peer?.terminate();await context.close();}
    }
    assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,results,errors},null,2));
  }finally{await browser.close();await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
