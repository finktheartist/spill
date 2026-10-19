import {describe,expect,it} from 'vitest';
import saved from '../../test/fixtures/photo-stock.json';
import {readInventorySnapshot} from './inventory-snapshot';
import {counts,proposedCounts,totalParts} from './inventory';
describe('saved scan ledger import',()=>{
 it('retains the whole 252-piece saved inventory without claiming new photos or physical confirmation',()=>{
  const inv=readInventorySnapshot(saved);expect(totalParts(inv)).toBe(252);expect(proposedCounts(inv)).toEqual(saved.stock);expect(counts(inv)).toEqual({});expect(inv.photos).toEqual([]);expect(inv.source).toBe('photo');expect(Object.values(inv.parts).every(p=>p.confidence===.5)).toBe(true);
 });
 it('rejects malformed or oversized ledgers rather than changing counts',()=>{
  for(const stock of [{},{'brick-1x1-black':NaN},{'brick-1x1-black':2001},{'unknown-1x1-black':1}])expect(()=>readInventorySnapshot({stock})).toThrow();
 });
});
