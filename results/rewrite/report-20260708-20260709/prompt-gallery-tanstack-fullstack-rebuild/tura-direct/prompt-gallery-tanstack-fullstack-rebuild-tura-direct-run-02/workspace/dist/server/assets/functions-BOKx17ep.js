import { n as TSS_SERVER_FUNCTION, r as getServerFnById, t as createServerFn } from "../server.js";
import { t as CatalogInput } from "./queries-DYUnDG0Q.js";
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
var getCatalog = createServerFn({ method: "GET" }).validator((input) => CatalogInput.partial().parse(input ?? {})).handler(createSsrRpc("139f47dabd199ca193485998f05c0927e2db6a30f494389b8c480d8011f52eef"));
var getPromptDetail = createServerFn({ method: "GET" }).validator((input) => String(input ?? "")).handler(createSsrRpc("3eb9f0aa77bdb2987d0efea63552755d8d7acbbdf291915772f10c0fce7b138f"));
var toggleFavoriteAction = createServerFn({ method: "POST" }).validator((input) => String(input ?? "")).handler(createSsrRpc("95f42230fe6a291a6eb1077dc75ef082efebb42d5e39da48c3a0f438126981ef"));
var addCartAction = createServerFn({ method: "POST" }).validator((input) => String(input ?? "")).handler(createSsrRpc("13f0cf0f41384ab8786cfde842fae2aba39f43e639fc809f5adc617c86375fc8"));
var removeCartAction = createServerFn({ method: "POST" }).validator((input) => String(input ?? "")).handler(createSsrRpc("4e2d6bd5e56c16dc12def0231eb590d138ac36c44c47a93fca559c1a848b2355"));
var getCartState = createServerFn({ method: "GET" }).handler(createSsrRpc("791ad9f1009ae519a1b84b813bbf1227971ef2656a1154e9da2d4c18d7f77ccd"));
var checkoutAction = createServerFn({ method: "POST" }).handler(createSsrRpc("88a0aa3b3a0679fab1b61164564096ddaa7885cf0effd9ed2fee5d3a6b563426"));
var getAnalytics = createServerFn({ method: "GET" }).handler(createSsrRpc("b44ab6b9bf49d673887034f6193581aae0e7cfeaa8c5da9a11fb677b9ac3b058"));
//#endregion
export { getCatalog as a, toggleFavoriteAction as c, getCartState as i, checkoutAction as n, getPromptDetail as o, getAnalytics as r, removeCartAction as s, addCartAction as t };
