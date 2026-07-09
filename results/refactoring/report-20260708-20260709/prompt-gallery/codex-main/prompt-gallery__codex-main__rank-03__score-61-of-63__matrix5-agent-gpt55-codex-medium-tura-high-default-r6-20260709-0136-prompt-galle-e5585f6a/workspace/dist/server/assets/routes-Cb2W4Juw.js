import { n as api } from "./market-api-BGNTLaER.js";
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
//#region src/routes/index.tsx
var $$splitComponentImporter = () => import("./routes-CeWsI8vu.js");
var normalizeSearch = (raw) => ({
	model: typeof raw.model === "string" ? raw.model : "all",
	category: typeof raw.category === "string" ? raw.category : "all",
	sort: raw.sort === "newest" || raw.sort === "popular" ? raw.sort : "featured",
	q: typeof raw.q === "string" ? raw.q : "",
	favorites: raw.favorites === true || raw.favorites === "true",
	freeOnly: raw.freeOnly === true || raw.freeOnly === "true",
	searchOpen: raw.searchOpen === true || raw.searchOpen === "true" || Boolean(raw.q)
});
var Route = createFileRoute("/")({
	validateSearch: normalizeSearch,
	loaderDeps: ({ search }) => search,
	loader: ({ deps }) => api.catalog({
		model: deps.model,
		category: deps.category,
		sort: deps.sort,
		search: deps.q,
		favoritesOnly: deps.favorites,
		freeOnly: deps.freeOnly
	}),
	component: lazyRouteComponent($$splitComponentImporter, "component")
});
//#endregion
export { Route as t };
