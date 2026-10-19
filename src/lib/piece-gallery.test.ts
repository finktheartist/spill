import {describe,it,expect} from 'vitest';
import {viablePieceGallery} from './piece-gallery';
import {isMade} from './catalog';
import {definition} from './connections';
describe('exact piece gallery',()=>{
 it('provides pages of manufactured native pieces and reaches the last page',()=>{
  const first=viablePieceGallery({color:'red'});expect(first.total).toBeGreaterThan(24);
  const all=Array.from({length:Math.ceil(first.total/24)},(_,page)=>viablePieceGallery({color:'red',offset:page*24}).parts).flat();
  expect(new Set(all.map(k=>k.partId)).size).toBe(first.total);
  for(const k of all){expect(isMade(k.partId)).toBe(true);expect(()=>definition(k)).not.toThrow();expect(k.color).toBe('red');}
 });
 it('filters by exact family and searches familiar size spelling or part number',()=>{
  const result=viablePieceGallery({type:'brick',color:'red',query:'2 x 4'});expect(result.parts.map(k=>k.partId)).toContain('brick-2x4-red');expect(result.parts.every(k=>k.type==='brick')).toBe(true);
  expect(viablePieceGallery({color:'red',query:'3001'}).parts.map(k=>k.partId)).toContain('brick-2x4-red');
 });
 it('rejects unknown color and bounds nonfinite pagination',()=>{
  expect(viablePieceGallery({color:'imaginary'}).total).toBe(0);expect(viablePieceGallery({offset:NaN,limit:Infinity}).parts.length).toBe(24);
 });
});
