// A real touch joystick driver for browser regressions. It follows a requested
// lateral line; the game itself never receives automatic steering assistance.
async function createDriver(page) {
  const client=await page.context().newCDPSession(page),bounds=await page.locator('#joy-steer').boundingBox();
  let braking=false;
  const centre={x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2,id:21},radius=bounds.width*.42;
  await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[centre]});
  return {
    async step(targetX=0) {
      const data=await page.evaluate(async()=>{
        const {getTrack,CARS,steeringLimit}=await import('/src/tracks.js'),d=__racerDebug,r=d.racers.find(r=>r.id===d.playerId);
        return {me:r,input:d.input,render:d.render,curvature:getTrack(d.track).curvature(r.s),previewCurvature:getTrack(d.track).curvature(r.s+Math.max(12,r.v*.65)),maxSteer:steeringLimit(r.v),grip:CARS.find(c=>c.id===r.car).grip,rules:d.rules};
      });
      const r=data.me,shouldBrake=r.v>Math.sqrt(16*data.grip/Math.max(.002,Math.abs(data.previewCurvature)))+2;
      if(shouldBrake!==braking){if(shouldBrake)await page.keyboard.down('KeyS');else await page.keyboard.up('KeyS');braking=shouldBrake;}
      const maxSteer=data.maxSteer,desired=data.curvature*r.v+(Math.atan2(targetX-r.x,14)-(r.headingError||0))*4;
      const grip=data.rules==='circuit'?1/(1+Math.max(0,r.gripUsage-1)*.45):1;
      const wheel=Math.atan(2.8*desired/Math.max(5,r.v*grip)),steer=Math.max(-1,Math.min(1,wheel/(maxSteer*data.grip)));
      const raw=Math.abs(steer)<.01?0:-Math.sign(steer)*(.14+.86*Math.abs(steer));
      await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...centre,x:centre.x+raw*radius}]});
      return data;
    },
    async release(){await page.keyboard.up('KeyS');await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await client.detach();},
  };
}
module.exports={createDriver};
