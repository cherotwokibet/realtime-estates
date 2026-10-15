import {parseListingJsonV2} from '@realtor/domain';
/** Reject duplicate keys before JSON parsing can replace retained facts. */
export function parseCreationJson(source:string):unknown{
 const tokens=source.match(/"(?:\\[\s\S]|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\]:,]/g)??[],stack:(Set<string>|null)[]=[];
 for(let i=0;i<tokens.length;i++){const token=tokens[i]!;if(token==='{')stack.push(new Set());else if(token==='[')stack.push(null);else if(token==='}'||token===']')stack.pop();else if(token.startsWith('"')&&tokens[i+1]===':'){const keys=stack.at(-1),key=JSON.parse(token) as string;if(!keys||keys.has(key))throw new Error('Duplicate facts.');keys.add(key);}}
 return parseListingJsonV2(source);
}
