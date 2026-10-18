const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {createManualDriver}=require('./v3-driver.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const BASE=process.env.RACER_URL||'http://localhost:3210',layoutOnly=process.argv.includes('--layout-only');
const output=path.join(__dirname,'artifacts');fs.mkdirSync(output,{recursive:true});
(async()=>{
  const browser=await chromium.launch({channel:process.env.CHROME_CHANNEL||'chrome',headless:true});
  const errors=[],report=[];
  try{
    const context=await browser.newContext({viewport:{width:1280,height:800},hasTouch:true});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.goto(BASE);await page.waitForFunction(()=>window.__racerDebug?.render);
    await page.selectOption('#rules','arcade');await page.click('#start');await page.waitForFunction(()=>__racerDebug.active);
    assert.equal(await page.locator('#drift-gauge').count(),1,'arcade drift charge must have its own readable gauge');
    assert.equal(await page.locator('#drift-display').isVisible(),true);
    assert.equal(await page.locator('#item-readout').isVisible(),true);
    const cameras=[];for(let i=0;i<3;i++){cameras.push(await page.evaluate(()=>__racerDebug.render.camera));await page.click('#camera');}
    assert.deepEqual(cameras,['chase','bonnet','wide']);
    if(!layoutOnly){
    await page.waitForFunction(()=>__racerDebug.status==='racing');
    const driver=await createManualDriver(page,{targetX:-5});
    try{
      const deadline=Date.now()+15000;
      while(Date.now()<deadline){const state=await driver.step();if(state.me.item)break;if(state.me.s>80)throw new Error('missed the first item box: '+JSON.stringify(state));await page.waitForTimeout(75);}
      assert.ok(await page.evaluate(()=>__racerDebug.racers.find(r=>r.id===__racerDebug.playerId).item),'real steering/throttle must reach an item pickup');
      const straightStart=await page.evaluate(async()=>{const {getTrack}=await import('/src/tracks.js');return getTrack(__racerDebug.track).boostStraight.s+55;});
      const approachDeadline=Date.now()+18000;
      while(Date.now()<approachDeadline){const state=await driver.step({targetX:-4});if(state.me.s>=straightStart)break;await page.waitForTimeout(60);}
      assert.ok(await page.evaluate(target=>__racerDebug.racers.find(r=>r.id===__racerDebug.playerId).s>=target,straightStart),'reach the wide straight before testing a held drift');
    }finally{await driver.release();}
    const itemBefore=await page.evaluate(()=>__racerDebug.racers.find(r=>r.id===__racerDebug.playerId).item);
    assert.ok((await page.locator('#item-hint').textContent()).length>5);
    await page.keyboard.press('KeyE');
    await page.keyboard.down('KeyW');await page.keyboard.down('KeyA');await page.keyboard.down('Space');
    try{await page.waitForFunction(()=>__racerDebug.racers.find(r=>r.id===__racerDebug.playerId).driftTier>=1&&document.getElementById('drift-hint').textContent.includes('松开'),null,{timeout:4000});}catch(error){console.log(JSON.stringify(await page.evaluate(()=>({debug:__racerDebug})),null,2));await page.screenshot({path:path.join(output,'handling-drift-failure.png')});throw error;}
    const charged=await page.evaluate(()=>({r:__racerDebug.racers.find(r=>r.id===__racerDebug.playerId),render:__racerDebug.render}));
    assert.ok(charged.r.driftCharge>=.55);assert.match(await page.locator('#drift-hint').textContent(),/松开/);
    await page.screenshot({path:path.join(output,'handling-drift-desktop.png')});
    await page.keyboard.up('Space');await page.keyboard.up('KeyA');
    await page.waitForFunction(()=>__racerDebug.racers.find(r=>r.id===__racerDebug.playerId).driftBoost>0);
    await page.keyboard.up('KeyW');
    report.push({case:'real-input-pickup-and-drift',item:itemBefore,tier:charged.r.driftTier,charge:charged.r.driftCharge,cameras});
    }
    await page.click('#pause');await page.click('#quit');
    for(const [label,width,height] of [['portrait',390,844],['landscape',844,390],['small-portrait',320,568],['small-landscape',667,375]]){
      await page.setViewportSize({width,height});await page.selectOption('#rules','arcade');await page.click('#start');
      await page.waitForFunction(()=>__racerDebug.active);
      await page.screenshot({path:path.join(output,`handling-mobile-${label}.png`)});
      const layout=await page.evaluate(()=>{
        const ids=['drift-display','item-readout','camera','race-reset','joy-steer','throttle-button'];
        return ids.map(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect();return {id,x:r.x,y:r.y,width:r.width,height:r.height,visible:!e.hidden,inside:r.x>=0&&r.y>=0&&r.right<=innerWidth+.5&&r.bottom<=innerHeight+.5};});
      });
      assert.ok(layout.every(e=>e.visible&&e.inside),JSON.stringify(layout));
      const overlaps=await page.evaluate(()=>{
        const controls=[...document.querySelectorAll('[data-control],#race-reset')];
        return ['item-readout','drift-display'].flatMap(id=>{const panel=document.getElementById(id).getBoundingClientRect();
          return controls.filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height&&panel.left<r.right&&panel.right>r.left&&panel.top<r.bottom&&panel.bottom>r.top;}).map(e=>`${id}/${e.dataset.control||e.id}`);
        });
      });
      assert.deepEqual(overlaps,[],`${label}: gameplay instruments must leave touch controls readable`);report.push({case:`mobile-${label}`,layout});
      await page.click('#pause');await page.click('#quit');
    }
    await page.setViewportSize({width:1280,height:800});await page.selectOption('#rules','circuit');await page.click('#start');
    await page.waitForFunction(()=>__racerDebug.active);assert.equal(await page.locator('#drift-display').isVisible(),false);assert.equal(await page.locator('#item-readout').isVisible(),false);
    await page.click('#pause');await page.click('#quit');
    await page.emulateMedia({reducedMotion:'reduce'});await page.selectOption('#rules','arcade');await page.click('#start');await page.waitForFunction(()=>__racerDebug.render.cameraPose);
    const reduced=await page.evaluate(()=>__racerDebug.render.cameraPose);assert.equal(reduced.roll,0);report.push({case:'reduced-motion',cameraPose:reduced});
    assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'handling-results.json'),JSON.stringify({report,errors},null,2));console.log(JSON.stringify({passed:report.length+1,report,errors},null,2));
    await context.close();
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
