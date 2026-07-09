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
//#region src/server/marketplace.ts
var catalogSchema = z.object({
	model: z.string().optional(),
	category: z.string().optional(),
	sort: z.enum([
		"featured",
		"newest",
		"popular"
	]).optional(),
	q: z.string().optional(),
	favoritesOnly: z.boolean().optional(),
	freeOnly: z.boolean().optional()
});
var promptSchema = z.object({ promptId: z.number().int().positive() });
var getStorefront = createServerFn({ method: "GET" }).validator((input) => catalogSchema.parse(input ?? {})).handler(createSsrRpc("a860f1e520dcc24e8df4183c1a013683d9b45369d031a5689ac8c2102214af17"));
var getPromptDetail = createServerFn({ method: "GET" }).validator((input) => promptSchema.parse(input)).handler(createSsrRpc("c8dae31869d7704ea190d2bf1949e96655cf6042ee45e0279f1362488c32d921"));
var toggleFavoriteAction = createServerFn({ method: "POST" }).validator((input) => promptSchema.parse(input)).handler(createSsrRpc("ae9ab71da54857ec4ce02ff821ae2faac07c54f90d6f116dee02e1fc2ada0ad7"));
var addCartAction = createServerFn({ method: "POST" }).validator((input) => promptSchema.parse(input)).handler(createSsrRpc("be6005e000853bf519ef4bf67ffdc6a037de5ae828f6c2ffd124cbb4376f21bd"));
var removeCartAction = createServerFn({ method: "POST" }).validator((input) => promptSchema.parse(input)).handler(createSsrRpc("fbaf335b5f5eda8367524f34ab456ae92199532b7e07d9b4aaee62d3bbd218e8"));
var checkoutAction = createServerFn({ method: "POST" }).handler(createSsrRpc("32f263797c3bca1649f3fdf07a38b001685b0c7d6377c162c89f5647115b9145"));
var getCartState = createServerFn({ method: "GET" }).handler(createSsrRpc("9f3ba8fd06af3fdf98a34a34a5fea5697aa198abf9cb8cecbb48975407082a6d"));
var getCreatorAnalytics = createServerFn({ method: "GET" }).handler(createSsrRpc("b37d78c6f0b78f29550ecb729df212f3b23af28f212cfb4abe6f5b71ee197995"));
//#endregion
export { getPromptDetail as a, toggleFavoriteAction as c, getCreatorAnalytics as i, checkoutAction as n, getStorefront as o, getCartState as r, removeCartAction as s, addCartAction as t };
