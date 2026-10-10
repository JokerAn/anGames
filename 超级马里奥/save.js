// Validate the entire stored shape before it can reach UI rendering or scoring.
// Valid records survive; only malformed fields are replaced with safe defaults.
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value:{};
const count=(value,max=Number.MAX_SAFE_INTEGER)=>typeof value==='number'&&Number.isFinite(value)?Math.max(0,Math.min(max,Math.floor(value))):0;

export function normalizeSave(value,levelCount){
  const source=record(value),records=record(source.records),result={sound:source.sound!==false,records:{}};
  for(const difficulty of ['easy','hard']){
    const mode=record(records[difficulty]),levels=record(mode.levels),clean={
      bestCoins:count(mode.bestCoins??(difficulty==='easy'?source.bestCoins:0)),
      bestStars:count(mode.bestStars??(difficulty==='easy'?source.bestStars:0),levelCount*3),
      levels:{}
    };
    for(let i=0;i<levelCount;i++){
      const entry=record(levels[i]);
      if(typeof entry.stars==='number'&&Number.isFinite(entry.stars))clean.levels[i]={stars:count(entry.stars,3)};
    }
    result.records[difficulty]=clean;
  }
  return result;
}
