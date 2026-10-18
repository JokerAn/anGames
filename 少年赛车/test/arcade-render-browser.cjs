// Presentation fixtures complement handling-browser.cjs, which uses real input.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const output=path.join(__dirname,'artifacts');fs.mkdirSync(output,{recursive:true});
(async()=>{
  const browser=await chromium.launch({channel:process.env.CHROME_CHANNEL||'chrome',headless:true}),errors=[],warnings=[],report=[];
  try{
    const page=await browser.newPage({viewport:{width:1280,height:800}});
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());if(m.type()==='warning')warnings.push(m.text());});
    await page.goto(process.env.RACER_URL||'http://localhost:3210');await page.waitForFunction(()=>window.__racerDebug?.render);
    const pulse=await page.evaluate(async()=>{
      const {RaceRenderer}=await import('/src/renderer.js'),{createRace}=await import('/src/simulation.js'),{getTrack}=await import('/src/tracks.js'),{syncVehiclePose}=await import('/src/driving.js');
      const container=document.createElement('div');container.style.cssText='position:fixed;inset:0;z-index:999;background:#141719';document.body.append(container);
      const view=new RaceRenderer(container),race=createRace({rules:'arcade'}),track=getTrack(race.trackId);view.setCameraMode('wide');view.setRace(race,'local');
      const me=race.racers[0],rival=race.racers[1],s=track.boostStraight.s+150;
      for(const [i,r] of race.racers.entries()){Object.assign(r,{s:s+i*16,x:i===0?-2:i%2?1:-3,v:30,headingError:0});syncVehiclePose(r,track);}
      let time=1;for(let i=0;i<12;i++){race.time=10+i/60;view.render(race,'local',1/60,time+=1/60);}
      race.events=[{id:1,racer:me.id,type:'item',item:'pulse',source:'pulse',used:true,attacker:me.id},{id:2,racer:rival.id,type:'hit',item:'pulse',source:'pulse',attacker:me.id}];
      for(let i=0;i<3;i++)view.render(race,'local',1/60,time+=1/60);
      window.arcadeVisual={view,race,time,track,syncVehiclePose};return view.diagnostics;
    });
    assert.ok(pulse.itemVFX>=2);assert.ok(pulse.effects.activeItemVFX.some(e=>e.type==='item'&&e.item==='pulse'));assert.ok(pulse.effects.activeItemVFX.some(e=>e.type==='hit'&&e.source==='pulse'));
    await page.screenshot({path:path.join(output,'handling-pulse-3d.png')});report.push({case:'pulse-cast-and-hit',effects:pulse.effects});
    const shield=await page.evaluate(()=>{
      const f=arcadeVisual,me=f.race.racers[0];me.shield=6;
      f.race.events=[...f.race.events,{id:3,racer:me.id,type:'shield',item:'shield',source:'oil',attacker:'rival',blocked:true}];
      for(let i=0;i<4;i++)f.view.render(f.race,'local',1/60,f.time+=1/60);
      return {diagnostics:f.view.diagnostics,shieldVisible:f.view.cars.get('local').userData.shield.visible};
    });
    assert.equal(shield.shieldVisible,true);assert.ok(shield.diagnostics.effects.activeItemVFX.some(e=>e.type==='shield'&&e.source==='oil'));
    await page.screenshot({path:path.join(output,'handling-shield-3d.png')});report.push({case:'shield-absorption',effects:shield.diagnostics.effects});
    const drift=await page.evaluate(()=>{
      const f=arcadeVisual,me=f.race.racers[0];f.view.effects.reset();f.race.events=[];
      Object.assign(me,{drifting:true,driftTier:3,driftCharge:2.1,slipAngle:-.22,steerAngle:.5,gripUsage:1.4});
      for(let i=0;i<30;i++){me.s+=.45;f.syncVehiclePose(me,f.track);me.slipAngle=-.22;f.race.time+=1/60;f.view.render(f.race,'local',1/60,f.time+=1/60);}
      return f.view.diagnostics;
    });
    assert.ok(drift.effects.driftSparks>0);assert.ok(drift.effects.skids>0);report.push({case:'tier-three-rear-tyre-feedback',effects:drift.effects});
    await page.screenshot({path:path.join(output,'handling-purple-drift-3d.png')});
    const reuse=await page.evaluate(async()=>{
      const f=arcadeVisual,{createRace}=await import('/src/simulation.js'),ringGeometry=f.view.effects.rings.geometry,samples=[];
      for(let n=0;n<6;n++){
        const race=createRace({rules:'arcade'});f.view.setRace(race,'local');
        for(let i=0;i<2;i++)f.view.render(race,'local',1/60,f.time+=1/60);
        samples.push({geometries:f.view.diagnostics.geometries,items:f.view.diagnostics.itemVFX,sparks:f.view.diagnostics.effects.driftSparks,pool:f.view.effects.itemPool.filter(p=>p.life>0).length});
        if(f.view.effects.rings.geometry!==ringGeometry)throw Error('rematch replaced immutable ring geometry');
      }
      f.race=createRace({rules:'arcade'});f.view.setRace(f.race,'local');return samples;
    });
    assert.ok(reuse.every(s=>s.items===0&&s.sparks===0&&s.pool===0));assert.ok(Math.max(...reuse.map(s=>s.geometries))-Math.min(...reuse.map(s=>s.geometries))<=2);report.push({case:'six-rematches-clean-reused-effects',samples:reuse});
    await page.emulateMedia({reducedMotion:'reduce'});
    const reduced=await page.evaluate(()=>{
      const f=arcadeVisual;f.race.events=[{id:1,racer:'local',type:'pickup',item:'shield',awarded:true},{id:2,racer:'local',type:'item',item:'pulse',used:false}];
      for(let i=0;i<3;i++)f.view.render(f.race,'local',1/60,f.time+=1/60);return f.view.diagnostics;
    });
    assert.equal(reduced.effects.particles,0);assert.equal(reduced.cameraPose.roll,0);assert.ok(reduced.effects.activeItemVFX.every(e=>e.type!=='item'));report.push({case:'reduced-motion-and-no-target-notice',effects:reduced.effects});
    assert.deepEqual(errors,[]);assert.deepEqual(warnings,[]);fs.writeFileSync(path.join(output,'handling-render-results.json'),JSON.stringify({report,errors,warnings},null,2));console.log(JSON.stringify({report,errors,warnings},null,2));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
