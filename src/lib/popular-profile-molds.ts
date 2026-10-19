/** Exact nominal source profiles, CC BY 4.0 LDraw; raw source attribution and
 * complete SHA pins live in study/sources/popular-profile-20261016. Cavities
 * are conservatively filled; qualified ports do not simulate clutch strength.
 * Data only: no rendering library, inventory, color or runtime physics imports. */
import type {PopularMold,MoldPrism,MoldPort,MoldXY,MoldPoint,MoldHull} from './popular-mold-types';

type XY=readonly[number,number];
const polygon=(ps:readonly XY[]):readonly MoldXY[]=>Object.freeze(ps.map(p=>Object.freeze([...p] as [number,number])));
const prism=(width:number,ps:readonly XY[]):MoldPrism=>Object.freeze({axis:'x',min:0,max:width,polygon:polygon(ps)});
const port=(kind:MoldPort['kind'],id:string,point:MoldPoint,open=false):MoldPort=>Object.freeze({id,kind,point:Object.freeze([...point] as [number,number,number]),normal:Object.freeze([0,0,kind==='stud'?1:-1] as [number,number,number]),...(open?{open:true}:{})});
const grid=(width:number,ys:readonly number[],z:number,kind:MoldPort['kind']):MoldPort[]=>Array.from({length:width/20},(_,x)=>ys.map((y,row)=>port(kind,`${kind}:${x}:${row}`,[10+20*x,y,z]))).flat();
function make(num:string,w:number,d:number,width:number,depth:number,height:number,name:string,
 profile:readonly XY[],ports:readonly MoldPort[],sections:readonly (readonly XY[])[]=[profile],limitations:readonly string[]=[]):PopularMold {
 return Object.freeze({num,type:`mold${num}` as `mold${number}`,w,d,name,widthLdu:width,depthLdu:depth,heightPlates:height,
  solids:Object.freeze(sections.map(s=>prism(width,s))),render:Object.freeze([prism(width,profile)]),ports:Object.freeze([...ports]),
  sources:Object.freeze([`study/sources/popular-profile-20261016/${num}.dat`]),
  limitations:Object.freeze(['Nominal exterior; internal clutch cavities conservatively filled. Stud/grip ports only; no tube bore, bar, strength or motion qualification.',...limitations])});
}

// 4286: raw [X,Y,Z] -> [X+10,Z+50,24-Y]. One source stud at raw0.
const slope33one=make('4286',1,3,20,60,3,'Slope brick 33 degrees 3 x 1',
 [[0,0],[60,0],[60,24],[40,24],[0,4]],
 [...grid(20,[50],24,'stud'),...grid(20,[10,30,50],0,'grip')]);
// 3298: [X+20,Z+50,24-Y]; source high row rawX=-10,+10,Z0.
const slope33two=make('3298',2,3,40,60,3,'Slope brick 33 degrees 3 x 2',
 [[0,0],[60,0],[60,24],[40,24],[0,4]],
 [...grid(40,[50],24,'stud'),...grid(40,[10,30,50],0,'grip')]);
// 60481 is an official moved-to alias for 60481a, symmetric stud holder.
// [X+10,Z+30,48-Y]; the exact alias chain is pinned, no nearest-mold mapping.
const slope65=make('60481',1,2,20,40,6,'Slope brick 65 degrees 2 x 1 x 2',
 [[0,0],[40,0],[40,48],[20,48],[0,4]],
 [...grid(20,[30],48,'stud'),...grid(20,[10,30],0,'grip')]);

// Exact normal-resolution and 48-resolution source circle coordinates. These
// are source facets, not fitted curves or additional smooth tessellation.
const quarter:readonly XY[]=[[1,0],[.9239,.3827],[.7071,.7071],[.3827,.9239],[0,1]];
const quarter48:readonly XY[]=[[1,0],[.9914,.1305],[.9659,.2588],[.9239,.3827],[.866,.5],[.7934,.6088],[.7071,.7071],[.6088,.7934],[.5,.866],[.3827,.9239],[.2588,.9659],[.1305,.9914],[0,1]];
function at(points:readonly XY[],y:number):XY {
 const existing=points.find(p=>p[0]===y);if(existing)return existing;
 for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i];if(a[0]<y&&y<b[0])return [y,a[1]+(b[1]-a[1])*(y-a[0])/(b[0]-a[0])];}
 throw Error('Source profile partition outside its domain');
}
const unique=(ps:readonly XY[]):XY[]=>ps.filter((p,i)=>!i||p[0]!==ps[i-1][0]||p[1]!==ps[i-1][1]);
const under=(top:readonly XY[],lo:number,hi:number,bottom:number):XY[]=>unique([[lo,bottom],[hi,bottom],at(top,hi),...top.filter(p=>p[0]>lo&&p[0]<hi).slice().reverse(),at(top,lo)]);
const above=(bottom:readonly XY[],lo:number,hi:number,top:number):XY[]=>unique([at(bottom,lo),...bottom.filter(p=>p[0]>lo&&p[0]<hi),at(bottom,hi),[hi,top],[lo,top]]);

// 85984 [X+20,Z+10,-Y]: source convex exterior, including lateral high
// corner facets and the lower one-LDU bevel. No full-width box/profile masks
// those cuts. The source top reaches15.6, inside the nominal16-LDU frame.
const shallowHull:MoldHull=Object.freeze({
 points:Object.freeze([[0,0,4],[0,20,1],[0,0,1],[40,0,1],[1,1,0],[40,20,13.6],[38,20,15.6],[40,0,4],[2,20,15.6],[39,1,0],[39,19,0],[1,19,0],[40,20,1],[38,19.3333,15.6],[0,20,13.6],[40,16,13.6],[2,19.3333,15.6],[39.41,18.35,15.01],[0,16,13.6],[.59,18.35,15.01],[39.41,20,15.01],[.59,20,15.01]].map(p=>Object.freeze(p as [number,number,number]))),
 faces:Object.freeze([[0,1,2],[0,2,3],[4,2,1],[4,3,2],[5,1,6],[7,0,3],[7,3,5],[8,6,1],[9,3,4],[9,4,10],[9,10,3],[11,10,4],[11,4,1],[11,1,10],[12,10,1],[12,1,5],[12,5,3],[12,3,10],[13,0,7],[13,6,8],[14,8,1],[14,1,0],[15,13,7],[15,7,5],[16,0,13],[16,13,8],[17,13,15],[17,15,5],[17,6,13],[18,0,16],[18,14,0],[19,14,18],[19,18,16],[19,16,8],[20,6,17],[20,17,5],[20,5,6],[21,14,19],[21,19,8],[21,8,14]].map(f=>Object.freeze(f))),
});
const shallow:PopularMold=Object.freeze({...make('85984',1,2,40,20,2,'Slope brick 31 degrees 1 x 2 x 2/3',[],grid(40,[10],0,'grip'),[],['Source-derived convex exterior fills cavities. Actual top15.6 LDU; nominal height16 LDU.']),solids:Object.freeze([]),render:Object.freeze([]),hulls:Object.freeze([shallowHull]),renderHulls:Object.freeze([shallowHull])});

// 6091 [X+10,Z+30,32-Y]: curved front rises to32, but the real
// rear stud is on24 and the rear socket is raised16 above the lower socket.
const curvedFront=quarter.map(([u,v]):XY=>[20-20*v,12+20*u]).reverse();
const curvedStud=make('6091',1,2,20,40,4,'Brick 2 x 1 x 1 1/3 with curved top',
 [[0,0],[20,0],[20,16],[40,16],[40,24],[20,24],...curvedFront.slice().reverse()],
 [port('stud','stud:0:1',[10,30,24]),port('grip','grip:0:0',[10,10,0]),port('grip','grip:0:1',[10,30,16])],
 [under(curvedFront,0,20,0),[[20,16],[40,16],[40,24],[20,24]]]);

// 49307 [X+10,Z+10,-Y]: full semicylindrical crown on a six-LDU
// skirt, one real underside cavity, no top stud. Source bottom is rawY0.
const half= [...quarter,...quarter.slice(0,-1).reverse().map(([u,v]):XY=>[-u,v])];
const capTop=half.map(([u,v]):XY=>[10-10*u,6+10*v]);
const cap=make('49307',1,1,20,20,2,'Brick 1 x 1 x 2/3 with curved top',under(capTop,0,20,0),grid(20,[10],0,'grip'));

// 93273 [X+10,Z+40,-Y]. Its two middle sockets are genuinely one
// plate above the end sockets. Only the source's16.00016098 peak is bounded
// to nominal16 (excess<.0002 LDU); no general collision tolerance is changed.
const doubleTop=quarter48.map(([u,v]):XY=>{const z=28.9719*(u+v)-24.9719;return [40+40*(u-v),z>16&&z-16<.0002?16:z];}).reverse();
const doubleCurve=make('93273',1,4,20,80,2,'Slope curved 4 x 1 double',
 [[0,0],[20,0],[20,8],[60,8],[60,0],[80,0],...doubleTop.slice().reverse()],
 [port('grip','grip:0:0',[10,10,0]),port('grip','grip:0:1',[10,30,8]),port('grip','grip:0:2',[10,50,8]),port('grip','grip:0:3',[10,70,0])],
 [under(doubleTop,0,20,0),under(doubleTop,20,60,8),under(doubleTop,60,80,0)],['Only this mold\'s <.0002 LDU high-face source rounding is nominalized to16; all remaining curve facets and socket levels retained.']);

// 24201 / 32803 [X+halfWidth,Z+10,16-Y]. The two upper rows are
// staggered at16 and8, with open studs. The curved underside has NO qualified
// horizontal anti-stud plane here. Open stud bores/internal stopper rings are
// not invented underside sockets or bar ports. These can hang from their real
// upper studs; they are not promised as standalone flat-bottom roots.
// Source right-cap chrd uses rounded40.97/56.57 rather than the main
// cylinder's28.9719/40. Keep both actual projected facet chains, taking their
// conservative lower hull. Only the cap's-.000647 endpoint is nominalized
// to its intended y0 frame plane, not by widening collision tolerances.
const invertedPoints:XY[]=[...quarter48.slice(0,7).map(([u,v]):XY=>[40+40*(v-u),41.028-28.9719*(u+v)]),
 ...quarter48.slice(0,7).map(([u,v]):XY=>{const y=40-56.57*v;return [y<0&&y>-.001?0:y,41.028-40.97*u];}),[40,16-15.9441]];
const invertedBottom:XY[]=[];
for(const p of invertedPoints.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1])){
 if(invertedBottom.at(-1)?.[0]===p[0])continue;
 while(invertedBottom.length>=2){const a=invertedBottom.at(-2)!,b=invertedBottom.at(-1)!;if((b[0]-a[0])*(p[1]-b[1])-(b[1]-a[1])*(p[0]-b[0])>0)break;invertedBottom.pop();}
 invertedBottom.push(p);
}
function inverted(num:string,width:number):PopularMold {
 const profile:XY[]=[...invertedBottom,[40,8],[20,8],[20,16],[0,16]];
 return make(num,width/20,2,width,40,2,`Slope curved 2 x ${width/20} inverted`,profile,
  [...grid(width,[10],16,'stud'),...Array.from({length:width/20},(_,x)=>port('stud',`stud:${x}:1`,[10+20*x,30,8],true))].map(p=>p.open?p:port('stud',p.id,p.point,true)),
  [above(invertedBottom,0,20,16),above(invertedBottom,20,40,8)],['Only real upper stud rows qualified; no underside flat clutch plane or hollow-bore attachment inferred. Nominal frame16 LDU; actual curved low point is about.0559 LDU above frame ground.',
   'Conservative profile includes both slightly different source side-cap/main-cylinder facet projections. Only source cap endpoint y=-.000647 is set to0; source rear planar z=8.00055 is set to its stud plane8. Both corrections <.001 LDU; no shared tolerance changed.']);
}
const invertedOne=inverted('24201',20),invertedTwo=inverted('32803',40);

// 37352 [X+20,Z+10,24-Y]: quarter-cylinder roof spanning the short
// depth, with two ordinary bottom sockets across the40-LDU width.
const shortRoof=quarter.map(([u,v]):XY=>[20-20*u,4+20*v]);
const shortCurve=make('37352',1,2,40,20,3,'Brick 1 x 2 with curved top',under(shortRoof,0,20,0),grid(40,[10],0,'grip'));

export const POPULAR_PROFILE_MOLDS:readonly PopularMold[]=Object.freeze([shallow,slope33one,slope33two,slope65,curvedStud,cap,doubleCurve,invertedOne,invertedTwo,shortCurve]);
