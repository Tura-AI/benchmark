import { t as Route } from "./routes-Cb2W4Juw.js";
import { t as Gallery } from "./Gallery-Bq235nby.js";
import { useNavigate } from "@tanstack/react-router";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { Circle, Diamond, Grid2X2, Search, Triangle } from "lucide-react";
//#region src/components/TopFilters.tsx
var models = [
	{
		label: "All",
		value: "all",
		icon: Grid2X2
	},
	{
		label: "GPT-4o",
		value: "GPT-4o",
		icon: Circle
	},
	{
		label: "Claude",
		value: "Claude",
		icon: Search
	},
	{
		label: "Midjourney",
		value: "Midjourney",
		icon: Triangle
	},
	{
		label: "Flux",
		value: "Flux",
		icon: Diamond
	}
];
function TopFilters({ search, onChange }) {
	return /* @__PURE__ */ jsxs("div", {
		className: "topbar",
		children: [/* @__PURE__ */ jsxs("div", {
			className: "filterbar",
			children: [/* @__PURE__ */ jsx("div", {
				className: "ftabs",
				role: "tablist",
				"aria-label": "Model filters",
				children: models.map((model) => {
					const Icon = model.icon;
					return /* @__PURE__ */ jsxs("button", {
						className: `ftab ${search.model === model.value ? "active" : ""}`,
						onClick: () => onChange({
							model: model.value,
							favorites: false
						}),
						children: [
							/* @__PURE__ */ jsx(Icon, {}),
							" ",
							model.label
						]
					}, model.value);
				})
			}), /* @__PURE__ */ jsx("div", {
				className: "fsort",
				"aria-label": "Sort prompts",
				children: [
					"featured",
					"newest",
					"popular"
				].map((sort) => /* @__PURE__ */ jsx("button", {
					className: `sortbtn ${search.sort === sort ? "active" : ""}`,
					onClick: () => onChange({ sort }),
					children: sort[0].toUpperCase() + sort.slice(1)
				}, sort))
			})]
		}), /* @__PURE__ */ jsx("div", {
			className: `searchbar ${search.searchOpen ? "open" : ""}`,
			children: /* @__PURE__ */ jsxs("div", {
				className: "inner",
				children: [/* @__PURE__ */ jsx(Search, {}), /* @__PURE__ */ jsx("input", {
					type: "search",
					value: search.q,
					onChange: (event) => onChange({
						q: event.target.value,
						searchOpen: true
					}),
					placeholder: "Search prompts - portrait, poster, cold email...",
					"aria-label": "Search prompts"
				})]
			})
		})]
	});
}
//#endregion
//#region src/routes/index.tsx?tsr-split=component
function Storefront() {
	const prompts = Route.useLoaderData();
	const search = Route.useSearch();
	const navigate = useNavigate({ from: "/" });
	const onChange = (patch) => {
		navigate({ search: (prev) => ({
			...prev,
			...patch
		}) });
	};
	return /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx(TopFilters, {
		search,
		onChange
	}), /* @__PURE__ */ jsxs("div", {
		className: "gallery",
		children: [(search.category !== "all" || search.favorites || search.freeOnly) && /* @__PURE__ */ jsxs("div", {
			className: "context-row",
			children: [/* @__PURE__ */ jsx("span", { children: search.favorites ? "Favorites" : search.freeOnly ? "Free prompts" : search.category }), /* @__PURE__ */ jsx("button", {
				onClick: () => onChange({
					category: "all",
					favorites: false,
					freeOnly: false
				}),
				children: "Clear"
			})]
		}), /* @__PURE__ */ jsx(Gallery, { prompts })]
	})] });
}
//#endregion
export { Storefront as component };
