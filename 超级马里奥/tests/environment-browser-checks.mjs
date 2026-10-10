// Browser-only failure paths and real touch events, using disposable storage.
export async function verifyEnvironment(page,base='http://127.0.0.1:8765'){
  const browser=page.context().browser(),checks=[];
  const cases=[
    {name:'malformed JSON',storage:'{broken'},
    {name:'malformed mode record',storage:JSON.stringify({records:{easy:'broken',hard:[]}})},
    {name:'invalid star counts',storage:JSON.stringify({records:{easy:{levels:{0:{stars:4},1:{stars:-2},2:{stars:'broken'}}}}})},
    {name:'storage access denied',blocked:true},
    {name:'audio constructor unavailable',audio:'throws'},
    {name:'audio API absent',audio:'missing'}
  ];
  for(const scenario of cases){
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    try{
      const p=await context.newPage(),errors=[];p.on('pageerror',error=>errors.push(error.message));
      await p.addInitScript(({storage,blocked,audio})=>{
        if(storage)localStorage.setItem('windy-trails:v1',storage);
        if(blocked){Storage.prototype.getItem=()=>{throw new Error('storage denied');};Storage.prototype.setItem=()=>{throw new Error('storage denied');};}
        if(audio==='throws')window.AudioContext=class{constructor(){throw new Error('audio unavailable');}};
        if(audio==='missing'){window.AudioContext=undefined;window.webkitAudioContext=undefined;}
      },scenario);
      await p.goto(`${base}/?debug`);await p.waitForFunction(()=>!!window.__windy);await p.locator('#map-button').tap();
      const mapWorks=await p.locator('.level-card').count()===8;
      await p.getByRole('button',{name:'回到首页'}).tap();await p.locator('#start-button').tap();
      const started=await p.evaluate(()=>__windy.state.mode==='playing');
      await p.evaluate(()=>__windy.finish());
      const finished=await p.evaluate(()=>__windy.state.mode==='winning');
      checks.push({name:scenario.name,pass:mapWorks&&started&&finished&&errors.length===0,errors});
    }finally{await context.close();}
  }
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  try{
    const p=await context.newPage();await p.goto(`${base}/?debug`);await p.waitForFunction(()=>!!window.__windy);await p.locator('#start-button').tap();
    const cdp=await context.newCDPSession(p);
    const point=async(selector,id)=>{const r=await p.locator(selector).boundingBox();return{x:r.x+r.width/2,y:r.y+r.height/2,id};};
    const right=await point('[data-action="right"]',1),center=await point('.pad-center',1);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[right]});
    await p.waitForFunction(()=>__windy.input.has('right'));
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[center]});
    await p.waitForFunction(()=>__windy.input.size===0);
    const neutral=await p.evaluate(()=>__windy.input.size===0);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[right]});
    await p.waitForFunction(()=>__windy.input.has('right'));
    const reengaged=await p.evaluate(()=>__windy.input.has('right'));
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await p.waitForFunction(()=>__windy.input.size===0);
    checks.push({name:'direction pad returns to neutral and can reengage',pass:neutral&&reengaged});
    await p.evaluate(()=>{__windy.begin(0);__windy.state.ammo=5;});
    const points=[right,await point('[data-action="jump"]',2),await point('[data-action="shoot"]',3)];
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points});
    await p.waitForFunction(()=>['right','jump','shoot'].every(action=>__windy.input.has(action)));
    const combined=await p.evaluate(()=>['right','jump','shoot'].every(action=>__windy.input.has(action)));
    await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
    await p.waitForFunction(()=>__windy.input.size===0);
    const released=await p.evaluate(()=>__windy.input.size===0);
    const ammo=await p.evaluate(()=>__windy.state.ammo);
    await p.waitForTimeout(300);
    checks.push({name:'three-finger touch cancellation leaves no ghost shots',pass:combined&&released&&await p.evaluate(value=>__windy.state.ammo===value,ammo)});
  }finally{await context.close();}
  const failures=checks.filter(c=>!c.pass);if(failures.length)throw new Error(JSON.stringify(failures));
  return checks;
}
