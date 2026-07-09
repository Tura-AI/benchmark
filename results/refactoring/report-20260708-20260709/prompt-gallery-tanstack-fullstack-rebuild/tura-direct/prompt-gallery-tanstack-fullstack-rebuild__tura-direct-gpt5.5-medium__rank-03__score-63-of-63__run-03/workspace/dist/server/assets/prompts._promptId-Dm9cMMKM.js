import { a as fetchPrompt, i as fetchCatalog } from "./serverFns-o3k0et2Q.js";
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
//#region src/routes/prompts.$promptId.tsx
var $$splitComponentImporter = () => import("./prompts._promptId-Ch-mDecg.js");
var Route = createFileRoute("/prompts/$promptId")({
	loader: async ({ params }) => ({
		prompt: await fetchPrompt({ data: { id: params.promptId } }),
		shell: await fetchCatalog({ data: {} })
	}),
	component: lazyRouteComponent($$splitComponentImporter, "component")
});
//#endregion
export { Route as t };
