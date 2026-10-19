import { afterEach, describe, expect, it, vi } from 'vitest';
import { refineAppearance, appearanceCanImprove, appearanceIsBetter } from './appearance';
import { featureChoices } from '../moc-features';
import type { Build } from '../bricks';
import type { ShapeVerdict } from './run';
import type { RankedIdea } from './pipeline';

const stock={'plate-2x2-white':22,'slope-2x2-white':1};
const build:Build={name:'Bird',description:'Capability fixture',steps:Array.from({length:20},(_,z)=>({caption:'Layer',parts:[{partId:'plate-2x2-white',x:2,y:2,z,rot:0}]}))};
const idea:RankedIdea={name:'Bird',pitch:'A bird',why:'',length:6,width:4,height:6,palette:[{role:'body',color:'white',cells:40}],worst:1,cells:40,shortfall:0};
const before:ShapeVerdict={looksLike:'bird',recognizable:3,complete:3,colors:3,impressive:2,fixes:['Taper the top'],named:true,pass:false};
const after={...before,impressive:3};
const patch={focus:'Taper the top',remove:[],add:[{id:'cap',choiceId:featureChoices(stock).find(c=>c.studyId==='pointed-muzzle')!.id,parent:'p19',parentPort:'stud:0:0',childPort:'grip:0:0',twist:0}]};
const reply=(json:unknown)=>new Response(JSON.stringify({modelVersion:'gemini-test-model',candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:JSON.stringify(json)}]}}]}));
const views=()=>['data:image/jpeg;base64,AA=='];
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});

describe('appearance-directed study use',()=>{
  it('prioritizes identity and shape while bounding quality tradeoffs',()=>{
    expect(appearanceCanImprove(before,after)).toBe(true);
    expect(appearanceCanImprove(before,before)).toBe(true); // a clear blind preference may improve within a score band
    expect(appearanceCanImprove(before,{...after,named:false})).toBe(false);
    expect(appearanceCanImprove(before,{...after,colors:2})).toBe(true);
    expect(appearanceIsBetter(before,before)).toBe(false);
    expect(appearanceCanImprove(before,{...after,colors:1})).toBe(false);
    expect(appearanceCanImprove(before,{...after,complete:1})).toBe(false);
    expect(appearanceCanImprove(before,{...after,recognizable:2,impressive:5})).toBe(false);
    expect(appearanceCanImprove(before,{...after,impressive:NaN})).toBe(false);
  });
  it('keeps the identified bridge revision even when its color score falls one point',()=>{
    const unrecognized={...before,looksLike:'unidentifiable block assembly',named:false,recognizable:2,complete:2,colors:3,impressive:2};
    const bridge={...unrecognized,looksLike:'covered bridge over water',named:true,recognizable:3,colors:2};
    expect(appearanceIsBetter(unrecognized,bridge)).toBe(true);
    expect(appearanceIsBetter(bridge,unrecognized)).toBe(false);
  });
  it('never trades away a passed or strong model for a weak named draft',()=>{
    const passed={...before,pass:true,recognizable:4,complete:4,colors:3,impressive:4};
    expect(appearanceCanImprove(passed,{...passed,pass:false,recognizable:5,colors:2})).toBe(false);
    expect(appearanceCanImprove({...passed,pass:false},{...passed,pass:false,recognizable:5,complete:3})).toBe(false);
  });
  it('upgrades a highly recognizable unfinished draft to a fully qualified model',()=>{
    const weak={...before,recognizable:5,complete:3,colors:5,impressive:3};
    const finished={...weak,pass:true,recognizable:4,complete:4,colors:3,impressive:4};
    expect(appearanceIsBetter(weak,finished)).toBe(true);
    expect(appearanceCanImprove(finished,weak)).toBe(false);
  });
  it('retains a real compiled repair only after a fresh review and anonymous comparison',async()=>{
    vi.spyOn(Math,'random').mockReturnValue(.1);
    const fetch=vi.fn().mockResolvedValueOnce(reply(patch)).mockResolvedValueOnce(reply({preferred:'A',reason:'The upper contour tapers.'}));vi.stubGlobal('fetch',fetch);
    const judge=vi.fn().mockResolvedValue(after),r=await refineAppearance(build,before,idea,stock,{minParts:20,views,judge});
    expect(r.improved).toBe(true);expect(r.edit?.receipts[0].studyId).toBe('pointed-muzzle');
    expect(judge).toHaveBeenCalledTimes(1);
    const comparison=JSON.parse(fetch.mock.calls[1][1].body).contents;
    expect(JSON.stringify(comparison)).not.toContain('Bird');
    expect(JSON.parse(fetch.mock.calls[0][1].body).contents[0].parts[0]).toHaveProperty('inlineData');
  });
  it('keeps the original on a tie or worse independent review',async()=>{
    const fetch=vi.fn().mockResolvedValueOnce(reply(patch)).mockResolvedValueOnce(reply({preferred:'tie',reason:'No clear visual improvement.'}));vi.stubGlobal('fetch',fetch);
    const r=await refineAppearance(build,before,idea,stock,{minParts:20,views,judge:async()=>after});
    expect(r.improved).toBe(false);expect(r.build).toBe(build);
  });
  it('returns the original after two invalid patches without asking the judge',async()=>{
    const fetch=vi.fn().mockImplementation(async()=>reply({...patch,add:[{...patch.add[0],parent:'p99'}]}));vi.stubGlobal('fetch',fetch);
    const judge=vi.fn(),r=await refineAppearance(build,before,idea,stock,{minParts:20,views,judge});
    expect(r.build).toBe(build);expect(fetch).toHaveBeenCalledTimes(2);expect(judge).not.toHaveBeenCalled();
  });
  it('cancellation prevents accepting or reviewing the returned patch',async()=>{
    const controller=new AbortController(),fetch=vi.fn().mockImplementation(async()=>{controller.abort();return reply(patch);});vi.stubGlobal('fetch',fetch);
    const judge=vi.fn();
    await expect(refineAppearance(build,before,idea,stock,{minParts:20,views,judge,signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});
    expect(judge).not.toHaveBeenCalled();
  });
});
