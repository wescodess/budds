import { u as useRuntimeConfig, c as createError } from '../nitro/nitro.mjs';

async function searchDocuments(params) {
  var _a, _b, _c;
  const config = useRuntimeConfig();
  const { cloudflareAccountId, cloudflareAiSearchInstance, cloudflareAiSearchToken } = config;
  const url = `https://api.cloudflare.com/client/v4/accounts/${cloudflareAccountId}/autorag/rags/${cloudflareAiSearchInstance}/search`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${cloudflareAiSearchToken}`
    },
    body: JSON.stringify({
      query: params.query,
      rewrite_query: (_a = params.rewrite_query) != null ? _a : true,
      max_num_results: (_b = params.max_num_results) != null ? _b : 10,
      ranking_options: params.ranking_options,
      reranking: (_c = params.reranking) != null ? _c : { enabled: true },
      filters: params.filters
    })
  });
  if (!response.ok) {
    const error = await response.text();
    throw createError({ statusCode: response.status, message: `AI Search error: ${error}` });
  }
  return response.json();
}

export { searchDocuments as s };
//# sourceMappingURL=ai-search.mjs.map
