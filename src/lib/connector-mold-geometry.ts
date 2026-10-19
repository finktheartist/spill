/** Exact nominal connector molds, in LDU: x right, y back, z up. Body minimum
 * is [0,0,0]; protruding studs are represented by ports, not body boxes.
 * Sources: pinned official LDraw 4070.dat (James Jessiman) and 99780.dat
 * (Magnus Forsberg), CC BY 4.0, with their actual stud primitives. The boxes
 * conservatively fill interior cavities and small bevels. No bar/pin, rear-hole
 * or hollow-stud-bore connection is qualified. Not a physical clutch proof.
 *
 * These molds require the connections-v2 port authority. An upright cell grid
 * cannot represent the recessed headlight face or bracket stud planes.
 */
export type ConnectorMoldPoint=readonly [number,number,number];
export interface ConnectorMoldBox {
 readonly min:ConnectorMoldPoint;
 readonly max:ConnectorMoldPoint;
}
export interface ConnectorMoldPort {
 readonly id:string;
 readonly kind:'stud'|'grip';
 readonly point:ConnectorMoldPoint;
 readonly normal:ConnectorMoldPoint;
}
export interface ConnectorMold {
 readonly num:string;
 readonly widthLdu:number;
 readonly depthLdu:number;
 readonly heightPlates:number;
 readonly boxes:readonly ConnectorMoldBox[];
 readonly ports:readonly ConnectorMoldPort[];
}

export const CONNECTOR_MOLD_SPECS=Object.freeze([
 Object.freeze({type:'headlight',w:1,d:1,num:'4070'}),
 Object.freeze({type:'invertedbracket',w:1,d:2,num:'99780'}),
] as const);

const point=(p:ConnectorMoldPoint):ConnectorMoldPoint=>Object.freeze([...p] as [number,number,number]);
const box=(min:ConnectorMoldPoint,max:ConnectorMoldPoint):ConnectorMoldBox=>Object.freeze({min:point(min),max:point(max)});
const port=(id:string,kind:ConnectorMoldPort['kind'],p:ConnectorMoldPoint,n:ConnectorMoldPoint):ConnectorMoldPort=>
 Object.freeze({id,kind,point:point(p),normal:point(n)});

// 4070 [X,Y,Z] -> [X+10,Z+10,24-Y]. The front stud's source base is
// [0,10,-6], NOT the ordinary sidebrick face [0,10,-10]. The front lip
// occupies only the bottom four LDU, leaving the real recessed mounting face.
const headlight:ConnectorMold=Object.freeze({
 num:'4070',widthLdu:20,depthLdu:20,heightPlates:3,
 boxes:Object.freeze([box([0,4,0],[20,20,24]),box([0,0,0],[20,4,4])]),
 ports:Object.freeze([
  port('stud:0:0','stud',[10,10,24],[0,0,1]),
  port('grip:0:0','grip',[10,10,0],[0,0,-1]),
  port('side:0','stud',[10,4,14],[0,-1,0]),
 ]),
});

// 99780 [X,Y,Z] -> [X+20,Z+14,8-Y]. The upright front leaf extends to
// z20, while the horizontal plate's stud plane is z8. The entire body is
// 40 x 24 x 20 LDU; neither its source origin nor its height matches 99781.
// Tiny rounded upper corners and cavities remain conservatively filled.
const invertedBracket:ConnectorMold=Object.freeze({
 num:'99780',widthLdu:40,depthLdu:24,heightPlates:2.5,
 boxes:Object.freeze([box([0,0,0],[40,4,20]),box([0,4,0],[40,24,8])]),
 ports:Object.freeze([
  port('stud:0:0','stud',[10,14,8],[0,0,1]),
  port('stud:1:0','stud',[30,14,8],[0,0,1]),
  port('grip:0:0','grip',[10,14,0],[0,0,-1]),
  port('grip:1:0','grip',[30,14,0],[0,0,-1]),
  port('side:0','stud',[10,0,10],[0,-1,0]),
  port('side:1','stud',[30,0,10],[0,-1,0]),
 ]),
});

/** Exact type/size keys only: no rotation alias, scaling or mold substitution. */
export function connectorMold(k:{type:string;w:number;d:number}):ConnectorMold|undefined {
 if(k.type==='headlight'&&k.w===1&&k.d===1)return headlight;
 if(k.type==='invertedbracket'&&k.w===1&&k.d===2)return invertedBracket;
 return undefined;
}
