import { describe, expect, it } from 'vitest';
import { BUILD_ATLAS } from './catalog';
import { assessBrief, ideaFromAssessment } from './matching';
import { atlasShortlist, attachCatalogKnowledge, shortlistText } from './selection';

describe('honest opportunity evidence in atlas selection',()=>{
  it('includes exact IDs, body reserves, carrier evidence and scan caveats in the shortlist prompt',()=>{
    const b={...BUILD_ATLAS[0],colors:[{role:'body',colors:['black'],share:1,natural:true}],features:[{name:'Contour',types:['curve'],count:1,required:true,substitution:'Use a real shaped contour.'}]},stock={'brick-2x2-black':30,'curve-1x2-black':1};
    const a=assessBrief(b,stock),prompt=shortlistText([a]);
    expect(prompt).toContain('curve-1x2-black');expect(prompt).toContain('bodyReserve');expect(prompt).toContain('geometryUnchecked');expect(prompt).toContain('inventory-opportunity-estimate');expect(prompt).toContain('not certainty');
    const hydrated=attachCatalogKnowledge({...ideaFromAssessment(a,stock),atlasId:b.id},[a],stock);
    expect(hydrated.opportunity).toBe(a.opportunity);
  });
  it('accepts optional original confidence without dropping the full catalog',()=>{
    const stock={'brick-2x2-black':40,'curve-1x2-black':4},list=atlasShortlist('pile',stock,[],12,{confidence:{'brick-2x2-black':.8,'curve-1x2-black':.3}});
    expect(list).toHaveLength(12);expect(BUILD_ATLAS).toHaveLength(2000);expect(list.every(a=>a.opportunity?.evidence==='inventory-opportunity-estimate')).toBe(true);
    expect(list.some(a=>(a.opportunity?.confidence.knownPieces??0)>0)).toBe(true);
  });
});
