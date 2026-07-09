//#region src/server/market.ts
async function requestJson(url, init) {
	const response = await fetch(url, {
		...init,
		headers: {
			"content-type": "application/json",
			...init?.headers ?? {}
		}
	});
	if (!response.ok) throw new Error(`Request failed: ${response.status}`);
	return response.json();
}
var fallbackFilters = {
	models: [
		{
			model: "Claude",
			count: 0
		},
		{
			model: "Flux",
			count: 0
		},
		{
			model: "GPT-4o",
			count: 0
		},
		{
			model: "Midjourney",
			count: 0
		}
	],
	categories: [
		"Image",
		"Photography",
		"Design",
		"Writing",
		"Code",
		"Marketing",
		"Productivity",
		"Research"
	].map((category) => ({
		category,
		count: 0
	})),
	counts: {
		featured: 0,
		free: 0,
		paid: 0,
		favorites: 0,
		cart: 0
	}
};
function getMarketplace({ data } = {}) {
	const params = new URLSearchParams();
	Object.entries(data ?? {}).forEach(([key, value]) => {
		if (value !== void 0 && value !== false && value !== "") params.set(key, String(value));
	});
	return requestJson(`/api/marketplace?${params}`);
}
function getPromptDetail({ data }) {
	return requestJson(`/api/prompts/${data.promptId}`);
}
function toggleFavoriteFn({ data }) {
	return requestJson("/api/favorite", {
		method: "POST",
		body: JSON.stringify(data)
	});
}
function addToCartFn({ data }) {
	return requestJson("/api/cart", {
		method: "POST",
		body: JSON.stringify(data)
	});
}
function removeFromCartFn({ data }) {
	return requestJson("/api/cart/remove", {
		method: "POST",
		body: JSON.stringify(data)
	});
}
function getCartFn() {
	return requestJson("/api/cart");
}
function checkoutFn() {
	return requestJson("/api/checkout", { method: "POST" });
}
function getAnalyticsFn() {
	return requestJson("/api/analytics");
}
//#endregion
export { getCartFn as a, removeFromCartFn as c, getAnalyticsFn as i, toggleFavoriteFn as l, checkoutFn as n, getMarketplace as o, fallbackFilters as r, getPromptDetail as s, addToCartFn as t };
