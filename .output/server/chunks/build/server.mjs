import process from 'node:process';globalThis._importMeta_=globalThis._importMeta_||{url:"file:///_entry.js",env:process.env};import { computed, hasInjectionContext, getCurrentInstance, toRef, isRef, watch, nextTick, defineComponent, ref, inject, h, Suspense, Fragment, createApp, provide, shallowReactive, onErrorCaptured, onServerPrefetch, unref, createVNode, resolveDynamicComponent, reactive, effectScope, defineAsyncComponent, mergeProps, getCurrentScope, shallowRef, isReadonly, useSSRContext, isShallow, isReactive, toRaw } from 'vue';
import { p as parseURL, m as encodePath, n as decodePath, o as hasProtocol, q as isScriptProtocol, t as joinURL, w as withQuery, v as getRequestURL, x as sanitizeStatusCode, y as getRequestHeaders, $ as $fetch$1, z as createError$1, A as defu, B as defu$1, C as toRouteMatcher, D as createRouter$1 } from '../nitro/nitro.mjs';
import { b as baseURL } from '../routes/renderer.mjs';
import { RouterView, createMemoryHistory, createRouter, START_LOCATION } from 'vue-router';
import { createAuthClient } from 'better-auth/vue';
import { ssrRenderSuspense, ssrRenderComponent, ssrRenderVNode } from 'vue/server-renderer';
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
import 'vue-bundle-renderer/runtime';
import 'unhead/server';
import 'devalue';

//#region src/utils.ts
function flatHooks(configHooks, hooks = {}, parentName) {
	for (const key in configHooks) {
		const subHook = configHooks[key];
		const name = parentName ? `${parentName}:${key}` : key;
		if (typeof subHook === "object" && subHook !== null) flatHooks(subHook, hooks, name);
		else if (typeof subHook === "function") hooks[name] = subHook;
	}
	return hooks;
}
const createTask = /* @__PURE__ */ (() => {
	if (console.createTask) return console.createTask;
	const defaultTask = { run: (fn) => fn() };
	return () => defaultTask;
})();
function callHooks(hooks, args, startIndex, task) {
	for (let i = startIndex; i < hooks.length; i += 1) try {
		const result = task ? task.run(() => hooks[i](...args)) : hooks[i](...args);
		if (result instanceof Promise) return result.then(() => callHooks(hooks, args, i + 1, task));
	} catch (error) {
		return Promise.reject(error);
	}
}
function serialTaskCaller(hooks, args, name) {
	if (hooks.length > 0) return callHooks(hooks, args, 0, createTask(name));
}
function parallelTaskCaller(hooks, args, name) {
	if (hooks.length > 0) {
		const task = createTask(name);
		return Promise.all(hooks.map((hook) => task.run(() => hook(...args))));
	}
}
function callEachWith(callbacks, arg0) {
	for (const callback of [...callbacks]) callback(arg0);
}
//#endregion
//#region src/hookable.ts
var Hookable = class {
	_hooks;
	_before;
	_after;
	_deprecatedHooks;
	_deprecatedMessages;
	constructor() {
		this._hooks = {};
		this._before = void 0;
		this._after = void 0;
		this._deprecatedMessages = void 0;
		this._deprecatedHooks = {};
		this.hook = this.hook.bind(this);
		this.callHook = this.callHook.bind(this);
		this.callHookWith = this.callHookWith.bind(this);
	}
	hook(name, function_, options = {}) {
		if (!name || typeof function_ !== "function") return () => {};
		const originalName = name;
		let dep;
		while (this._deprecatedHooks[name]) {
			dep = this._deprecatedHooks[name];
			name = dep.to;
		}
		if (dep && !options.allowDeprecated) {
			let message = dep.message;
			if (!message) message = `${originalName} hook has been deprecated` + (dep.to ? `, please use ${dep.to}` : "");
			if (!this._deprecatedMessages) this._deprecatedMessages = /* @__PURE__ */ new Set();
			if (!this._deprecatedMessages.has(message)) {
				console.warn(message);
				this._deprecatedMessages.add(message);
			}
		}
		if (!function_.name) try {
			Object.defineProperty(function_, "name", {
				get: () => "_" + name.replace(/\W+/g, "_") + "_hook_cb",
				configurable: true
			});
		} catch {}
		this._hooks[name] = this._hooks[name] || [];
		this._hooks[name].push(function_);
		return () => {
			if (function_) {
				this.removeHook(name, function_);
				function_ = void 0;
			}
		};
	}
	hookOnce(name, function_) {
		let _unreg;
		let _function = (...arguments_) => {
			if (typeof _unreg === "function") _unreg();
			_unreg = void 0;
			_function = void 0;
			return function_(...arguments_);
		};
		_unreg = this.hook(name, _function);
		return _unreg;
	}
	removeHook(name, function_) {
		const hooks = this._hooks[name];
		if (hooks) {
			const index = hooks.indexOf(function_);
			if (index !== -1) hooks.splice(index, 1);
			if (hooks.length === 0) this._hooks[name] = void 0;
		}
	}
	clearHook(name) {
		this._hooks[name] = void 0;
	}
	deprecateHook(name, deprecated) {
		this._deprecatedHooks[name] = typeof deprecated === "string" ? { to: deprecated } : deprecated;
		const _hooks = this._hooks[name] || [];
		this._hooks[name] = void 0;
		for (const hook of _hooks) this.hook(name, hook);
	}
	deprecateHooks(deprecatedHooks) {
		for (const name in deprecatedHooks) this.deprecateHook(name, deprecatedHooks[name]);
	}
	addHooks(configHooks) {
		const hooks = flatHooks(configHooks);
		const removeFns = Object.keys(hooks).map((key) => this.hook(key, hooks[key]));
		return () => {
			for (const unreg of removeFns) unreg();
			removeFns.length = 0;
		};
	}
	removeHooks(configHooks) {
		const hooks = flatHooks(configHooks);
		for (const key in hooks) this.removeHook(key, hooks[key]);
	}
	removeAllHooks() {
		this._hooks = {};
	}
	callHook(name, ...args) {
		return this.callHookWith(serialTaskCaller, name, args);
	}
	callHookParallel(name, ...args) {
		return this.callHookWith(parallelTaskCaller, name, args);
	}
	callHookWith(caller, name, args) {
		const event = this._before || this._after ? {
			name,
			args,
			context: {}
		} : void 0;
		if (this._before) callEachWith(this._before, event);
		const result = caller(this._hooks[name] ? [...this._hooks[name]] : [], args, name);
		if (result instanceof Promise) return result.finally(() => {
			if (this._after && event) callEachWith(this._after, event);
		});
		if (this._after && event) callEachWith(this._after, event);
		return result;
	}
	beforeEach(function_) {
		this._before = this._before || [];
		this._before.push(function_);
		return () => {
			if (this._before !== void 0) {
				const index = this._before.indexOf(function_);
				if (index !== -1) this._before.splice(index, 1);
			}
		};
	}
	afterEach(function_) {
		this._after = this._after || [];
		this._after.push(function_);
		return () => {
			if (this._after !== void 0) {
				const index = this._after.indexOf(function_);
				if (index !== -1) this._after.splice(index, 1);
			}
		};
	}
};
function createHooks() {
	return new Hookable();
}

function createContext(opts = {}) {
  let currentInstance;
  let isSingleton = false;
  const checkConflict = (instance) => {
    if (currentInstance && currentInstance !== instance) {
      throw new Error("Context conflict");
    }
  };
  let als;
  if (opts.asyncContext) {
    const _AsyncLocalStorage = opts.AsyncLocalStorage || globalThis.AsyncLocalStorage;
    if (_AsyncLocalStorage) {
      als = new _AsyncLocalStorage();
    } else {
      console.warn("[unctx] `AsyncLocalStorage` is not provided.");
    }
  }
  const _getCurrentInstance = () => {
    if (als) {
      const instance = als.getStore();
      if (instance !== void 0) {
        return instance;
      }
    }
    return currentInstance;
  };
  return {
    use: () => {
      const _instance = _getCurrentInstance();
      if (_instance === void 0) {
        throw new Error("Context is not available");
      }
      return _instance;
    },
    tryUse: () => {
      return _getCurrentInstance();
    },
    set: (instance, replace) => {
      if (!replace) {
        checkConflict(instance);
      }
      currentInstance = instance;
      isSingleton = true;
    },
    unset: () => {
      currentInstance = void 0;
      isSingleton = false;
    },
    call: (instance, callback) => {
      checkConflict(instance);
      currentInstance = instance;
      try {
        return als ? als.run(instance, callback) : callback();
      } finally {
        if (!isSingleton) {
          currentInstance = void 0;
        }
      }
    },
    async callAsync(instance, callback) {
      currentInstance = instance;
      const onRestore = () => {
        currentInstance = instance;
      };
      const onLeave = () => currentInstance === instance ? onRestore : void 0;
      asyncHandlers.add(onLeave);
      try {
        const r = als ? als.run(instance, callback) : callback();
        if (!isSingleton) {
          currentInstance = void 0;
        }
        return await r;
      } finally {
        asyncHandlers.delete(onLeave);
      }
    }
  };
}
function createNamespace(defaultOpts = {}) {
  const contexts = {};
  return {
    get(key, opts = {}) {
      if (!contexts[key]) {
        contexts[key] = createContext({ ...defaultOpts, ...opts });
      }
      return contexts[key];
    }
  };
}
const _globalThis = typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : typeof global !== "undefined" ? global : {};
const globalKey = "__unctx__";
const defaultNamespace = _globalThis[globalKey] || (_globalThis[globalKey] = createNamespace());
const getContext = (key, opts = {}) => defaultNamespace.get(key, opts);
const asyncHandlersKey = "__unctx_async_handlers__";
const asyncHandlers = _globalThis[asyncHandlersKey] || (_globalThis[asyncHandlersKey] = /* @__PURE__ */ new Set());
function executeAsync(function_) {
  const restores = [];
  for (const leaveHandler of asyncHandlers) {
    const restore2 = leaveHandler();
    if (restore2) {
      restores.push(restore2);
    }
  }
  const restore = () => {
    for (const restore2 of restores) {
      restore2();
    }
  };
  let awaitable = function_();
  if (awaitable && typeof awaitable === "object" && "catch" in awaitable) {
    awaitable = awaitable.catch((error) => {
      restore();
      throw error;
    });
  }
  return [awaitable, restore];
}

if (!globalThis.$fetch) {
  globalThis.$fetch = $fetch$1.create({
    baseURL: baseURL()
  });
}
if (!("global" in globalThis)) {
  globalThis.global = globalThis;
}
const nuxtLinkDefaults = { "componentName": "NuxtLink" };
const appId = "nuxt-app";
function getNuxtAppCtx(id = appId) {
  return getContext(id, {
    asyncContext: false
  });
}
const NuxtPluginIndicator = "__nuxt_plugin";
function createNuxtApp(options) {
  let hydratingCount = 0;
  const nuxtApp = {
    _id: options.id || appId || "nuxt-app",
    _scope: effectScope(),
    provide: void 0,
    versions: {
      get nuxt() {
        return "4.4.2";
      },
      get vue() {
        return nuxtApp.vueApp.version;
      }
    },
    payload: shallowReactive({
      ...options.ssrContext?.payload || {},
      data: shallowReactive({}),
      state: reactive({}),
      once: /* @__PURE__ */ new Set(),
      _errors: shallowReactive({})
    }),
    static: {
      data: {}
    },
    runWithContext(fn) {
      if (nuxtApp._scope.active && !getCurrentScope()) {
        return nuxtApp._scope.run(() => callWithNuxt(nuxtApp, fn));
      }
      return callWithNuxt(nuxtApp, fn);
    },
    isHydrating: false,
    deferHydration() {
      if (!nuxtApp.isHydrating) {
        return () => {
        };
      }
      hydratingCount++;
      let called = false;
      return () => {
        if (called) {
          return;
        }
        called = true;
        hydratingCount--;
        if (hydratingCount === 0) {
          nuxtApp.isHydrating = false;
          return nuxtApp.callHook("app:suspense:resolve");
        }
      };
    },
    _asyncDataPromises: {},
    _asyncData: shallowReactive({}),
    _state: shallowReactive({}),
    _payloadRevivers: {},
    ...options
  };
  {
    nuxtApp.payload.serverRendered = true;
  }
  if (nuxtApp.ssrContext) {
    nuxtApp.payload.path = nuxtApp.ssrContext.url;
    nuxtApp.ssrContext.nuxt = nuxtApp;
    nuxtApp.ssrContext.payload = nuxtApp.payload;
    nuxtApp.ssrContext.config = {
      public: nuxtApp.ssrContext.runtimeConfig.public,
      app: nuxtApp.ssrContext.runtimeConfig.app
    };
  }
  nuxtApp.hooks = createHooks();
  nuxtApp.hook = nuxtApp.hooks.hook;
  {
    const contextCaller = async function(hooks, args) {
      for (const hook of hooks) {
        await nuxtApp.runWithContext(() => hook(...args));
      }
    };
    nuxtApp.hooks.callHook = (name, ...args) => nuxtApp.hooks.callHookWith(contextCaller, name, args);
  }
  nuxtApp.callHook = nuxtApp.hooks.callHook;
  nuxtApp.provide = (name, value) => {
    const $name = "$" + name;
    defineGetter(nuxtApp, $name, value);
    defineGetter(nuxtApp.vueApp.config.globalProperties, $name, value);
  };
  defineGetter(nuxtApp.vueApp, "$nuxt", nuxtApp);
  defineGetter(nuxtApp.vueApp.config.globalProperties, "$nuxt", nuxtApp);
  const runtimeConfig = options.ssrContext.runtimeConfig;
  nuxtApp.provide("config", runtimeConfig);
  return nuxtApp;
}
function registerPluginHooks(nuxtApp, plugin2) {
  if (plugin2.hooks) {
    nuxtApp.hooks.addHooks(plugin2.hooks);
  }
}
async function applyPlugin(nuxtApp, plugin2) {
  if (typeof plugin2 === "function") {
    const { provide: provide2 } = await nuxtApp.runWithContext(() => plugin2(nuxtApp)) || {};
    if (provide2 && typeof provide2 === "object") {
      for (const key in provide2) {
        nuxtApp.provide(key, provide2[key]);
      }
    }
  }
}
async function applyPlugins(nuxtApp, plugins2) {
  const resolvedPlugins = /* @__PURE__ */ new Set();
  const unresolvedPlugins = [];
  const parallels = [];
  let error = void 0;
  let promiseDepth = 0;
  async function executePlugin(plugin2) {
    const unresolvedPluginsForThisPlugin = plugin2.dependsOn?.filter((name) => plugins2.some((p) => p._name === name) && !resolvedPlugins.has(name)) ?? [];
    if (unresolvedPluginsForThisPlugin.length > 0) {
      unresolvedPlugins.push([new Set(unresolvedPluginsForThisPlugin), plugin2]);
    } else {
      const promise = applyPlugin(nuxtApp, plugin2).then(async () => {
        if (plugin2._name) {
          resolvedPlugins.add(plugin2._name);
          await Promise.all(unresolvedPlugins.map(async ([dependsOn, unexecutedPlugin]) => {
            if (dependsOn.has(plugin2._name)) {
              dependsOn.delete(plugin2._name);
              if (dependsOn.size === 0) {
                promiseDepth++;
                await executePlugin(unexecutedPlugin);
              }
            }
          }));
        }
      }).catch((e) => {
        if (!plugin2.parallel && !nuxtApp.payload.error) {
          throw e;
        }
        error ||= e;
      });
      if (plugin2.parallel) {
        parallels.push(promise);
      } else {
        await promise;
      }
    }
  }
  for (const plugin2 of plugins2) {
    if (nuxtApp.ssrContext?.islandContext && plugin2.env?.islands === false) {
      continue;
    }
    registerPluginHooks(nuxtApp, plugin2);
  }
  for (const plugin2 of plugins2) {
    if (nuxtApp.ssrContext?.islandContext && plugin2.env?.islands === false) {
      continue;
    }
    await executePlugin(plugin2);
  }
  await Promise.all(parallels);
  if (promiseDepth) {
    for (let i = 0; i < promiseDepth; i++) {
      await Promise.all(parallels);
    }
  }
  if (error) {
    throw nuxtApp.payload.error || error;
  }
}
// @__NO_SIDE_EFFECTS__
function defineNuxtPlugin(plugin2) {
  if (typeof plugin2 === "function") {
    return plugin2;
  }
  const _name = plugin2._name || plugin2.name;
  delete plugin2.name;
  return Object.assign(plugin2.setup || (() => {
  }), plugin2, { [NuxtPluginIndicator]: true, _name });
}
function callWithNuxt(nuxt, setup, args) {
  const fn = () => setup();
  const nuxtAppCtx = getNuxtAppCtx(nuxt._id);
  {
    return nuxt.vueApp.runWithContext(() => nuxtAppCtx.callAsync(nuxt, fn));
  }
}
function tryUseNuxtApp(id) {
  let nuxtAppInstance;
  if (hasInjectionContext()) {
    nuxtAppInstance = getCurrentInstance()?.appContext.app.$nuxt;
  }
  nuxtAppInstance ||= getNuxtAppCtx(id).tryUse();
  return nuxtAppInstance || null;
}
function useNuxtApp(id) {
  const nuxtAppInstance = tryUseNuxtApp(id);
  if (!nuxtAppInstance) {
    {
      throw new Error("[nuxt] instance unavailable");
    }
  }
  return nuxtAppInstance;
}
// @__NO_SIDE_EFFECTS__
function useRuntimeConfig(_event) {
  return useNuxtApp().$config;
}
function defineGetter(obj, key, val) {
  Object.defineProperty(obj, key, { get: () => val });
}
const LayoutMetaSymbol = /* @__PURE__ */ Symbol("layout-meta");
const PageRouteSymbol = /* @__PURE__ */ Symbol("route");
globalThis._importMeta_.url.replace(/\/app\/.*$/, "/");
const useRouter = () => {
  return useNuxtApp()?.$router;
};
const useRoute = () => {
  if (hasInjectionContext()) {
    return inject(PageRouteSymbol, useNuxtApp()._route);
  }
  return useNuxtApp()._route;
};
// @__NO_SIDE_EFFECTS__
function defineNuxtRouteMiddleware(middleware) {
  return middleware;
}
const isProcessingMiddleware = () => {
  try {
    if (useNuxtApp()._processingMiddleware) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
};
const URL_QUOTE_RE = /"/g;
const navigateTo = (to, options) => {
  to ||= "/";
  const toPath = typeof to === "string" ? to : "path" in to ? resolveRouteObject(to) : useRouter().resolve(to).href;
  const isExternalHost = hasProtocol(toPath, { acceptRelative: true });
  const isExternal = options?.external || isExternalHost;
  if (isExternal) {
    if (!options?.external) {
      throw new Error("Navigating to an external URL is not allowed by default. Use `navigateTo(url, { external: true })`.");
    }
    const { protocol } = new URL(toPath, "http://localhost");
    if (protocol && isScriptProtocol(protocol)) {
      throw new Error(`Cannot navigate to a URL with '${protocol}' protocol.`);
    }
  }
  const inMiddleware = isProcessingMiddleware();
  const router = useRouter();
  const nuxtApp = useNuxtApp();
  {
    if (nuxtApp.ssrContext) {
      const fullPath = typeof to === "string" || isExternal ? toPath : router.resolve(to).fullPath || "/";
      const location2 = isExternal ? toPath : joinURL((/* @__PURE__ */ useRuntimeConfig()).app.baseURL, fullPath);
      const redirect = async function(response) {
        await nuxtApp.callHook("app:redirected");
        const encodedLoc = location2.replace(URL_QUOTE_RE, "%22");
        const encodedHeader = encodeURL(location2, isExternalHost);
        nuxtApp.ssrContext["~renderResponse"] = {
          statusCode: sanitizeStatusCode(options?.redirectCode || 302, 302),
          body: `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0; url=${encodedLoc}"></head></html>`,
          headers: { location: encodedHeader }
        };
        return response;
      };
      if (!isExternal && inMiddleware) {
        router.afterEach((final) => final.fullPath === fullPath ? redirect(false) : void 0);
        return to;
      }
      return redirect(!inMiddleware ? void 0 : (
        /* abort route navigation */
        false
      ));
    }
  }
  if (isExternal) {
    nuxtApp._scope.stop();
    if (options?.replace) {
      (void 0).replace(toPath);
    } else {
      (void 0).href = toPath;
    }
    if (inMiddleware) {
      if (!nuxtApp.isHydrating) {
        return false;
      }
      return new Promise(() => {
      });
    }
    return Promise.resolve();
  }
  const encodedTo = typeof to === "string" ? encodeRoutePath(to) : to;
  return options?.replace ? router.replace(encodedTo) : router.push(encodedTo);
};
function resolveRouteObject(to) {
  return withQuery(to.path || "", to.query || {}) + (to.hash || "");
}
function encodeURL(location2, isExternalHost = false) {
  const url = new URL(location2, "http://localhost");
  if (!isExternalHost) {
    return url.pathname + url.search + url.hash;
  }
  if (location2.startsWith("//")) {
    return url.toString().replace(url.protocol, "");
  }
  return url.toString();
}
function encodeRoutePath(url) {
  const parsed = parseURL(url);
  return encodePath(decodePath(parsed.pathname)) + parsed.search + parsed.hash;
}
const NUXT_ERROR_SIGNATURE = "__nuxt_error";
const useError = /* @__NO_SIDE_EFFECTS__ */ () => toRef(useNuxtApp().payload, "error");
const showError = (error) => {
  const nuxtError = createError(error);
  try {
    const error2 = /* @__PURE__ */ useError();
    if (false) ;
    error2.value ||= nuxtError;
  } catch {
    throw nuxtError;
  }
  return nuxtError;
};
const isNuxtError = (error) => !!error && typeof error === "object" && NUXT_ERROR_SIGNATURE in error;
const createError = (error) => {
  if (typeof error !== "string" && error.statusText) {
    error.message ??= error.statusText;
  }
  const nuxtError = createError$1(error);
  Object.defineProperty(nuxtError, NUXT_ERROR_SIGNATURE, {
    value: true,
    configurable: false,
    writable: false
  });
  Object.defineProperty(nuxtError, "status", {
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    get: () => nuxtError.statusCode,
    configurable: true
  });
  Object.defineProperty(nuxtError, "statusText", {
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    get: () => nuxtError.statusMessage,
    configurable: true
  });
  return nuxtError;
};
const unhead_2RGNnFHTZ0_5NCXBsIKW4tSakBJSWgp2dLZInNkse3g = /* @__PURE__ */ defineNuxtPlugin({
  name: "nuxt:head",
  enforce: "pre",
  setup(nuxtApp) {
    const head = nuxtApp.ssrContext.head;
    nuxtApp.vueApp.use(head);
  }
});
function toArray(value) {
  return Array.isArray(value) ? value : [value];
}
const matcher = /* @__PURE__ */ (() => {
  const $0 = {};
  return (m, p) => {
    let r = [];
    if (p.charCodeAt(p.length - 1) === 47) p = p.slice(0, -1) || "/";
    if (p === "/login") {
      r.unshift({ data: $0 });
    }
    let s = p.split("/"), l = s.length;
    if (l > 1) {
      if (s[1] === "app") {
        r.unshift({ data: $0, params: { "_": s.slice(2).join("/") } });
      }
    }
    return r;
  };
})();
const _routeRulesMatcher = (path) => defu({}, ...matcher("", path).map((r) => r.data).reverse());
const routeRulesMatcher = _routeRulesMatcher;
function getRouteRules(arg) {
  const path = typeof arg === "string" ? arg : arg.path;
  try {
    return routeRulesMatcher(path);
  } catch (e) {
    console.error("[nuxt] Error matching route rules.", e);
    return {};
  }
}
const __nuxt_page_meta$1 = { layout: false };
const __nuxt_page_meta = { auth: "guest" };
const _routes = [
  {
    name: "app-chat",
    path: "/app/chat",
    meta: { ...__nuxt_page_meta$1 || {}, ...{ "auth": "user" } },
    component: () => import('./chat-BLSvQ7Ge.mjs')
  },
  {
    name: "login",
    path: "/login",
    meta: { ...__nuxt_page_meta || {}, ...{ "auth": "guest" } },
    component: () => import('./login-B569FHys.mjs')
  },
  {
    name: "index",
    path: "/",
    component: () => import('./index-CjCNOu9D.mjs')
  }
];
const ROUTE_KEY_PARENTHESES_RE = /(:\w+)\([^)]+\)/g;
const ROUTE_KEY_SYMBOLS_RE = /(:\w+)[?+*]/g;
const ROUTE_KEY_NORMAL_RE = /:\w+/g;
function generateRouteKey(route) {
  const source = route?.meta.key ?? route.path.replace(ROUTE_KEY_PARENTHESES_RE, "$1").replace(ROUTE_KEY_SYMBOLS_RE, "$1").replace(ROUTE_KEY_NORMAL_RE, (r) => route.params[r.slice(1)]?.toString() || "");
  return typeof source === "function" ? source(route) : source;
}
function isChangingPage(to, from) {
  if (to === from || from === START_LOCATION) {
    return false;
  }
  if (generateRouteKey(to) !== generateRouteKey(from)) {
    return true;
  }
  const areComponentsSame = to.matched.every(
    (comp, index) => comp.components && comp.components.default === from.matched[index]?.components?.default
  );
  if (areComponentsSame) {
    return false;
  }
  return true;
}
const routerOptions0 = {
  scrollBehavior(to, from, savedPosition) {
    const nuxtApp = useNuxtApp();
    const hashScrollBehaviour = useRouter().options?.scrollBehaviorType ?? "auto";
    if (to.path.replace(/\/$/, "") === from.path.replace(/\/$/, "")) {
      if (from.hash && !to.hash) {
        return { left: 0, top: 0 };
      }
      if (to.hash) {
        return { el: to.hash, top: _getHashElementScrollMarginTop(to.hash), behavior: hashScrollBehaviour };
      }
      return false;
    }
    const routeAllowsScrollToTop = typeof to.meta.scrollToTop === "function" ? to.meta.scrollToTop(to, from) : to.meta.scrollToTop;
    if (routeAllowsScrollToTop === false) {
      return false;
    }
    if (from === START_LOCATION) {
      return _calculatePosition(to, from, savedPosition, hashScrollBehaviour);
    }
    return new Promise((resolve) => {
      const doScroll = () => {
        requestAnimationFrame(() => resolve(_calculatePosition(to, from, savedPosition, hashScrollBehaviour)));
      };
      nuxtApp.hooks.hookOnce("page:loading:end", () => {
        const transitionPromise = nuxtApp["~transitionPromise"];
        if (transitionPromise) {
          transitionPromise.then(doScroll);
        } else {
          doScroll();
        }
      });
    });
  }
};
function _getHashElementScrollMarginTop(selector) {
  try {
    const elem = (void 0).querySelector(selector);
    if (elem) {
      return (Number.parseFloat(getComputedStyle(elem).scrollMarginTop) || 0) + (Number.parseFloat(getComputedStyle((void 0).documentElement).scrollPaddingTop) || 0);
    }
  } catch {
  }
  return 0;
}
function _calculatePosition(to, from, savedPosition, defaultHashScrollBehaviour) {
  if (savedPosition) {
    return savedPosition;
  }
  const isPageNavigation = isChangingPage(to, from);
  if (to.hash) {
    return {
      el: to.hash,
      top: _getHashElementScrollMarginTop(to.hash),
      behavior: isPageNavigation ? defaultHashScrollBehaviour : "instant"
    };
  }
  return {
    left: 0,
    top: 0
  };
}
const configRouterOptions = {
  hashMode: false,
  scrollBehaviorType: "auto"
};
const routerOptions = {
  ...configRouterOptions,
  ...routerOptions0
};
const validate = /* @__PURE__ */ defineNuxtRouteMiddleware(async (to, from) => {
  let __temp, __restore;
  if (!to.meta?.validate) {
    return;
  }
  const result = ([__temp, __restore] = executeAsync(() => Promise.resolve(to.meta.validate(to))), __temp = await __temp, __restore(), __temp);
  if (result === true) {
    return;
  }
  const error = createError({
    fatal: false,
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    status: result && (result.status || result.statusCode) || 404,
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    statusText: result && (result.statusText || result.statusMessage) || `Page Not Found: ${to.fullPath}`,
    data: {
      path: to.fullPath
    }
  });
  return error;
});
function matchesUser(user, match) {
  for (const [key, expected] of Object.entries(match)) {
    const actual = user[key];
    if (Array.isArray(expected)) {
      if (!expected.includes(actual))
        return false;
    } else {
      if (actual !== expected)
        return false;
    }
  }
  return true;
}
function useRequestEvent(nuxtApp) {
  nuxtApp ||= useNuxtApp();
  return nuxtApp.ssrContext?.event;
}
function useRequestHeaders(include) {
  const event = useRequestEvent();
  const _headers = event ? getRequestHeaders(event) : {};
  if (!include || !event) {
    return _headers;
  }
  const headers = /* @__PURE__ */ Object.create(null);
  for (const _key of include) {
    const key = _key.toLowerCase();
    const header = _headers[key];
    if (header) {
      headers[key] = header;
    }
  }
  return headers;
}
function useRequestFetch() {
  return useRequestEvent()?.$fetch || globalThis.$fetch;
}
function defineClientAuth(config) {
  return (baseURL2) => {
    const ctx = { siteUrl: baseURL2 };
    const resolved = typeof config === "function" ? config(ctx) : config;
    const { baseURL: configuredBaseURL, ...resolvedOptions } = resolved;
    const clientOptions = { ...resolvedOptions, baseURL: configuredBaseURL ?? baseURL2 };
    return createAuthClient(clientOptions);
  };
}
const createAppAuthClient = defineClientAuth({});
function isRecord(value) {
  return Boolean(value && typeof value === "object");
}
const DEFAULT_AUTH_ACTION_ERROR_MESSAGE = "Request failed. Please try again.";
function getMessage(value) {
  if (value instanceof Error)
    return value.message;
  if (typeof value === "string")
    return value;
  if (isRecord(value) && typeof value.message === "string")
    return value.message;
  return DEFAULT_AUTH_ACTION_ERROR_MESSAGE;
}
function getCode(value) {
  if (!isRecord(value))
    return void 0;
  return typeof value.code === "string" ? value.code : void 0;
}
function getStatus(value) {
  if (!isRecord(value))
    return void 0;
  if (typeof value.status === "number")
    return value.status;
  if (typeof value.statusCode === "number")
    return value.statusCode;
  return void 0;
}
function normalizeAuthActionError(error) {
  return {
    message: getMessage(error),
    code: getCode(error),
    status: getStatus(error),
    raw: error
  };
}
function isSafeLocalRedirect(redirect) {
  if (typeof redirect !== "string")
    return;
  if (!redirect.startsWith("/") || redirect.startsWith("//"))
    return;
  return redirect;
}
function resolvePostAuthRedirect(requestURL) {
  const runtimeConfig = /* @__PURE__ */ useRuntimeConfig();
  const authConfig = runtimeConfig.public.auth;
  const redirectQueryKey = authConfig?.redirectQueryKey ?? "redirect";
  const queryRedirect = requestURL.searchParams?.get(redirectQueryKey);
  const safeQueryRedirect = isSafeLocalRedirect(queryRedirect);
  if (safeQueryRedirect)
    return safeQueryRedirect;
  return isSafeLocalRedirect(authConfig?.redirects?.authenticated);
}
function resolvePostAuthSuccessRedirect(requestURL) {
  const target = resolvePostAuthRedirect(requestURL);
  if (!target)
    return;
  return async () => {
    await navigateTo(target);
  };
}
function withFallbackSocialCallbackURL(data, requestURL) {
  const callbackURL = resolvePostAuthRedirect(requestURL);
  if (!callbackURL)
    return data;
  if (!isRecord(data))
    return { callbackURL };
  if (typeof data.callbackURL === "string")
    return data;
  return { ...data, callbackURL };
}
function stripToken(session) {
  const { token: _, ...safe } = session;
  return safe;
}
function isExpectedSignedOutSessionError(error) {
  const normalizedError = normalizeAuthActionError(error);
  if (normalizedError.status === 401)
    return true;
  return normalizedError.code === "UNAUTHORIZED";
}
async function fetchSessionServer(session, user, authReady, options = {}) {
  try {
    const headers = options.headers || useRequestHeaders(["cookie"]);
    const requestFetch = useRequestFetch();
    const data = await requestFetch("/api/auth/get-session", { headers });
    if (data?.session && data?.user) {
      session.value = stripToken(data.session);
      user.value = data.user;
    } else {
      session.value = null;
      user.value = null;
    }
  } catch {
    session.value = null;
    user.value = null;
  } finally {
    if (!authReady.value)
      authReady.value = true;
  }
}
async function fetchSessionClient(client, session, user, authReady, options = {}) {
  try {
    const headers = options.headers || useRequestHeaders(["cookie"]);
    const fetchOptions = headers ? { headers } : void 0;
    const query = options.force ? { disableCookieCache: true } : void 0;
    const result = await client.getSession({ query }, fetchOptions);
    const data = result.data;
    if (data?.session && data?.user) {
      session.value = stripToken(data.session);
      user.value = data.user;
    } else {
      session.value = null;
      user.value = null;
    }
  } catch (error) {
    session.value = null;
    user.value = null;
    if (!isExpectedSignedOutSessionError(error))
      console.error("[nuxt-better-auth] Failed to fetch session:", error);
  } finally {
    if (!authReady.value)
      authReady.value = true;
  }
}
function wrapOnSuccess(fetchSession, loggedIn, waitForSession, cb) {
  return async (ctx) => {
    await fetchSession({ force: true });
    if (!loggedIn.value)
      await waitForSession();
    await nextTick();
    await cb(ctx);
  };
}
function wrapAuthMethod(method, deps, wrapOptions = {}) {
  return (async (...args) => {
    const originalData = args[0];
    const options = args[1];
    const data = wrapOptions.transformData?.(originalData, options) ?? originalData;
    const dataRecord = isRecord(data) ? data : void 0;
    const optionsRecord = isRecord(options) ? options : void 0;
    if (wrapOptions.shouldSkipSessionSync?.(data, options))
      return method(data, options);
    const fetchOptions = isRecord(dataRecord?.fetchOptions) ? dataRecord.fetchOptions : void 0;
    const nestedOnSuccess = fetchOptions?.onSuccess;
    const topLevelOnSuccess = optionsRecord?.onSuccess;
    const fallbackOnSuccess = deps.resolvePostAuthSuccessRedirect();
    const wrappedFallbackOnSuccess = fallbackOnSuccess && wrapOnSuccess(deps.fetchSession, deps.loggedIn, deps.waitForSession, async () => {
      if (!deps.loggedIn.value)
        return;
      await fallbackOnSuccess();
    });
    if (typeof nestedOnSuccess === "function") {
      const nextData = {
        ...dataRecord,
        fetchOptions: {
          ...fetchOptions,
          onSuccess: wrapOnSuccess(deps.fetchSession, deps.loggedIn, deps.waitForSession, nestedOnSuccess)
        }
      };
      return method(nextData, options);
    }
    if (typeof topLevelOnSuccess === "function") {
      const nextOptions = {
        ...optionsRecord,
        onSuccess: wrapOnSuccess(deps.fetchSession, deps.loggedIn, deps.waitForSession, topLevelOnSuccess)
      };
      return method(data, nextOptions);
    }
    if (wrappedFallbackOnSuccess) {
      if (fetchOptions) {
        const nextData = {
          ...dataRecord,
          fetchOptions: {
            ...fetchOptions,
            onSuccess: wrappedFallbackOnSuccess
          }
        };
        return method(nextData, options);
      }
      const nextOptions = {
        ...optionsRecord,
        onSuccess: wrappedFallbackOnSuccess
      };
      return method(data, nextOptions);
    }
    return method(data, options);
  });
}
function useRequestURL(opts) {
  {
    return getRequestURL(useRequestEvent(), opts);
  }
}
const useStateKeyPrefix = "$s";
function useState(...args) {
  const autoKey = typeof args[args.length - 1] === "string" ? args.pop() : void 0;
  if (typeof args[0] !== "string") {
    args.unshift(autoKey);
  }
  const [_key, init] = args;
  if (!_key || typeof _key !== "string") {
    throw new TypeError("[nuxt] [useState] key must be a string: " + _key);
  }
  if (init !== void 0 && typeof init !== "function") {
    throw new Error("[nuxt] [useState] init must be a function: " + init);
  }
  const key = useStateKeyPrefix + _key;
  const nuxtApp = useNuxtApp();
  const state = toRef(nuxtApp.payload.state, key);
  if (init) {
    nuxtApp._state[key] ??= { _default: init };
  }
  if (state.value === void 0 && init) {
    const initialValue = init();
    if (isRef(initialValue)) {
      nuxtApp.payload.state[key] = initialValue;
      return initialValue;
    }
    state.value = initialValue;
  }
  return state;
}
let _sessionSignalListenerBound = false;
let _signOutPromise = null;
let _client = null;
function getClient(baseURL2) {
  if (!_client)
    _client = createAppAuthClient(baseURL2);
  return _client;
}
function getRuntimeFlags() {
  const globalFlags = globalThis.__NUXT_BETTER_AUTH_TEST_FLAGS__;
  if (globalFlags)
    return globalFlags;
  return { client: Boolean(false), server: Boolean(true) };
}
function ensureSessionSignalListener(client, onSignal) {
  if (_sessionSignalListenerBound)
    return;
  const store = client.$store;
  if (!isRecord(store))
    return;
  const listen = store.listen;
  if (typeof listen !== "function")
    return;
  _sessionSignalListenerBound = true;
  const listenFn = listen;
  listenFn("$sessionSignal", async () => {
    try {
      await onSignal();
    } catch {
    }
  });
}
function useUserSession() {
  const runtimeFlags = getRuntimeFlags();
  const runtimeConfig = /* @__PURE__ */ useRuntimeConfig();
  const requestURL = useRequestURL();
  const nuxtApp = useNuxtApp();
  const client = runtimeFlags.client ? getClient(runtimeConfig.public.siteUrl || requestURL.origin) : null;
  const session = useState("auth:session", () => null);
  const user = useState("auth:user", () => null);
  const authReady = useState("auth:ready", () => false);
  const prerenderReadyResetQueued = useState("auth:prerender-ready-reset-queued", () => false);
  const hydrationReconcileQueued = useState("auth:hydration-reconcile-queued", () => false);
  const ready = computed(() => authReady.value);
  const loggedIn = computed(() => Boolean(session.value && user.value));
  const isPrerenderedPayload = computed(() => Boolean(nuxtApp.payload.prerenderedAt || nuxtApp.payload.isCached));
  const isPrerenderHydrationEmptySnapshot = computed(() => {
    if (!runtimeFlags.client)
      return false;
    if (!nuxtApp.isHydrating || !nuxtApp.payload.serverRendered || !isPrerenderedPayload.value)
      return false;
    return !session.value && !user.value;
  });
  const skipHydratedSsrGetSession = computed(() => {
    const authConfig = runtimeConfig.public.auth;
    return Boolean(authConfig?.session?.skipHydratedSsrGetSession);
  });
  const shouldSkipInitialClientSessionFetch = computed(() => {
    if (!skipHydratedSsrGetSession.value)
      return false;
    if (!runtimeFlags.client)
      return false;
    if (!nuxtApp.payload.serverRendered)
      return false;
    if (isPrerenderedPayload.value)
      return false;
    return Boolean(session.value && user.value);
  });
  if (isPrerenderHydrationEmptySnapshot.value && authReady.value && !prerenderReadyResetQueued.value) {
    prerenderReadyResetQueued.value = true;
    nuxtApp.hook("app:suspense:resolve", () => {
      try {
        if (!session.value && !user.value && authReady.value)
          authReady.value = false;
      } finally {
        prerenderReadyResetQueued.value = false;
      }
    });
  }
  if (shouldSkipInitialClientSessionFetch.value && !authReady.value)
    authReady.value = true;
  function clearSession() {
    session.value = null;
    user.value = null;
  }
  async function fetchSession(options = {}) {
    if (runtimeFlags.server)
      return fetchSessionServer(session, user, authReady, options);
    if (client)
      return fetchSessionClient(client, session, user, authReady, options);
  }
  async function updateUser(updates) {
    if (!user.value)
      return;
    const previousUser = user.value;
    user.value = { ...user.value, ...updates };
    if (!client)
      return;
    try {
      const clientWithUpdateUser = client;
      const result = await clientWithUpdateUser.updateUser(updates);
      if (result?.error) {
        if (result.error instanceof Error)
          throw result.error;
        const normalizedError = normalizeAuthActionError(result.error);
        throw new Error(normalizedError.message);
      }
    } catch (error) {
      user.value = previousUser;
      if (!(error instanceof Error)) {
        const normalizedError = normalizeAuthActionError(error);
        throw new Error(normalizedError.message);
      }
      throw error;
    }
  }
  if (runtimeFlags.client && client && !shouldSkipInitialClientSessionFetch.value) {
    const clientSession = client.useSession();
    watch(
      () => clientSession.value,
      (newSession) => {
        const shouldWaitForPrerenderResolution = isPrerenderHydrationEmptySnapshot.value && !newSession?.data?.session && !newSession?.data?.user;
        if (shouldWaitForPrerenderResolution)
          return;
        if (newSession?.data?.session && newSession?.data?.user) {
          session.value = stripToken(newSession.data.session);
          user.value = newSession.data.user;
        } else if (!newSession?.isPending && !newSession?.isRefetching) {
          const isHydrationEmptySnapshot = nuxtApp.isHydrating && nuxtApp.payload.serverRendered && Boolean(session.value && user.value) && !newSession?.data?.session && !newSession?.data?.user;
          if (isHydrationEmptySnapshot) {
            if (!hydrationReconcileQueued.value) {
              hydrationReconcileQueued.value = true;
              nuxtApp.hook("app:mounted", async () => {
                await fetchSession({ force: true });
                hydrationReconcileQueued.value = false;
              });
            }
            return;
          }
          clearSession();
        }
        if (!authReady.value && !newSession?.isPending && !newSession?.isRefetching)
          authReady.value = true;
      },
      { immediate: true, deep: true }
    );
  }
  function waitForSession() {
    return new Promise((resolve) => {
      if (loggedIn.value) {
        resolve();
        return;
      }
      const unwatch = watch(loggedIn, (isLoggedIn) => {
        if (isLoggedIn) {
          unwatch();
          resolve();
        }
      });
      setTimeout(() => {
        unwatch();
        resolve();
      }, 5e3);
    });
  }
  const wrapDeps = {
    fetchSession,
    loggedIn,
    waitForSession,
    resolvePostAuthSuccessRedirect: () => resolvePostAuthSuccessRedirect(requestURL)
  };
  const signIn = client?.signIn ? new Proxy(client.signIn, {
    get(target, prop) {
      const targetRecord = target;
      const method = targetRecord[prop];
      if (typeof method !== "function")
        return method;
      const shouldSkipSessionSync = prop === "social" ? (data) => {
        const socialData = isRecord(data) ? data : void 0;
        return socialData?.disableRedirect !== true;
      } : void 0;
      const transformData = prop === "social" ? (data) => withFallbackSocialCallbackURL(data, requestURL) : void 0;
      return wrapAuthMethod(
        (...args) => targetRecord[prop](...args),
        wrapDeps,
        { shouldSkipSessionSync, transformData }
      );
    }
  }) : new Proxy({}, {
    get: (_, prop) => {
      throw new Error(`signIn.${String(prop)}() can only be called on client-side`);
    }
  });
  const signUp = client?.signUp ? new Proxy(client.signUp, {
    get(target, prop) {
      const targetRecord = target;
      const method = targetRecord[prop];
      if (typeof method !== "function")
        return method;
      return wrapAuthMethod((...args) => targetRecord[prop](...args), wrapDeps);
    }
  }) : new Proxy({}, {
    get: (_, prop) => {
      throw new Error(`signUp.${String(prop)}() can only be called on client-side`);
    }
  });
  if (runtimeFlags.client && client && shouldSkipInitialClientSessionFetch.value) {
    ensureSessionSignalListener(client, () => fetchSession({ force: true }));
  }
  async function signOut(options) {
    if (!client)
      throw new Error("signOut can only be called on client-side");
    if (_signOutPromise) {
      await _signOutPromise;
      return;
    }
    _signOutPromise = (async () => {
      await client.signOut();
      clearSession();
      if (options?.onSuccess) {
        await options.onSuccess();
        return;
      }
      const authConfig = runtimeConfig.public.auth;
      const logoutRedirect = authConfig?.redirects?.logout;
      if (logoutRedirect) {
        await nextTick();
        await navigateTo(logoutRedirect);
      }
    })().finally(() => {
      _signOutPromise = null;
    });
    await _signOutPromise;
  }
  return {
    client,
    session,
    user,
    loggedIn,
    ready,
    signIn,
    signUp,
    signOut,
    waitForSession,
    fetchSession,
    updateUser
  };
}
let authRouteRulesPromise = null;
let routeRulesMatcherPromise = null;
const auth = /* @__PURE__ */ defineNuxtRouteMiddleware(async (to) => {
  let __temp, __restore;
  useNuxtApp();
  if (to.meta.auth === void 0) {
    const routeRulesMatcher2 = ([__temp, __restore] = executeAsync(() => getRouteRulesMatcher()), __temp = await __temp, __restore(), __temp);
    const matches = routeRulesMatcher2?.matchAll(to.path);
    if (matches?.length) {
      const merged = defu$1({}, ...matches.reverse());
      if (merged.auth !== void 0)
        to.meta.auth = merged.auth;
    }
    if (to.meta.auth === void 0) {
      const rules = ([__temp, __restore] = executeAsync(() => getRouteRules({ path: to.path })), __temp = await __temp, __restore(), __temp);
      if (rules.auth !== void 0)
        to.meta.auth = rules.auth;
    }
  }
  const auth2 = to.meta.auth;
  if (auth2 === void 0 || auth2 === false)
    return;
  const config = (/* @__PURE__ */ useRuntimeConfig()).public.auth;
  const { fetchSession, user, loggedIn } = useUserSession();
  if (!loggedIn.value) {
    const headers = useRequestHeaders(["cookie"]);
    [__temp, __restore] = executeAsync(() => fetchSession({ headers, ...{} })), await __temp, __restore();
  }
  const mode = typeof auth2 === "string" ? auth2 : auth2?.only ?? "user";
  const redirectTo = typeof auth2 === "object" ? auth2.redirectTo : void 0;
  if (mode === "guest") {
    if (loggedIn.value)
      return navigateTo(redirectTo ?? config?.redirects?.guest ?? "/");
    return;
  }
  if (!loggedIn.value) {
    const resolved = resolveLoginRedirect({
      route: to,
      loginTarget: redirectTo ?? config?.redirects?.login ?? "/login",
      config
    });
    return resolved.external ? navigateTo(resolved.to, { external: true }) : navigateTo(resolved.to);
  }
  if (typeof auth2 === "object" && auth2.user) {
    if (!user.value || !matchesUser(user.value, auth2.user))
      throw createError({ statusCode: 403, statusMessage: "Access denied" });
  }
});
function resolveLoginRedirect(input) {
  const { route, loginTarget, config } = input;
  const preserveRedirect = config?.preserveRedirect ?? true;
  const redirectQueryKey = config?.redirectQueryKey ?? "redirect";
  if (!preserveRedirect)
    return { to: loginTarget, external: false };
  if (!loginTarget.startsWith("/") || loginTarget.startsWith("//"))
    return { to: loginTarget, external: false };
  const [beforeHash, hash = ""] = loginTarget.split("#", 2);
  const [path, query = ""] = beforeHash.split("?", 2);
  try {
    const params2 = new URLSearchParams(query);
    if (params2.has(redirectQueryKey))
      return { to: loginTarget, external: false };
  } catch {
    return { to: loginTarget, external: false };
  }
  {
    const separator = query ? "&" : "";
    const encodedRedirect = encodeURIComponent(route.fullPath);
    const url = `${path}?${query}${separator}${redirectQueryKey}=${encodedRedirect}${hash ? `#${hash}` : ""}`;
    return { to: url, external: true };
  }
}
async function getAuthRouteRules() {
  if (!authRouteRulesPromise) {
    authRouteRulesPromise = import('./virtual_nuxt__Users_wesleyukadike_Desktop_budds_node_modules_.cache_nuxt_.nuxt_better-auth_route-rules-hWIQKdvu.mjs').then((mod) => mod.authRouteRules || {}).catch(() => ({}));
  }
  return await authRouteRulesPromise;
}
async function getRouteRulesMatcher() {
  if (!routeRulesMatcherPromise) {
    routeRulesMatcherPromise = getAuthRouteRules().then((authRouteRules) => {
      if (!Object.keys(authRouteRules).length)
        return null;
      return toRouteMatcher(createRouter$1({ routes: authRouteRules }));
    });
  }
  return await routeRulesMatcherPromise;
}
const manifest_45route_45rule = /* @__PURE__ */ defineNuxtRouteMiddleware((to) => {
  {
    return;
  }
});
const globalMiddleware = [
  validate,
  auth,
  manifest_45route_45rule
];
const namedMiddleware = {};
const plugin = /* @__PURE__ */ defineNuxtPlugin({
  name: "nuxt:router",
  enforce: "pre",
  async setup(nuxtApp) {
    let __temp, __restore;
    let routerBase = (/* @__PURE__ */ useRuntimeConfig()).app.baseURL;
    const history = routerOptions.history?.(routerBase) ?? createMemoryHistory(routerBase);
    const routes = routerOptions.routes ? ([__temp, __restore] = executeAsync(() => routerOptions.routes(_routes)), __temp = await __temp, __restore(), __temp) ?? _routes : _routes;
    let startPosition;
    const router = createRouter({
      ...routerOptions,
      scrollBehavior: (to, from, savedPosition) => {
        if (from === START_LOCATION) {
          startPosition = savedPosition;
          return;
        }
        if (routerOptions.scrollBehavior) {
          router.options.scrollBehavior = routerOptions.scrollBehavior;
          if ("scrollRestoration" in (void 0).history) {
            const unsub = router.beforeEach(() => {
              unsub();
              (void 0).history.scrollRestoration = "manual";
            });
          }
          return routerOptions.scrollBehavior(to, START_LOCATION, startPosition || savedPosition);
        }
      },
      history,
      routes
    });
    nuxtApp.vueApp.use(router);
    const previousRoute = shallowRef(router.currentRoute.value);
    router.afterEach((_to, from) => {
      previousRoute.value = from;
    });
    Object.defineProperty(nuxtApp.vueApp.config.globalProperties, "previousRoute", {
      get: () => previousRoute.value
    });
    const initialURL = nuxtApp.ssrContext.url;
    const _route = shallowRef(router.currentRoute.value);
    const syncCurrentRoute = () => {
      _route.value = router.currentRoute.value;
    };
    router.afterEach((to, from) => {
      if (to.matched.at(-1)?.components?.default === from.matched.at(-1)?.components?.default) {
        syncCurrentRoute();
      }
    });
    const route = { sync: syncCurrentRoute };
    for (const key in _route.value) {
      Object.defineProperty(route, key, {
        get: () => _route.value[key],
        enumerable: true
      });
    }
    nuxtApp._route = shallowReactive(route);
    nuxtApp._middleware ||= {
      global: [],
      named: {}
    };
    const error = /* @__PURE__ */ useError();
    if (!nuxtApp.ssrContext?.islandContext) {
      router.afterEach(async (to, _from, failure) => {
        delete nuxtApp._processingMiddleware;
        if (failure) {
          await nuxtApp.callHook("page:loading:end");
        }
        if (failure?.type === 4) {
          return;
        }
        if (to.redirectedFrom && to.fullPath !== initialURL) {
          await nuxtApp.runWithContext(() => navigateTo(to.fullPath || "/"));
        }
      });
    }
    try {
      if (true) {
        ;
        [__temp, __restore] = executeAsync(() => router.push(initialURL)), await __temp, __restore();
        ;
      }
      ;
      [__temp, __restore] = executeAsync(() => router.isReady()), await __temp, __restore();
      ;
    } catch (error2) {
      [__temp, __restore] = executeAsync(() => nuxtApp.runWithContext(() => showError(error2))), await __temp, __restore();
    }
    const resolvedInitialRoute = router.currentRoute.value;
    const hasDeferredRoute = false;
    syncCurrentRoute();
    if (nuxtApp.ssrContext?.islandContext) {
      return { provide: { router } };
    }
    const initialLayout = nuxtApp.payload.state._layout;
    router.beforeEach(async (to, from) => {
      await nuxtApp.callHook("page:loading:start");
      to.meta = reactive(to.meta);
      if (nuxtApp.isHydrating && initialLayout && !isReadonly(to.meta.layout)) {
        to.meta.layout = initialLayout;
      }
      nuxtApp._processingMiddleware = true;
      if (!nuxtApp.ssrContext?.islandContext) {
        const middlewareEntries = /* @__PURE__ */ new Set([...globalMiddleware, ...nuxtApp._middleware.global]);
        for (const component of to.matched) {
          const componentMiddleware = component.meta.middleware;
          if (!componentMiddleware) {
            continue;
          }
          for (const entry2 of toArray(componentMiddleware)) {
            middlewareEntries.add(entry2);
          }
        }
        const routeRules = getRouteRules({ path: to.path });
        if (routeRules.appMiddleware) {
          for (const key in routeRules.appMiddleware) {
            if (routeRules.appMiddleware[key]) {
              middlewareEntries.add(key);
            } else {
              middlewareEntries.delete(key);
            }
          }
        }
        for (const entry2 of middlewareEntries) {
          const middleware = typeof entry2 === "string" ? nuxtApp._middleware.named[entry2] || await namedMiddleware[entry2]?.().then((r) => r.default || r) : entry2;
          if (!middleware) {
            throw new Error(`Unknown route middleware: '${entry2}'.`);
          }
          try {
            if (false) ;
            const result = await nuxtApp.runWithContext(() => middleware(to, from));
            if (true) {
              if (result === false || result instanceof Error) {
                const error2 = result || createError({
                  status: 404,
                  statusText: `Page Not Found: ${initialURL}`
                });
                await nuxtApp.runWithContext(() => showError(error2));
                return false;
              }
            }
            if (result === true) {
              continue;
            }
            if (result === false) {
              return result;
            }
            if (result) {
              if (isNuxtError(result) && result.fatal) {
                await nuxtApp.runWithContext(() => showError(result));
              }
              return result;
            }
          } catch (err) {
            const error2 = createError(err);
            if (error2.fatal) {
              await nuxtApp.runWithContext(() => showError(error2));
            }
            return error2;
          }
        }
      }
    });
    router.onError(async () => {
      delete nuxtApp._processingMiddleware;
      await nuxtApp.callHook("page:loading:end");
    });
    router.afterEach((to) => {
      if (to.matched.length === 0 && !error.value) {
        return nuxtApp.runWithContext(() => showError(createError({
          status: 404,
          fatal: false,
          statusText: `Page not found: ${to.fullPath}`,
          data: {
            path: to.fullPath
          }
        })));
      }
    });
    nuxtApp.hooks.hookOnce("app:created", async () => {
      try {
        if ("name" in resolvedInitialRoute) {
          resolvedInitialRoute.name = void 0;
        }
        if (hasDeferredRoute) ;
        else {
          await router.replace({
            ...resolvedInitialRoute,
            force: true
          });
        }
        router.options.scrollBehavior = routerOptions.scrollBehavior;
      } catch (error2) {
        await nuxtApp.runWithContext(() => showError(error2));
      }
    });
    return { provide: { router } };
  }
});
const session_server_59KlNXHvvfKBZsybnQ8BMdZo8jQihGR4b1YPIsq7xBA = /* @__PURE__ */ defineNuxtPlugin({
  name: "auth:session-init",
  enforce: "pre",
  async setup() {
    let __temp, __restore;
    const session = useState("auth:session", () => null);
    const user = useState("auth:user", () => null);
    const authReady = useState("auth:ready", () => false);
    const event = useRequestEvent();
    if (event) {
      try {
        const headers = useRequestHeaders(["cookie"]);
        const data = ([__temp, __restore] = executeAsync(() => $fetch("/api/auth/get-session", { headers })), __temp = await __temp, __restore(), __temp);
        if (data?.session && data?.user) {
          const { token: _, ...safeSession } = data.session;
          session.value = safeSession;
          user.value = data.user;
        }
      } catch {
      }
    }
    authReady.value = true;
  }
});
function definePayloadReducer(name, reduce) {
  {
    useNuxtApp().ssrContext["~payloadReducers"][name] = reduce;
  }
}
const reducers = [
  ["NuxtError", (data) => isNuxtError(data) && data.toJSON()],
  ["EmptyShallowRef", (data) => isRef(data) && isShallow(data) && !data.value && (typeof data.value === "bigint" ? "0n" : JSON.stringify(data.value) || "_")],
  ["EmptyRef", (data) => isRef(data) && !data.value && (typeof data.value === "bigint" ? "0n" : JSON.stringify(data.value) || "_")],
  ["ShallowRef", (data) => isRef(data) && isShallow(data) && data.value],
  ["ShallowReactive", (data) => isReactive(data) && isShallow(data) && toRaw(data)],
  ["Ref", (data) => isRef(data) && data.value],
  ["Reactive", (data) => isReactive(data) && toRaw(data)]
];
const revive_payload_server_RNvb0uGWa6zjXGddYJVHsGaVZZYBgZpT5qw3A1bEQpU = /* @__PURE__ */ defineNuxtPlugin({
  name: "nuxt:revive-payload:server",
  setup() {
    for (const [reducer, fn] of reducers) {
      definePayloadReducer(reducer, fn);
    }
  }
});
const components_plugin_4kY4pyzJIYX99vmMAAIorFf3CnAaptHitJgf7JxiED8 = /* @__PURE__ */ defineNuxtPlugin({
  name: "nuxt:global-components"
});
const plugins = [
  unhead_2RGNnFHTZ0_5NCXBsIKW4tSakBJSWgp2dLZInNkse3g,
  plugin,
  session_server_59KlNXHvvfKBZsybnQ8BMdZo8jQihGR4b1YPIsq7xBA,
  revive_payload_server_RNvb0uGWa6zjXGddYJVHsGaVZZYBgZpT5qw3A1bEQpU,
  components_plugin_4kY4pyzJIYX99vmMAAIorFf3CnAaptHitJgf7JxiED8
];
const defineRouteProvider = (name = "RouteProvider") => defineComponent({
  name,
  props: {
    route: {
      type: Object,
      required: true
    },
    vnode: Object,
    vnodeRef: Object,
    renderKey: String,
    trackRootNodes: Boolean
  },
  setup(props) {
    const previousKey = props.renderKey;
    const previousRoute = props.route;
    const route = {};
    for (const key in props.route) {
      Object.defineProperty(route, key, {
        get: () => previousKey === props.renderKey ? props.route[key] : previousRoute[key],
        enumerable: true
      });
    }
    provide(PageRouteSymbol, shallowReactive(route));
    return () => {
      if (!props.vnode) {
        return props.vnode;
      }
      return h(props.vnode, { ref: props.vnodeRef });
    };
  }
});
const RouteProvider = defineRouteProvider();
const __nuxt_component_0 = defineComponent({
  name: "NuxtPage",
  inheritAttrs: false,
  props: {
    name: {
      type: String
    },
    transition: {
      type: [Boolean, Object],
      default: void 0
    },
    keepalive: {
      type: [Boolean, Object],
      default: void 0
    },
    route: {
      type: Object
    },
    pageKey: {
      type: [Function, String],
      default: null
    }
  },
  setup(props, { attrs, slots, expose }) {
    const nuxtApp = useNuxtApp();
    const pageRef = ref();
    inject(PageRouteSymbol, null);
    expose({ pageRef });
    inject(LayoutMetaSymbol, null);
    nuxtApp.deferHydration();
    return () => {
      return h(RouterView, { name: props.name, route: props.route, ...attrs }, {
        default: (routeProps) => {
          return h(Suspense, { suspensible: true }, {
            default() {
              return h(RouteProvider, {
                vnode: slots.default ? normalizeSlot(slots.default, routeProps) : routeProps.Component,
                route: routeProps.route,
                vnodeRef: pageRef
              });
            }
          });
        }
      });
    };
  }
});
function normalizeSlot(slot, data) {
  const slotContent = slot(data);
  return slotContent.length === 1 ? h(slotContent[0]) : h(Fragment, void 0, slotContent);
}
const _export_sfc = (sfc, props) => {
  const target = sfc.__vccOpts || sfc;
  for (const [key, val] of props) {
    target[key] = val;
  }
  return target;
};
const _sfc_main$2 = {};
function _sfc_ssrRender(_ctx, _push, _parent, _attrs) {
  const _component_NuxtPage = __nuxt_component_0;
  _push(ssrRenderComponent(_component_NuxtPage, _attrs, null, _parent));
}
const _sfc_setup$2 = _sfc_main$2.setup;
_sfc_main$2.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("app.vue");
  return _sfc_setup$2 ? _sfc_setup$2(props, ctx) : void 0;
};
const AppComponent = /* @__PURE__ */ _export_sfc(_sfc_main$2, [["ssrRender", _sfc_ssrRender]]);
const _sfc_main$1 = {
  __name: "nuxt-error-page",
  __ssrInlineRender: true,
  props: {
    error: Object
  },
  setup(__props) {
    const props = __props;
    const _error = props.error;
    const status = Number(_error.statusCode || 500);
    const is404 = status === 404;
    const statusText = _error.statusMessage ?? (is404 ? "Page Not Found" : "Internal Server Error");
    const description = _error.message || _error.toString();
    const stack = void 0;
    const _Error404 = defineAsyncComponent(() => import('./error-404-C4NixouF.mjs'));
    const _Error = defineAsyncComponent(() => import('./error-500-DYX-vv9D.mjs'));
    const ErrorTemplate = is404 ? _Error404 : _Error;
    return (_ctx, _push, _parent, _attrs) => {
      _push(ssrRenderComponent(unref(ErrorTemplate), mergeProps({ status: unref(status), statusText: unref(statusText), statusCode: unref(status), statusMessage: unref(statusText), description: unref(description), stack: unref(stack) }, _attrs), null, _parent));
    };
  }
};
const _sfc_setup$1 = _sfc_main$1.setup;
_sfc_main$1.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("../node_modules/.pnpm/nuxt@4.4.2_b11074a74fb040b88eedb6fb7ae81571/node_modules/nuxt/dist/app/components/nuxt-error-page.vue");
  return _sfc_setup$1 ? _sfc_setup$1(props, ctx) : void 0;
};
const _sfc_main = {
  __name: "nuxt-root",
  __ssrInlineRender: true,
  setup(__props) {
    const IslandRenderer = () => null;
    const nuxtApp = useNuxtApp();
    nuxtApp.deferHydration();
    nuxtApp.ssrContext.url;
    const SingleRenderer = false;
    provide(PageRouteSymbol, useRoute());
    nuxtApp.hooks.callHookWith((hooks) => hooks.map((hook) => hook()), "vue:setup");
    const error = /* @__PURE__ */ useError();
    const abortRender = error.value && !nuxtApp.ssrContext.error;
    onErrorCaptured((err, target, info) => {
      nuxtApp.hooks.callHook("vue:error", err, target, info)?.catch((hookError) => console.error("[nuxt] Error in `vue:error` hook", hookError));
      {
        const p = nuxtApp.runWithContext(() => showError(err));
        onServerPrefetch(() => p);
        return false;
      }
    });
    const islandContext = nuxtApp.ssrContext.islandContext;
    return (_ctx, _push, _parent, _attrs) => {
      ssrRenderSuspense(_push, {
        default: () => {
          if (unref(abortRender)) {
            _push(`<div></div>`);
          } else if (unref(error)) {
            _push(ssrRenderComponent(unref(_sfc_main$1), { error: unref(error) }, null, _parent));
          } else if (unref(islandContext)) {
            _push(ssrRenderComponent(unref(IslandRenderer), { context: unref(islandContext) }, null, _parent));
          } else if (unref(SingleRenderer)) {
            ssrRenderVNode(_push, createVNode(resolveDynamicComponent(unref(SingleRenderer)), null, null), _parent);
          } else {
            _push(ssrRenderComponent(unref(AppComponent), null, null, _parent));
          }
        },
        _: 1
      });
    };
  }
};
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("../node_modules/.pnpm/nuxt@4.4.2_b11074a74fb040b88eedb6fb7ae81571/node_modules/nuxt/dist/app/components/nuxt-root.vue");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
let entry;
{
  entry = async function createNuxtAppServer(ssrContext) {
    const vueApp = createApp(_sfc_main);
    const nuxt = createNuxtApp({ vueApp, ssrContext });
    try {
      await applyPlugins(nuxt, plugins);
      await nuxt.hooks.callHook("app:created", vueApp);
    } catch (error) {
      await nuxt.hooks.callHook("app:error", error);
      nuxt.payload.error ||= createError(error);
    }
    if (ssrContext && (ssrContext["~renderResponse"] || ssrContext._renderResponse)) {
      throw new Error("skipping render");
    }
    return vueApp;
  };
}
const entry_default = ((ssrContext) => entry(ssrContext));

export { _export_sfc as _, useNuxtApp as a, useRuntimeConfig as b, nuxtLinkDefaults as c, useUserSession as d, entry_default as default, encodeRoutePath as e, navigateTo as n, resolveRouteObject as r, useRouter as u };
//# sourceMappingURL=server.mjs.map
