import { describe, expect, it, vi } from 'vitest';
import * as connections from '../connections';
import { BUILD_ATLAS } from './catalog';
import { assessAtlas, assessBrief, searchAssessments } from './matching';
import { createOpportunityContext } from './opportunity';
import type { AtlasAssessment, BuildBrief } from './types';

const stock={'brick-2x2-black':30,'curve-1x2-black':2};
const b:BuildBrief={...BUILD_ATLAS[0],id:'strong',name:'Useful contour',family:'objects',categoryId:'shared',parts:[20,50],colors:[{role:'body',colors:['black'],share:1,natural:true}],features:[{name:'Contour',types:['curve'],count:2,required:true,substitution:'Use a real alternative contour.'}]};

describe('evidence-first atlas matching',()=>{
  it('precomputes stock geometry once for a complete 2000-subject scan without generation',()=>{
    const expected=createOpportunityContext(stock).parts.length;
    const inspect=vi.spyOn(connections,'definition'),fetch=vi.spyOn(globalThis,'fetch');
    const all=assessAtlas(stock);expect(all).toHaveLength(2000);expect(inspect).toHaveBeenCalledTimes(expected);
    expect(fetch).not.toHaveBeenCalled();inspect.mockRestore();fetch.mockRestore();
  });
  it('does not let a weak family fill a diversity slot ahead of materially better fit',()=>{
    const strong=assessBrief(b,stock),same={...strong,brief:{...b,id:'strong-two',name:'Second strong object'},score:strong.score-1};
    const weak:AtlasAssessment={...strong,brief:{...b,id:'weak',name:'Weak animal',family:'animals',categoryId:'other'},score:strong.score-30};
    const ordered=searchAssessments([weak,same,strong],{limit:3}).matches;
    expect(ordered.slice(0,2).map(a=>a.brief.id)).toEqual(['strong','strong-two']);expect(ordered[2].brief.id).toBe('weak');
    const blocked={...weak,score:100,status:'needs-parts' as const,opportunity:{...weak.opportunity!,tier:'blocked' as const}};
    expect(searchAssessments([blocked,strong],{limit:1}).matches[0].brief.id).toBe('strong');
  });
  it('keeps diversity and pagination among similarly supported opportunities',()=>{
    const a=assessBrief(b,stock),items=Array.from({length:6},(_,i)=>({...a,brief:{...b,id:`id-${i}`,name:`Candidate ${i}`,categoryId:`category-${i%2}`,family:i%2?'animals' as const:'objects' as const},score:80}));
    const first=searchAssessments(items,{limit:3}).matches,next=searchAssessments(items,{offset:3,limit:3}).matches;
    expect(new Set(first.slice(0,2).map(a=>a.brief.family)).size).toBe(2);expect(new Set([...first,...next].map(a=>a.brief.id)).size).toBe(6);
  });
  it('exposes exact receipts rather than using unsupported counts or unreserved feature IDs',()=>{
    const a=assessBrief(b,{'plate-3x8-dark-gray':100,'tile-2x3-black':100});
    expect(a.status).toBe('needs-parts');expect(a.opportunity?.receipts[0].allocated).toBe(0);expect(a.opportunity?.bodyReserve.available).toBe(0);
  });
});
