import { n as TSS_SERVER_FUNCTION, t as createServerFn } from "../server.js";
import { a as getCategories, d as toggleFavorite, f as USER_ID, i as getCart, l as listPrompts, n as checkout, o as getFilterCounts, r as getAnalytics, s as getPrompt, t as addToCart, u as removeFromCart } from "./queries-BkgkyYDi.js";
import { z } from "zod";
//#region node_modules/@tanstack/start-server-core/dist/esm/createServerRpc.js
var createServerRpc = (serverFnMeta, splitImportFn) => {
	const url = "/_serverFn/" + serverFnMeta.id;
	return Object.assign(splitImportFn, {
		url,
		serverFnMeta,
		[TSS_SERVER_FUNCTION]: true
	});
};
//#endregion
//#region src/server/marketplace-api.ts
function storefrontApi(data = {}) {
	return {
		prompts: listPrompts({
			...data,
			userId: USER_ID
		}),
		categories: getCategories(),
		counts: getFilterCounts(USER_ID),
		cart: getCart(USER_ID)
	};
}
function promptDetailApi(promptId) {
	const prompt = getPrompt(promptId, USER_ID);
	if (!prompt) throw new Error("Prompt not found");
	return {
		prompt,
		cart: getCart(USER_ID)
	};
}
function toggleFavoriteApi(promptId) {
	return {
		favorite: toggleFavorite(promptId, USER_ID),
		counts: getFilterCounts(USER_ID)
	};
}
function addCartApi(promptId) {
	return { cart: addToCart(promptId, USER_ID) };
}
function removeCartApi(promptId) {
	return { cart: removeFromCart(promptId, USER_ID) };
}
function checkoutApi() {
	return checkout(USER_ID);
}
function cartStateApi() {
	return getCart(USER_ID);
}
function creatorAnalyticsApi() {
	return getAnalytics();
}
//#endregion
//#region src/server/marketplace.ts?tss-serverfn-split
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
var getStorefront_createServerFn_handler = createServerRpc({
	id: "a860f1e520dcc24e8df4183c1a013683d9b45369d031a5689ac8c2102214af17",
	name: "getStorefront",
	filename: "src/server/marketplace.ts"
}, (opts) => getStorefront.__executeServer(opts));
var getStorefront = createServerFn({ method: "GET" }).validator((input) => catalogSchema.parse(input ?? {})).handler(getStorefront_createServerFn_handler, ({ data }) => storefrontApi(data));
var getPromptDetail_createServerFn_handler = createServerRpc({
	id: "c8dae31869d7704ea190d2bf1949e96655cf6042ee45e0279f1362488c32d921",
	name: "getPromptDetail",
	filename: "src/server/marketplace.ts"
}, (opts) => getPromptDetail.__executeServer(opts));
var getPromptDetail = createServerFn({ method: "GET" }).validator((input) => promptSchema.parse(input)).handler(getPromptDetail_createServerFn_handler, ({ data }) => promptDetailApi(data.promptId));
var toggleFavoriteAction_createServerFn_handler = createServerRpc({
	id: "ae9ab71da54857ec4ce02ff821ae2faac07c54f90d6f116dee02e1fc2ada0ad7",
	name: "toggleFavoriteAction",
	filename: "src/server/marketplace.ts"
}, (opts) => toggleFavoriteAction.__executeServer(opts));
var toggleFavoriteAction = createServerFn({ method: "POST" }).validator((input) => promptSchema.parse(input)).handler(toggleFavoriteAction_createServerFn_handler, ({ data }) => toggleFavoriteApi(data.promptId));
var addCartAction_createServerFn_handler = createServerRpc({
	id: "be6005e000853bf519ef4bf67ffdc6a037de5ae828f6c2ffd124cbb4376f21bd",
	name: "addCartAction",
	filename: "src/server/marketplace.ts"
}, (opts) => addCartAction.__executeServer(opts));
var addCartAction = createServerFn({ method: "POST" }).validator((input) => promptSchema.parse(input)).handler(addCartAction_createServerFn_handler, ({ data }) => addCartApi(data.promptId));
var removeCartAction_createServerFn_handler = createServerRpc({
	id: "fbaf335b5f5eda8367524f34ab456ae92199532b7e07d9b4aaee62d3bbd218e8",
	name: "removeCartAction",
	filename: "src/server/marketplace.ts"
}, (opts) => removeCartAction.__executeServer(opts));
var removeCartAction = createServerFn({ method: "POST" }).validator((input) => promptSchema.parse(input)).handler(removeCartAction_createServerFn_handler, ({ data }) => removeCartApi(data.promptId));
var checkoutAction_createServerFn_handler = createServerRpc({
	id: "32f263797c3bca1649f3fdf07a38b001685b0c7d6377c162c89f5647115b9145",
	name: "checkoutAction",
	filename: "src/server/marketplace.ts"
}, (opts) => checkoutAction.__executeServer(opts));
var checkoutAction = createServerFn({ method: "POST" }).handler(checkoutAction_createServerFn_handler, () => checkoutApi());
var getCartState_createServerFn_handler = createServerRpc({
	id: "9f3ba8fd06af3fdf98a34a34a5fea5697aa198abf9cb8cecbb48975407082a6d",
	name: "getCartState",
	filename: "src/server/marketplace.ts"
}, (opts) => getCartState.__executeServer(opts));
var getCartState = createServerFn({ method: "GET" }).handler(getCartState_createServerFn_handler, () => cartStateApi());
var getCreatorAnalytics_createServerFn_handler = createServerRpc({
	id: "b37d78c6f0b78f29550ecb729df212f3b23af28f212cfb4abe6f5b71ee197995",
	name: "getCreatorAnalytics",
	filename: "src/server/marketplace.ts"
}, (opts) => getCreatorAnalytics.__executeServer(opts));
var getCreatorAnalytics = createServerFn({ method: "GET" }).handler(getCreatorAnalytics_createServerFn_handler, () => creatorAnalyticsApi());
//#endregion
export { addCartAction_createServerFn_handler, checkoutAction_createServerFn_handler, getCartState_createServerFn_handler, getCreatorAnalytics_createServerFn_handler, getPromptDetail_createServerFn_handler, getStorefront_createServerFn_handler, removeCartAction_createServerFn_handler, toggleFavoriteAction_createServerFn_handler };
