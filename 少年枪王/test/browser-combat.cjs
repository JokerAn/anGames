const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
(async()=>{
  const {createGameServer}=await import('../server.js'),{aimAngles,MAX_HP}=await import('../src/simulation.js');
  const app=createGameServer();await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${app.server.address().port}`;
  const browser=await chromium.launch({headless:true,channel:'chrome'}),errors=[];
  try{
    const context=await browser.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true,deviceScaleFactor:1}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url);await page.waitForSelector('#preview canvas');
    await page.evaluate(async()=>{
      const {ArenaRenderer}=await import('/src/renderer.js'),THREE=await import('three'),render=ArenaRenderer.prototype.render;
      ArenaRenderer.prototype.render=function(dt){render.call(this,dt);window.combatView={id:this.lastPlayer,aspect:this.camera.aspect,actors:[...this.models.entries()].map(([id,m])=>{const h=m.userData.health,head=m.position.clone().add(new THREE.Vector3(0,1.9,0)).project(this.camera);return {id,visible:m.visible,hp:h?.value,barVisible:!!h?.sprite.visible,color:h?[...h.canvas.getContext('2d').getImageData(20,7,1,1).data]:[],head:{x:(head.x+1)*innerWidth/2,y:(1-head.y)*innerHeight/2}};})};};
    });
    await page.tap('[data-map="blocks"]');await page.tap('[data-mode="lan"]');await page.fill('#room-password','combat-test');await page.tap('#join-room');await page.waitForSelector('#leave-room:not([hidden])');await page.tap('#start-game');await page.waitForSelector('#game-screen:not([hidden])');
    const room=[...app.rooms.values()][0],me=room.match.actors.find(a=>!a.bot),enemy=room.match.actors.find(a=>a.bot&&a.team!==me.team),friend=room.match.actors.find(a=>a.bot&&a.team===me.team);
    for(const a of room.match.actors)if(a.bot&&a!==enemy&&a!==friend){a.hp=0;a.respawn=999;}
    Object.assign(me,{x:44,z:20,y:0,hp:100,shield:0,yaw:0,pitch:-.12});Object.assign(enemy,{x:44,z:10,y:0,hp:100,shield:0,weapon:'blaster',weaponChoice:'blaster',yaw:Math.PI,cooldown:0,thinkTime:0});Object.assign(friend,{x:40,z:18,y:0,hp:100,shield:0,cooldown:999});
    await page.waitForFunction(()=>Number(document.querySelector('#health-value').textContent)<100,{},{timeout:8000});enemy.cooldown=999;
    await page.waitForFunction(()=>{const me=window.combatView?.actors.find(a=>a.id===window.combatView.id);return me?.hp<100&&!me.barVisible;});
    const view=await page.evaluate(()=>window.combatView),own=view.actors.find(a=>a.id===me.id),foe=view.actors.find(a=>a.id===enemy.id),mate=view.actors.find(a=>a.id===friend.id);
    assert.ok(own.color[1]>own.color[0]);assert.ok(foe.color[0]>foe.color[1]);assert.ok(mate.color[1]>mate.color[0]);assert.ok(own.head.x<844/2-55);assert.ok(foe.barVisible&&mate.barVisible);
    const crosshair=await page.locator('#crosshair').boundingBox();assert.ok(Math.abs(crosshair.x+crosshair.width/2-422)<1);assert.ok(Math.abs(crosshair.y+crosshair.height/2-195)<1);
    assert.equal(await page.locator('#crosshair i').first().evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(197, 255, 220)');
    console.log('Real enemy hits reach the player HUD and overhead bar; friend/enemy colors and reticle separation passed.');
    // Aim using an actual touch drag, then shoot; verify the authoritative enemy
    // health and its rendered bar both decrease, rather than faking UI values.
    const angles=aimAngles({...me,viewAspect:844/390},{x:enemy.x,y:enemy.y+1.12,z:enemy.z});const cdp=await context.newCDPSession(page);
    const start={id:1,x:560,y:210};await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...start,x:start.x-(angles.yaw-me.yaw)/(.004*.7),y:start.y-(angles.pitch-me.pitch)/(.0035*.7)}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(150);
    const fire=await page.locator('#fire-button').boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:2,x:fire.x+fire.width/2,y:fire.y+fire.height/2}]});
    await page.waitForFunction(id=>window.combatView?.actors.find(a=>a.id===id)?.hp<100,enemy.id,{timeout:5000});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});assert.ok(enemy.hp<100);
    await page.waitForTimeout(250);await page.screenshot({path:path.join(__dirname,'artifacts/crosshair-health-landscape.png')});
    await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>Math.abs(window.combatView.aspect-390/844)<.01);await page.waitForTimeout(150);assert.ok(Math.abs(me.viewAspect-390/844)<.01);
    const portrait=await page.evaluate(()=>window.combatView.actors.find(a=>a.id===window.combatView.id));assert.ok(portrait.head.x>25&&portrait.head.x<390-25);await page.screenshot({path:path.join(__dirname,'artifacts/crosshair-health-portrait.png')});
    enemy.hp=0;enemy.respawn=1;await page.waitForFunction(id=>window.combatView?.actors.find(a=>a.id===id)?.barVisible===false,enemy.id);enemy.respawn=.01;
    await page.waitForFunction(id=>window.combatView?.actors.find(a=>a.id===id)?.hp===150,enemy.id);assert.equal(enemy.hp,MAX_HP);
    Object.assign(me,{x:0,z:8});Object.assign(enemy,{x:0,z:-8,hp:100,cooldown:999});await page.waitForFunction(id=>window.combatView?.actors.find(a=>a.id===id)?.barVisible===false,enemy.id);
    console.log('Touch aimed fire reduces enemy health; portrait framing, death/respawn bars and wall occlusion passed.');
    await page.tap('#pause-game');await page.tap('#quit-game');assert.deepEqual(errors,[]);await context.close();
  }finally{await browser.close();await app.close();}
})().catch(e=>{console.error(e);process.exit(1);});
