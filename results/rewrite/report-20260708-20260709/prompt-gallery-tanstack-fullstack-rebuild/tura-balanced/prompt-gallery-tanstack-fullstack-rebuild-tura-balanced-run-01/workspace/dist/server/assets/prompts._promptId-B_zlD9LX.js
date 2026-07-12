import { i as getCartFn, o as getPromptFn } from "./queries-BQK17jAu.js";
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
//#region src/routes/prompts.$promptId.tsx
var $$splitComponentImporter = () => import("./prompts._promptId-nAZBmj05.js");
var Route = createFileRoute("/prompts/$promptId")({
	loader: async ({ params }) => {
		const id = Number(params.promptId);
		const [prompt, cart] = await Promise.all([getPromptFn({ data: id }), getCartFn()]);
		if (!prompt) throw new Error("Prompt not found");
		return {
			prompt,
			cart
		};
	},
	component: lazyRouteComponent($$splitComponentImporter, "component")
});
//#endregion
export { Route as t };
