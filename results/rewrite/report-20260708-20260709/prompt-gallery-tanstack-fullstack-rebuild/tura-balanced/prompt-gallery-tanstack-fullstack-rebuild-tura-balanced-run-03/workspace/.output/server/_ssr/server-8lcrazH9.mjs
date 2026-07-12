import { n as createServerFn, t as TSS_SERVER_FUNCTION } from "./ssr.mjs";
import { a as string, i as object, n as boolean, r as number, t as _enum } from "../_libs/zod.mjs";
import { a as getPrompt, c as toggleFavorite, i as getCartSummary, n as checkout, o as getStorefront, r as getAnalytics, s as removeFromCart, t as addToCart } from "./db-DaTCybyF.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/server-8lcrazH9.js
var createServerRpc = (serverFnMeta, splitImportFn) => {
	const url = "/_serverFn/" + serverFnMeta.id;
	return Object.assign(splitImportFn, {
		url,
		serverFnMeta,
		[TSS_SERVER_FUNCTION]: true
	});
};
var catalogQuery = object({
	model: string().optional(),
	category: string().optional(),
	sort: _enum([
		"featured",
		"newest",
		"popular"
	]).optional(),
	q: string().optional(),
	favorites: boolean().optional(),
	free: boolean().optional()
});
var promptMutation = object({ promptId: number().int().positive() });
var loadStorefront_createServerFn_handler = createServerRpc({
	id: "d7670ae09e0a49134e6e837e3781ff8cf6fda13f0d6c8e9c9e80bc9fa90dcc95",
	name: "loadStorefront",
	filename: "src/data/server.ts"
}, (opts) => loadStorefront.__executeServer(opts));
var loadStorefront = createServerFn({ method: "GET" }).validator((data) => catalogQuery.parse(data ?? {})).handler(loadStorefront_createServerFn_handler, ({ data }) => getStorefront(data));
var loadPrompt_createServerFn_handler = createServerRpc({
	id: "97055dd22d86cfe1ca0eb9cced2ec3333714c1a526773b8fed1dc2e1d9ad561f",
	name: "loadPrompt",
	filename: "src/data/server.ts"
}, (opts) => loadPrompt.__executeServer(opts));
var loadPrompt = createServerFn({ method: "GET" }).validator((data) => object({ id: number().int().positive() }).parse(data)).handler(loadPrompt_createServerFn_handler, ({ data }) => getPrompt(data.id));
var loadCart_createServerFn_handler = createServerRpc({
	id: "36ab5b76be32b16eb38c1f2ea0d825c44895b864abb11f18939e720451b102b7",
	name: "loadCart",
	filename: "src/data/server.ts"
}, (opts) => loadCart.__executeServer(opts));
var loadCart = createServerFn({ method: "GET" }).handler(loadCart_createServerFn_handler, () => getCartSummary());
var loadAnalytics_createServerFn_handler = createServerRpc({
	id: "27eb48a99a6ac6443c55e9f04ab406876d4f375f4e955c7b9d670313101ebb60",
	name: "loadAnalytics",
	filename: "src/data/server.ts"
}, (opts) => loadAnalytics.__executeServer(opts));
var loadAnalytics = createServerFn({ method: "GET" }).handler(loadAnalytics_createServerFn_handler, () => getAnalytics());
var saveFavorite_createServerFn_handler = createServerRpc({
	id: "794fdbbe37886089de6e15ec75f7d862d6c82731c36e2ff803b4d849be3d35bc",
	name: "saveFavorite",
	filename: "src/data/server.ts"
}, (opts) => saveFavorite.__executeServer(opts));
var saveFavorite = createServerFn({ method: "POST" }).validator((data) => promptMutation.parse(data)).handler(saveFavorite_createServerFn_handler, ({ data }) => toggleFavorite(data.promptId));
var addPromptToCart_createServerFn_handler = createServerRpc({
	id: "bb59d9a129f801a90cd40e6580179e68721a2dfadc3efd5a283ae2c0beae4121",
	name: "addPromptToCart",
	filename: "src/data/server.ts"
}, (opts) => addPromptToCart.__executeServer(opts));
var addPromptToCart = createServerFn({ method: "POST" }).validator((data) => promptMutation.parse(data)).handler(addPromptToCart_createServerFn_handler, ({ data }) => addToCart(data.promptId));
var removePromptFromCart_createServerFn_handler = createServerRpc({
	id: "c8c054d382d931b95d5edf884319bc09c59ac355c86d7bde6e7464a12fec2c4e",
	name: "removePromptFromCart",
	filename: "src/data/server.ts"
}, (opts) => removePromptFromCart.__executeServer(opts));
var removePromptFromCart = createServerFn({ method: "POST" }).validator((data) => promptMutation.parse(data)).handler(removePromptFromCart_createServerFn_handler, ({ data }) => removeFromCart(data.promptId));
var checkoutCart_createServerFn_handler = createServerRpc({
	id: "5597c790ed3b86309fc1f389596503e282c5ec964a2f0203f19421aec46d9dd6",
	name: "checkoutCart",
	filename: "src/data/server.ts"
}, (opts) => checkoutCart.__executeServer(opts));
var checkoutCart = createServerFn({ method: "POST" }).handler(checkoutCart_createServerFn_handler, () => checkout());
//#endregion
export { addPromptToCart_createServerFn_handler, checkoutCart_createServerFn_handler, loadAnalytics_createServerFn_handler, loadCart_createServerFn_handler, loadPrompt_createServerFn_handler, loadStorefront_createServerFn_handler, removePromptFromCart_createServerFn_handler, saveFavorite_createServerFn_handler };
