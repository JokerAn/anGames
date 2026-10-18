import test from 'node:test';
import assert from 'node:assert/strict';
import {createRace,stepRace,cleanChoice,cleanInput,snapshot} from '../src/simulation.js';
import {GUARDRAIL_OFFSET,syncVehiclePose} from '../src/driving.js';
import {earnRaceProgress} from './race-fixtures.js';
import {getTrack,TRACKS} from '../src/tracks.js';
function active(){const r=createRace({laps:2,rules:'arcade'});r.time=0;return r;}
function advance(r,seconds){for(let i=0;i<seconds*60;i++)stepRace(r,1/60);}
test('赛道闭合，采样和弯率有限，所有路线不同',()=>{
  const lengths=[];
  for(const config of TRACKS){const t=getTrack(config.id);lengths.push(t.length);assert.deepEqual(t.sample(0),t.sample(t.length));for(let s=-100;s<t.length;s+=3){const p=t.sample(s);assert.ok(Number.isFinite(p.x+p.y+p.z+t.curvature(s)));}assert.ok(t.objects.some(o=>o.type==='boost'));assert.ok(t.objects.some(o=>o.type==='oil'));}
  assert.equal(new Set(lengths).size,TRACKS.length);
});
test('倒计时不能偷跑；单人和双人始终六车',()=>{
  const r=createRace();r.racers[0].input={throttle:true};const initial=r.racers[0].s;advance(r,2);assert.equal(r.racers[0].s,initial);advance(r,3);assert.ok(r.racers[0].s>initial);assert.equal(r.racers.filter(r=>r.bot).length,5);
  const two=createRace({players:[{id:'a'},{id:'b'}]});assert.equal(two.racers.length,6);assert.equal(two.racers.filter(r=>r.bot).length,4);
});
test('输入和车型容错，客户端不能传速度、位置篡改比赛',()=>{
  assert.equal(cleanInput({steer:Infinity}).steer,0);assert.equal(cleanInput({steer:200}).steer,1);assert.equal(cleanChoice({car:'bad',engine:'bad'}).car,'comet');assert.equal(cleanChoice({name:'x'.repeat(40)}).name.length,12);assert.equal(cleanInput({s:1e9,v:1e9}).s,undefined);assert.equal(snapshot(active()).racers[0].cooldowns,undefined);
});
test('手动油门、刹车、转向和护栏碰撞生效',()=>{
  const r=active(),p=r.racers[0];p.input={throttle:false};advance(r,1);assert.equal(p.v,0);p.input={throttle:true,steer:1};advance(r,1);assert.ok(p.v>0);assert.ok(p.x>-2.5);p.s=getTrack(r.trackId).boostStraight.s+10;p.x=GUARDRAIL_OFFSET-1.02;p.v=40;p.headingError=0;p.input={steer:1};syncVehiclePose(p,getTrack(r.trackId));p.sideSpeed=5;advance(r,.1);const halfWidth=1.02*Math.abs(Math.cos(p.headingError))+2.25*Math.abs(Math.sin(p.headingError));assert.ok(p.x+halfWidth<=GUARDRAIL_OFFSET+.02);assert.ok(r.events.some(e=>e.type==='hit'&&e.racer===p.id));
});
test('撞车产生速度损失与横向分离',()=>{
  const r=active(),[a,b]=r.racers;a.s=20;b.s=21;a.x=0;b.x=.6;a.v=b.v=40;b.bot=false;stepRace(r,1/60);assert.ok(a.v<40);assert.ok(Math.abs(a.x-b.x)>=1.94);assert.ok(r.events.some(e=>e.text==='车身碰撞'));
});
test('氮气消耗，漂移释放蓄能',()=>{
  const r=pickupRace(),p=r.racers[0],track=getTrack(r.trackId);
  Object.assign(p,{s:track.boostStraight.s+10,x:-3,v:32,input:{nitro:true}});syncVehiclePose(p,track);
  advance(r,.3);assert.ok(p.nitro<55);assert.equal(p.boosting,true);
  p.input={drift:true,steer:.4};advance(r,.9);assert.ok(p.driftCharge>=.55);assert.equal(p.driftTier,1);assert.ok(Math.abs(p.slipAngle)>.16);
  const before=p.nitro;p.input={};advance(r,.3);
  assert.equal(p.drifting,false);assert.equal(p.driftCharge,0);assert.equal(p.offRoad,false);assert.equal(p.hit,0);
  assert.ok(p.nitro>before+9);assert.equal(r.events.filter(e=>e.type==='drift'&&e.racer===p.id).length,1);
});
test('道具箱、加速带、油污与护盾',()=>{
  const r=active(),p=r.racers[0],t=getTrack(r.trackId);const at=type=>{const o=t.objects.find(o=>o.type===type);p.s=o.s;p.x=o.x;p.v=30;stepRace(r,1/60);};
  at('box');assert.ok(p.item);at('boost');assert.ok(p.boost>0);at('oil');assert.ok(p.slow>0);
  p.item='shield';p.input={item:true};stepRace(r,1/60);assert.ok(p.shield>0);assert.equal(p.item,null);p.slow=0;p.cooldowns={};at('oil');assert.equal(p.slow,0);
});
test('油污与脉冲可释放；按住道具不会连发',()=>{
  const r=active(),[a,b]=r.racers;a.s=30;a.item='oil';a.input={item:true};stepRace(r,1/60);assert.equal(r.traps.length,1);const trapId=r.traps[0].id;a.item='pulse';stepRace(r,1/60);assert.equal(a.item,'pulse');a.input={};stepRace(r,1/60);b.s=a.s+20;b.x=a.x;b.shield=0;syncVehiclePose(b,getTrack(r.trackId));a.input={item:true};stepRace(r,1/60);assert.ok(b.slow>0);assert.equal(a.item,null);advance(r,20);assert.ok(!r.traps.some(t=>t.id===trapId));
});
test('冲线排名按顺序，未完成者在等待窗口后结算',()=>{
  const r=createRace({laps:2,rules:'arcade',players:[{id:'a'},{id:'b'}]}),t=getTrack(r.trackId),[a,b]=r.racers;r.time=0;
  r.racers.slice(2).forEach(p=>{p.bot=false;p.input={brake:true,park:true};});
  const gates=earnRaceProgress(r,[[a,t.length*2-1],[b,t.length*2-5]]);
  for(const p of [a,b])assert.equal(gates.filter(e=>e.type==='checkpoint'&&e.racer===p.id).length,16);
  Object.assign(a,{x:-4,v:60});Object.assign(b,{x:4,v:50});syncVehiclePose(a,t);syncVehiclePose(b,t);
  advance(r,.2);assert.equal(a.rank,1);assert.equal(b.rank,2);assert.ok(a.finishTime!==null);assert.ok(a.bestLap>0);
  advance(r,36);assert.equal(r.status,'finished');assert.ok(r.racers.slice(2).every(p=>p.finishTime===null));
});
for(const track of TRACKS)test(`${track.name}：六个人机可完赛、无非有限状态`,()=>{
  const r=createRace({track:track.id,laps:2,players:[]});advance(r,160);assert.equal(r.status,'finished');assert.equal(r.finishOrder.length,6);for(const p of r.racers)assert.ok(Number.isFinite(p.s+p.x+p.v));
});

function pickupRace(track='coast',players=[{id:'local'}]) {
  const race=createRace({track,players,rules:'arcade'});race.time=1;
  // Isolate pickups from traffic collisions; full-race AI checks above still cover traffic.
  race.racers.filter(r=>r.bot).forEach(r=>r.finishTime=0);
  return race;
}
for(const config of TRACKS)test(`${config.name}：道具箱中心与车身两侧擦边均可拾取`,()=>{
  for(const offset of [-2.05,0,2.05]) {
    const race=pickupRace(config.id),racer=race.racers[0],box=getTrack(config.id).objects.find(o=>o.type==='box');
    racer.s=box.s-2.8;racer.x=box.x+offset;racer.v=55;
    stepRace(race,1/60);
    assert.ok(racer.item,`offset=${offset}`);
    assert.ok(racer.pickupCooldowns[box.id]>race.time);
    assert.equal(race.events.filter(e=>e.type==='pickup').length,1);
  }
});
test('高速漂移离开箱体范围时仍可收集；隔壁车道不会误拾取',()=>{
  const race=pickupRace(),racer=race.racers[0],box=getTrack(race.trackId).objects.find(o=>o.type==='box');
  racer.s=box.s-1;racer.x=box.x+2.05;racer.v=95;racer.input={steer:1,drift:true,nitro:true};syncVehiclePose(racer,getTrack(race.trackId));racer.sideSpeed=14;
  stepRace(race,.05);assert.ok(racer.x-box.x>2.25);assert.ok(racer.item);
  const miss=pickupRace(),other=miss.racers[0];other.s=box.s;other.x=box.x+3;other.v=95;stepRace(miss,.05);assert.equal(other.item,null);
});
test('满槽不消耗箱体；使用道具后可拾取，冷却期间不重复发放',()=>{
  const race=pickupRace(),racer=race.racers[0],box=getTrack(race.trackId).objects.find(o=>o.type==='box');
  racer.s=box.s;racer.x=box.x;racer.input={throttle:false};racer.item='shield';
  stepRace(race,1/60);assert.equal(racer.item,'shield');assert.equal(racer.pickupCooldowns[box.id],undefined);assert.ok(race.events.some(e=>e.type==='full'));
  racer.input={throttle:false,item:true};stepRace(race,1/60);assert.ok(racer.shield>0);assert.ok(racer.item);const expiry=racer.pickupCooldowns[box.id];
  racer.item=null;racer.input={throttle:false};stepRace(race,1/60);assert.equal(racer.item,null);assert.equal(racer.pickupCooldowns[box.id],expiry);
  race.time=expiry+.1;stepRace(race,1/60);assert.ok(racer.item);
});
test('箱体冷却随联机快照同步，两个玩家分别拾取同一箱体',()=>{
  const race=pickupRace('coast',[{id:'a'},{id:'b'}]),[a,b]=race.racers,box=getTrack(race.trackId).objects.find(o=>o.type==='box');
  for(const racer of [a,b]){racer.s=box.s;racer.x=box.x;racer.input={throttle:false};}
  stepRace(race,1/60);assert.ok(a.item);assert.ok(b.item);
  const state=snapshot(race);assert.equal(state.racers[0].pickupCooldowns[box.id],a.pickupCooldowns[box.id]);assert.equal(state.racers[1].pickupCooldowns[box.id],b.pickupCooldowns[box.id]);
  assert.equal(state.racers[0].cooldowns,undefined);
});

test('同帧冲线按实际越线时刻排名，不能按处理顺序或冲出距离排名',()=>{
  for(const dt of [1/60,.05]){
    const race=createRace({laps:2,players:[{id:'a'},{id:'b'}]}),track=getTrack(race.trackId),goal=track.length*2,[a,b]=race.racers;race.time=0;
    race.racers.slice(2).forEach(r=>{r.bot=false;r.input={brake:true,park:true};});
    earnRaceProgress(race,[[a,goal-.8],[b,goal-.3]]);
    Object.assign(a,{x:-5,v:100,input:{throttle:false}});Object.assign(b,{x:5,v:60,input:{throttle:false}});syncVehiclePose(a,track);syncVehiclePose(b,track);
    const frameStart=race.time;stepRace(race,dt);
    assert.ok(b.finishTime!==null&&a.finishTime!==null);assert.ok(b.finishTime<a.finishTime);
    assert.equal(b.rank,1);assert.equal(a.rank,2);assert.deepEqual(race.finishOrder,['b','a']);
    assert.ok(a.s>b.s&&b.s>goal,'冲出距离较大的 a 仍应排在 b 之后');
    for(const [p,distance] of [[a,.8],[b,.3]]){
      const expected=frameStart+dt*distance/(p.s-(goal-distance));
      assert.ok(Math.abs(p.finishTime-expected)<1e-8);assert.ok(p.finishTime>frameStart&&p.finishTime<race.time);
    }
  }
});
test('单圈计时按越线时刻计算',()=>{
  const race=pickupRace(),me=race.racers[0],track=getTrack(race.trackId),length=track.length;
  const gates=earnRaceProgress(race,[[me,length-.3]]);assert.equal(gates.filter(e=>e.type==='checkpoint').length,8);
  const frameStart=race.time,lapStart=me.lapStart;me.v=60;syncVehiclePose(me,track);
  stepRace(race,1/60);const crossing=frameStart+(1/60)*.3/(me.s-(length-.3));
  assert.equal(me.lap,2);assert.ok(Math.abs(me.lapStart-crossing)<1e-8);
  assert.ok(Math.abs(me.bestLap-(crossing-lapStart))<1e-8);assert.ok(me.lapStart<race.time);
});
test('未经检查点直接搬到圈末或终点不能计圈或完赛',()=>{
  for(const laps of [1,2]){
    const race=active(),me=race.racers[0],track=getTrack(race.trackId);
    race.racers.slice(1).forEach(r=>{r.bot=false;r.input={brake:true,park:true};});
    Object.assign(me,{s:track.length*laps-.3,x:0,v:60,input:{}});syncVehiclePose(me,track);stepRace(race,1/60);
    assert.ok(me.s>track.length*laps);assert.equal(me.completedLaps,0);assert.equal(me.bestLap,null);assert.equal(me.finishTime,null);assert.deepEqual(race.finishOrder,[]);
    assert.ok(!race.events.some(e=>e.type==='lap'||e.type==='finish'));assert.ok(race.events.some(e=>e.type==='checkpoint-missed'));
  }
});
test('起点不赠氮气，只有非起点干净检查点补充5点',()=>{
  const race=pickupRace(),me=race.racers[0],track=getTrack(race.trackId);
  Object.assign(me,{s:-.2,x:0,v:20,nitro:0,input:{nitro:true}});syncVehiclePose(me,track);stepRace(race,1/60);
  assert.equal(me.nitro,0);assert.equal(me.boosting,false);assert.equal(me.cleanSectors,0);
  assert.ok(race.events.some(e=>e.type==='checkpoint'&&e.checkpoint===0));
  const checkpoint=track.length/8;earnRaceProgress(race,[[me,checkpoint-.2]]);
  me.v=20;syncVehiclePose(me,track);stepRace(race,1/60);
  assert.equal(me.nitro,5);assert.equal(me.cleanSectors,1);assert.equal(me.boosting,false);
  assert.ok(race.events.some(e=>e.type==='checkpoint'&&e.checkpoint===1));
  stepRace(race,1/60);assert.equal(me.boosting,true);assert.ok(me.nitro<5);
});
test('氮气耗尽后按住不会免费触发加速，松开后才能恢复',()=>{
  const race=pickupRace(),me=race.racers[0];me.s=0;me.x=0;me.v=20;me.nitro=0;me.input={nitro:true};
  for(let i=0;i<60;i++){stepRace(race,1/60);assert.equal(me.boosting,false);assert.equal(me.nitro,0);}
  me.input={};advance(race,.2);assert.ok(me.nitro>0);
});
test('加速带不会缩短已有更长加速的持续时间',()=>{
  const race=pickupRace(),me=race.racers[0],pad=getTrack(race.trackId).objects.find(o=>o.type==='boost');me.s=pad.s;me.x=pad.x;me.boost=5;me.v=20;
  stepRace(race,1/60);assert.ok(me.boost>4.9);
});
test('护盾连续擦墙不会每帧刷屏，也不会产生受伤闪烁',()=>{
  const race=pickupRace(),me=race.racers[0],track=getTrack(race.trackId);
  Object.assign(me,{s:track.boostStraight.s+10,x:GUARDRAIL_OFFSET-1.02,v:20,shield:5,input:{steer:1}});syncVehiclePose(me,track);me.sideSpeed=5;advance(race,1);
  const shields=race.events.filter(e=>e.type==='shield'&&e.racer===me.id);
  assert.ok(shields.length>=1&&shields.length<=4);assert.equal(me.hit,0);assert.ok(!race.events.some(e=>e.type==='hit'&&e.racer===me.id));
});
test('异常输入会安全刹车，非法道具点击序号不会进入比赛状态',()=>{
  for(const input of [null,[],true,'bad']){const clean=cleanInput(input);assert.equal(clean.throttle,false);assert.equal(clean.itemPress,0);}
  for(const itemPress of [-1,Infinity,NaN,1.5,Number.MAX_SAFE_INTEGER+1])assert.equal(cleanInput({itemPress}).itemPress,0);
});
test('异常昵称和配置不会抛错，使用安全默认值',()=>{
  for(const choice of [null,[],true,{name:{toString:null}},{name:'  '}])assert.deepEqual(cleanChoice(choice),{name:'少年车手',car:'comet',engine:'balanced'});
});
