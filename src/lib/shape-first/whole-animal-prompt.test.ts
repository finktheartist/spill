import {describe,it,expect} from 'vitest';
import large from '../fixtures/large-pile-stock.json';
import {definition} from '../connections';
import {parsePartId} from '../bricks';
import {wholeAnimalStock,wholeAnimalCatalog,wholeAnimalPrinciples} from './whole-animal-prompt';

describe('complete-inventory MOC design context',()=>{
 it('keeps body material available before features are designed and excludes unsupported raw IDs',()=>{
  const stock=wholeAnimalStock(large.stock);
  expect(stock['roundbrick-1x1-tan']).toBe(4);expect(stock['plate-2x8-reddish-brown']).toBe(3);
  expect(stock['tile-2x3-tan']).toBe(1);expect(stock['plate-3x8-dark-gray']).toBeUndefined();expect(stock['slope-2x2-black']).toBe(2);
  expect(large.stock['roundbrick-1x1-tan']).toBe(4);
 });
 it('compresses ordinary grid ports without changing actual axes, heights or port identities',()=>{
  const catalog=wholeAnimalCatalog({'plate-1x3-tan':1,'brick-1x2-reddish-brown':2,'tile-1x2-tan':1,'curve-1x2-black':2});
  expect(catalog.find(s=>s.shape==='plate-1x3')?.sizeStuds).toEqual([3,1,.4]);
  expect(catalog.find(s=>s.shape==='curve-1x2')?.sizeStuds).toEqual([1,2,.8]);
  for(const entry of catalog){
   const id=Object.keys(entry.ids)[0],actual=definition(parsePartId(id)!).ports;
   if(entry.gridPorts){const g=entry.gridPorts as {columns:number;rows:number;studs:boolean;grips:boolean},height=(entry.sizeStuds as number[])[2];
    const expected=[];for(let x=0;x<g.columns;x++)for(let y=0;y<g.rows;y++)for(const kind of ['grip','stud'])if(kind==='grip'?g.grips:g.studs)expected.push({id:`${kind}:${x}:${y}`,kind,pointStuds:[x+.5,y+.5,kind==='grip'?0:height],normal:[0,0,kind==='grip'?-1:1]});
    expect(expected.map(p=>p.id).sort()).toEqual(actual.map(p=>p.id).sort());
    for(const p of expected){const actualPort=actual.find(q=>q.id===p.id)!;expect(p.pointStuds).toEqual(actualPort.point.map(n=>n/20));expect(p.normal).toEqual(actualPort.normal);}
   }else expect(entry.ports).toEqual(actual.map(p=>({id:p.id,kind:p.kind,pointStuds:p.point.map(n=>n/20),normal:p.normal})));
  }
 });
 it('rejects malformed stock and explicitly permits whole-body rebuilding without complete-model examples',()=>{
  for(const bad of [null,[],{'brick-1x2-reddish-brown':-1},{'brick-1x2-reddish-brown':1.5}])expect(()=>wholeAnimalStock(bad as Record<string,number>)).toThrow();
  const text=wholeAnimalPrinciples(large.stock,'Fennec fox',40);
  expect(text).toContain('There is NO fixed body');expect(text).toContain('40–80 purposeful pieces');expect(text).toContain('ORIGINAL complete inventory');
  expect(text).not.toContain('authored-low');expect(text).not.toContain('animal-craft:');
 });
});
