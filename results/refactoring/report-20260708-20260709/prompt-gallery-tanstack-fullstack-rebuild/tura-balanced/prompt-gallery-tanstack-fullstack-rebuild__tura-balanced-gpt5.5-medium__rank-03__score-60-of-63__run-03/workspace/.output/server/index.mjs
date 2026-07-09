globalThis.__nitro_main__ = import.meta.url;
import { a as toEventHandler, c as NodeResponse, i as defineLazyEventHandler, l as serve, n as HTTPError, r as defineHandler, t as H3Core } from "./_libs/h3+rou3+srvx.mjs";
import { i as withoutTrailingSlash, n as joinURL, r as withLeadingSlash, t as decodePath } from "./_libs/ufo.mjs";
import { promises } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
//#region node_modules/nitro/dist/runtime/internal/route-rules.mjs
var headers = ((m) => function headersRouteRule(event) {
	for (const [key, value] of Object.entries(m.options || {})) event.res.headers.set(key, value);
});
//#endregion
//#region #nitro/virtual/public-assets-data
var public_assets_data_default = {
	"/assets/admin.analytics-B04dzSgr.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"677-jHS/CDhQUur2xYS/o08L01yQSq8\"",
		"mtime": "2026-07-09T10:08:17.249Z",
		"size": 1655,
		"path": "../public/assets/admin.analytics-B04dzSgr.js"
	},
	"/assets/app-gIyr5pww.css": {
		"type": "text/css; charset=utf-8",
		"etag": "\"3727-FiJq1sSQpqvEpPL0ubHffMYIzRw\"",
		"mtime": "2026-07-09T10:08:17.249Z",
		"size": 14119,
		"path": "../public/assets/app-gIyr5pww.css"
	},
	"/assets/cart-0pE6Crx8.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"5ad-KwE1pXDp05pSpTQxvVzR9KX48/g\"",
		"mtime": "2026-07-09T10:08:17.249Z",
		"size": 1453,
		"path": "../public/assets/cart-0pE6Crx8.js"
	},
	"/assets/FormatMoney-CtBTfXhe.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"110-cAV11j2u3qHqtKzfmHziW6NMjf0\"",
		"mtime": "2026-07-09T10:08:17.247Z",
		"size": 272,
		"path": "../public/assets/FormatMoney-CtBTfXhe.js"
	},
	"/assets/prompts._promptId-DS-ZEFeb.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"506-5iAR8FCJRdqxUx2+OGABICPbgPE\"",
		"mtime": "2026-07-09T10:08:17.249Z",
		"size": 1286,
		"path": "../public/assets/prompts._promptId-DS-ZEFeb.js"
	},
	"/assets/routes-D4tQz_GQ.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"2ec3-jWW6+J1Wzk0hQUeKcEhR9JK5juo\"",
		"mtime": "2026-07-09T10:08:17.249Z",
		"size": 11971,
		"path": "../public/assets/routes-D4tQz_GQ.js"
	},
	"/media/prompts/pp101.svg": {
		"type": "image/svg+xml",
		"etag": "\"532-F5Lcv5iN6y4Cgp6ZV6xFbTqqivg\"",
		"mtime": "2026-07-09T09:33:33.949Z",
		"size": 1330,
		"path": "../public/media/prompts/pp101.svg"
	},
	"/media/prompts/pp118.svg": {
		"type": "image/svg+xml",
		"etag": "\"51a-n4zWiKzs9WtJb28Ifp5/8ztw+9E\"",
		"mtime": "2026-07-09T09:33:33.943Z",
		"size": 1306,
		"path": "../public/media/prompts/pp118.svg"
	},
	"/media/prompts/pp142.svg": {
		"type": "image/svg+xml",
		"etag": "\"532-BrDmIMw8l264eCk7UD7VW6KSHCo\"",
		"mtime": "2026-07-09T09:33:33.944Z",
		"size": 1330,
		"path": "../public/media/prompts/pp142.svg"
	},
	"/media/prompts/pp160.svg": {
		"type": "image/svg+xml",
		"etag": "\"51a-E3nILYhuYdkgJ6sn/AYKxrf7Y0Y\"",
		"mtime": "2026-07-09T09:33:33.946Z",
		"size": 1306,
		"path": "../public/media/prompts/pp160.svg"
	},
	"/media/prompts/pp156.svg": {
		"type": "image/svg+xml",
		"etag": "\"532-rD03SeHnQVAJ/QhVqey5ACKxFR8\"",
		"mtime": "2026-07-09T09:33:33.949Z",
		"size": 1330,
		"path": "../public/media/prompts/pp156.svg"
	},
	"/media/prompts/pp174.svg": {
		"type": "image/svg+xml",
		"etag": "\"532-HVGasqEoogQsP6p/i0ZY0MbmlwY\"",
		"mtime": "2026-07-09T09:33:33.942Z",
		"size": 1330,
		"path": "../public/media/prompts/pp174.svg"
	},
	"/media/prompts/pp198.svg": {
		"type": "image/svg+xml",
		"etag": "\"532-2Ar5lSNEmE8A8E48Nbl6Ye3gB+g\"",
		"mtime": "2026-07-09T09:33:33.944Z",
		"size": 1330,
		"path": "../public/media/prompts/pp198.svg"
	},
	"/media/prompts/pp189.svg": {
		"type": "image/svg+xml",
		"etag": "\"532-+lfFFhdUgpTP/gvEt58ZCCVaBL4\"",
		"mtime": "2026-07-09T09:33:33.946Z",
		"size": 1330,
		"path": "../public/media/prompts/pp189.svg"
	},
	"/media/prompts/pp207.svg": {
		"type": "image/svg+xml",
		"etag": "\"50b-PI1BHEOy3zshSMwtj6LGX9qoC84\"",
		"mtime": "2026-07-09T09:33:33.942Z",
		"size": 1291,
		"path": "../public/media/prompts/pp207.svg"
	},
	"/media/prompts/pp211.svg": {
		"type": "image/svg+xml",
		"etag": "\"51a-2s6dIlYRJPskSHqdXWuHwdwnPxE\"",
		"mtime": "2026-07-09T09:33:33.947Z",
		"size": 1306,
		"path": "../public/media/prompts/pp211.svg"
	},
	"/media/prompts/pp212.svg": {
		"type": "image/svg+xml",
		"etag": "\"51a-bC/mKRfsPsaID7Kqcx8pvOHe/jU\"",
		"mtime": "2026-07-09T09:33:33.948Z",
		"size": 1306,
		"path": "../public/media/prompts/pp212.svg"
	},
	"/assets/index-BGO9e2If.js": {
		"type": "text/javascript; charset=utf-8",
		"etag": "\"4ed87-QP4ql5Z/eo8wBJzZHsKTqZq2tK0\"",
		"mtime": "2026-07-09T10:08:17.245Z",
		"size": 322951,
		"path": "../public/assets/index-BGO9e2If.js"
	},
	"/media/prompts/pp248.svg": {
		"type": "image/svg+xml",
		"etag": "\"532-2WtGHWF5rd7QehKcX51t2TbtDpo\"",
		"mtime": "2026-07-09T09:33:33.948Z",
		"size": 1330,
		"path": "../public/media/prompts/pp248.svg"
	},
	"/media/prompts/pp233.svg": {
		"type": "image/svg+xml",
		"etag": "\"51a-Zy2sad2HRKQmP688F1jgckjVxeY\"",
		"mtime": "2026-07-09T09:33:33.942Z",
		"size": 1306,
		"path": "../public/media/prompts/pp233.svg"
	},
	"/media/prompts/pp267.svg": {
		"type": "image/svg+xml",
		"etag": "\"51a-9IWDFSZpiR4IQOx8XuIldhYWTWc\"",
		"mtime": "2026-07-09T09:33:33.949Z",
		"size": 1306,
		"path": "../public/media/prompts/pp267.svg"
	},
	"/media/prompts/pp221.svg": {
		"type": "image/svg+xml",
		"etag": "\"50b-4Wgx2flT9EnzR+kcsynESlriyiE\"",
		"mtime": "2026-07-09T09:33:33.950Z",
		"size": 1291,
		"path": "../public/media/prompts/pp221.svg"
	},
	"/media/prompts/pp290.svg": {
		"type": "image/svg+xml",
		"etag": "\"532-M7GYyuiKnWUUDOpBGyekWL4ACpo\"",
		"mtime": "2026-07-09T09:33:33.950Z",
		"size": 1330,
		"path": "../public/media/prompts/pp290.svg"
	},
	"/media/prompts/pp276.svg": {
		"type": "image/svg+xml",
		"etag": "\"50b-WW1ZRPxSaWi6bqE+ReWWdaZJn9k\"",
		"mtime": "2026-07-09T09:33:33.947Z",
		"size": 1291,
		"path": "../public/media/prompts/pp276.svg"
	},
	"/media/prompts/pp255.svg": {
		"type": "image/svg+xml",
		"etag": "\"50b-DYB9sLUPwq5jCMgp8BaSLcmn2Lc\"",
		"mtime": "2026-07-09T09:33:33.946Z",
		"size": 1291,
		"path": "../public/media/prompts/pp255.svg"
	},
	"/media/prompts/pp301.svg": {
		"type": "image/svg+xml",
		"etag": "\"532-MXZCGXBXC8yGQ0zDGX7vEh+0ACg\"",
		"mtime": "2026-07-09T09:33:33.943Z",
		"size": 1330,
		"path": "../public/media/prompts/pp301.svg"
	},
	"/media/prompts/pp31.svg": {
		"type": "image/svg+xml",
		"etag": "\"530-h8GFd2+vbkulqKsfQNPmrhzopOo\"",
		"mtime": "2026-07-09T09:33:33.947Z",
		"size": 1328,
		"path": "../public/media/prompts/pp31.svg"
	},
	"/media/prompts/pp77.svg": {
		"type": "image/svg+xml",
		"etag": "\"518-o34o0cwhaQZyKwNPHBFaT8gi/co\"",
		"mtime": "2026-07-09T09:33:33.950Z",
		"size": 1304,
		"path": "../public/media/prompts/pp77.svg"
	},
	"/media/prompts/pp63.svg": {
		"type": "image/svg+xml",
		"etag": "\"530-Izsw5zKG9OSTGA8EPrTHuSa9Llo\"",
		"mtime": "2026-07-09T09:33:33.951Z",
		"size": 1328,
		"path": "../public/media/prompts/pp63.svg"
	}
};
//#endregion
//#region #nitro/virtual/public-assets-node
function readAsset(id) {
	const serverDir = dirname(fileURLToPath(globalThis.__nitro_main__));
	return promises.readFile(resolve(serverDir, public_assets_data_default[id].path));
}
//#endregion
//#region #nitro/virtual/public-assets
var publicAssetBases = {};
function isPublicAssetURL(id = "") {
	if (public_assets_data_default[id]) return true;
	for (const base in publicAssetBases) if (id.startsWith(base)) return true;
	return false;
}
function getAsset(id) {
	return public_assets_data_default[id];
}
//#endregion
//#region node_modules/nitro/dist/runtime/internal/static.mjs
var METHODS = /* @__PURE__ */ new Set(["HEAD", "GET"]);
var EncodingMap = {
	gzip: ".gz",
	br: ".br",
	zstd: ".zst"
};
var static_default = defineHandler((event) => {
	if (event.req.method && !METHODS.has(event.req.method)) return;
	let id = decodePath(withLeadingSlash(withoutTrailingSlash(event.url.pathname)));
	let asset;
	const encodings = [...(event.req.headers.get("accept-encoding") || "").split(",").map((e) => EncodingMap[e.trim()]).filter(Boolean).sort(), ""];
	for (const encoding of encodings) for (const _id of [id + encoding, joinURL(id, "index.html" + encoding)]) {
		const _asset = getAsset(_id);
		if (_asset) {
			asset = _asset;
			id = _id;
			break;
		}
	}
	if (!asset) {
		if (isPublicAssetURL(id)) {
			event.res.headers.delete("Cache-Control");
			throw new HTTPError({ status: 404 });
		}
		return;
	}
	if (encodings.length > 1) event.res.headers.append("Vary", "Accept-Encoding");
	if (event.req.headers.get("if-none-match") === asset.etag) {
		event.res.status = 304;
		event.res.statusText = "Not Modified";
		return "";
	}
	const ifModifiedSinceH = event.req.headers.get("if-modified-since");
	const mtimeDate = new Date(asset.mtime);
	if (ifModifiedSinceH && asset.mtime && new Date(ifModifiedSinceH) >= mtimeDate) {
		event.res.status = 304;
		event.res.statusText = "Not Modified";
		return "";
	}
	if (asset.type) event.res.headers.set("Content-Type", asset.type);
	if (asset.etag && !event.res.headers.has("ETag")) event.res.headers.set("ETag", asset.etag);
	if (asset.mtime && !event.res.headers.has("Last-Modified")) event.res.headers.set("Last-Modified", mtimeDate.toUTCString());
	if (asset.encoding && !event.res.headers.has("Content-Encoding")) event.res.headers.set("Content-Encoding", asset.encoding);
	if (asset.size > 0 && !event.res.headers.has("Content-Length")) event.res.headers.set("Content-Length", asset.size.toString());
	return readAsset(id);
});
//#endregion
//#region #nitro/virtual/routing
var findRouteRules = /* @__PURE__ */ (() => {
	const $0 = [{
		name: "headers",
		route: "/assets/**",
		handler: headers,
		options: { "cache-control": "public, max-age=31536000, immutable" }
	}];
	return (m, p) => {
		let r = [];
		if (p.charCodeAt(p.length - 1) === 47) p = p.slice(0, -1) || "/";
		let s = p.split("/");
		if (s.length > 1) {
			if (s[1] === "assets") r.unshift({
				data: $0,
				params: { "_": s.slice(2).join("/") }
			});
		}
		return r;
	};
})();
var _lazy_L48bvs = defineLazyEventHandler(() => import("./_chunks/ssr-renderer.mjs"));
var findRoute = /* @__PURE__ */ (() => {
	const data = {
		route: "/**",
		handler: _lazy_L48bvs
	};
	return ((_m, p) => {
		return {
			data,
			params: { "_": p.slice(1) }
		};
	});
})();
var globalMiddleware = [toEventHandler(static_default)].filter(Boolean);
//#endregion
//#region node_modules/nitro/dist/runtime/internal/error/prod.mjs
var errorHandler = (error, event) => {
	const res = defaultHandler(error, event);
	return new NodeResponse(typeof res.body === "string" ? res.body : JSON.stringify(res.body, null, 2), res);
};
function defaultHandler(error, event) {
	const unhandled = error.unhandled ?? !HTTPError.isError(error);
	const { status = 500, statusText = "" } = unhandled ? {} : error;
	if (status === 404) {
		const url = event.url || new URL(event.req.url);
		const baseURL = "/";
		if (/^\/[^/]/.test(baseURL) && !url.pathname.startsWith(baseURL)) return {
			status: 302,
			headers: new Headers({ location: `${baseURL}${url.pathname.slice(1)}${url.search}` })
		};
	}
	const headers = new Headers(unhandled ? {} : error.headers);
	headers.set("content-type", "application/json; charset=utf-8");
	return {
		status,
		statusText,
		headers,
		body: {
			error: true,
			...unhandled ? {
				status,
				unhandled: true
			} : typeof error.toJSON === "function" ? error.toJSON() : {
				status,
				statusText,
				message: error.message
			}
		}
	};
}
//#endregion
//#region #nitro/virtual/error-handler
var errorHandlers = [errorHandler];
async function error_handler_default(error, event) {
	for (const handler of errorHandlers) try {
		const response = await handler(error, event, { defaultHandler });
		if (response) return response;
	} catch (error) {
		console.error(error);
	}
}
//#endregion
//#region #nitro/virtual/app
function createNitroApp() {
	const captureError = (error, errorCtx) => {
		if (errorCtx?.event) {
			const errors = errorCtx.event.req.context?.nitro?.errors;
			if (errors) errors.push({
				error,
				context: errorCtx
			});
		}
	};
	const h3App = createH3App({ onError(error, event) {
		return error_handler_default(error, event);
	} });
	let appHandler = (req) => {
		req.context ||= {};
		req.context.nitro = req.context.nitro || { errors: [] };
		return h3App.fetch(req);
	};
	return {
		fetch: appHandler,
		h3: h3App,
		hooks: void 0,
		captureError
	};
}
function createH3App(config) {
	const h3App = new H3Core(config);
	h3App["~findRoute"] = (event) => findRoute(event.req.method, event.url.pathname);
	h3App["~middleware"].push(...globalMiddleware);
	h3App["~getMiddleware"] = (event, route) => {
		const pathname = event.url.pathname;
		const method = event.req.method;
		const middleware = [];
		const routeRules = getRouteRules(method, pathname);
		event.context.routeRules = routeRules?.routeRules;
		if (routeRules?.routeRuleMiddleware.length) middleware.push(...routeRules.routeRuleMiddleware);
		middleware.push(...h3App["~middleware"]);
		if (route?.data?.middleware?.length) middleware.push(...route.data.middleware);
		return middleware;
	};
	return h3App;
}
//#endregion
//#region node_modules/nitro/dist/runtime/internal/app.mjs
var APP_ID = "default";
function useNitroApp() {
	let instance = useNitroApp._instance;
	if (instance) return instance;
	instance = useNitroApp._instance = createNitroApp();
	globalThis.__nitro__ = globalThis.__nitro__ || {};
	globalThis.__nitro__[APP_ID] = instance;
	return instance;
}
function getRouteRules(method, pathname) {
	const m = findRouteRules(method, pathname);
	if (!m?.length) return { routeRuleMiddleware: [] };
	const routeRules = {};
	for (const layer of m) for (const rule of layer.data) {
		const currentRule = routeRules[rule.name];
		if (currentRule) {
			if (rule.options === false) {
				delete routeRules[rule.name];
				continue;
			}
			if (typeof currentRule.options === "object" && typeof rule.options === "object") currentRule.options = {
				...currentRule.options,
				...rule.options
			};
			else currentRule.options = rule.options;
			currentRule.route = rule.route;
			currentRule.params = {
				...currentRule.params,
				...layer.params
			};
		} else if (rule.options !== false) routeRules[rule.name] = {
			...rule,
			params: layer.params
		};
	}
	const middleware = [];
	const orderedRules = Object.values(routeRules).sort((a, b) => (a.handler?.order || 0) - (b.handler?.order || 0));
	for (const rule of orderedRules) {
		if (rule.options === false || !rule.handler) continue;
		middleware.push(rule.handler(rule));
	}
	return {
		routeRules,
		routeRuleMiddleware: middleware
	};
}
//#endregion
//#region node_modules/nitro/dist/runtime/internal/error/hooks.mjs
function _captureError(error, type) {
	console.error(`[${type}]`, error);
	useNitroApp().captureError?.(error, { tags: [type] });
}
function trapUnhandledErrors() {
	process.on("unhandledRejection", (error) => _captureError(error, "unhandledRejection"));
	process.on("uncaughtException", (error) => _captureError(error, "uncaughtException"));
}
//#endregion
//#region #nitro/virtual/tracing
var tracingSrvxPlugins = [];
//#endregion
//#region node_modules/nitro/dist/presets/node/runtime/node-server.mjs
var _parsedPort = Number.parseInt(process.env.NITRO_PORT ?? process.env.PORT ?? "");
var port = Number.isNaN(_parsedPort) ? 3e3 : _parsedPort;
var host = process.env.NITRO_HOST || process.env.HOST;
var cert = process.env.NITRO_SSL_CERT;
var key = process.env.NITRO_SSL_KEY;
var nitroApp = useNitroApp();
serve({
	port,
	hostname: host,
	tls: cert && key ? {
		cert,
		key
	} : void 0,
	fetch: nitroApp.fetch,
	plugins: [...tracingSrvxPlugins]
});
trapUnhandledErrors();
var node_server_default = {};
//#endregion
export { node_server_default as default };
