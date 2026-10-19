import {expect,it} from 'vitest';
import {photoCrop} from './photo-crop';

it('uses normalized y/x coordinates in landscape and portrait photos',()=>{
 const landscape=photoCrop(2000,1000,[200,300,400,400],300)!;
 expect(landscape.source).toEqual([550,150,300,300]);expect(landscape.outline).toEqual([50,50,200,200]);
 const portrait=photoCrop(1000,2000,[300,200,400,400],300)!;
 expect(portrait.source).toEqual([150,550,300,300]);expect(portrait.outline).toEqual([50,50,200,200]);
});
it('clips photo-edge padding without stretching or shifting the outlined piece',()=>{
 const p=photoCrop(1000,1000,[0,0,100,100],150)!;
 expect(p.source).toEqual([0,0,125,125]);expect(p.destination).toEqual([25,25,125,125]);expect(p.outline).toEqual([25,25,100,100]);
 const end=photoCrop(1000,1000,[900,900,1000,1000],150)!;
 expect(end.source).toEqual([875,875,125,125]);expect(end.destination).toEqual([0,0,125,125]);expect(end.outline).toEqual([25,25,100,100]);
});
it('rejects invalid/absent geometry instead of manufacturing a thumbnail',()=>{
 for(const b of [[0,0,0,10],[-1,0,20,20],[0,0,1001,20],[0,NaN,20,20]] as [number,number,number,number][])expect(photoCrop(1000,1000,b,144)).toBeNull();
 expect(photoCrop(0,1000,[0,0,20,20],144)).toBeNull();expect(photoCrop(1000,1000,[0,0,20,20],Infinity)).toBeNull();
});
