import { a as getCatalog } from "./functions-BOKx17ep.js";
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { z } from "zod";
//#region src/routes/index.tsx
var $$splitComponentImporter = () => import("./routes-Ua7iWEFC.js");
var Search = z.object({
	model: z.string().catch("all").optional(),
	category: z.string().catch("all").optional(),
	sort: z.enum([
		"Featured",
		"Newest",
		"Popular"
	]).catch("Featured").optional(),
	search: z.string().catch("").optional(),
	favoritesOnly: z.boolean().catch(false).optional()
});
var Route = createFileRoute("/")({
	validateSearch: Search,
	loaderDeps: ({ search }) => search,
	loader: ({ deps }) => getCatalog({ data: deps }),
	component: lazyRouteComponent($$splitComponentImporter, "component")
});
//#endregion
export { Route as t };
