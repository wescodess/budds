import { defineComponent, ref, mergeProps, unref, useSSRContext } from 'vue';
import { ssrRenderAttrs, ssrRenderList, ssrRenderAttr, ssrIncludeBooleanAttr, ssrLooseContain, ssrLooseEqual, ssrInterpolate, ssrRenderClass } from 'vue/server-renderer';

function useRag() {
  const messages = ref([]);
  const loading = ref(false);
  const error = ref(null);
  async function chat(query, options) {
    error.value = null;
    loading.value = true;
    messages.value.push({ role: "user", content: query });
    const history = messages.value.slice(0, -1).map(({ role, content }) => ({ role, content }));
    try {
      const response = await $fetch("/api/rag/chat", {
        method: "POST",
        body: {
          query,
          model: options.model,
          history,
          temperature: options.temperature,
          max_tokens: options.max_tokens,
          max_num_results: options.max_num_results,
          score_threshold: options.score_threshold,
          filters: options.filters
        }
      });
      messages.value.push({
        role: "assistant",
        content: response.answer,
        sources: response.sources
      });
      return response;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to get response";
      error.value = message;
      messages.value.pop();
      throw err;
    } finally {
      loading.value = false;
    }
  }
  async function search(query, options) {
    error.value = null;
    loading.value = true;
    try {
      return await $fetch("/api/rag/search", {
        method: "POST",
        body: {
          query,
          ...options
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Search failed";
      error.value = message;
      throw err;
    } finally {
      loading.value = false;
    }
  }
  function clearMessages() {
    messages.value = [];
    error.value = null;
  }
  return {
    messages,
    loading,
    error,
    chat,
    search,
    clearMessages
  };
}
const _sfc_main = /* @__PURE__ */ defineComponent({
  __name: "chat",
  __ssrInlineRender: true,
  setup(__props) {
    const { messages, loading, error } = useRag();
    const query = ref("");
    const selectedModel = ref("anthropic/claude-sonnet-4-5");
    const showSources = ref(null);
    const models = [
      { label: "Claude Sonnet 4.5", value: "anthropic/claude-sonnet-4-5" },
      { label: "Claude Haiku 3.5", value: "anthropic/claude-3.5-haiku" },
      { label: "GPT-4o", value: "openai/gpt-4o" },
      { label: "GPT-4o Mini", value: "openai/gpt-4o-mini" },
      { label: "Gemini 2.5 Flash", value: "google/gemini-2.5-flash-preview" },
      { label: "Llama 3.1 70B", value: "meta-llama/llama-3.1-70b-instruct" },
      { label: "DeepSeek V3", value: "deepseek/deepseek-chat-v3-0324" },
      { label: "Mistral Large", value: "mistralai/mistral-large-latest" }
    ];
    ref();
    return (_ctx, _push, _parent, _attrs) => {
      _push(`<div${ssrRenderAttrs(mergeProps({ class: "flex h-screen flex-col bg-zinc-950 text-zinc-100" }, _attrs))}><header class="flex items-center justify-between border-b border-zinc-800 px-6 py-3"><h1 class="text-lg font-semibold">RAG Chat</h1><div class="flex items-center gap-3"><select class="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-zinc-500"><!--[-->`);
      ssrRenderList(models, (model) => {
        _push(`<option${ssrRenderAttr("value", model.value)}${ssrIncludeBooleanAttr(Array.isArray(unref(selectedModel)) ? ssrLooseContain(unref(selectedModel), model.value) : ssrLooseEqual(unref(selectedModel), model.value)) ? " selected" : ""}>${ssrInterpolate(model.label)}</option>`);
      });
      _push(`<!--]--></select><button class="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"> Clear </button></div></header><div class="flex-1 overflow-y-auto px-6 py-4">`);
      if (unref(messages).length === 0) {
        _push(`<div class="flex h-full items-center justify-center"><div class="text-center"><p class="text-lg text-zinc-500">Ask a question about your documents</p><p class="mt-1 text-sm text-zinc-600">Powered by AI Search + ${ssrInterpolate(models.find((m) => m.value === unref(selectedModel))?.label)}</p></div></div>`);
      } else {
        _push(`<div class="mx-auto max-w-3xl space-y-4"><!--[-->`);
        ssrRenderList(unref(messages), (msg, i) => {
          _push(`<div class="${ssrRenderClass([
            "rounded-lg px-4 py-3",
            msg.role === "user" ? "ml-auto max-w-[80%] bg-zinc-800" : "max-w-[90%] bg-zinc-900 border border-zinc-800"
          ])}"><p class="whitespace-pre-wrap text-sm leading-relaxed">${ssrInterpolate(msg.content)}</p>`);
          if (msg.sources?.length) {
            _push(`<div class="mt-2"><button class="text-xs text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline">${ssrInterpolate(unref(showSources) === i ? "Hide" : "Show")} ${ssrInterpolate(msg.sources.length)} sources </button>`);
            if (unref(showSources) === i) {
              _push(`<div class="mt-2 space-y-2"><!--[-->`);
              ssrRenderList(msg.sources, (source, si) => {
                _push(`<div class="rounded border border-zinc-700 bg-zinc-950 p-2.5 text-xs"><div class="mb-1 flex items-center justify-between text-zinc-500"><span>${ssrInterpolate(source.attributes?.filename || source.attributes?.url || `Source ${si + 1}`)}</span><span>Score: ${ssrInterpolate((source.score * 100).toFixed(0))}%</span></div><p class="line-clamp-3 text-zinc-400">${ssrInterpolate(source.content)}</p></div>`);
              });
              _push(`<!--]--></div>`);
            } else {
              _push(`<!---->`);
            }
            _push(`</div>`);
          } else {
            _push(`<!---->`);
          }
          _push(`</div>`);
        });
        _push(`<!--]-->`);
        if (unref(loading)) {
          _push(`<div class="max-w-[90%] rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3"><div class="flex items-center gap-2 text-sm text-zinc-500"><span class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-500"></span> Searching documents and generating response... </div></div>`);
        } else {
          _push(`<!---->`);
        }
        _push(`</div>`);
      }
      _push(`</div>`);
      if (unref(error)) {
        _push(`<div class="border-t border-red-900 bg-red-950/50 px-6 py-2 text-sm text-red-400">${ssrInterpolate(unref(error))}</div>`);
      } else {
        _push(`<!---->`);
      }
      _push(`<form class="border-t border-zinc-800 px-6 py-4"><div class="mx-auto flex max-w-3xl gap-2"><input${ssrRenderAttr("value", unref(query))} type="text" placeholder="Ask a question..." class="flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"${ssrIncludeBooleanAttr(unref(loading)) ? " disabled" : ""}><button type="submit" class="rounded-md bg-zinc-100 px-5 py-2.5 text-sm font-medium text-zinc-900 transition hover:bg-zinc-200 disabled:opacity-50"${ssrIncludeBooleanAttr(unref(loading) || !unref(query).trim()) ? " disabled" : ""}> Send </button></div></form></div>`);
    };
  }
});
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("pages/app/chat.vue");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};

export { _sfc_main as default };
//# sourceMappingURL=chat-BlmRLx_b.mjs.map
