import { a as getCatalogFn, o as getPromptFn } from "./functions-BtzvV4sV.js";
import { createFileRoute, lazyRouteComponent, notFound } from "@tanstack/react-router";
//#region src/routes/prompts.$promptId.tsx
var $$splitComponentImporter = () => import("./prompts._promptId-DrlRgQaq.js");
var Route = createFileRoute("/prompts/$promptId")({
	loader: async ({ params }) => {
		const prompt = await getPromptFn({ data: { promptId: params.promptId } });
		if (!prompt) throw notFound();
		return {
			prompt,
			related: (await getCatalogFn({ data: {
				category: "all",
				sort: "Popular"
			} })).prompts.filter((item) => item.id !== prompt.id)
		};
	},
	component: lazyRouteComponent($$splitComponentImporter, "component")
});
//#endregion
export { Route as t };
