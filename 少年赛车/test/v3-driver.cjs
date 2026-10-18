// Test-only controller: reads telemetry and sends actual touch/pedal input.
// The production human input path never imports this helper.
async function createManualDriver(page,options={}){
  const cdp=await page.context().newCDPSession(page),stick=await page.locator('#joy-steer').boundingBox(),gas=await page.locator('#throttle-button').boundingBox();
  if(!stick||!gas)throw new Error('Manual driver needs visible steering and throttle controls');
  const centre={id:31,x:stick.x+stick.width/2,y:stick.y+stick.height/2},pedal={id:32,x:gas.x+gas.width/2,y:gas.y+gas.height/2};let braking=false,nitro=false,released=false;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[centre,pedal]});
  return {
    async step(overrides={}){
      if(released)throw new Error('Manual driver has been released');
      const settings={...options,...(typeof overrides==='number'?{targetX:overrides}:overrides)};
      if(settings.targetX!==undefined&&!Number.isFinite(settings.targetX))throw new TypeError('targetX must be finite');
      const state=await page.evaluate(async({targetX,turbo})=>{
        const {driverInput}=await import('/src/driving.js'),{getTrack,steeringLimit,clamp}=await import('/src/tracks.js'),d=__racerDebug,me=d.racers.find(r=>r.id===d.playerId),track=getTrack(d.track);
        const input=driverInput({difficulty:'normal',rules:d.rules,racers:d.racers,time:d.time},me,track);
        if(Number.isFinite(targetX)){
          // Aim at a world-space point on the requested line. Read the actual
          // independently integrated heading/position, including lateral slip.
          const ahead=Math.max(9,me.v*.45),aim=track.sample(me.s+ahead,targetX),wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
          const desiredHeading=Math.atan2(aim.x-me.worldX,aim.z-me.worldZ),rate=track.curvature(me.s+ahead*.6)*me.v+wrap(desiredHeading-me.heading)*2.2;
          input.steer=clamp(Math.atan(2.8*rate/Math.max(5,Math.abs(me.forwardSpeed)))/steeringLimit(me.v),-1,1);
        }
        if(turbo)input.nitro=!input.brake&&me.v>28&&Math.abs(track.curvature(me.s+Math.max(9,me.v*.45)*.6))<.003&&Math.abs(me.headingError)<.08;
        return {me,time:d.time,status:d.status,input,render:d.render,rules:d.rules,actualInput:d.input};
      },{targetX:settings.targetX,turbo:settings.turbo===true});
      if(state.input.brake!==braking){braking=state.input.brake;if(braking)await page.keyboard.down('KeyS');else await page.keyboard.up('KeyS');}
      const shouldNitro=settings.turbo===true&&state.input.nitro;
      if(shouldNitro!==nitro){nitro=shouldNitro;if(nitro)await page.keyboard.down('ShiftLeft');else await page.keyboard.up('ShiftLeft');}
      const steer=state.input.steer,raw=Math.abs(steer)<.01?0:-Math.sign(steer)*(.14+.86*Math.abs(steer));
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...centre,x:centre.x+raw*stick.width*.42},pedal]});return state;
    },
    async release(){if(released)return;released=true;try{await page.keyboard.up('KeyS');await page.keyboard.up('ShiftLeft');await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}finally{await cdp.detach();}},
  };
}
module.exports={createManualDriver};
