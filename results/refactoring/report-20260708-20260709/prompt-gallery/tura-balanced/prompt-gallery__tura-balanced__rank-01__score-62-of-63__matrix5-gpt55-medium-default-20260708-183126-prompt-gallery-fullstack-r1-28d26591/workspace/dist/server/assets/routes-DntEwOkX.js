import { a as getCatalogFn, i as getCartFn, o as getPromptFn } from "./queries-BQK17jAu.js";
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
//#region src/routes/index.tsx
var $$splitComponentImporter = () => import("./routes-12UeHXjj.js");
var Route = createFileRoute("/")({
	validateSearch: (search) => ({
		model: search.model != null ? String(search.model) : "all",
		category: search.category != null ? String(search.category) : "all",
		sort: search.sort != null ? String(search.sort) : "featured",
		q: search.q != null ? String(search.q) : "",
		favorites: search.favorites === "1" ? "1" : void 0,
		free: search.free === "1" ? "1" : void 0,
		preview: search.preview != null ? String(search.preview) : void 0
	}),
	loaderDeps: ({ search }) => search,
	loader: async ({ deps }) => {
		const [catalog, cart] = await Promise.all([getCatalogFn({ data: {
			...deps,
			favoritesOnly: deps.favorites === "1",
			freeOnly: deps.free === "1"
		} }), getCartFn()]);
		const previewId = deps.preview ? Number(String(deps.preview).replace(/^"|"$/g, "")) : 0;
		return {
			catalog,
			cart,
			previewPrompt: Number.isFinite(previewId) && previewId > 0 ? await getPromptFn({ data: previewId }) : null
		};
	},
	component: lazyRouteComponent($$splitComponentImporter, "component")
});
//#endregion
export { Route as t };
