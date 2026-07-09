import { N as notFound, f as lazyRouteComponent, p as createFileRoute } from "../_libs/@tanstack/react-router+[...].mjs";
import { a as loadPrompt } from "./server-Cp9Zv1gM.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/prompts._promptId-Bv4Hj3ZK.js
var $$splitComponentImporter = () => import("./prompts._promptId-CyoCYq5g.mjs");
var Route = createFileRoute("/prompts/$promptId")({
	loader: async ({ params }) => {
		const id = Number(params.promptId);
		if (!Number.isInteger(id)) throw notFound();
		return loadPrompt({ data: { id } });
	},
	component: lazyRouteComponent($$splitComponentImporter, "component")
});
//#endregion
export { Route as t };
