import test from 'node:test';
import assert from 'node:assert/strict';
import {TRACKS,TRACK_LAYOUT,ROAD_HALF,BOOST_PAD,getTrack,shortDistance} from '../src/tracks.js';
import {createRace,stepRace} from '../src/simulation.js';
const hazards=['barrier','oil'];
for(const config of TRACKS) {
  test(`${config.name}：新增 320 米平直路段，坡度与切线平顺衔接`,()=>{
    const track=getTrack(config.id),straight=track.boostStraight;
    assert.ok(track.length>1500);assert.ok(Math.abs(straight.length-320)<1e-8);
    const first=track.sample(straight.s+2),yaw=first.yaw;
    for(let offset=2;offset<straight.length-2;offset+=2){const p=track.sample(straight.s+offset);assert.ok(Math.abs(p.yaw-yaw)<1e-8);assert.ok(Math.abs(p.y-first.y)<1e-8);if(offset>=8&&offset<=straight.length-8)assert.ok(Math.abs(track.curvature(straight.s+offset))<1e-8);}
    for(const section of track.sections)for(const seam of [section.s,section.s+section.length]){
      assert.ok(Math.abs(shortDistance(track.sample(seam+2).yaw,track.sample(seam-2).yaw,Math.PI*2))<.04,'直线和弯道没有朝向跳变');assert.ok(Math.abs(track.slope(seam))<.01);
    }
    assert.deepEqual(track.sample(0),track.sample(track.length));
  });
  test(`${config.name}：道具竞速直线上三个加速带可以沿同一车道连续通过`,()=>{
    const track=getTrack(config.id),straight=track.boostStraight,pads=track.objects.filter(o=>o.section==='boost-straight');
    assert.equal(pads.length,3);assert.equal(new Set(pads.map(p=>p.x)).size,1);
    for(let i=0;i<pads.length;i++){const pad=pads[i];assert.equal(pad.type,'boost');assert.ok(pad.s-straight.s>=50);assert.ok(straight.s+straight.length-pad.s>=110);assert.ok(Math.abs(track.curvature(pad.s))<1e-8);if(i)assert.ok(pad.s-pads[i-1].s>BOOST_PAD.length+10);}
    for(const rules of ['arcade']) {
      const race=createRace({track:config.id,rules});race.time=1;race.racers.slice(1).forEach(r=>r.finishTime=0);const me=race.racers[0];Object.assign(me,{s:straight.s+15,x:0,v:45,input:{throttle:true}});
      const collected=new Set();let minimumBoost=Infinity;
      for(let i=0;i<10*60&&me.s<straight.s+straight.length-20;i++){
        stepRace(race,1/60);for(const pad of pads)if(me.boostContacts[pad.id])collected.add(pad.id);
        if(me.s>pads[0].s+7&&me.s<pads.at(-1).s)minimumBoost=Math.min(minimumBoost,me.boost);
        assert.ok(!race.events.some(e=>e.racer===me.id&&e.type==='hit'),'加速直线不可撞到静态障碍');
      }
      assert.equal(collected.size,3,`${rules} 必须触发三个加速带`);assert.ok(minimumBoost>0,'连续加速不能中断');assert.equal(me.item,null);
    }
  });
  test(`${config.name}：所有加速带前后均无障碍物，整段新直线也无补给箱`,()=>{
    const track=getTrack(config.id),straight=track.boostStraight;
    assert.ok(track.objects.some(o=>o.type==='oil'));assert.ok(track.objects.some(o=>o.type==='barrier'));
    for(const pad of track.objects.filter(o=>o.type==='boost'))assert.ok(Math.abs(track.curvature(pad.s))<1e-8,'所有加速带只布置在直线');
    for(const pad of track.objects.filter(o=>o.type==='boost'))for(const o of track.objects.filter(o=>hazards.includes(o.type))){const d=shortDistance(o.s,pad.s,track.length);assert.ok(d< -TRACK_LAYOUT.boostApproach-6||d>TRACK_LAYOUT.boostRunoff+6,`${o.id} 占用 ${pad.id} 的安全区`);}
    for(const o of track.objects.filter(o=>o.type!=='boost')){const d=shortDistance(o.s,straight.s,track.length);assert.ok(d< -TRACK_LAYOUT.straightEntrance||d>straight.length+TRACK_LAYOUT.straightExit,`${o.id} 占用直线安全区`);}
    assert.equal(new Set(track.objects.map(o=>o.id)).size,track.objects.length);for(const o of track.objects){assert.ok(o.s>0&&o.s<track.length);assert.ok(Math.abs(o.x)+o.width<ROAD_HALF);}
  });
  test(`${config.name}：较长路线的地图边界包含全赛道与起点`,()=>{
    const track=getTrack(config.id),b=track.bounds,scale=Math.min(212/b.width,152/b.height);
    for(let s=0;s<track.length;s+=2){const p=track.sample(s),x=120+(p.x-b.centerX)*scale,y=90+(p.z-b.centerZ)*scale;assert.ok(x>=14-1e-8&&x<=226+1e-8);assert.ok(y>=14-1e-8&&y<=166+1e-8);}
  });
}
