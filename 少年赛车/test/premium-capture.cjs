// Controlled after-pass captures at the same viewports as the pre-pass
// baselines (1600x1000 desktop, 390x844@2x mobile), using the same
// "start, hold throttle" flow. Complements the state-hook evidence manifest.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path');
const output=path.join(__dirname,'artifacts','premium');fs.mkdirSync(output,{recursive:true});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function raceShot(page,{track='coast',rules='circuit',label,driveMs=3300}){
  await page.evaluate(({track,rules})=>{
    localStorage.setItem('junior-racers',JSON.stringify({car:'comet',engine:'balanced',track,rules,laps:2,difficulty:'normal',controlVersion:3,autoThrottle:false,sound:false,camera:'chase',ghost:false}));
  },{track,rules});
  await page.reload({waitUntil:'load'});
  await page.waitForFunction(()=>window.__racerDebug?.render);
  await wait(700);
  await page.click('#start');
  await page.waitForFunction(()=>window.__racerDebug?.active===true);
  // Wait for the race to actually start (cold shader compile can delay the
  // countdown) so both the baseline and after-pass run frames are comparable.
  await page.waitForFunction(()=>window.__racerDebug?.status==='racing',{timeout:60000});
  await wait(350);
  await page.keyboard.down('KeyW');
  await wait(driveMs);
  await page.screenshot({path:path.join(output,label+'.png')});
  const diagnostics=await page.evaluate(()=>__racerDebug.render);
  await page.keyboard.up('KeyW');
  return diagnostics;
}
(async()=>{
  const browser=await chromium.launch({channel:process.env.CHROME_CHANNEL||'chrome',headless:true});
  const errors=[],warnings=[],report=[];
  try{
    const desktop=await browser.newPage({viewport:{width:1600,height:1000}});
    desktop.on('pageerror',e=>errors.push(e.message));
    desktop.on('console',m=>{if(m.type()==='error')errors.push(m.text());if(m.type()==='warning')warnings.push(m.text());});
    await desktop.goto(process.env.RACER_URL||'http://127.0.0.1:3210');
    await desktop.waitForFunction(()=>window.__racerDebug?.render);
    await wait(1200);
    await desktop.screenshot({path:path.join(output,'after-1600-garage-desktop.png')});
    for(const [track,rules,label] of [['coast','circuit','after-1600-coast-desktop'],['arcade','arcade','after-1600-arcade-desktop']]){
      const d=await raceShot(desktop,{track,rules,label});
      report.push({label,track,calls:d.calls,triangles:d.triangles,textures:d.textures,post:d.post?.mode,quality:d.quality});
    }
    const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
    mobile.on('pageerror',e=>errors.push(e.message));
    await mobile.goto(process.env.RACER_URL||'http://127.0.0.1:3210');
    await mobile.waitForFunction(()=>window.__racerDebug?.render);
    await wait(1200);
    await mobile.screenshot({path:path.join(output,'after-1600-garage-mobile.png'),fullPage:true});
    const md=await raceShot(mobile,{track:'arcade',rules:'arcade',label:'after-1600-arcade-mobile',driveMs:2600});
    report.push({label:'after-1600-arcade-mobile',calls:md.calls,triangles:md.triangles,textures:md.textures,post:md.post?.mode,quality:md.quality});
    const landscape=await browser.newPage({viewport:{width:844,height:390},isMobile:true,hasTouch:true,deviceScaleFactor:2});
    landscape.on('pageerror',e=>errors.push(e.message));
    await landscape.goto(process.env.RACER_URL||'http://127.0.0.1:3210');
    await landscape.waitForFunction(()=>window.__racerDebug?.render);
    const ld=await raceShot(landscape,{track:'arcade',rules:'arcade',label:'after-1600-arcade-landscape',driveMs:2000});
    report.push({label:'after-1600-arcade-landscape',calls:ld.calls,triangles:ld.triangles,textures:ld.textures,post:ld.post?.mode,quality:ld.quality});
    fs.writeFileSync(path.join(output,'after-1600-report.json'),JSON.stringify({report,errors,warnings},null,2));
    console.log(JSON.stringify({report,errors,warnings},null,2));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
