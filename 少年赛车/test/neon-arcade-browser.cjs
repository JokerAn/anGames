const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {createManualDriver}=require('./v3-driver.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const output=path.join(__dirname,'artifacts');fs.mkdirSync(output,{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:process.env.CHROME_CHANNEL||'chrome',headless:true}),errors=[],warnings=[],report=[];
 try{
  const context=await browser.newContext({viewport:{width:1280,height:800},hasTouch:true}),page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());if(m.type()==='warning')warnings.push(m.text());});
  await page.goto(process.env.RACER_URL||'http://localhost:3210');await page.waitForFunction(()=>window.__racerDebug?.render);
  assert.equal(await page.locator('[data-track]').count(),4);assert.match(await page.locator('#track-count').textContent(),/4/);
  await page.click('[data-track="arcade"]');await page.selectOption('#rules','arcade');await page.click('#start');
  await page.waitForFunction(()=>__racerDebug.active&&__racerDebug.render.lightShow?.active);
  if(await page.locator('#dismiss-driving-coach').isVisible())await page.click('#dismiss-driving-coach');
  await page.screenshot({path:path.join(output,'neon-arcade-start-desktop.png')});
  const lightA=await page.evaluate(()=>__racerDebug.render.lightShow);await page.waitForTimeout(250);const lightB=await page.evaluate(()=>__racerDebug.render.lightShow);
  assert.ok(lightA.arches>0&&lightA.panels>0&&lightA.beams>0,JSON.stringify(lightA));assert.notEqual(lightA.phase,lightB.phase,'light chase must actually animate');
  assert.ok(lightA.drawCalls<=25,JSON.stringify(lightA));report.push({case:'selectable-fourth-track-and-animated-light-show',lightShow:lightB});
  await page.waitForFunction(()=>__racerDebug.status==='racing'&&__racerDebug.time>3.2);
  const driver=await createManualDriver(page,{targetX:-5}),trace=[];let pickedRocket=false,rocketActive=false,pickedFrost=false,launchSpeed=0,peak=0;
  try{
   const deadline=Date.now()+24000;
   while(Date.now()<deadline){
    const state=await driver.step();const me=state.me;if(trace.length===0||state.time-trace[trace.length-1].time>.4)trace.push({time:state.time,s:me.s,x:me.x,v:me.v,item:me.item,overdrive:me.overdrive,frozen:me.frozen});
    if(me.item==='rocket'&&!pickedRocket){pickedRocket=true;launchSpeed=me.v;await page.keyboard.press('KeyE');}
    if(me.overdrive>0){rocketActive=true;peak=Math.max(peak,me.v);}
    if(me.item==='frost'){pickedFrost=true;break;}
    if(me.s>240)throw Error('passed early directed supply without frost: '+JSON.stringify(trace));
    await page.waitForTimeout(55);
   }
  }finally{await page.keyboard.down('KeyS');await driver.release();}
  assert.equal(pickedRocket,true,JSON.stringify(trace));assert.equal(rocketActive,true,JSON.stringify(trace));assert.ok(peak>launchSpeed+4,JSON.stringify({launchSpeed,peak,trace}));assert.equal(pickedFrost,true,JSON.stringify(trace));
  await page.waitForFunction(()=>__racerDebug.racers.find(r=>r.id===__racerDebug.playerId).v<1);await page.keyboard.up('KeyS');
  await page.waitForFunction(()=>document.getElementById('item-title').textContent.includes('冰冻'));
  assert.match(await page.locator('[data-control="item"]').getAttribute('aria-label'),/冰冻/);report.push({case:'real-touch-directed-rocket-and-frost',launchSpeed,peak,trace});
  for(const [label,width,height] of [['desktop',1280,800],['portrait',390,844],['landscape',844,390],['small-portrait',320,568],['small-landscape',667,375]]){
   await page.setViewportSize({width,height});await page.waitForTimeout(120);
   const boxes=await page.evaluate(()=>{
    const ids=['item-readout','drift-display','camera','race-reset','joy-steer','throttle-button'],rects=ids.map(id=>{const r=document.getElementById(id).getBoundingClientRect();return {id,x:r.x,y:r.y,width:r.width,height:r.height,inside:r.x>=0&&r.y>=0&&r.right<=innerWidth+.5&&r.bottom<=innerHeight+.5};});
    const controls=[...document.querySelectorAll('[data-control],#race-reset')];const overlaps=['item-readout','drift-display'].flatMap(id=>{const a=document.getElementById(id).getBoundingClientRect();return controls.filter(e=>{const b=e.getBoundingClientRect();return b.width&&b.height&&a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;}).map(e=>`${id}/${e.dataset.control||e.id}`);});
    return {rects,overlaps,lightShow:__racerDebug.render.lightShow};
   });
   assert.ok(boxes.rects.every(r=>r.inside),`${label}: ${JSON.stringify(boxes)}`);assert.deepEqual(boxes.overlaps,[],`${label}: frost guidance overlaps pedals`);
   await page.screenshot({path:path.join(output,`neon-arcade-${label}.png`)});report.push({case:`frost-hud-${label}`,layout:boxes});
  }
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>__racerDebug.render.reducedMotion);await page.waitForTimeout(150);
  const quietA=await page.evaluate(()=>__racerDebug.render.lightShow.phase);await page.waitForTimeout(220);const quietB=await page.evaluate(()=>__racerDebug.render.lightShow.phase);assert.equal(quietA,quietB,'reduced motion stops the light chase');
  report.push({case:'static-light-show-with-reduced-motion',phase:quietB});
  await page.click('#pause');await page.click('#quit');await page.setViewportSize({width:1280,height:800});await page.emulateMedia({reducedMotion:'no-preference'});
  const fixture=await page.evaluate(async()=>{
   const {RaceRenderer}=await import('/src/renderer.js'),{createRace}=await import('/src/simulation.js'),{getTrack}=await import('/src/tracks.js'),{syncVehiclePose}=await import('/src/driving.js');
   const stage=document.createElement('div');stage.style.cssText='position:fixed;inset:0;z-index:999;background:#100722';document.body.append(stage);const view=new RaceRenderer(stage),race=createRace({track:'arcade',rules:'arcade'}),track=getTrack('arcade');view.setCameraMode('wide');view.setRace(race,'local');
   for(const [i,r] of race.racers.entries()){Object.assign(r,{s:track.boostStraight.s+90+i*12,x:i%2?3:-3,v:35,headingError:0});syncVehiclePose(r,track);}const me=race.racers[0];me.overdrive=2.2;me.boosting=true;race.events=[{id:1,racer:me.id,type:'item',item:'rocket',used:true},{id:2,racer:race.racers[1].id,type:'hit',item:'frost',source:'frost',attacker:me.id}];race.racers[1].frozen=2.4;
   let time=40;for(let i=0;i<8;i++)view.render(race,'local',1/60,time+=1/60);window.neonFixture={view,race,time};return view.diagnostics;
  });
  assert.ok(fixture.effects.activeItemVFX.some(e=>e.item==='rocket'));assert.ok(fixture.effects.activeItemVFX.some(e=>e.item==='frost'));await page.screenshot({path:path.join(output,'neon-arcade-light-tunnel.png')});report.push({case:'rocket-frost-webgl-feedback',render:fixture});
  const rematches=await page.evaluate(async()=>{
   const {createRace}=await import('/src/simulation.js'),f=neonFixture,samples=[];
   for(let n=0;n<5;n++){const race=createRace({track:'arcade',rules:'arcade'});f.view.setRace(race,'local');for(let i=0;i<3;i++)f.view.render(race,'local',1/60,f.time+=1/60);samples.push({geometries:f.view.diagnostics.geometries,textures:f.view.diagnostics.textures,lights:f.view.diagnostics.lightShow});}
   f.view.adaptive.level=0;f.view.applyQuality();for(let i=0;i<3;i++)f.view.render(createRace({track:'arcade',rules:'arcade'}),'local',1/60,f.time+=1/60);return {samples,low:f.view.diagnostics};
  });
  assert.ok(Math.max(...rematches.samples.map(s=>s.geometries))-Math.min(...rematches.samples.map(s=>s.geometries))<=3);assert.ok(rematches.low.lightShow.active);report.push({case:'five-rematches-and-low-quality-light-show',...rematches});
  assert.deepEqual(errors,[]);assert.deepEqual(warnings,[]);fs.writeFileSync(path.join(output,'neon-arcade-results.json'),JSON.stringify({report,errors,warnings},null,2));console.log(JSON.stringify({report,errors,warnings},null,2));await context.close();
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
