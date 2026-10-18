const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({channel:process.env.CHROME_CHANNEL||'chrome',headless:true}),errors=[],warnings=[];
 try{
  const page=await browser.newPage({viewport:{width:1000,height:700}});page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());if(m.type()==='warning')warnings.push(m.text());});
  await page.goto(process.env.RACER_URL||'http://localhost:3210');await page.waitForFunction(()=>window.__racerDebug?.render);
  const report=await page.evaluate(async()=>{
   const {RaceRenderer}=await import('/src/renderer.js'),{createRace}=await import('/src/simulation.js'),{getTrack}=await import('/src/tracks.js');
   const container=document.createElement('div');container.style.cssText='position:fixed;inset:0;width:1000px;height:700px';document.body.append(container);
   const view=new RaceRenderer(container),race=createRace({rules:'timeattack'}),me=race.racers[0];view.setRace(race,me.id);
   if(typeof view.setGhost!=='function')throw new Error('RaceRenderer.setGhost must be available');
   const original=JSON.stringify(race),p=getTrack(race.trackId).sample(40),pose={s:40,x:0,v:25,heading:p.yaw,worldX:p.x,worldZ:p.z};
   view.setGhost(pose,me.car);view.render(race,me.id,1/30,1);let transparent=true;view.ghost.traverse(o=>{if(o.isMesh)transparent&&=o.material.transparent&&o.material.opacity<.6&&!o.castShadow;});
   const separate=!view.cars.has('ghost')&&race.racers.length===1,visible=view.ghost.visible,source=view.cars.get(me.id),sourceMaterial=source.userData.body.children.find(o=>o.isMesh).material;
   const sharedPaintIntact=sourceMaterial.transparent===false;view.setGhost(null);view.render(race,me.id,1/30,1.05);const hidden=!view.ghost.visible;
   view.setGhost(pose,me.car);view.setRace(race,me.id);view.render(race,me.id,1/30,1.1);const cleared=!view.ghost;
   view.setGhost(pose,me.car);view.render(race,me.id,1/30,1.2);const before={...view.renderer.info.memory};let clock=1.3;
   for(let i=0;i<4;i++){view.setRace(race,me.id);view.setGhost(pose,me.car);view.render(race,me.id,1/30,clock+=.1);}
   const stable=view.renderer.info.memory.geometries<=before.geometries+2&&view.renderer.info.memory.textures<=before.textures+1;
   return {transparent,separate,visible,hidden,cleared,stable,sharedPaintIntact,unchanged:JSON.stringify(race)===original};
  });
  assert.ok(Object.values(report).every(Boolean),JSON.stringify(report));
  await page.goto(process.env.RACER_URL||'http://localhost:3210');await page.waitForFunction(()=>window.__racerDebug?.render);
  await page.evaluate(async()=>{
    const {RaceHud}=await import('/src/race-hud.js');document.querySelector('#garage').hidden=true;document.querySelector('#race-screen').hidden=false;document.querySelector('#throttle-button').hidden=false;document.querySelector('#race-screen').classList.add('circuit','timeattack');
    window.ghostClicks=0;window.ghostUiHud=new RaceHud({onGhost:()=>window.ghostClicks++});window.ghostUiRace={rules:'timeattack',trackId:'coast',laps:2,time:10,status:'racing',racers:[{id:'you'}],checkpoints:Array.from({length:8},(_,id)=>({id}))};
    ghostUiHud.coachSeen=true;ghostUiHud.sync(ghostUiRace,{id:'you',v:38,validLap:true,checkpointsPassed:3},{},{direction:'right',distance:70,speed:22,severity:'tight',brakeNow:true,phase:'brake'});ghostUiHud.syncGhost({bestTime:93.23,delta:-.24,enabled:true});
  });
  await page.locator('#ghost-toggle').click({timeout:1500});assert.equal(await page.evaluate(()=>window.ghostClicks),1);
  await page.locator('#ghost-toggle').focus();await page.keyboard.press('Space');assert.equal(await page.evaluate(()=>window.ghostClicks),2);
  const layouts=[];
  for(const [width,height] of [[1280,800],[390,844],[320,568],[844,390],[667,375]]){
    await page.setViewportSize({width,height});
    await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a=>a.finished.catch(()=>{})));});
    const boxes={};for(const selector of ['#ghost-comparison','#ghost-toggle','#race-guide','#lap-integrity','.speedometer','#race-reset','#throttle-button'])boxes[selector]=await page.locator(selector).boundingBox();
    for(const [selector,box] of Object.entries(boxes))assert.ok(box&&box.x>=0&&box.y>=0&&box.x+box.width<=width+1&&box.y+box.height<=height+1,`${width}x${height} ${selector}: ${JSON.stringify(box)}`);
    const a=boxes['#lap-integrity'],b=boxes['.speedometer'],overlap=Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)>0&&Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)>0;
    assert.equal(overlap,false,`${width}x${height}: replay panel must not cover the speedometer ${JSON.stringify({a,b})}`);layouts.push({width,height});
    if(width===390)await page.screenshot({path:path.join(__dirname,'artifacts/feel-v31-ghost-panel-mobile.png')});
  }
  assert.deepEqual(errors,[]);assert.deepEqual(warnings,[]);fs.mkdirSync(path.join(__dirname,'artifacts'),{recursive:true});fs.writeFileSync(path.join(__dirname,'artifacts/feel-v31-ghost-render-results.json'),JSON.stringify({report,layouts,errors,warnings},null,2));console.log(JSON.stringify({report,layouts,errors,warnings},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
