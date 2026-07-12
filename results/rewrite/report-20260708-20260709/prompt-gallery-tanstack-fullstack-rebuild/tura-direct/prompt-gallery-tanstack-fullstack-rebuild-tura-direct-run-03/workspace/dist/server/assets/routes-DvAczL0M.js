import { i as fetchCatalog } from "./serverFns-o3k0et2Q.js";
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
//#region src/routes/index.tsx
var $$splitComponentImporter = () => import("./routes-LV801acR.js");
var Route = createFileRoute("/")({
	validateSearch: (s) => ({
		model: String(s.model ?? "all"),
		category: String(s.category ?? "all"),
		q: typeof s.q === "string" ? s.q : "",
		favorites: s.favorites === true || s.favorites === "true",
		free: s.free === true || s.free === "true",
		sort: s.sort ?? "featured"
	}),
	loaderDeps: ({ search }) => search,
	loader: ({ deps }) => fetchCatalog({ data: deps }),
	component: lazyRouteComponent($$splitComponentImporter, "component")
});
//#endregion
export { Route as t };
