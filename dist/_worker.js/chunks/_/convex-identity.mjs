import{a as e}from"../nitro/nitro.mjs";function getConvexTokenIdentifier(t){const o=t.context.convexToken;if(!o)throw e({statusCode:401,message:"Convex authentication token not available"});const n=o.split(".")[1].replace(/-/g,"+").replace(/_/g,"/"),a=JSON.parse(atob(n));return`${a.iss}|${a.sub}`}export{getConvexTokenIdentifier as g};
//# sourceMappingURL=convex-identity.mjs.map
