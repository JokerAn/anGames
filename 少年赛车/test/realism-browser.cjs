// Optional: PLAYWRIGHT_MODULE=/path/to/playwright node test/realism-browser.cjs
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const BASE=process.env.RACER_URL||'http://localhost:3210';
const artifacts=path.join(__dirname,'artifacts');
(async()=>{
  const browser=await chromium.launch({channel:process.env.CHROME_CHANNEL||'chrome',headless:true});
  const errors=[],warnings=[],report=[];
  async function setup(viewport,budget,dpr=2){
    const context=await browser.newContext({viewport,deviceScaleFactor:dpr,hasTouch:true,isMobile:true});
    await context.addInitScript(({cores,memory})=>{Object.defineProperty(navigator,'hardwareConcurrency',{get:()=>cores});Object.defineProperty(navigator,'deviceMemory',{get:()=>memory});},budget);
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());if(m.type()==='warning')warnings.push(m.text());});await page.goto(BASE);await page.waitForFunction(()=>!!window.__racerDebug?.render);return {page,context};
  }
  try {
    const {page:p,context}=await setup({width:390,height:844},{cores:8,memory:8});
    await p.locator('#sound').tap();assert.equal(await p.locator('#sound span').textContent(),'音效开');await p.locator('#sound').tap();assert.equal(await p.locator('#sound span').textContent(),'音效关');
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await p.screenshot({path:path.join(artifacts,'realism-garage-mobile.png'),fullPage:true});
    await p.locator('#auto-throttle').uncheck();await p.locator('#start').tap();await p.waitForTimeout(4100);assert.equal(await p.evaluate(()=>__racerDebug.racers[0].v),0);assert.equal(await p.locator('[data-control="item"]').isVisible(),false);
    const client=await context.newCDPSession(p);
    const point=async selector=>{const box=await p.locator(selector).boundingBox();return {x:box.x+box.width/2,y:box.y+box.height/2};};
    const throttle=await point('#throttle-button');
    await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...throttle,id:1}]});await p.waitForTimeout(900);assert.ok(await p.evaluate(()=>__racerDebug.racers[0].v)>8);await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    const joy=await point('#joy-steer'),brake=await point('[data-control="brake"]'),nitro=await point('[data-control="nitro"]');
    await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:joy.x+25,y:joy.y,id:2},{...brake,id:3},{...nitro,id:4}]});await p.waitForTimeout(250);
    const input=await p.evaluate(()=>__racerDebug.input);assert.ok(input.steer<0);assert.equal(input.brake,true);assert.equal(input.nitro,true);assert.equal(input.throttle,false);assert.equal(await p.evaluate(()=>__racerDebug.racers[0].braking),true);
    await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await p.waitForTimeout(100);assert.equal(await p.evaluate(()=>__racerDebug.input.steer),0);assert.equal(await p.evaluate(()=>__racerDebug.input.brake),false);
    await p.screenshot({path:path.join(artifacts,'realism-race-mobile-portrait.png')});
    await p.locator('#camera').tap();assert.equal(await p.evaluate(()=>__racerDebug.render.camera),'bonnet');await p.screenshot({path:path.join(artifacts,'realism-bonnet-mobile.png')});
    await p.locator('#camera').tap();await p.setViewportSize({width:844,height:390});await p.screenshot({path:path.join(artifacts,'realism-race-mobile-landscape.png')});
    for(const control of ['#joy-steer','[data-control="brake"]','[data-control="nitro"]','#throttle-button']){const box=await p.locator(control).boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=844&&box.y+box.height<=390,control);}
    report.push({case:'high-phone-layout',...(await p.evaluate(()=>__racerDebug.render))});
    // Context loss must pause safely, restoration must allow continued play.
    await p.evaluate(()=>{window.lostGL=document.querySelector('#race-view canvas').getContext('webgl2').getExtension('WEBGL_lose_context');lostGL.loseContext();});await p.locator('#pause-dialog').waitFor({state:'visible'});await p.waitForTimeout(200);await p.evaluate(()=>lostGL.restoreContext());await p.waitForTimeout(700);await p.locator('#resume').tap();assert.equal(await p.evaluate(()=>__racerDebug.paused),false);
    await p.locator('#pause').tap();await p.locator('#quit').tap();
    for(const track of ['canyon','neon']){await p.locator(`[data-track="${track}"]`).tap();await p.locator('#auto-throttle').check();await p.locator('#start').tap();await p.waitForTimeout(4200);await p.screenshot({path:path.join(artifacts,`realism-${track}-mobile.png`)});report.push({case:track,...await p.evaluate(()=>__racerDebug.render)});await p.locator('#pause').tap();await p.locator('#quit').tap();}
    // Fixed camera/car templates should not leak geometry or textures on rematch.
    await p.locator('[data-track="coast"]').tap();await p.locator('#start').tap();await p.waitForTimeout(500);const before=await p.evaluate(()=>__racerDebug.render);
    for(let i=0;i<4;i++){await p.locator('#pause').tap();await p.locator('#quit').tap();await p.locator('#start').tap();await p.waitForTimeout(350);}
    const after=await p.evaluate(()=>__racerDebug.render);report.push({case:'rematch-resources',before:{geometries:before.geometries,textures:before.textures},after:{geometries:after.geometries,textures:after.textures}});assert.ok(after.geometries<=before.geometries+2,JSON.stringify({before,after}));assert.ok(after.textures<=before.textures+1,JSON.stringify({before,after}));await context.close();
    const low=await setup({width:844,height:390},{cores:2,memory:2},3);await low.page.locator('#start').tap();await low.page.waitForTimeout(5600);const lowInfo=await low.page.evaluate(()=>({render:__racerDebug.render,width:document.querySelector('#race-view canvas').width,height:document.querySelector('#race-view canvas').height}));
    assert.equal(lowInfo.render.level,0);assert.equal(lowInfo.render.shadows,false);assert.equal(lowInfo.render.targetFps,30);assert.ok(lowInfo.width*lowInfo.height<=650000);await low.page.screenshot({path:path.join(artifacts,'realism-low-budget-mobile.png')});report.push({case:'low-budget',...lowInfo});await low.context.close();
    const switches=await setup({width:844,height:390},{cores:8,memory:8});
    const levels=await switches.page.evaluate(async()=>{
      const {RaceRenderer}=await import('/src/renderer.js'),{createRace}=await import('/src/simulation.js');
      const container=document.createElement('div');container.style.cssText='position:fixed;inset:0';document.body.append(container);
      const view=new RaceRenderer(container),race=createRace();view.setRace(race,'local');let time=1;const result=[];
      for(const level of [3,0,2,1,3,0,1,2]){view.adaptive.level=level;view.applyQuality();for(let i=0;i<5;i++)view.render(race,'local',1/30,time+=1/30);result.push(view.diagnostics);await new Promise(resolve=>requestAnimationFrame(resolve));}
      return result.map(({level,shadows,pixelRatio})=>({level,shadows,pixelRatio}));
    });
    await switches.page.waitForTimeout(200);assert.deepEqual(levels.map(r=>r.shadows),[true,false,true,false,true,false,false,true]);report.push({case:'all-quality-transitions',levels});await switches.context.close();
    assert.deepEqual(errors,[]);assert.deepEqual(warnings,[]);console.log(JSON.stringify({passed:true,checks:['phone portrait/landscape layout','manual throttle','real multi-touch brake+steer+boost','camera switch','audio toggle/mute','WebGL restoration','all track rendering','rematch resource stability','low/high device budgets','all quality transitions'],report,warnings},null,2));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
