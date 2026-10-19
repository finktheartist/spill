import type {Box} from './inventory';

/** Keep the outlined observation centered, including when its padding crosses a photo edge. */
export function photoCrop(width:number,height:number,box:Box,size:number) {
 if(![width,height,size,...box].every(Number.isFinite)||width<=0||height<=0||size<=0||box.some(v=>v<0||v>1000)||box[2]<=box[0]||box[3]<=box[1])return null;
 const [top,left,bottom,right]=[box[0]*height/1000,box[1]*width/1000,box[2]*height/1000,box[3]*width/1000];
 const side=Math.max(Math.min(60,width,height),Math.max(right-left,bottom-top)*1.5),x=(left+right-side)/2,y=(top+bottom-side)/2,k=size/side;
 const sx=Math.max(0,x),sy=Math.max(0,y),sw=Math.min(width,x+side)-sx,sh=Math.min(height,y+side)-sy;
 return {source:[sx,sy,sw,sh] as const,destination:[(sx-x)*k,(sy-y)*k,sw*k,sh*k] as const,outline:[(left-x)*k,(top-y)*k,(right-left)*k,(bottom-top)*k] as const};
}
