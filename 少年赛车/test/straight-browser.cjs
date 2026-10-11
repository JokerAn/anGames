const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const BASE=process.env.RACER_URL||'http://localhost:3210';
(async()=>{
  const browser=await chromium.launch({channel:process.env.CHROME_CHANNEL||'chrome',headless:true}),errors=[],report=[];
  try {
    for(const [track,rules,weak] of [['coast','circuit',true],['canyon','arcade',false],['neon','circuit',false]]) {
      const context=await browser.newContext({viewport:{width:844,height:390},deviceScaleFactor:2,hasTouch:true,isMobile:true});
      await context.addInitScript(weak=>{Object.defineProperty(navigator,'hardwareConcurrency',{get:()=>weak?2:8});Object.defineProperty(navigator,'deviceMemory',{get:()=>weak?2:8});},weak);
      const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(['error','warning'].includes(m.type()))errors.push(m.text());});await page.goto(BASE);
      await page.locator(`[data-track="${track}"]`).tap();await page.locator('#rules').selectOption(rules);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.screenshot({path:path.join(__dirname,'artifacts',`straight-${track}-garage.png`),scale:'css',fullPage:true});
      await page.locator('#start').tap();
      const layout=await page.evaluate(async()=>{const {getTrack}=await import('/src/tracks.js'),t=getTrack(__racerDebug.track);return {straight:t.boostStraight,pads:t.objects.filter(o=>o.section==='boost-straight'),length:t.length};});
      let steering='',shot=false,entered=false;const collected=new Set(),deadline=Date.now()+22000;
      while(Date.now()<deadline){
        const state=await page.evaluate(()=>{const d=__racerDebug;return {me:d.racers.find(r=>r.id===d.playerId),time:d.time,render:d.render};});
        const target=0,delta=target-state.me.x,next=Math.abs(delta)>.28?(delta>0?'ArrowLeft':'ArrowRight'):'';
        if(steering!==next){if(steering)await page.keyboard.up(steering);if(next)await page.keyboard.down(next);steering=next;}
        if(state.me.s>=layout.straight.s+15&&!shot){await page.screenshot({path:path.join(__dirname,'artifacts',`straight-${track}-mobile.png`),scale:'css'});shot=true;}
        for(const id of state.me.boostContacts||[])if(layout.pads.some(p=>p.id===id)){collected.add(id);entered=true;}
        if(entered&&state.me.s<layout.pads.at(-1).s-7)assert.ok(state.me.boost>0,'三个连续加速带之间不得中断加速');
        if(collected.size===3){report.push({track,rules,straightLength:layout.straight.length,pads:[...collected],speedKmh:Math.round(state.me.v*3.6),quality:state.render.quality,calls:state.render.calls});break;}
        await page.waitForTimeout(40);
      }
      if(steering)await page.keyboard.up(steering);assert.equal(collected.size,3,`${track} 实际 UI 驾驶必须接触所有三个加速带`);assert.equal(shot,true);await context.close();
    }
    // Inspect rendered objects in both modes using the same live scene builder.
    const context=await browser.newContext(),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(['error','warning'].includes(m.type()))errors.push(m.text());});await page.goto(BASE);
    const modes=await page.evaluate(async()=>{
      const {RaceRenderer}=await import('/src/renderer.js'),{createRace}=await import('/src/simulation.js');const container=document.createElement('div');container.style.cssText='position:fixed;inset:0';document.body.append(container);const view=new RaceRenderer(container),out=[];
      for(const rules of ['circuit','arcade']){view.setRace(createRace({rules}),'local');out.push({rules,boosts:view.world.children.filter(o=>o.userData.type==='boost').length,hazards:view.world.children.filter(o=>['oil','barrier','box'].includes(o.userData.type)).length});}return out;
    });
    assert.equal(modes[0].boosts,5);assert.equal(modes[0].hazards,0);assert.equal(modes[1].boosts,5);assert.ok(modes[1].hazards>0);await context.close();
    assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,report,modes,errors},null,2));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
