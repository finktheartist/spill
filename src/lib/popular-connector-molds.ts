import type {PopularMold, MoldPrism, MoldPort, MoldPoint} from './popular-mold-types';

/** Six distinct exact molds from official LDraw source. No bracket or sidebrick
 * aliasing: each has its own manufactured identity, planes and nominal bounds.
 * Source transforms/pins in tests. Cosmetic corners/cavities are conservatively
 * filled, and hollow studs do not supply bar or axle connections. */
const point=(p:MoldPoint):MoldPoint=>Object.freeze([...p] as [number,number,number]);
const box=(min:MoldPoint,max:MoldPoint):MoldPrism=>Object.freeze({axis:'z',min:min[2],max:max[2],
 polygon:Object.freeze([[min[0],min[1]],[max[0],min[1]],[max[0],max[1]],[min[0],max[1]]].map(p=>Object.freeze(p) as readonly[number,number]))});
const port=(id:string,kind:'stud'|'grip',p:MoldPoint,n:MoldPoint,open=false):MoldPort=>Object.freeze({id,kind,point:point(p),normal:point(n),...(open?{open:true}:{})});
const limitations=Object.freeze(['Nominal exterior; cosmetic rounded corners and interior cavities are conservatively filled.','Only listed stud/socket mating is qualified; no stud bore, bar, pin, axle, friction, flex or moving joint.']);
function bracket(num:string,width:number,up:boolean,tall:boolean):PopularMold {
 const H=tall?40:20,W=width*20,top=up?8:H,bottom=top-8;
 const solids=Object.freeze([box([0,0,0],[W,4,H]),box([0,4,bottom],[W,24,top])]);
 const xs=Array.from({length:width},(_,i)=>10+20*i),rows=tall?[10,30]:[10];
 const ports=Object.freeze([
  ...xs.map((x,i)=>port(`stud:${i}:0`,'stud',[x,14,top],[0,0,1])),
  ...xs.map((x,i)=>port(`grip:${i}:0`,'grip',[x,14,bottom],[0,0,-1])),
  ...rows.flatMap((z,row)=>xs.map((x,i)=>port(`side:${row*width+i}`,'stud',[x,0,z],[0,-1,0],true))),
 ]);
 return Object.freeze({num,type:`mold${num}` as `mold${number}`,w:1,d:width,name:`Bracket 1 × ${width} — ${tall?2:1} × ${width} ${up?'inverted':'down'}`,
  widthLdu:W,depthLdu:24,heightPlates:H/8,solids,render:solids,ports,sources:Object.freeze([`${num}.dat`]),limitations});
}
const tallSide:PopularMold=(()=>{
 const solids=Object.freeze([box([0,0,0],[20,20,40])]);
 return Object.freeze({num:'32952',type:'mold32952',w:1,d:1,name:'Brick 1 × 1 × 1⅔ with two side studs',widthLdu:20,depthLdu:20,heightPlates:5,solids,render:solids,
  ports:Object.freeze([port('stud:0:0','stud',[10,10,40],[0,0,1]),port('grip:0:0','grip',[10,10,0],[0,0,-1]),
    port('side:0','stud',[10,0,10],[0,-1,0],true),port('side:1','stud',[10,0,30],[0,-1,0],true)]),sources:Object.freeze(['32952.dat']),limitations});
})();
const steppedSide:PopularMold=(()=>{
 const solids=Object.freeze([box([0,0,0],[40,20,16]),box([0,20,0],[40,40,8])]);
 return Object.freeze({num:'99206',type:'mold99206',w:2,d:2,name:'Stepped plate 2 × 2 with two raised and two side studs',widthLdu:40,depthLdu:40,heightPlates:2,solids,render:solids,
  ports:Object.freeze([
    ...[10,30].flatMap((x,i)=>[port(`stud:${i}:0`,'stud',[x,10,16],[0,0,1]),port(`stud:${i}:1`,'stud',[x,30,8],[0,0,1]),
      port(`grip:${i}:0`,'grip',[x,10,0],[0,0,-1]),port(`grip:${i}:1`,'grip',[x,30,0],[0,0,-1]),port(`side:${i}`,'stud',[x,0,10],[0,-1,0],true)]),
  ]),sources:Object.freeze(['99206.dat','s/99206s01.dat']),limitations});
})();
export const POPULAR_CONNECTOR_MOLDS:readonly PopularMold[]=Object.freeze([
 bracket('99207',2,true,true),bracket('44728',2,false,true),bracket('36840',1,true,false),bracket('73825',1,true,true),steppedSide,tallSide,
]);
