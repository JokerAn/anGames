// Unpaused motion evidence: real keyboard/touch driving through the v3 driver,
// recorded as WebM plus a timed frame sequence with diagnostics. Not part of the
// gameplay test suite; used by the premium graphics pass evidence.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {createManualDriver}=require('./v3-driver.cjs');
const fs=require('node:fs'),path=require('node:path');
const output=path.join(__dirname,'artifacts','premium');fs.mkdirSync(output,{recursive:true});
const BASE=process.env.RACER_URL||'http://127.0.0.1:3210';
(async()=>{
  const browser=await chromium.launch({channel:process.env.CHROME_CHANNEL||'chrome',headless:true});
  const context=await browser.newContext({viewport:{width:1280,height:720},recordVideo:{dir:path.join(output,'video-tmp'),size:{width:1280,height:720}}});
  const errors=[],page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  const report={clip:null,frames:[],diagnostics:null,errors};
  try{
    await page.goto(BASE);
    await page.waitForFunction(()=>window.__racerDebug?.render);
    await page.evaluate(()=>{localStorage.setItem('junior-racers',JSON.stringify({car:'comet',engine:'turbo',track:'neon',rules:'circuit',laps:2,difficulty:'normal',controlVersion:3,autoThrottle:false,sound:false,camera:'chase',ghost:false}));});
    await page.reload();
    await page.waitForFunction(()=>window.__racerDebug?.render);
    await page.waitForTimeout(600);
    await page.click('#start');
    await page.waitForFunction(()=>__racerDebug.active);
    await page.waitForFunction(()=>__racerDebug.status==='racing',{timeout:60000});
    const coach=page.locator('#dismiss-driving-coach');
    if(await coach.isVisible())await coach.click();
    const driver=await createManualDriver(page,{targetX:-3});
    const started=Date.now();
    try{
      while(Date.now()-started<7000){
        const state=await driver.step();
        if(state.me)report.frames.push({t:Math.round((Date.now()-started)/100)/10,s:Math.round(state.me.s),x:Math.round(state.me.x*10)/10,v:Math.round(state.me.v*3.6),driftTier:state.me.driftTier,offRoad:state.me.offRoad});
        await page.waitForTimeout(120);
      }
    }finally{await driver.release();}
    report.diagnostics=await page.evaluate(()=>__racerDebug.render);
    await page.screenshot({path:path.join(output,'motion-final-frame.png')});
  }finally{
    await context.close(); // finalises the WebM
    const dir=path.join(output,'video-tmp');
    const files=fs.existsSync(dir)?fs.readdirSync(dir).filter(name=>name.endsWith('.webm')):[];
    if(files.length){
      const source=path.join(dir,files[0]),target=path.join(output,'motion-neon-chase.webm');
      fs.renameSync(source,target);
      fs.rmSync(dir,{recursive:true,force:true});
      report.clip=path.relative(process.cwd(),target);
    }
    await browser.close();
  }
  fs.writeFileSync(path.join(output,'motion-report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({clip:report.clip,frames:report.frames.length,errors:report.errors,diagnostics:report.diagnostics&&{calls:report.diagnostics.calls,triangles:report.diagnostics.triangles,post:report.diagnostics.post&&report.diagnostics.post.mode,speedFx:report.diagnostics.speedFx}},null,1));
})().catch(error=>{console.error(error);process.exitCode=1;});
