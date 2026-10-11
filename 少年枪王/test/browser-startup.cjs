// Validate startup without depending on browser audio permission resolving.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
  const {createGameServer}=await import('../server.js'),app=createGameServer();await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const url=`http://127.0.0.1:${app.server.address().port}`,browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'chrome'}),errors=[],report=[];
  try {
    for(const audio of ['normal','pending','rejected','unavailable','constructor-error','partial-error'])for(const mobile of [false,true]) {
      const context=await browser.newContext({viewport:mobile?{width:844,height:390}:{width:1280,height:800},hasTouch:mobile,isMobile:mobile});
      await context.addInitScript(mode=>{
        const Native=window.AudioContext||window.webkitAudioContext;
        if(mode==='unavailable'){window.AudioContext=window.webkitAudioContext=undefined;return;}
        if(mode==='normal')return;
        window.AudioContext=class {
          constructor(){
            if(mode==='constructor-error')throw new Error('Audio disabled');
            const ctx=new Native();
            if(mode==='partial-error'){ctx.createGain=()=>{throw new Error('Audio initialization failed');};return ctx;}
            Object.defineProperty(ctx,'state',{get:()=> 'suspended'});
            ctx.resume=mode==='pending'?()=>new Promise(()=>{}):()=>Promise.reject(new Error('Audio permission denied'));
            return ctx;
          }
        };
      },audio);
      const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
      await page.goto(url+'/?debug=1');await page.waitForFunction(()=>window.__arena?.renderer);assert.equal(await page.locator('#start-game').isEnabled(),true);
      await page.locator('#start-game').click();await page.waitForFunction(()=>window.__arena?.state?.time>.4,{},{timeout:4000});
      assert.equal(await page.locator('#game-screen').isVisible(),true);if(mobile)await page.locator('#pause-game').tap();else await page.keyboard.press('Escape');await page.waitForSelector('#pause-dialog[open]');await page.locator('#quit-game').click();assert.equal(await page.locator('#start-game').isEnabled(),true);
      // Returning to the lobby must not leave a pending first attempt or stale state.
      await page.locator('#start-game').click();await page.waitForFunction(()=>window.__arena?.state?.time>.2,{},{timeout:4000});
      report.push({audio,mobile,started:true,restarted:true});console.log(`PASS startup ${audio} ${mobile?'mobile':'desktop'}`);await context.close();
    }
    assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,report,errors},null,2));
  }finally{await browser.close();await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
