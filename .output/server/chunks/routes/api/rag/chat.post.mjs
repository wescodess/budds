import { u as useRuntimeConfig, c as createError, d as defineEventHandler, r as readBody, s as setResponseHeader, a as sendStream } from '../../../nitro/nitro.mjs';
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

function getGatewayBaseUrl() {
  const config = useRuntimeConfig();
  return `https://gateway.ai.cloudflare.com/v1/${config.cloudflareAccountId}/${config.cloudflareAiGatewayId}`;
}
async function generateCompletion(params) {
  var _a, _b;
  const config = useRuntimeConfig();
  const url = `${getGatewayBaseUrl()}/openrouter/v1/chat/completions`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.openrouterApiKey}`
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      temperature: (_a = params.temperature) != null ? _a : 0.7,
      max_tokens: (_b = params.max_tokens) != null ? _b : 2048,
      stream: false
    })
  });
  if (!response.ok) {
    const error = await response.text();
    throw createError({ statusCode: response.status, message: `AI Gateway error: ${error}` });
  }
  return response.json();
}
async function generateCompletionStream(params) {
  var _a, _b;
  const config = useRuntimeConfig();
  const url = `${getGatewayBaseUrl()}/openrouter/v1/chat/completions`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.openrouterApiKey}`
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      temperature: (_a = params.temperature) != null ? _a : 0.7,
      max_tokens: (_b = params.max_tokens) != null ? _b : 2048,
      stream: true
    })
  });
  if (!response.ok) {
    const error = await response.text();
    throw createError({ statusCode: response.status, message: `AI Gateway error: ${error}` });
  }
  return response.body;
}

const SYSTEM_PROMPT = `You are a helpful assistant that answers questions based on the provided context.
Use the context below to answer the user's question accurately.
If the context doesn't contain enough information to answer, say so clearly.
Always cite which source documents your answer is based on when possible.`;
const chat_post = defineEventHandler(async (event) => {
  var _a, _b, _c, _d, _e, _f, _g;
  const body = await readBody(event);
  if (!((_a = body.query) == null ? void 0 : _a.trim())) {
    throw createError({ statusCode: 400, message: "query is required" });
  }
  if (!((_b = body.model) == null ? void 0 : _b.trim())) {
    throw createError({ statusCode: 400, message: "model is required" });
  }
  const searchResults = await searchDocuments({
    query: body.query,
    max_num_results: (_c = body.max_num_results) != null ? _c : 10,
    ranking_options: body.score_threshold ? { score_threshold: body.score_threshold } : void 0,
    filters: body.filters
  });
  const context = searchResults.data.map((chunk, i) => {
    var _a2, _b2;
    const source = ((_a2 = chunk.attributes) == null ? void 0 : _a2.filename) || ((_b2 = chunk.attributes) == null ? void 0 : _b2.url) || `Source ${i + 1}`;
    return `[${source}]
${chunk.content}`;
  }).join("\n\n---\n\n");
  const messages = [
    { role: "system", content: SYSTEM_PROMPT }
  ];
  if (context) {
    messages.push({
      role: "user",
      content: `Context:
${context}`
    });
    messages.push({
      role: "assistant",
      content: "I've reviewed the provided context. How can I help you?"
    });
  }
  if ((_d = body.history) == null ? void 0 : _d.length) {
    messages.push(...body.history);
  }
  messages.push({ role: "user", content: body.query });
  if (body.stream) {
    const stream = await generateCompletionStream({
      model: body.model,
      messages,
      temperature: body.temperature,
      max_tokens: body.max_tokens});
    setResponseHeader(event, "Content-Type", "text/event-stream");
    setResponseHeader(event, "Cache-Control", "no-cache");
    setResponseHeader(event, "Connection", "keep-alive");
    return sendStream(event, stream);
  }
  const completion = await generateCompletion({
    model: body.model,
    messages,
    temperature: body.temperature,
    max_tokens: body.max_tokens
  });
  return {
    answer: (_g = (_f = (_e = completion.choices[0]) == null ? void 0 : _e.message) == null ? void 0 : _f.content) != null ? _g : "",
    model: completion.model,
    usage: completion.usage,
    sources: searchResults.data.map((chunk) => ({
      content: chunk.content,
      score: chunk.score,
      attributes: chunk.attributes
    }))
  };
});

export { chat_post as default };
//# sourceMappingURL=chat.post.mjs.map
