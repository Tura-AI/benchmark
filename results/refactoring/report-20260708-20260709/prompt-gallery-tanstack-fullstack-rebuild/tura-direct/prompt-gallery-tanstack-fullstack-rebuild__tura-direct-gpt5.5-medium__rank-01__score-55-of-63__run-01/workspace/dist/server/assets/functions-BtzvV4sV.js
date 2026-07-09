import { n as TSS_SERVER_FUNCTION, r as getServerFnById, t as createServerFn } from "../server.js";
import { z } from "zod";
//#region node_modules/@tanstack/start-server-core/dist/esm/createSsrRpc.js
var createSsrRpc = (functionId) => {
	const url = "/_serverFn/" + functionId;
	const serverFnMeta = { id: functionId };
	const fn = async (...args) => {
		return (await getServerFnById(functionId, { origin: "server" }))(...args);
	};
	return Object.assign(fn, {
		url,
		serverFnMeta,
		[TSS_SERVER_FUNCTION]: true
	});
};
//#endregion
//#region src/server/functions.ts
var catalogInput = z.object({
	model: z.string().optional(),
	category: z.string().optional(),
	sort: z.enum([
		"Featured",
		"Newest",
		"Popular"
	]).optional(),
	q: z.string().optional(),
	favorites: z.boolean().optional()
});
var promptInput = z.object({ promptId: z.string().min(1) });
var getCatalogFn = createServerFn({ method: "GET" }).validator((data) => catalogInput.parse(data ?? {})).handler(createSsrRpc("22280aa419ab6fe111f40373b7a5bcd703591f084b854a2961084956e87eb10d"));
var getPromptFn = createServerFn({ method: "GET" }).validator((data) => promptInput.parse(data)).handler(createSsrRpc("521f90fb1eb33240989f6de95c778a66a174f1297fbc3dc2abe27b749bdf966b"));
var toggleFavoriteFn = createServerFn({ method: "POST" }).validator((data) => promptInput.parse(data)).handler(createSsrRpc("469896283cff030cc9bc742d5b57d0523e86f532c737dc6c2de8e8212111ef87"));
var addToCartFn = createServerFn({ method: "POST" }).validator((data) => promptInput.parse(data)).handler(createSsrRpc("13799a03ae7e7b916d209dbe27de59c54730206602ac449aa88230f3f2f3850c"));
var removeFromCartFn = createServerFn({ method: "POST" }).validator((data) => promptInput.parse(data)).handler(createSsrRpc("9cd9c31ab345fa0967ecdfc52dfda96db12aa517a28776ddd9c56ba22208f130"));
var getCartFn = createServerFn({ method: "GET" }).handler(createSsrRpc("13dd8f8d8da9e853736e64202f2ebfd2a0f118c2db4a90aed3bd3dfd037517b5"));
var checkoutFn = createServerFn({ method: "POST" }).handler(createSsrRpc("d0e4d1410ee7278af658890a54f5561caddf0137bad34573e64966a4f328ca79"));
var getAnalyticsFn = createServerFn({ method: "GET" }).handler(createSsrRpc("2aac43ce6a2882cb9124d98454a3954aba15ec4c6fa224b19fb952d642f612b7"));
//#endregion
export { getCatalogFn as a, toggleFavoriteFn as c, getCartFn as i, checkoutFn as n, getPromptFn as o, getAnalyticsFn as r, removeFromCartFn as s, addToCartFn as t };
