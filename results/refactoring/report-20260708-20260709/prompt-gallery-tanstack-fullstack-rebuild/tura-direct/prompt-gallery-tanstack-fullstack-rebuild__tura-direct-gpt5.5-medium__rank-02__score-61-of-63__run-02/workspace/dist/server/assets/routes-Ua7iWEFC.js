import { t as Route } from "./routes-Dt20-Xyj.js";
import { t as PromptCard } from "./PromptCard-DKVUoNlI.js";
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
//#region src/routes/index.tsx?tsr-split=component
function Storefront() {
	const data = Route.useLoaderData();
	const search = Route.useSearch();
	const navigate = useNavigate({ from: "/" });
	const [searchOpen, setSearchOpen] = useState(Boolean(search.search));
	const set = (patch) => navigate({ search: (old) => ({
		...old,
		...patch
	}) });
	return /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsxs("section", {
		className: "top",
		children: [/* @__PURE__ */ jsxs("div", {
			className: "hero",
			children: [/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("p", {
				className: "eyebrow mono",
				children: "Prompt systems for beauty commerce"
			}), /* @__PURE__ */ jsx("h1", { children: "POWERPROMPT gallery" })] }), /* @__PURE__ */ jsx("p", { children: "Browse ranked prompt products backed by SQLite data: Featured, Newest, Popular, Favorites, and Cart all work through server functions." })]
		}), /* @__PURE__ */ jsxs("div", {
			className: "filters",
			"aria-label": "Catalog filters",
			children: [
				[
					"all",
					"GPT-4o",
					"Claude",
					"Midjourney",
					"Flux"
				].map((model) => /* @__PURE__ */ jsx("button", {
					className: `tab ${(search.model ?? "all") === model ? "active" : ""}`,
					onClick: () => set({ model }),
					children: model === "all" ? "All models" : model
				}, model)),
				/* @__PURE__ */ jsx("button", {
					className: "iconbtn",
					onClick: () => setSearchOpen(!searchOpen),
					children: "Search"
				}),
				/* @__PURE__ */ jsxs("label", {
					className: `search ${searchOpen ? "open" : ""}`,
					children: [/* @__PURE__ */ jsx("span", {
						className: "mono",
						style: {
							position: "absolute",
							left: -9999
						},
						children: "Search prompts"
					}), /* @__PURE__ */ jsx("input", {
						defaultValue: search.search ?? "",
						placeholder: "Search makeup, Flux, serum...",
						onChange: (event) => set({ search: event.currentTarget.value })
					})]
				}),
				[
					"Featured",
					"Newest",
					"Popular"
				].map((sort) => /* @__PURE__ */ jsx("button", {
					className: `sort ${(search.sort ?? "Featured") === sort ? "active" : ""}`,
					onClick: () => set({ sort }),
					children: sort
				}, sort)),
				/* @__PURE__ */ jsx("button", {
					className: `sort ${search.favoritesOnly ? "active" : ""}`,
					onClick: () => set({ favoritesOnly: !search.favoritesOnly }),
					children: "Favorites"
				})
			]
		})]
	}), /* @__PURE__ */ jsx("section", {
		className: "gallery",
		"aria-label": "Prompt marketplace gallery",
		children: data.prompts.map((prompt) => /* @__PURE__ */ jsx(PromptCard, { prompt }, prompt.id))
	})] });
}
//#endregion
export { Storefront as component };
