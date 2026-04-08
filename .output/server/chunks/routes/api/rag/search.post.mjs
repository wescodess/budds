import { d as defineEventHandler, r as readBody, c as createError } from '../../../nitro/nitro.mjs';
import { s as searchDocuments } from '../../../_/ai-search.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';
import 'better-sqlite3';
import 'better-auth';

const search_post = defineEventHandler(async (event) => {
  var _a;
  const body = await readBody(event);
  if (!((_a = body.query) == null ? void 0 : _a.trim())) {
    throw createError({ statusCode: 400, message: "query is required" });
  }
  const results = await searchDocuments({
    query: body.query,
    max_num_results: body.max_num_results,
    ranking_options: body.score_threshold ? { score_threshold: body.score_threshold } : void 0,
    filters: body.filters
  });
  return results;
});

export { search_post as default };
//# sourceMappingURL=search.post.mjs.map
