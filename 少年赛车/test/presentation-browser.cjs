const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const output=path.join(__dirname,'artifacts');fs.mkdirSync(output,{recursive:true});
(async()=>{
  const browser=await chromium.launch({channel:process.env.CHROME_CHANNEL||'chrome',headless:true}),errors=[],warnings=[],report=[];
  try{
    const page=await browser.newPage({viewport:{width:1280,height:800}});page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());if(m.type()==='warning')warnings.push(m.text());});
    await page.goto(process.env.RACER_URL||'http://localhost:3210');await page.waitForFunction(()=>window.__racerDebug?.render);
    const result=await page.evaluate(async()=>{
      const {RaceRenderer,makeCar}=await import('/src/renderer.js'),{createRace}=await import('/src/simulation.js'),{getTrack}=await import('/src/tracks.js'),{syncVehiclePose}=await import('/src/driving.js');
      const a=makeCar('comet'),b=makeCar('comet');
      if(!a.userData.body||!a.userData.brakeMaterial)throw new Error('car body suspension and independent brake lamps must exist');
      if(a.userData.brakeMaterial===b.userData.brakeMaterial)throw new Error('braking one car must not light every car');
      const container=document.createElement('div');container.id='presentation-test';container.style.cssText='position:fixed;inset:0;z-index:999;background:#12181b';document.body.append(container);
      const view=new RaceRenderer(container);view.adaptive.level=2;view.applyQuality();const race=createRace({track:'coast'});view.setRace(race,'local');window.presentationTest={view,race};
      const me=race.racers[0];Object.assign(me,{v:35,rpm:4500,acceleration:15,s:90,x:0,headingError:.25,drifting:true,steerAngle:.35,gripUsage:1.4});
      let time=1;for(let i=0;i<60;i++){me.s+=me.v/60;syncVehiclePose(me,getTrack(race.trackId));race.time+=1/60;view.render(race,'local',1/60,time+=1/60);}
      const car=view.cars.get('local'),drivePitch=car.userData.body.rotation.x,effects=view.effects.diagnostics;
      Object.assign(me,{acceleration:-28,braking:true,drifting:false,gripUsage:.6});
      for(let i=0;i<35;i++){me.s+=me.v/60;syncVehiclePose(me,getTrack(race.trackId));view.render(race,'local',1/60,time+=1/60);}
      const brakePitch=car.userData.body.rotation.x,brakeEmission=car.userData.brakeMaterial.emissiveIntensity,otherEmission=view.cars.get('bot-1').userData.brakeMaterial.emissiveIntensity;
      view.cameraMode='bonnet';view.cameraReady=false;me.headingError=.6;syncVehiclePose(me,getTrack(race.trackId));
      for(let i=0;i<45;i++)view.render(race,'local',1/60,time+=1/60);
      const direction=view.camera.getWorldDirection(view.target),yaw=getTrack('coast').sample(me.s).yaw+me.headingError,difference=Math.atan2(Math.sin(Math.atan2(direction.x,direction.z)-yaw),Math.cos(Math.atan2(direction.x,direction.z)-yaw));
      return {drivePitch,brakePitch,effects,brakeEmission,otherEmission,cameraHeadingError:Math.abs(difference),render:view.diagnostics};
    });
    assert.ok(result.drivePitch<0&&result.brakePitch>0,JSON.stringify(result));assert.ok(result.brakeEmission>result.otherEmission*2);
    assert.ok(result.effects.smoke>0&&result.effects.skids>0,JSON.stringify(result.effects));assert.ok(result.effects.particles<=64&&result.effects.skids<=192);
    assert.ok(result.cameraHeadingError<.03,JSON.stringify(result));report.push({case:'suspension-contact-effects-and-heading',...result});
    await page.screenshot({path:path.join(output,'feel-bonnet.png')});
    const impact=await page.evaluate(()=>{
      const {view,race}=presentationTest,car=view.cars.get('local');view.effects.reset();
      for(let i=0;i<64;i++)view.effects.spawn(car.position,false,35,car.rotation.y,64);
      view.effects.impact(car,64);view.effects.update(1/60,view.camera,64);const atImpact=view.effects.diagnostics;
      for(let i=0;i<100;i++)view.effects.update(1/60,view.camera,64);
      return {atImpact,expired:view.effects.diagnostics};
    });
    assert.ok(impact.atImpact.sparks>0,'collision sparks must remain visible even when smoke fills the particle budget');assert.ok(impact.atImpact.particles<=64);assert.equal(impact.expired.particles,0);report.push({case:'impact-priority-and-expiry',...impact});

    for(const track of ['coast','canyon','neon']){
      await page.evaluate(async track=>{
        const {view}=window.presentationTest,{createRace}=await import('/src/simulation.js'),race=createRace({track});window.presentationTest.race=race;view.cameraMode='chase';view.setRace(race,'local');
        const {syncVehiclePose}=await import('/src/driving.js'),{getTrack}=await import('/src/tracks.js');
        race.time=12;const me=race.racers[0];Object.assign(me,{s:240,x:0,v:38,gear:3,rpm:5200,acceleration:0,braking:true,steerAngle:.2});syncVehiclePose(me,getTrack(track));
        for(let i=0;i<40;i++)view.render(race,'local',1/60,5+i/60);
      },track);
      await page.screenshot({path:path.join(output,`feel-${track}.png`)});
      report.push({case:track,...await page.evaluate(()=>presentationTest.view.diagnostics)});
    }
    await page.emulateMedia({reducedMotion:'reduce'});
    const reduced=await page.evaluate(async()=>{
      const {syncVehiclePose}=await import('/src/driving.js'),{getTrack}=await import('/src/tracks.js');
      const {view,race}=presentationTest;view.effects.reset();const me=race.racers[0];Object.assign(me,{drifting:true,gripUsage:1.8,boosting:true});
      for(let i=0;i<40;i++){me.s+=.5;syncVehiclePose(me,getTrack(race.trackId));view.render(race,'local',1/60,8+i/60);}return view.effects.diagnostics;
    });assert.equal(reduced.smoke,0);assert.equal(reduced.sparks,0);report.push({case:'reduced-motion',effects:reduced});
    assert.deepEqual(errors,[]);assert.deepEqual(warnings,[]);fs.writeFileSync(path.join(output,'presentation-results.json'),JSON.stringify({report,errors,warnings},null,2));console.log(JSON.stringify({report,errors,warnings},null,2));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
