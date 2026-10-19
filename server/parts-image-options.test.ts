import {expect,it} from 'vitest';
import {catalogImageOptions,normalizeCatalogQuery,searchPartsCatalog,type CatalogPart,type PartsCatalog} from './parts-search';

const cdn='https://cdn.rebrickable.com/media/parts';
const render=(num:string,color:number)=>`${cdn}/ldraw/${color}/${num}.png`;
const element=(id:string)=>`${cdn}/elements/${id}.jpg`;
const part=(extra:Partial<CatalogPart>={}):CatalogPart=>{
 const p:CatalogPart={num:'3004',name:'Brick 1 x 2',category:'Bricks',pop:1,shape:'brick-1x2',look:'brick-1x2',words:'',colors:[19,4,0,15,1],elements:['300421','300401','300426','300423','300424'],identifiers:['3004'],...extra};
 p.words=normalizeCatalogQuery(`${p.name} ${p.identifiers.join(' ')} ${p.category}`);return p;
};
const data=(parts:CatalogPart[]):PartsCatalog=>({parts,colorIds:{tan:19,red:4,blue:1},catalog:{totalParts:parts.length,searchableParts:parts.length,nativeParts:parts.filter(p=>p.shape).length,snapshotDate:'2026-10-07',snapshotDateSource:'local-downloaded-label',freshness:'local-snapshot-not-live-verified',excludes:[],nativeMapping:'exact-rebrickable-part-number'}});

it('uses the exact part number for every render and only that record’s saved elements',()=>{
 const p=part({num:'3861b',shape:undefined,look:null,elements:['1234567']}),images=catalogImageOptions(p,4);
 expect(images.map(i=>i.url)).toEqual([render('3861b',4),render('3861b',19),render('3861b',0),render('3861b',15),element('1234567')]);
 expect(images.some(i=>i.url.endsWith('/3861a.png')||i.url.endsWith('/3861.png'))).toBe(false);
 expect(images.every(i=>new URL(i.url).origin==='https://cdn.rebrickable.com')).toBe(true);
});
it('orders the selected color, at most three other actual colors, then saved element photos, bounded to eight',()=>{
 const images=catalogImageOptions(part(),4);
 expect(images).toHaveLength(8);
 expect(images.map(i=>i.url)).toEqual([render('3004',4),render('3004',19),render('3004',0),render('3004',15),element('300421'),element('300401'),element('300426'),element('300423')]);
 expect(images[0].label).toContain('requested color 4');
 expect(images.slice(1,4).every(i=>i.label.includes('other saved color'))).toBe(true);
 expect(images.slice(4).every(i=>i.label.includes('color may differ'))).toBe(true);
});
it('dedupes repeated colors and elements without wasting the eight slots',()=>{
 const p=part({colors:[19,19,4,4,0,15,1],elements:['123','123','456','456','789','111','222']}),images=catalogImageOptions(p,19);
 expect(images.map(i=>i.url)).toEqual([render('3004',19),render('3004',4),render('3004',0),render('3004',15),element('123'),element('456'),element('789'),element('111')]);
 expect(new Set(images.map(i=>i.url)).size).toBe(8);
});
it('never invents an unavailable requested render color and labels its actual selected color honestly',()=>{
 const images=catalogImageOptions(part({colors:[19,4],elements:[]}),1);
 expect(images.map(i=>i.url)).toEqual([render('3004',19),render('3004',4)]);
 expect(images[0].label).toContain('saved color 19');expect(images[0].label).toContain('requested color unavailable');
 expect(images[1].label).toContain('other saved color 4');
 expect(catalogImageOptions(part({colors:[4],elements:[]}))[0].label).toBe('Render — saved color 4');
});
it('uses existing fallback 71 only when no valid saved colors exist and makes no color-match claim',()=>{
 const images=catalogImageOptions(part({colors:[],elements:['1234567']}),4);
 expect(images.map(i=>i.url)).toEqual([render('3004',71),element('1234567')]);
 expect(images[0].label).toContain('fallback color 71');expect(images[0].label).toContain('no saved color recorded');
 expect(catalogImageOptions(part({colors:[],elements:[]}),71)[0].label).not.toContain('requested color');
});
it('rejects malformed mold IDs and cannot form arbitrary URLs',()=>{
 for(const num of ['','../3004','..','3004/other','https://example.com/a','3004?c=1','3004#fragment','3004%2Fother','3004\n','a'.repeat(81)])expect(catalogImageOptions(part({num}))).toEqual([]);
 expect(catalogImageOptions(part({num:'003381',colors:[0],elements:[]}))[0].url).toBe(render('003381',0));
});
it('omits malformed colors/elements while keeping valid exact candidates in saved order',()=>{
 const p=part({colors:[19,-1,NaN,Infinity,1.5,'4',0] as unknown as number[],elements:['../bad','https://example.com/a','123?x=1','123#x','1/2','a123','123456789012345678901','123',123 as unknown as string]});
 expect(catalogImageOptions(p,4).map(i=>i.url)).toEqual([render('3004',19),render('3004',0),element('123')]);
 expect(catalogImageOptions(part({colors:null as unknown as number[]}))).toEqual([]);
 for(const requested of [NaN,Infinity,-1,1.2])expect(catalogImageOptions(part({colors:[19],elements:[]}),requested)[0].url).toBe(render('3004',19));
});
it('returns distinct printed/variant candidates without borrowing another row’s render or element IDs',()=>{
 const base=part({colors:[19],elements:['300421']}),variant=part({num:'3004pr0001',name:'Printed Brick',shape:undefined,look:null,colors:[4],elements:['9999999'],identifiers:['3004pr0001']});
 const result=searchPartsCatalog(data([base,variant]),new URLSearchParams('q=3004pr0001&color=tan'));
 expect(result.parts).toHaveLength(1);expect(result.parts[0]).toMatchObject({num:'3004pr0001',look:null,inColor:false,img:'/api/part-image/3004pr0001?c=4'});
 expect(result.parts[0].images.map(i=>i.url)).toEqual([render('3004pr0001',4),element('9999999')]);expect(result.parts[0].shape).toBeUndefined();
});
it('adds image options without changing count, ranking, pagination or compatible img/inColor fields',()=>{
 const parts=Array.from({length:5},(_,i)=>part({num:String(3004+i),colors:[19],elements:[],identifiers:[String(3004+i)]})),catalog=data(parts),saved=structuredClone(catalog);
 const a=searchPartsCatalog(catalog,new URLSearchParams('limit=2&offset=0&color=tan')),b=searchPartsCatalog(catalog,new URLSearchParams('limit=2&offset=2&color=tan')),c=searchPartsCatalog(catalog,new URLSearchParams('limit=2&offset=4&color=tan'));
 expect(a).toMatchObject({count:5,total:5,offset:0,limit:2,nextOffset:2,hasMore:true});expect(b.nextOffset).toBe(4);expect(c).toMatchObject({nextOffset:null,hasMore:false});
 expect([...a.parts,...b.parts,...c.parts].map(p=>p.num)).toEqual(parts.map(p=>p.num));
 for(const row of [...a.parts,...b.parts,...c.parts]){expect(row.img).toBe(`/api/part-image/${row.num}?c=19`);expect(row.inColor).toBe(true);expect(row.images[0].url).toBe(render(row.num,19));}
 expect(catalog).toEqual(saved);
});
