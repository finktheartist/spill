import {expect,it} from 'vitest';
import {normalizeCatalogQuery as norm,searchPartsCatalog,type CatalogPart,type PartsCatalog} from './parts-search';

function part(num:string,name:string,category:string,extra:Partial<CatalogPart>={}):CatalogPart {
  const p:CatalogPart={num,name,category,pop:1,look:null,colors:[19],elements:[],identifiers:[num],words:'',...extra};
  p.words=norm(`${p.name} ${p.identifiers.join(' ')} ${p.category}`);return p;
}
function catalog(parts:CatalogPart[]):PartsCatalog {
  return {parts,colorIds:{tan:19,red:4},catalog:{totalParts:parts.length,searchableParts:parts.length,nativeParts:parts.filter(p=>p.shape).length,snapshotDate:'2026-10-07',snapshotDateSource:'local-downloaded-label',freshness:'local-snapshot-not-live-verified',excludes:[],nativeMapping:'exact-rebrickable-part-number'}};
}
const query=(data:PartsCatalog,q:string,extra:Record<string,string>={})=>searchPartsCatalog(data,new URLSearchParams({q,...extra}));

it('normalizes compact/spaced x, X and multiplication signs identically',()=>{
  for(const input of ['1x2','1 x 2','1X2','1×2','1 × 2'])expect(norm(input)).toBe('1 x 2');
  expect(norm(' Plate 1×2×3! ')).toBe(norm('plate 1x2x3'));
  const data=catalog([part('a','Plate 1 x 2','Plates'),part('b','Plate 1 × 2','Plates'),part('c','Plate 1 x 20','Plates')]);
  for(const text of ['1x2','1 × 2','2×1'])expect(query(data,text).parts.map(p=>p.num)).toEqual(['a','b']);
});
it('keeps every supplied category and printed/special record searchable without granting native geometry',()=>{
  const data=catalog([part('3004','Brick 1 x 2','Bricks',{shape:'brick-1x2',look:'brick-1x2'}),part('3004pr001','Brick 1 x 2 with Print','Bricks'),part('3004b','Brick 1 x 2 Variant','Bricks'),part('hat','Minifig Hat','Minifig Accessories'),part('stick','Sticker Sheet','Stickers'),part('large','Duplo Brick','Duplo'),part('tail','Special Tail','Animal Parts')]);
  expect(query(data,'').count).toBe(7);
  for(const text of ['print','variant','minifig','sticker','duplo','tail'])expect(query(data,text).count).toBe(1);
  for(const num of ['3004pr001','3004b']){
    const result=query(data,num).parts[0];expect(result.num).toBe(num);expect(result.shape).toBeUndefined();expect(result.look).toBeNull();
  }
  expect(query(data,'3004').parts[0].shape).toBe('brick-1x2');
});
it('promotes exact part numbers, then exact element IDs, then retains supplied rank',()=>{
  const data=catalog([part('90001','Part 3004 Example','Bricks',{pop:999}),part('element-owner','Special Brick','Special',{identifiers:['element-owner','3004']}),part('3004','Brick 1 x 2','Bricks',{shape:'brick-1x2',look:'brick-1x2'}),part('3004pr001','Printed Brick','Bricks')]);
  expect(query(data,'3004').parts.map(p=>p.num)).toEqual(['3004','element-owner','90001','3004pr001']);
  const first=query(data,'3004',{limit:'2'}),next=query(data,'3004',{limit:'2',offset:'2'});
  expect(first.nextOffset).toBe(2);expect(next.parts.map(p=>p.num)).toEqual(['90001','3004pr001']);expect(next.nextOffset).toBeNull();
});
it('finds exact elements on their actual owner without turning them into a native part-number alias',()=>{
  const data=catalog([part('special','Unknown Mold','Special',{identifiers:['special','6513964']})]);
  const out=query(data,'6513964');expect(out.count).toBe(1);expect(out.parts[0]).toMatchObject({num:'special',look:null});expect(out.parts[0].shape).toBeUndefined();
});
it('returns complete nonoverlapping pages with matched counts distinct from catalog totals',()=>{
  const data=catalog(Array.from({length:9},(_,i)=>part(String(i),i<7?'Curved Piece':'Plain Brick','Parts')));
  const a=query(data,'curved',{limit:'3'}),b=query(data,'curved',{limit:'3',offset:String(a.nextOffset)}),c=query(data,'curved',{limit:'3',offset:String(b.nextOffset)});
  expect([a,b,c].map(p=>p.parts.length)).toEqual([3,3,1]);expect(new Set([...a.parts,...b.parts,...c.parts].map(p=>p.num)).size).toBe(7);
  for(const page of [a,b,c]){expect(page.count).toBe(7);expect(page.total).toBe(9);expect(page.catalog).toBe(data.catalog);}
  expect(c.hasMore).toBe(false);expect(c.nextOffset).toBeNull();expect(query(data,'curved',{offset:'20'}).parts).toEqual([]);
});
it('uses color only for preview selection and retains incompatible or unknown-color records',()=>{
  const data=catalog([part('red-only','Red Mold','Special',{colors:[4]}),part('tan','Tan Mold','Parts'),part('none','Unrecorded Colors','Parts',{colors:[]})]);
  const out=query(data,'',{color:'tan'});expect(out.count).toBe(3);
  expect(out.parts.map(p=>[p.num,p.img,p.inColor])).toEqual([['red-only','/api/part-image/red-only?c=4',false],['tan','/api/part-image/tan?c=19',true],['none','/api/part-image/none?c=71',false]]);
  expect(query(data,'',{color:'unknown-color'}).parts).toHaveLength(3);
});
it('preserves defaults and hard pagination caps while rejecting malformed requests',()=>{
  const data=catalog([]);expect(query(data,'')).toMatchObject({offset:0,limit:40,count:0,total:0,hasMore:false,nextOffset:null});
  expect(query(data,'',{limit:'10000'}).limit).toBe(80);
  const malformed:Record<string,string>[]=[{limit:'0'},{limit:'-1'},{limit:'1.5'},{limit:'NaN'},{limit:'Infinity'},{limit:''},{offset:'-1'},{offset:'1e2'},{offset:'1000001'},{offset:'9007199254740992'}];
  for(const params of malformed)expect(()=>query(data,'',params)).toThrow(RangeError);
  expect(()=>query(data,'x'.repeat(257))).toThrow(/256/);
  expect(query(data,'',{offset:'1000000'}).parts).toEqual([]);
});
it('does not mutate the catalog or query, leak internal indexes, or infer shape from descriptive names',()=>{
  const data=catalog([part('strange/mold','Brick 1 x 2 Lookalike','Bricks',{identifiers:['strange/mold','999'],elements:['999']})]),params=new URLSearchParams('q=brick&color=tan'),saved=structuredClone(data);
  const result=searchPartsCatalog(data,params);expect(data).toEqual(saved);expect(params.toString()).toBe('q=brick&color=tan');
  expect(result.parts[0]).toMatchObject({num:'strange/mold',look:null,img:'/api/part-image/strange%2Fmold?c=19'});
  for(const key of ['words','identifiers','elements','colors'])expect(result.parts[0]).not.toHaveProperty(key);
});
