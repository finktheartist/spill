import {describe,expect,it} from 'vitest';
import {addPart,emptyInventory} from '../inventory';
import {parsePartId} from '../bricks';
import {recommendationStockKey,stockEvidence} from './stock-evidence';

describe('photo evidence for subject recommendations',()=>{
 it('preserves scanner confidence without passing photo locations or claiming confirmation',()=>{
  let inv=addPart(emptyInventory(),parsePartId('slope-2x2-black')!,2,{photo:1,box:[0,0,100,100]},.62);
  inv={...inv,photos:[{id:1,url:'private-photo-location'}]};
  const evidence=stockEvidence(inv);
  expect(evidence).toEqual({source:'photo',confidenceById:{'slope-2x2-black':.62}});
  expect(JSON.stringify(evidence)).not.toContain('private-photo-location');
  inv.parts['slope-2x2-black'].confidence=1;
  expect(evidence.confidenceById['slope-2x2-black']).toBe(.62);
 });
 it('does not turn malformed evidence into reliable identification',()=>{
  const inv=addPart(emptyInventory(),parsePartId('curve-1x2-black')!,2);
  for(const invalid of [NaN,Infinity,-1,1.2]){
   inv.parts['curve-1x2-black'].confidence=invalid;
   expect(stockEvidence(inv).confidenceById).toEqual({});
  }
 });
 it('invalidates a recommendation when confidence changes without changing stock counts',()=>{
  const stock={'slope-2x2-black':2};
  const old={source:'photo' as const,confidenceById:{'slope-2x2-black':.6}};
  const corrected={...old,confidenceById:{'slope-2x2-black':1}};
  expect(recommendationStockKey(stock,old)).not.toBe(recommendationStockKey(stock,corrected));
  expect(recommendationStockKey(stock,old)).not.toBe(recommendationStockKey(stock,{...old,source:'sample'}));
 });
 it('ignores evidence order and IDs that cannot participate in this inventory',()=>{
  const stock={'slope-2x2-black':2,'curve-1x2-black':2};
  const first={source:'photo' as const,confidenceById:{'slope-2x2-black':.7,'curve-1x2-black':.9}};
  const second={source:'photo' as const,confidenceById:{'curve-1x2-black':.9,'slope-2x2-black':.7,'plate-1x2-red':.1}};
  expect(recommendationStockKey(stock,first)).toBe(recommendationStockKey(stock,second));
 });
});
