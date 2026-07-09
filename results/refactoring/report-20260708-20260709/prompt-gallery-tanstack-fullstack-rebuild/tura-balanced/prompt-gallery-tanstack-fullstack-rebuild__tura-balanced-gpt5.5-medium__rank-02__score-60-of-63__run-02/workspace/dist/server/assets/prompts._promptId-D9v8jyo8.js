import { a as getPromptDetail, o as getStorefront } from "./marketplace-sbgQtYxN.js";
import { createFileRoute, lazyRouteComponent, notFound } from "@tanstack/react-router";
//#region src/routes/prompts.$promptId.tsx
var $$splitComponentImporter = () => import("./prompts._promptId-CimSYM1h.js");
var Route = createFileRoute("/prompts/$promptId")({
	loader: async ({ params }) => {
		const promptId = Number(params.promptId);
		if (!Number.isInteger(promptId)) throw notFound();
		const [detail, shell] = await Promise.all([getPromptDetail({ data: { promptId } }), getStorefront({ data: {} })]);
		return {
			...detail,
			shell
		};
	},
	component: lazyRouteComponent($$splitComponentImporter, "component")
});
//#endregion
export { Route as t };
