import { n as api } from "./market-api-BGNTLaER.js";
import { createFileRoute, lazyRouteComponent, notFound } from "@tanstack/react-router";
//#region src/routes/prompts.$promptId.tsx
var $$splitComponentImporter = () => import("./prompts._promptId-CiQPpmeK.js");
var Route = createFileRoute("/prompts/$promptId")({
	loader: async ({ params }) => {
		const prompt = await api.prompt(Number(params.promptId));
		if (!prompt) throw notFound();
		return prompt;
	},
	component: lazyRouteComponent($$splitComponentImporter, "component")
});
//#endregion
export { Route as t };
