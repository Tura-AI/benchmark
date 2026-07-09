import { n as createServerFn, r as getServerFnById, t as TSS_SERVER_FUNCTION } from "./ssr.mjs";
import { a as string, i as object, n as boolean, r as number, t as _enum } from "../_libs/zod.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/server-Cp9Zv1gM.js
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
var loadStorefront = createServerFn({ method: "GET" }).validator((data) => catalogQuery.parse(data ?? {})).handler(createSsrRpc("d7670ae09e0a49134e6e837e3781ff8cf6fda13f0d6c8e9c9e80bc9fa90dcc95"));
var loadPrompt = createServerFn({ method: "GET" }).validator((data) => object({ id: number().int().positive() }).parse(data)).handler(createSsrRpc("97055dd22d86cfe1ca0eb9cced2ec3333714c1a526773b8fed1dc2e1d9ad561f"));
var loadCart = createServerFn({ method: "GET" }).handler(createSsrRpc("36ab5b76be32b16eb38c1f2ea0d825c44895b864abb11f18939e720451b102b7"));
var loadAnalytics = createServerFn({ method: "GET" }).handler(createSsrRpc("27eb48a99a6ac6443c55e9f04ab406876d4f375f4e955c7b9d670313101ebb60"));
var saveFavorite = createServerFn({ method: "POST" }).validator((data) => promptMutation.parse(data)).handler(createSsrRpc("794fdbbe37886089de6e15ec75f7d862d6c82731c36e2ff803b4d849be3d35bc"));
var addPromptToCart = createServerFn({ method: "POST" }).validator((data) => promptMutation.parse(data)).handler(createSsrRpc("bb59d9a129f801a90cd40e6580179e68721a2dfadc3efd5a283ae2c0beae4121"));
var removePromptFromCart = createServerFn({ method: "POST" }).validator((data) => promptMutation.parse(data)).handler(createSsrRpc("c8c054d382d931b95d5edf884319bc09c59ac355c86d7bde6e7464a12fec2c4e"));
var checkoutCart = createServerFn({ method: "POST" }).handler(createSsrRpc("5597c790ed3b86309fc1f389596503e282c5ec964a2f0203f19421aec46d9dd6"));
//#endregion
export { loadPrompt as a, saveFavorite as c, loadCart as i, checkoutCart as n, loadStorefront as o, loadAnalytics as r, removePromptFromCart as s, addPromptToCart as t };
