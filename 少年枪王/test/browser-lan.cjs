const { chromium }=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
(async()=>{
 const {createGameServer}=await import('../server.js');const app=createGameServer();await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${app.server.address().port}`;
 const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
 try{
 const opts={viewport:{width:844,height:390},isMobile:true,hasTouch:true,deviceScaleFactor:1};const a=await browser.newContext(opts),b=await browser.newContext(opts);const host=await a.newPage(),guest=await b.newPage();
 for(const page of [host,guest]){page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{window.testTones=0;const Original=window.AudioContext.prototype.createOscillator;window.AudioContext.prototype.createOscillator=function(){window.testTones++;return Original.call(this);};});await page.goto(url);await page.waitForSelector('#preview canvas');await page.tap('[data-mode="lan"]');}
 await host.fill('#player-name','蓝队小队长');await host.fill('#room-password','browser-lan-test');await host.tap('#join-room');await host.waitForSelector('#leave-room:not([hidden])');
 await guest.fill('#player-name','红队小伙伴');await guest.selectOption('#player-team','red');await guest.fill('#room-password','browser-lan-test');await guest.tap('#join-room');await guest.waitForSelector('#leave-room:not([hidden])');assert.equal(await guest.locator('#start-game').isDisabled(),true);
 await host.tap('[data-map="harbor"]');await guest.waitForSelector('[data-map="harbor"][aria-pressed="true"]');assert.equal(await guest.locator('[data-map="desert"]').isDisabled(),true);
 await host.tap('#configure-enemy');await host.tap('[data-preset="swarm"]');await host.tap('#save-config');await host.tap('#start-game');await host.waitForSelector('#game-screen:not([hidden])');await guest.waitForSelector('#game-screen:not([hidden])');
 const room=[...app.rooms.values()][0];assert.equal(room.match.config.map,'harbor');assert.match(await guest.locator('#map-badge').innerText(),/海港仓库/);assert.equal(room.match.actors.filter(x=>x.team==='red'&&x.bot).length,11);assert.equal(room.match.actors.filter(x=>!x.bot).length,2);assert.equal(room.match.actors.filter(x=>x.difficulty==='hard').length,1);
 const hostId=room.host,me=room.match.actors.find(x=>x.id===hostId);Object.assign(me,{x:14,z:20,yaw:0,pitch:0,cooldown:0});await host.waitForTimeout(150);
 const rect=await host.locator('#joystick').boundingBox(),fire=await host.locator('#fire-button').boundingBox(),cdp=await a.newCDPSession(host);
 const stickPoint={id:1,x:rect.x+rect.width*.85,y:rect.y+rect.height/2},firePoint={id:2,x:fire.x+fire.width/2,y:fire.y+fire.height/2};
 const tones=await host.evaluate(()=>window.testTones),beforeX=me.x;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[stickPoint,firePoint]});await host.waitForTimeout(500);const movedX=me.x;assert.ok(movedX>beforeX+.3,`${beforeX} -> ${movedX}`);assert.ok(await host.evaluate(()=>window.testTones)>tones+3);assert.equal(me.input.fire,true);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await host.waitForTimeout(160);assert.equal(me.input.fire,false);assert.equal(me.input.moveX,0);console.log('Two simultaneous touches move + fire; release clears input; audio synthesis active.');
 await guest.screenshot({path:path.join(__dirname,'artifacts/lan-red-phone.png')});
 room.match.time=room.config.duration-.01;await host.waitForSelector('#result-dialog[open]');await guest.waitForSelector('#result-dialog[open]');assert.equal(await guest.locator('#play-again').isDisabled(),true);assert.equal(await host.locator('#result-score').innerText(),await guest.locator('#result-score').innerText());
 await host.tap('#result-lobby');await guest.waitForSelector('#app:not([hidden])');await host.tap('[data-map="desert"]');await guest.waitForSelector('[data-map="desert"][aria-pressed="true"]');await guest.selectOption('#player-team','blue');await host.waitForTimeout(100);assert.equal(room.members.every(m=>m.team==='blue'),true);
 await host.tap('#start-game');await guest.waitForSelector('#game-screen:not([hidden])');assert.equal(room.match.config.map,'desert');assert.match(await guest.locator('#map-badge').innerText(),/沙漠遗迹/);assert.equal(room.match.actors.filter(x=>x.team==='blue').length,3);assert.equal(await guest.locator('#player-badge').innerText(),'● 蓝色小队');
 await host.tap('#pause-game');await host.tap('#quit-game');await guest.waitForSelector('#app:not([hidden])');await a.close();await guest.waitForTimeout(200);assert.equal(await guest.locator('#start-game').isDisabled(),false);await b.close();
 assert.deepEqual(errors,[]);console.log('Two-phone browser LAN PvP, mixed roster, synchronized results, co-op replay on a different map and host transfer passed.');
 } finally{await browser.close();await app.close();}
})().catch(e=>{console.error(e);process.exit(1);});
