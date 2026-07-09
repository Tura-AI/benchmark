import { f as lazyRouteComponent, p as createFileRoute } from "../_libs/@tanstack/react-router+[...].mjs";
import { o as loadStorefront } from "./server-Cp9Zv1gM.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-CIoeulzr.js
var $$splitComponentImporter = () => import("./routes-DAVpCuqn.mjs");
var Route = createFileRoute("/")({
	validateSearch: (search) => ({
		model: typeof search.model === "string" ? search.model : "all",
		category: typeof search.category === "string" ? search.category : "all",
		sort: search.sort === "newest" || search.sort === "popular" ? search.sort : "featured",
		q: typeof search.q === "string" ? search.q : "",
		favorites: search.favorites === true || search.favorites === "true",
		free: search.free === true || search.free === "true"
	}),
	loaderDeps: ({ search }) => search,
	loader: ({ deps }) => loadStorefront({ data: deps }),
	component: lazyRouteComponent($$splitComponentImporter, "component")
});
//#endregion
export { Route as t };
