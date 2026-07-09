import { t as Route } from "./admin-Y3_xC1Z1.js";
import { jsx, jsxs } from "react/jsx-runtime";
import { BarChart3, DollarSign, Percent, TrendingUp } from "lucide-react";
//#region src/routes/admin.tsx?tsr-split=component
function money(value) {
	return `$${Number(value).toLocaleString(void 0, { maximumFractionDigits: 2 })}`;
}
function AdminPage() {
	const analytics = Route.useLoaderData();
	const summary = analytics.summary;
	const maxDaily = Math.max(...analytics.daily.map((day) => day.revenue), 1);
	return /* @__PURE__ */ jsxs("div", {
		className: "admin-page",
		children: [
			/* @__PURE__ */ jsxs("header", {
				className: "page-head",
				children: [/* @__PURE__ */ jsx("p", {
					className: "mono",
					children: "Creator analytics"
				}), /* @__PURE__ */ jsx("h1", { children: "Revenue, conversion, and prompt demand" })]
			}),
			/* @__PURE__ */ jsxs("section", {
				className: "metric-grid",
				children: [
					/* @__PURE__ */ jsx(Metric, {
						icon: /* @__PURE__ */ jsx(DollarSign, {}),
						label: "Revenue",
						value: money(summary.revenue)
					}),
					/* @__PURE__ */ jsx(Metric, {
						icon: /* @__PURE__ */ jsx(BarChart3, {}),
						label: "Average order value",
						value: money(summary.averageOrderValue)
					}),
					/* @__PURE__ */ jsx(Metric, {
						icon: /* @__PURE__ */ jsx(Percent, {}),
						label: "Conversion rate",
						value: `${Math.round(summary.conversionRate * 1e3) / 10}%`
					}),
					/* @__PURE__ */ jsx(Metric, {
						icon: /* @__PURE__ */ jsx(TrendingUp, {}),
						label: "Average paid price",
						value: money(summary.averagePrice)
					})
				]
			}),
			/* @__PURE__ */ jsxs("section", {
				className: "analytics-grid",
				children: [
					/* @__PURE__ */ jsxs("div", {
						className: "panel",
						children: [/* @__PURE__ */ jsx("h2", { children: "Creator revenue" }), analytics.creators.map((creator) => /* @__PURE__ */ jsxs("div", {
							className: "rank-row",
							children: [/* @__PURE__ */ jsx("span", { children: creator.name }), /* @__PURE__ */ jsx("b", { children: money(creator.creatorRevenue) })]
						}, creator.name))]
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "panel",
						children: [/* @__PURE__ */ jsx("h2", { children: "Category revenue" }), analytics.categories.map((category) => /* @__PURE__ */ jsxs("div", {
							className: "rank-row",
							children: [/* @__PURE__ */ jsx("span", { children: category.name }), /* @__PURE__ */ jsx("b", { children: money(category.categoryRevenue) })]
						}, category.name))]
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "panel wide",
						children: [/* @__PURE__ */ jsx("h2", { children: "Daily sales trend" }), /* @__PURE__ */ jsx("div", {
							className: "bars",
							children: analytics.daily.map((day) => /* @__PURE__ */ jsxs("div", {
								className: "bar-item",
								children: [/* @__PURE__ */ jsx("span", { style: { height: `${Math.max(16, day.revenue / maxDaily * 130)}px` } }), /* @__PURE__ */ jsx("small", { children: day.day.slice(5) })]
							}, day.day))
						})]
					})
				]
			})
		]
	});
}
function Metric({ icon, label, value }) {
	return /* @__PURE__ */ jsxs("article", {
		className: "metric",
		children: [
			icon,
			/* @__PURE__ */ jsx("span", { children: label }),
			/* @__PURE__ */ jsx("b", { children: value })
		]
	});
}
//#endregion
export { AdminPage as component };
