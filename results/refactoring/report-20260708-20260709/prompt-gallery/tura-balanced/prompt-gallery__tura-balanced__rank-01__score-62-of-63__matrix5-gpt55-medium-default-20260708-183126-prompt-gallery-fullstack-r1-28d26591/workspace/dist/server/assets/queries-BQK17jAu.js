import { n as TSS_SERVER_FUNCTION, r as getServerFnById, t as createServerFn } from "../server.js";
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
//#region src/server/queries.ts
var getCatalogFn = createServerFn({ method: "GET" }).validator((data) => data).handler(createSsrRpc("970904723766c3e6160b593b922973b17f181b1461c9daddd6335b52a23cca52"));
var getPromptFn = createServerFn({ method: "GET" }).validator((id) => id).handler(createSsrRpc("4c6cdc043c643eb1f92d887131aaad7bf8338143a69cbdd293620bff57cd59b8"));
var getCartFn = createServerFn({ method: "GET" }).handler(createSsrRpc("e4747ba48447e7ebf23d6eac8a8143be4506d6a3ddfb950b49363f1956721565"));
var getAnalyticsFn = createServerFn({ method: "GET" }).handler(createSsrRpc("530c7b85bf1ad97bb4718fddca855905dd492dd7c5c7584fbf40bf4c8e8df2ac"));
var toggleFavoriteFn = createServerFn({ method: "POST" }).validator((id) => id).handler(createSsrRpc("f0a1aebe69f10935be5109da1c271bc5370eba796ef5ddb340e3cea5f1d9584f"));
var addToCartFn = createServerFn({ method: "POST" }).validator((id) => id).handler(createSsrRpc("e226ee45a36b009fd9cba791e9a888cb7a9518a6365310cbad533d8523f8ffcc"));
var checkoutCartFn = createServerFn({ method: "POST" }).handler(createSsrRpc("422f2f51120ef93b121e38cd1bf5861f3f31d5f19ecc04f138b85a398c40f710"));
//#endregion
export { getCatalogFn as a, getCartFn as i, checkoutCartFn as n, getPromptFn as o, getAnalyticsFn as r, toggleFavoriteFn as s, addToCartFn as t };
