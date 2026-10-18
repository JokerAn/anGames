// Runtime audit for the premium graphics pass. Complements the visual evidence:
// it drives the real game input path, then checks HUD geometry across target
// viewports, speed-effect activation, rematch resource stability and that the
// evidence hooks stay out of normal play.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const BASE=process.env.RACER_URL||'http://127.0.0.1:3210';
const VIEWPORTS=[[1600,1000],[390,664],[390,844],[844,390],[320,568],[667,375],[412,732]];
const rectHit=(a,b)=>a.left<b.right-1&&a.right>b.left+1&&a.top<b.bottom-1&&a.bottom>b.top+1;
(async()=>{
  const browser=await chromium.launch({channel:process.env.CHROME_CHANNEL||'chrome',headless:true});
  const errors=[],warnings=[],report=[];
  async function open(viewport,mobile=false){
    const context=await browser.newContext({viewport,hasTouch:true,isMobile:mobile,deviceScaleFactor:mobile?2:1});
    const page=await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text());if(message.type()==='warning')warnings.push(message.text());});
    await page.goto(BASE);await page.waitForFunction(()=>window.__racerDebug?.render);
    return {context,page};
  }
  try{
    // 1) Normal play: speed effect activates when the quality tier includes it,
    //    the read-only debug hooks stay evidence-only.
    {
      const {context,page}=await open({width:1280,height:720});
      assert.equal(await page.evaluate(()=>typeof window.__THREE_GAME_TEST_HOOKS__),'undefined','evidence hooks must not load in normal play');
      await page.click('#start');
      await page.waitForFunction(()=>__racerDebug.status==='racing',{timeout:60000});
      await page.keyboard.down('KeyW');
      await page.waitForFunction(()=>__racerDebug.racers.find(r=>r.id===__racerDebug.playerId).v>25,null,{timeout:40000});
      const state=await page.evaluate(()=>{const r=__racerDebug,d=r.render;return {speedFx:d.speedFx,level:d.level,post:d.post?.mode};});
      await page.keyboard.up('KeyW');
      const hasDetail=(await page.evaluate(()=>__racerDebug.render.level))>=2;
      if(hasDetail)assert.equal(state.speedFx.visible,true,'speed streaks must activate on the detail tiers at speed');
      assert.ok(state.speedFx.count<=64);
      report.push({case:'real-play-speed-fx',speedFx:state.speedFx,level:state.level,post:state.post});
      await context.close();
    }
    // 2) Rematch resource stability with the new scene kit.
    {
      const {context,page}=await open({width:1280,height:720});
      await page.click('#start');await page.waitForFunction(()=>__racerDebug.active,{timeout:60000});
      const before=await page.evaluate(()=>({geometries:__racerDebug.render.geometries,textures:__racerDebug.render.textures}));
      for(let i=0;i<3;i++){await page.click('#pause');await page.click('#quit');await page.click('#start');await page.waitForFunction(()=>__racerDebug.active,{timeout:60000});}
      const after=await page.evaluate(()=>({geometries:__racerDebug.render.geometries,textures:__racerDebug.render.textures}));
      assert.ok(after.geometries<=before.geometries+2,JSON.stringify({before,after}));
      assert.ok(after.textures<=before.textures+2,JSON.stringify({before,after}));
      report.push({case:'three-rematches-stable',before,after});
      await context.close();
    }
    // 3) Target viewports: every HUD element inside the viewport, no overlaps,
    //    no horizontal page overflow.
    for(const [width,height] of VIEWPORTS){
      const {context,page}=await open({width,height},width<800);
      await page.click('#start');await page.waitForFunction(()=>__racerDebug.active,{timeout:60000});
      await page.waitForTimeout(400);
      const layout=await page.evaluate(()=>{
        const rectHit=(a,b)=>a.left<b.right-1&&a.right>b.left+1&&a.top<b.bottom-1&&a.bottom>b.top+1;
        const ids=['race-guide','lap-integrity','race-side','throttle-button','joy-steer','race-reset','camera','pause','speedometer'];
        const rects={};for(const id of ids){const element=document.getElementById(id);if(!element)continue;const box=element.getBoundingClientRect();if(box.width<=0||box.height<=0)continue;rects[id]={inside:box.x>=-1&&box.y>=-1&&box.right<=innerWidth+1&&box.bottom<=innerHeight+1};}
        const rect=id=>document.getElementById(id)?.getBoundingClientRect();
        const overlaps=[];
        for(const [id,value] of Object.entries(rects))if(!value.inside)overlaps.push(`${id}:outside`);
        for(const [a,b] of [['speedometer','race-reset'],['lap-integrity','speedometer'],['race-guide','lap-integrity'],['race-side','race-reset']]){const ra=rect(a),rb=rect(b);if(ra&&rb&&rectHit(ra,rb))overlaps.push(`${a}~${b}`);}
        const item=document.getElementById('item-readout');
        if(item&&!item.hidden){const ir=item.getBoundingClientRect();for(const control of [...document.querySelectorAll('[data-control],#race-reset')])if(rectHit(ir,control.getBoundingClientRect()))overlaps.push(`item-readout~${control.dataset.control||control.id}`);}
        return {overlaps,scrollWidth:document.documentElement.scrollWidth,innerWidth};
      });
      assert.deepEqual(layout.overlaps,[],`${width}x${height}: ${JSON.stringify(layout)}`);
      assert.ok(layout.scrollWidth<=layout.innerWidth+1,`${width}x${height}: horizontal overflow`);
      report.push({case:`layout-${width}x${height}`,overlaps:layout.overlaps});
      await context.close();
    }
    // 4) Portrait garage: intro copy must not overlap the showroom canvas.
    for(const [width,height] of [[390,664],[390,844],[320,568]]){
      const {context,page}=await open({width,height},true);
      await page.waitForTimeout(400);
      const overlap=await page.evaluate(()=>{
        const intro=document.querySelector('.intro p')?.getBoundingClientRect(),view=document.getElementById('garage-view')?.getBoundingClientRect();
        return !!(intro&&view&&intro.left<view.right-1&&intro.right>view.left+1&&intro.top<view.bottom-1&&intro.bottom>view.top+1);
      });
      assert.equal(overlap,false,`${width}x${height}: garage copy overlaps the showroom`);
      report.push({case:`garage-${width}x${height}`,overlap});
      await context.close();
    }
    assert.deepEqual(errors,[]);
    assert.deepEqual(warnings,[]);
    console.log(JSON.stringify({passed:true,report,errors,warnings},null,2));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
