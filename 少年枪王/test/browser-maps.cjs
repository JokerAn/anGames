const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
(async()=>{
  const {createGameServer}=await import('../server.js');const app=createGameServer();await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${app.server.address().port}`;
  const browser=await chromium.launch({headless:true,channel:'chrome'}),errors=[];
  try{
    const context=await browser.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true,deviceScaleFactor:1}),page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.goto(url);await page.waitForSelector('#preview canvas');
    // Observe the actual live renderer from the test, with no debug hooks in production.
    await page.evaluate(async()=>{
      const {ArenaRenderer}=await import('/src/renderer.js'),THREE=await import('three'),render=ArenaRenderer.prototype.render;
      ArenaRenderer.prototype.render=function(dt){
        render.call(this,dt);const model=this.models.get(this.lastPlayer);let gunMeshes=0;model?.userData.gun.traverse(o=>{if(o.isMesh)gunMeshes++;});
        const foot=model?model.position.clone().project(this.camera):null,head=model?model.position.clone().add(new THREE.Vector3(0,1.9,0)).project(this.camera):null;
        window.testView={map:this.map.id,mode:this.mode,localVisible:model?.visible,gunMeshes,weapon:model?.userData.weapon,bodyYaw:model?.rotation.y,cameraYaw:this.camera.rotation.y,cameraDistance:model?model.position.distanceTo(this.camera.position):0,foot:foot&&{x:foot.x,y:foot.y},head:head&&{x:head.x,y:head.y},drawCalls:this.renderer.info.render.calls,fov:this.camera.fov};
      };
    });
    for(const map of ['blocks','harbor','desert']){
      await page.tap(`[data-map="${map}"]`);await page.waitForFunction(m=>window.testView?.map===m,map);await page.tap('#start-game');await page.waitForSelector('#game-screen:not([hidden])');await page.waitForFunction(()=>window.testView?.localVisible&&window.testView?.gunMeshes>0);
      const initial=await page.evaluate(()=>window.testView);assert.equal(initial.map,map);assert.ok(initial.cameraDistance>3);assert.ok(Math.abs(initial.foot.x)<1&&Math.abs(initial.foot.y)<1);assert.ok(Math.abs(initial.head.x)<1&&Math.abs(initial.head.y)<1);
      await page.screenshot({path:path.join(__dirname,`artifacts/third-person-${map}.png`)});
      await page.tap('#aim-button');await page.waitForTimeout(250);const aimed=await page.evaluate(()=>window.testView);assert.ok(aimed.localVisible&&aimed.gunMeshes>0);assert.ok(aimed.cameraDistance<initial.cameraDistance);assert.ok(aimed.fov<initial.fov);await page.tap('#aim-button');
      await page.tap('#current-weapon');await page.waitForFunction(()=>window.testView.weapon==='smg');
      const cdp=await context.newCDPSession(page),eye=await page.locator('#freelook-button').boundingBox();const before=await page.evaluate(()=>window.testView);
      const point={id:1,x:eye.x+eye.width/2,y:eye.y+eye.height/2};await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...point,x:point.x-600}]});await page.waitForTimeout(120);
      const orbit=await page.evaluate(()=>window.testView);assert.ok(Math.abs(orbit.cameraYaw-before.cameraYaw)>1);assert.ok(Math.abs(orbit.bodyYaw-before.bodyYaw)<.1);assert.equal(await page.locator('body').evaluate(e=>e.classList.contains('free-looking')),true);
      if(map==='harbor')await page.screenshot({path:path.join(__dirname,'artifacts/third-person-free-look.png')});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(80);assert.equal(await page.locator('body').evaluate(e=>e.classList.contains('free-looking')),false);
      const returned=await page.evaluate(()=>window.testView);assert.ok(Math.abs(returned.cameraYaw-before.cameraYaw)<.15);
      console.log(`${map}: visible full-body armed character, shoulder aiming, weapon model switch, independent orbit and return passed (${initial.drawCalls} draw calls).`);
      await page.tap('#pause-game');await page.tap('#quit-game');await cdp.detach();
    }
    await context.close();
    const desktop=await browser.newContext({viewport:{width:1440,height:1080}}),lobby=await desktop.newPage();await lobby.goto(url);await lobby.waitForSelector('#preview canvas');await lobby.click('[data-map="harbor"]');await lobby.screenshot({path:path.join(__dirname,'artifacts/maps-lobby-desktop.png'),fullPage:true});
    await lobby.setViewportSize({width:390,height:844});await lobby.screenshot({path:path.join(__dirname,'artifacts/maps-lobby-mobile.png'),fullPage:true});assert.equal(await lobby.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await lobby.setViewportSize({width:1440,height:900});
    await lobby.evaluate(async()=>{const {ArenaRenderer}=await import('/src/renderer.js'),render=ArenaRenderer.prototype.render;ArenaRenderer.prototype.render=function(dt){render.call(this,dt);const model=this.models.get(this.lastPlayer);window.testDesktopView={yaw:this.camera.rotation.y,body:model?.rotation.y};};});
    await lobby.click('#start-game');await lobby.waitForSelector('#game-screen:not([hidden])');await lobby.waitForFunction(()=>typeof window.testDesktopView?.body==='number');await lobby.screenshot({path:path.join(__dirname,'artifacts/third-person-desktop.png')});
    const beforeAlt=await lobby.evaluate(()=>window.testDesktopView);await lobby.keyboard.down('Alt');await lobby.mouse.move(650,300);await lobby.waitForTimeout(100);const withAlt=await lobby.evaluate(()=>window.testDesktopView);
    assert.equal(await lobby.locator('body').evaluate(e=>e.classList.contains('free-looking')),true);assert.ok(Math.abs(withAlt.yaw-beforeAlt.yaw)>.1);assert.ok(Math.abs(withAlt.body-beforeAlt.body)<.1);
    await lobby.keyboard.up('Alt');assert.equal(await lobby.locator('body').evaluate(e=>e.classList.contains('free-looking')),false);await lobby.keyboard.press('Escape');await lobby.waitForSelector('#pause-dialog[open]');await lobby.click('#quit-game');
    console.log('Desktop Alt orbit, release-to-return and Esc menu passed.');
    await desktop.close();assert.deepEqual(errors,[]);console.log('All three maps and third-person browser checks passed.');
  }finally{await browser.close();await app.close();}
})().catch(e=>{console.error(e);process.exit(1);});
