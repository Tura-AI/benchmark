import { t as getJson } from "./client-api-COuYp5Ys.js";
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
//#region src/routes/index.tsx
var $$splitComponentImporter = () => import("./routes-DC6jb8_d.js");
var Route = createFileRoute("/")({
	validateSearch: (search) => ({
		model: String(search.model ?? "all"),
		category: String(search.category ?? "all"),
		sort: String(search.sort ?? "featured"),
		search: String(search.search ?? ""),
		favoritesOnly: search.favoritesOnly === true || search.favoritesOnly === "true",
		freeOnly: search.freeOnly === true || search.freeOnly === "true",
		searchOpen: search.searchOpen === true || search.searchOpen === "true"
	}),
	loaderDeps: ({ search }) => search,
	loader: async ({ deps }) => {
		if (typeof window === "undefined") {
			const { storefrontApi } = await import("./api-SnfGUBjd.js");
			return storefrontApi(deps);
		}
		const params = new URLSearchParams();
		Object.entries(deps).forEach(([key, value]) => {
			if (value !== void 0 && value !== false && value !== "") params.set(key, String(value));
		});
		return getJson(`/api/storefront?${params}`);
	},
	component: lazyRouteComponent($$splitComponentImporter, "component")
});
//#endregion
export { Route as t };
