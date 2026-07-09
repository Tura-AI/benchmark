import { t as getJson } from "./client-api-COuYp5Ys.js";
import { createFileRoute, lazyRouteComponent, notFound } from "@tanstack/react-router";
//#region src/routes/prompts.$promptId.tsx
var $$splitComponentImporter = () => import("./prompts._promptId-C0sTghPd.js");
var Route = createFileRoute("/prompts/$promptId")({
	loader: async ({ params }) => {
		const detail = typeof window === "undefined" ? await (async () => {
			const { promptDetailApi, storefrontApi } = await import("./api-SnfGUBjd.js");
			return {
				...promptDetailApi(Number(params.promptId)),
				categories: storefrontApi().categories
			};
		})() : await getJson(`/api/prompt/${params.promptId}`);
		if (!detail.prompt) throw notFound();
		return detail;
	},
	component: lazyRouteComponent($$splitComponentImporter, "component")
});
//#endregion
export { Route as t };
