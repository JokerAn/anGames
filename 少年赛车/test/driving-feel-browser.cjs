const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const output=path.join(__dirname,'artifacts');fs.mkdirSync(output,{recursive:true});
(async()=>{
  const browser=await chromium.launch({headless:true,channel:process.env.CHROME_CHANNEL||'chrome'}),errors=[],warnings=[],report=[];
  try{
    const context=await browser.newContext({viewport:{width:1280,height:800},hasTouch:true});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());if(m.type()==='warning')warnings.push(m.text());});
    await page.goto(process.env.RACER_URL||'http://localhost:3210');await page.waitForFunction(()=>window.__racerDebug?.render);
    await page.click('#sound');await page.waitForFunction(()=>__racerDebug.audio.enabled&&__racerDebug.audio.state==='running');
    for(const engine of ['balanced','turbo','electric']){
      await page.click(`[data-engine="${engine}"]`);await page.click('#start');await page.waitForFunction(()=>__racerDebug.status==='racing');
      await page.keyboard.down('KeyW');await page.waitForFunction(()=>__racerDebug.racers.find(r=>r.id===__racerDebug.playerId).v>12);
      const throttle=await page.evaluate(()=>({audio:__racerDebug.audio,motion:__racerDebug.render.motion,me:__racerDebug.racers.find(r=>r.id===__racerDebug.playerId)}));
      assert.equal(throttle.audio.engine,engine);assert.ok(throttle.motion.pitch<-.005,JSON.stringify(throttle));
      assert.ok(engine==='electric'?throttle.audio.electricGain>0&&throttle.audio.combustionGain===0:throttle.audio.combustionGain>0);
      await page.keyboard.up('KeyW');await page.keyboard.down('KeyS');
      await page.waitForFunction(()=>__racerDebug.render.motion.pitch>.015);
      await page.screenshot({path:path.join(output,`feel-driving-${engine}.png`)});await page.keyboard.up('KeyS');
      await page.click('#pause');await page.waitForFunction(()=>Object.entries(__racerDebug.audio).filter(([name])=>name.endsWith('Gain')).every(([,gain])=>gain===0));
      report.push({engine,throttle,pausedAudio:await page.evaluate(()=>__racerDebug.audio)});await page.click('#quit');
    }
    assert.deepEqual(errors,[]);assert.deepEqual(warnings,[]);fs.writeFileSync(path.join(output,'feel-ui-results.json'),JSON.stringify({report,errors,warnings},null,2));console.log(JSON.stringify({report:report.map(({engine,throttle,pausedAudio})=>({engine,pitch:throttle.motion.pitch,speed:throttle.me.v,sound:throttle.audio.state,pauseWind:pausedAudio.windGain})),errors,warnings},null,2));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
