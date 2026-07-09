import { i as getAnalyticsFn } from "./market-CFU9gbvr.js";
import { t as Icons } from "./icons-DqNOm4Um.js";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
//#region src/routes/creator.tsx?tsr-split=component
function money(value) {
	return `$${value.toFixed(2)}`;
}
function CreatorPage() {
	const [analytics, setAnalytics] = useState(null);
	useEffect(() => {
		getAnalyticsFn().then(setAnalytics);
	}, []);
	if (!analytics) return /* @__PURE__ */ jsx("main", {
		className: "analytics-page",
		children: "Loading analytics..."
	});
	return /* @__PURE__ */ jsxs("main", {
		className: "analytics-page",
		children: [
			/* @__PURE__ */ jsxs(Link, {
				to: "/",
				className: "back-link",
				children: [/* @__PURE__ */ jsx(Icons.ChevronRight, {}), " Back to storefront"]
			}),
			/* @__PURE__ */ jsx("p", {
				className: "mono kicker",
				children: "Creator admin"
			}),
			/* @__PURE__ */ jsx("h1", { children: "Sales analytics" }),
			/* @__PURE__ */ jsxs("section", {
				className: "metrics",
				children: [
					/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("span", { children: "Gross revenue" }), /* @__PURE__ */ jsx("strong", { children: money(analytics.summary.grossRevenue) })] }),
					/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("span", { children: "Creator revenue" }), /* @__PURE__ */ jsx("strong", { children: money(analytics.summary.creatorRevenue) })] }),
					/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("span", { children: "Conversion rate" }), /* @__PURE__ */ jsxs("strong", { children: [analytics.summary.conversionRate, "%"] })] }),
					/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("span", { children: "Avg order value" }), /* @__PURE__ */ jsx("strong", { children: money(analytics.summary.averageOrderValue) })] })
				]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "analytics-grid",
				children: [
					/* @__PURE__ */ jsxs("section", {
						className: "table-panel",
						children: [/* @__PURE__ */ jsx("h2", { children: "Creator revenue" }), analytics.creators.map((creator) => /* @__PURE__ */ jsxs("div", {
							className: "table-row",
							children: [
								/* @__PURE__ */ jsx("span", { children: creator.creator }),
								/* @__PURE__ */ jsxs("span", { children: [creator.sales, " sales"] }),
								/* @__PURE__ */ jsx("strong", { children: money(creator.creatorRevenue) })
							]
						}, creator.creator))]
					}),
					/* @__PURE__ */ jsxs("section", {
						className: "table-panel",
						children: [/* @__PURE__ */ jsx("h2", { children: "Category revenue" }), analytics.categoryRevenue.map((category) => /* @__PURE__ */ jsxs("div", {
							className: "table-row",
							children: [
								/* @__PURE__ */ jsx("span", { children: category.category }),
								/* @__PURE__ */ jsxs("span", { children: [category.sales, " sales"] }),
								/* @__PURE__ */ jsx("strong", { children: money(category.revenue) })
							]
						}, category.category))]
					}),
					/* @__PURE__ */ jsxs("section", {
						className: "table-panel trend-panel",
						children: [/* @__PURE__ */ jsx("h2", { children: "Daily sales trend" }), /* @__PURE__ */ jsx("div", {
							className: "trend-bars",
							children: analytics.dailySales.map((day) => /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("span", { style: { height: `${Math.max(18, day.revenue * 2)}px` } }), /* @__PURE__ */ jsx("em", { children: day.day.slice(5) })] }, day.day))
						})]
					})
				]
			})
		]
	});
}
//#endregion
export { CreatorPage as component };
