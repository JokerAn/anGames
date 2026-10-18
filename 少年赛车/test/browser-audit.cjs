// Optional browser regression suite. Requires Playwright and a running game server.
const assert=require('node:assert/strict');
const {createDriver}=require('./browser-driver.cjs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const BASE=process.env.RACER_URL||'http://localhost:3210';
function installFakeSocket(){
  window.testSockets=[];
  window.WebSocket=class {
    static OPEN=1;static CONNECTING=0;static CLOSED=3;
    constructor(){this.readyState=0;this.sent=[];window.testSockets.push(this);}
    open(){this.readyState=1;this.onopen?.();}
    emit(data){this.onmessage?.({data:JSON.stringify(data)});}
    send(raw){this.sent.push(JSON.parse(raw));}
    close(){this.readyState=3;this.onclose?.();}
  };
}
(async()=>{
 const browser=await chromium.launch({channel:process.env.CHROME_CHANNEL||'chrome',headless:true});
 const errors=[];
 const pageIn=async(fake=false)=>{
  const context=await browser.newContext({viewport:{width:844,height:390},hasTouch:true,isMobile:true});
  if(fake)await context.addInitScript(installFakeSocket);
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(BASE);return {page,context};
 };
 try {
  const {page:p,context:first}=await pageIn(true);
  await p.locator('#laps').selectOption('2');await p.locator('#difficulty').selectOption('easy');await p.reload();assert.equal(await p.locator('#laps').inputValue(),'2');assert.equal(await p.locator('#difficulty').inputValue(),'easy');
  await p.locator('[data-mode="lan"]').tap();await p.locator('#room-code').fill('2026');await p.locator('#start').tap();
  await p.locator('[data-mode="solo"]').tap();assert.equal(await p.locator('#start').isEnabled(),true);await p.locator('#start').tap();
  await p.evaluate(()=>{const old=testSockets[0];old.open();old.emit({type:'welcome',id:'obsolete-player'});old.emit({type:'lobby',room:'old',players:[]});old.emit({type:'state',state:{}});});
  await p.waitForTimeout(200);const solo=await p.evaluate(()=>__racerDebug);assert.equal(solo.playerId,'local');assert.equal(solo.mode,'solo');assert.equal(solo.active,true);assert.equal(await p.locator('#room-dialog').isVisible(),false);
  await p.locator('#pause').tap();const pausedAt=await p.evaluate(()=>__racerDebug.time);await p.waitForTimeout(200);assert.equal(await p.evaluate(()=>__racerDebug.time),pausedAt);await p.locator('#quit').tap();
  console.log('PASS stale socket callbacks cannot alter a new solo game; settings persist; pause freezes time');
  await p.locator('[data-mode="lan"]').tap();await p.locator('#room-code').fill('3456');await p.locator('#start').tap();
  await p.evaluate(async()=>{
   const socket=testSockets.at(-1);socket.open();socket.emit({type:'welcome',id:'me'});
   window.testLobby={type:'lobby',room:'3456',host:'me',track:'coast',laps:2,difficulty:'easy',players:[{id:'me',name:'我',car:'comet',engine:'balanced',ready:true},{id:'peer',name:'朋友',car:'bolt',engine:'balanced',ready:true}]};socket.emit(testLobby);
   const {createRace}=await import('/src/simulation.js');window.testRace=createRace({laps:2,rules:'arcade',players:[{id:'me'},{id:'peer'}]});testRace.time=1;testRace.status='racing';testRace.racers[0].item='shield';socket.emit({type:'race',state:testRace});
  });
  await p.waitForTimeout(100);
  await p.keyboard.press('KeyE');
  await p.waitForTimeout(120);assert.ok(await p.evaluate(()=>testSockets.at(-1).sent.some(m=>m.type==='input'&&m.input.itemPress===1&&m.input.item===false)));
  await p.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  await p.waitForTimeout(100);assert.equal(await p.locator('#pause-dialog').isVisible(),true);assert.equal(await p.evaluate(()=>testSockets.at(-1).sent.filter(m=>m.type==='input').at(-1).input.throttle),false);
  await p.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'));});await p.locator('#resume').tap();
  await p.locator('#pause').tap();await p.evaluate(()=>testSockets.at(-1).emit(testLobby));assert.equal(await p.locator('#pause-dialog').isVisible(),false);assert.equal(await p.locator('#room-dialog').isVisible(),true);
  await p.evaluate(()=>testSockets.at(-1).emit({type:'race',state:testRace}));
  await p.evaluate(()=>{testRace.status='finished';testRace.time=50;testRace.racers.forEach((r,i)=>{r.finishTime=30+i;r.rank=i+1;});testSockets.at(-1).emit({type:'state',state:testRace});});
  await p.locator('#result-dialog').waitFor({state:'visible'});await p.evaluate(()=>testSockets.at(-1).close());assert.equal(await p.locator('#pause-dialog').isVisible(),false);assert.equal(await p.locator('#result-dialog').isVisible(),true);assert.equal(await p.locator('#again').isVisible(),false);await p.locator('#result-back').tap();
  console.log('PASS short item tap survives send interval; hidden LAN page brakes; rematch/disconnect dialogs remain consistent');
  await p.locator('[data-mode="lan"]').tap();await p.locator('#start').tap();await p.evaluate(()=>testSockets.at(-1).open());await p.waitForTimeout(6300);assert.equal(await p.locator('#start').isEnabled(),true);assert.equal(await p.evaluate(()=>testSockets.at(-1).readyState),3);
  console.log('PASS room acknowledgement timeout recovers the start button');await first.close();

  const {page:a,context:ca}=await pageIn(),{page:b,context:cb}=await pageIn();const code=String(Date.now()).slice(-8);
  for(const [page,name] of [[a,'审查A'],[b,'审查B']]){await page.locator('#rules').selectOption('arcade');await page.locator('[data-mode="lan"]').tap();await page.locator('#nickname').fill(name);await page.locator('#room-code').fill(code);await page.locator('#start').tap();await page.locator('#room-dialog').waitFor({state:'visible'});}
  await a.locator('#ready').tap();await b.locator('#ready').tap();await a.waitForFunction(()=>!document.getElementById('room-start').disabled);await a.locator('#room-start').tap();
  // Stage this pickup after the opening traffic has passed. The controller
  // follows one fixed line; a live lateral collision is a separate driving case.
  await a.waitForFunction(()=>__racerDebug.status==='racing'&&__racerDebug.time>3.2);
  const driver=await createDriver(a);let acquired=false;
  for(let i=0;i<150;i++){
   await driver.step(-5);
   if(await a.locator('[data-control="item"]').evaluate(el=>el.classList.contains('available'))){acquired=true;break;}await a.waitForTimeout(40);
  }
  await driver.release();assert.ok(acquired,'LAN player should collect a crate through manual steering');
  await a.keyboard.press('KeyE');
  await a.waitForFunction(()=>document.getElementById('item-name').textContent==='等待道具');
  const peerId=await b.evaluate(()=>__racerDebug.playerId);await cb.close();await a.waitForFunction(id=>__racerDebug.racers.find(r=>r.id===id)?.bot,peerId);
  console.log('PASS real two-browser LAN pickup, sub-frame item tap and disconnect takeover');await ca.close();

  const {page:renderPage,context:rc}=await pageIn();
  const orientations=await renderPage.evaluate(async()=>{
   const {RaceRenderer}=await import('/src/renderer.js'),{createRace}=await import('/src/simulation.js'),{getTrack,TRACKS}=await import('/src/tracks.js'),THREE=await import('/vendor/three.module.js');
   const container=document.createElement('div');container.style.cssText='position:fixed;inset:0';document.body.append(container);const view=new RaceRenderer(container),out=[];let renderTime=1;
   for(const track of TRACKS){const state=createRace({track:track.id}),me=state.racers[0];view.setRace(state);
    for(const offset of [.12,-.12]){const pose=getTrack(track.id).sample(me.s);me.heading=pose.yaw+offset;for(let i=0;i<60;i++)view.render(state,me.id,1/60,renderTime+=1/60);const forward=new THREE.Vector3(0,0,1).applyQuaternion(view.cars.get(me.id).quaternion);out.push({track:track.id,offset,lateralHeading:forward.x*pose.nx+forward.z*pose.nz});}
   }return out;
  });
  for(const o of orientations)assert.equal(Math.sign(o.lateralHeading),Math.sign(o.offset),JSON.stringify(o));console.log('PASS rendered orientation follows the independent world heading on all three tracks');await rc.close();
  assert.deepEqual(errors,[]);console.log('PASS zero uncaught browser errors');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
