const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const output=path.join(__dirname,'artifacts');fs.mkdirSync(output,{recursive:true});
(async()=>{
  const {createGameServer}=await import('../server.js');const app=createGameServer();await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const url=`http://127.0.0.1:${app.server.address().port}`,browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'chrome'}),errors=[],results=[];
  const observe=page=>{page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});};
  const shot=async(page,name,fullPage=false)=>{await page.screenshot({path:path.join(output,`v2-${name}.png`),fullPage});};
  const alive=page=>page.waitForFunction(()=>window.__arena?.state?.actors.find(a=>a.id==='local')?.hp>0);
  try{
    const desktop=await browser.newContext({viewport:{width:1440,height:1000}}),page=await desktop.newPage();observe(page);
    await page.goto(url+'/?debug=1');await page.waitForFunction(()=>window.__arena?.renderer&&!window.__arena.renderer.webglLost);
    assert.equal(await page.locator('#rules').inputValue(),'control');await shot(page,'lobby-desktop',true);
    for(const map of ['blocks','harbor','desert']){
      await page.click(`[data-map="${map}"]`);await page.waitForFunction(id=>window.__arena.renderer.map.id===id,map);await page.click('#start-game');await alive(page);
      await page.waitForFunction(()=>window.__arena.state.time>.4);
      const values=await page.evaluate(()=>{const {renderer,state}=window.__arena,me=state.actors.find(a=>a.id==='local'),m=renderer.models.get('local');return {visible:m.visible,weapon:m.userData.weapon,finite:[...renderer.camera.position].every(Number.isFinite),ammo:me.ammo.blaster,bloom:renderer.bloom.enabled};});
      assert.ok(values.visible&&values.finite&&values.bloom);assert.equal(values.ammo,30);await shot(page,`combat-${map}`);
      if(map==='harbor'){
        await page.evaluate(async()=>{const {match,controls}=window.__arena,{aimAngles}=await import('/src/simulation.js');const me=match.actors.find(a=>a.id==='local'),enemy=match.actors.find(a=>a.bot&&a.team!==me.team);for(const a of match.actors)if(a.bot)a.cooldown=999;Object.assign(me,{x:44,z:30,shield:0});Object.assign(enemy,{x:44,z:12,shield:0,hp:150});Object.assign(controls,aimAngles({...me,viewAspect:innerWidth/innerHeight},{x:enemy.x,y:1.2,z:enemy.z}));window.auditEnemy=enemy.id;});
        await page.keyboard.down('KeyO');await page.waitForFunction(()=>window.__arena.state.actors.find(a=>a.id==='local').ammo.blaster<28);await page.keyboard.up('KeyO');assert.ok(await page.evaluate(()=>window.__arena.match.actors.find(a=>a.id===window.auditEnemy).hp<150));
        await page.keyboard.press('KeyR');await page.waitForFunction(()=>window.__arena.state.actors.find(a=>a.id==='local').reloadTime>0);
        const reloadAmmo=await page.evaluate(()=>window.__arena.state.actors.find(a=>a.id==='local').ammo.blaster);await page.keyboard.down('KeyO');await page.waitForTimeout(180);await page.keyboard.up('KeyO');assert.equal(await page.evaluate(()=>window.__arena.state.actors.find(a=>a.id==='local').ammo.blaster),reloadAmmo);
        await page.waitForFunction(()=>window.__arena.state.actors.find(a=>a.id==='local').ammo.blaster===30);
        await page.keyboard.down('KeyD');await page.keyboard.press('KeyE');await page.keyboard.up('KeyD');await page.waitForFunction(()=>window.__arena.state.actors.find(a=>a.id==='local').dashCooldown>2);await page.waitForFunction(()=>Number(document.querySelector('#stamina-value').textContent)<100);
        await page.keyboard.press('KeyV');await page.waitForFunction(()=>document.querySelector('#game-canvas canvas').dataset.view==='first-person');await shot(page,'first-person');
        await page.keyboard.press('KeyV');await page.keyboard.press('KeyC');await page.waitForFunction(()=>window.__arena.controls.shoulder===-1&&document.querySelector('#game-canvas canvas').dataset.view==='third-person');
        await page.keyboard.press('Digit4');await page.waitForFunction(()=>window.__arena.state.actors.find(a=>a.id==='local').weapon==='sniper');
        await page.mouse.click(700,500,{button:'right'});await page.waitForFunction(()=>document.body.classList.contains('scoped'));await shot(page,'sniper-scope');
        await page.mouse.click(700,500,{button:'right'});
      }
      await page.keyboard.press('Escape');await page.waitForSelector('#pause-dialog[open]');
      const time=await page.locator('#game-time').innerText();await page.waitForTimeout(200);assert.equal(await page.locator('#game-time').innerText(),time);await page.click('#quit-game');
      results.push(`${map}: scene, local actor, resources, pause verified`);console.log(results.at(-1));
    }
    await page.click('#settings-open');await page.selectOption('#quality','low');assert.equal(await page.evaluate(()=>window.__arena.renderer.bloom.enabled),false);await page.selectOption('#quality','balanced');await page.locator('#settings-dialog .close-dialog').click();
    await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await shot(page,'lobby-mobile',true);
    await desktop.close();
    const mobile=await browser.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true,deviceScaleFactor:1}),phone=await mobile.newPage();observe(phone);
    await phone.goto(url+'/?debug=1');await phone.waitForFunction(()=>window.__arena?.renderer);await phone.tap('#start-game');await alive(phone);await phone.waitForFunction(()=>window.__arena.state.time>.4);
    const cdp=await mobile.newCDPSession(phone),stick=await phone.locator('#joystick').boundingBox(),fire=await phone.locator('#fire-button').boundingBox();
    const original=await phone.evaluate(()=>{const a=window.__arena.state.actors.find(a=>a.id==='local');return {x:a.x,z:a.z};});
    const points=[{id:1,x:stick.x+stick.width*.8,y:stick.y+stick.height*.5},{id:2,x:fire.x+fire.width/2,y:fire.y+fire.height/2}];
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points});await phone.waitForTimeout(400);
    const moved=await phone.evaluate(()=>{const a=window.__arena.state.actors.find(a=>a.id==='local');return {x:a.x,z:a.z,ammo:a.ammo.blaster};});assert.ok(Math.hypot(moved.x-original.x,moved.z-original.z)>.2);assert.ok(moved.ammo<30);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await phone.waitForFunction(()=>window.__arena.controls.moveX===0&&!window.__arena.controls.fire);
    await phone.tap('#reload-button');await phone.waitForFunction(()=>window.__arena.state.actors.find(a=>a.id==='local').reloadTime>0);
    await phone.tap('#dash-button');await phone.waitForFunction(()=>window.__arena.state.actors.find(a=>a.id==='local').dashCooldown>0);
    await phone.tap('#view-button');await phone.waitForFunction(()=>window.__arena.controls.viewMode==='first');await phone.tap('#view-button');await phone.tap('#aim-button');assert.ok(await phone.locator('body').evaluate(e=>e.classList.contains('aiming')));await phone.tap('#aim-button');
    const fireBounds=await phone.locator('#fire-button').boundingBox(),ammoBounds=await phone.locator('#current-weapon').boundingBox();assert.ok(fireBounds.y+fireBounds.height<ammoBounds.y,'landscape firing button overlaps ammunition');
    await shot(phone,'combat-mobile-landscape');await phone.setViewportSize({width:390,height:844});await phone.waitForTimeout(250);await shot(phone,'combat-mobile-portrait');
    assert.ok(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const portraitFire=await phone.locator('#fire-button').boundingBox(),portraitAmmo=await phone.locator('#current-weapon').boundingBox();assert.ok(portraitFire.y+portraitFire.height<portraitAmmo.y,`portrait firing button overlaps ammunition: ${JSON.stringify({portraitFire,portraitAmmo})}`);
    for(const selector of ['#joystick','#fire-button','#dash-button','#reload-button','#view-button','#pause-game']){const box=await phone.locator(selector).boundingBox();assert.ok(box&&box.x>=0&&box.y>=0&&box.x+box.width<=390&&box.y+box.height<=844,selector);}
    await phone.tap('#pause-game');await phone.waitForSelector('#pause-dialog[open]');await phone.tap('#quit-game');await mobile.close();results.push('mobile: simultaneous movement/fire, release, reload, dodge, dual views, portrait and landscape verified');
    const lan=await browser.newContext({viewport:{width:1000,height:700},hasTouch:true}),host=await lan.newPage(),guest=await lan.newPage();observe(host);observe(guest);
    for(const client of [host,guest]){await client.goto(url+'/?debug=1');await client.waitForFunction(()=>window.__arena?.renderer);await client.click('[data-mode="lan"]');await client.fill('#room-password','tactical-audit-26');await client.click('#join-room');}
    await host.waitForFunction(()=>document.querySelectorAll('#room-members .member-row').length===2&&!document.querySelector('#start-game').disabled);await host.selectOption('#rules','control');await host.click('#start-game');await host.waitForSelector('#game-screen:not([hidden])');await guest.waitForSelector('#game-screen:not([hidden])');
    await host.waitForFunction(()=>window.__arena.state?.time>.3);const room=[...app.rooms.values()].find(r=>r.match);assert.ok(room);const actor=room.match.actors.find(a=>a.id===room.host);assert.equal(room.match.config.rules,'control');
    await host.keyboard.press('KeyV');await host.waitForFunction(()=>window.__arena.state.actors.some(a=>!a.bot&&a.viewMode==='first'));
    await host.keyboard.down('KeyO');await host.waitForFunction(()=>window.__arena.state.actors.some(a=>!a.bot&&a.ammo.blaster<30));await host.keyboard.up('KeyO');await host.keyboard.press('KeyR');await host.waitForFunction(()=>window.__arena.state.actors.some(a=>!a.bot&&a.reloadTime>0));
    assert.ok(actor.reloadTime>0);await host.keyboard.press('KeyE');await host.waitForFunction(()=>window.__arena.state.actors.some(a=>!a.bot&&a.dashCooldown>0));assert.ok(actor.dashCooldown>0);
    await shot(host,'lan-authoritative');room.match.score.blue=room.match.config.target;await host.waitForSelector('#result-dialog[open]');await guest.waitForSelector('#result-dialog[open]');await host.click('#result-lobby');await guest.waitForSelector('#app:not([hidden])');await lan.close();results.push('LAN: both clients, authoritative magazines/reload/dodge/views, end and lobby synchronization verified');
    assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'v2-browser-results.json'),JSON.stringify({results,errors},null,2));console.log(results.join('\n'));console.log('PASS: no browser runtime or console errors');
  }finally{await browser.close();await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
