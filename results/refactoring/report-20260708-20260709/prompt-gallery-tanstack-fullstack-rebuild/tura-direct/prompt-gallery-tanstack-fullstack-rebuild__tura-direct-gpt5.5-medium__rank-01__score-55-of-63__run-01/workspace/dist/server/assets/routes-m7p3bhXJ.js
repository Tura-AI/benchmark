import { a as getCatalogFn } from "./functions-BtzvV4sV.js";
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
//#region src/routes/index.tsx
var $$splitComponentImporter = () => import("./routes-DlXv4HnD.js");
var Route = createFileRoute("/")({
	validateSearch: (search) => ({
		model: typeof search.model === "string" ? search.model : "all",
		category: typeof search.category === "string" ? search.category : "all",
		sort: search.sort === "Newest" || search.sort === "Popular" ? search.sort : "Featured",
		q: typeof search.q === "string" ? search.q : "",
		favorites: search.favorites === true || search.favorites === "true"
	}),
	loaderDeps: ({ search }) => search,
	loader: ({ deps }) => getCatalogFn({ data: deps }),
	component: lazyRouteComponent($$splitComponentImporter, "component")
});
//#endregion
export { Route as t };
