import { t as Route } from "./admin-BEsQX7z1.js";
import { t as Shell } from "./layout-2vooB8mZ.js";
import { jsx, jsxs } from "react/jsx-runtime";
//#region src/components/analytics.tsx
function AnalyticsView({ analytics }) {
	const money = (cents) => `$${(cents / 100).toFixed(2)}`;
	return /* @__PURE__ */ jsxs("section", {
		className: "analytics",
		children: [
			/* @__PURE__ */ jsx("h1", { children: "Creator analytics" }),
			/* @__PURE__ */ jsx("p", {
				className: "desc",
				children: "Revenue, conversion, category totals, and trend summaries are calculated by SQLite queries."
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "stats",
				children: [
					/* @__PURE__ */ jsxs("div", {
						className: "stat",
						children: [/* @__PURE__ */ jsx("div", {
							className: "k",
							children: "Revenue"
						}), /* @__PURE__ */ jsx("div", {
							className: "v",
							children: money(analytics.summary.revenueCents)
						})]
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "stat",
						children: [/* @__PURE__ */ jsx("div", {
							className: "k",
							children: "Conversion"
						}), /* @__PURE__ */ jsxs("div", {
							className: "v",
							children: [analytics.summary.conversionRate, "%"]
						})]
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "stat",
						children: [/* @__PURE__ */ jsx("div", {
							className: "k",
							children: "Avg order"
						}), /* @__PURE__ */ jsx("div", {
							className: "v",
							children: money(analytics.summary.averageOrderCents)
						})]
					})
				]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "grid-2",
				children: [
					/* @__PURE__ */ jsx(Panel, {
						title: "Creator revenue",
						rows: analytics.creatorRevenue.map((r) => [r.creator, money(r.creatorRevenueCents)])
					}),
					/* @__PURE__ */ jsx(Panel, {
						title: "Category revenue",
						rows: analytics.categoryRevenue.map((r) => [r.category, money(r.revenueCents)])
					}),
					/* @__PURE__ */ jsx(Panel, {
						title: "Daily sales",
						rows: analytics.dailySales.map((r) => [r.day, `${r.orders} · ${money(r.revenueCents)}`])
					}),
					/* @__PURE__ */ jsx(Panel, {
						title: "Marketplace",
						rows: [["Orders", String(analytics.summary.orders)], ["Average prompt price", money(analytics.summary.averagePriceCents)]]
					})
				]
			})
		]
	});
}
function Panel({ title, rows }) {
	return /* @__PURE__ */ jsxs("div", {
		className: "panel",
		children: [/* @__PURE__ */ jsx("h2", { children: title }), /* @__PURE__ */ jsx("ul", { children: rows.map(([a, b]) => /* @__PURE__ */ jsxs("li", { children: [/* @__PURE__ */ jsx("span", { children: a }), /* @__PURE__ */ jsx("strong", { children: b })] }, a)) })]
	});
}
//#endregion
//#region src/routes/admin.tsx?tsr-split=component
function AdminRoute() {
	const data = Route.useLoaderData();
	return /* @__PURE__ */ jsx(Shell, {
		categories: data.shell.categories,
		cartCount: data.shell.cart.count,
		children: /* @__PURE__ */ jsx(AnalyticsView, { analytics: data.analytics })
	});
}
//#endregion
export { AdminRoute as component };
