import { o as getStorefront } from "./marketplace-sbgQtYxN.js";
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
//#region src/routes/index.tsx
var $$splitComponentImporter = () => import("./routes-BHCKjxFU.js");
var Route = createFileRoute("/")({
	validateSearch: (search) => ({
		model: typeof search.model === "string" ? search.model : "all",
		category: typeof search.category === "string" ? search.category : "all",
		sort: search.sort === "newest" || search.sort === "popular" ? search.sort : "featured",
		q: typeof search.q === "string" ? search.q : void 0,
		favorites: search.favorites === true || search.favorites === "true",
		free: search.free === true || search.free === "true"
	}),
	loaderDeps: ({ search }) => search,
	loader: async ({ deps }) => getStorefront({ data: {
		model: deps.model,
		category: deps.category,
		sort: deps.sort,
		q: deps.q,
		favoritesOnly: deps.favorites,
		freeOnly: deps.free
	} }),
	component: lazyRouteComponent($$splitComponentImporter, "component")
});
//#endregion
export { Route as t };
