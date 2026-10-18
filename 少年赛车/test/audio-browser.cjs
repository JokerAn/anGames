const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const output=path.join(__dirname,'artifacts');fs.mkdirSync(output,{recursive:true});
function wav(samples,rate){const data=Buffer.from(samples,'base64'),header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(36+data.length,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(rate,24);header.writeUInt32LE(rate*2,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(data.length,40);return Buffer.concat([header,data]);}
(async()=>{
  const browser=await chromium.launch({channel:process.env.CHROME_CHANNEL||'chrome',headless:true}),errors=[];
  try{
    const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(process.env.RACER_URL||'http://localhost:3210');
    const report=[];
    for(const engine of ['balanced','turbo','electric']){
      const result=await page.evaluate(async engine=>{
        const {AudioEngine}=await import('/src/audio.js');const ctx=new OfflineAudioContext(2,44100*4,44100),audio=new AudioEngine();audio.enabled=true;
        if(typeof audio.createGraph!=='function')throw new Error('AudioEngine.createGraph must support real offline synthesis');audio.createGraph(ctx);
        for(let frame=0;frame<240;frame++){
          const time=frame/60,phase=time<1?0:time<2?1:time<3?2:3;
          audio.update({id:'local',engine,v:phase===0?0:phase===1?30:45,rpm:phase===0?1000:phase===1?4200:6200,gear:phase<2?2:3,acceleration:phase===1?16:0,gripUsage:phase===2?1.5:0,drifting:phase===2,boosting:phase===2},phase!==3,{throttle:phase===1||phase===2,at:time});
        }
        const buffer=await ctx.startRendering(),channel=buffer.getChannelData(0),metrics=[];
        for(const [start,end] of [[.25,.85],[1.35,1.9],[2.35,2.9],[3.6,3.95]]){let energy=0,peak=0;for(let i=Math.floor(start*44100);i<end*44100;i++){if(!Number.isFinite(channel[i]))throw new Error('nonfinite audio sample');energy+=channel[i]*channel[i];peak=Math.max(peak,Math.abs(channel[i]));}metrics.push({rms:Math.sqrt(energy/((end-start)*44100)),peak});}
        const pcm=new Int16Array(channel.length);for(let i=0;i<pcm.length;i++)pcm[i]=Math.round(Math.max(-1,Math.min(1,channel[i]))*32767);
        let binary='';const bytes=new Uint8Array(pcm.buffer);for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
        return {engine,metrics,samples:btoa(binary),rate:44100};
      },engine);
      if(engine==='electric')assert.ok(result.metrics[0].rms<.00002,'stationary electric motor should be quiet');else assert.ok(result.metrics[0].rms>.0002,`${engine}: idle is silent`);
      assert.ok(result.metrics[1].rms>result.metrics[0].rms*1.2,`${engine}: throttle must audibly raise load`);
      assert.ok(result.metrics.every(m=>m.peak<.97),`${engine}: clipping`);
      assert.ok(result.metrics[3].rms<.00002,`${engine}: paused audio must fade to silence`);
      fs.writeFileSync(path.join(output,`engine-${engine}.wav`),wav(result.samples,result.rate));delete result.samples;report.push(result);
    }
    const lifecycle=await page.evaluate(async()=>{
      const {AudioEngine}=await import('/src/audio.js'),audio=new AudioEngine();audio.unlock=()=>new Promise(()=>{});
      const outcome=await Promise.race([audio.toggle().then(()=>audio.enabled),new Promise(r=>setTimeout(()=>r('blocked'),200))]);
      return {outcome};
    });assert.equal(lifecycle.outcome,true,'audio authorization cannot block a sound toggle');
    assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'audio-results.json'),JSON.stringify({report,lifecycle,errors},null,2));console.log(JSON.stringify({report,lifecycle,errors},null,2));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
