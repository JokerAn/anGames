// Preserve the legacy regression API while using the 3.0 manual controller.
// All motion comes from real CDP joystick/pedal events and keyboard braking.
const {createManualDriver}=require('./v3-driver.cjs');
async function createDriver(page,options={}){
  const driver=await createManualDriver(page,options);
  return {
    step(targetX=0){return driver.step({targetX});},
    release(){return driver.release();},
  };
}
module.exports={createDriver};
