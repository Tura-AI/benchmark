import { T as TSS_SERVER_FUNCTION, c as createServerFn } from "../server.js";
import { z } from "zod";
import { g as getCounts, l as listPrompts, d as getPrompt, b as getCartSummary, c as getAnalytics, t as toggleFavorite, a as addToCart, r as removeFromCart, e as checkout } from "./db-Dyq5Uycb.js";
import "node:async_hooks";
import "h3-v2";
import "@tanstack/router-core";
import "seroval";
import "@tanstack/history";
import "@tanstack/router-core/ssr/client";
import "@tanstack/router-core/ssr/server";
import "react";
import "@tanstack/react-router";
import "react/jsx-runtime";
import "@tanstack/react-router/ssr/server";
import "better-sqlite3";
import "node:fs";
import "node:path";
var createServerRpc = (serverFnMeta, splitImportFn) => {
  const url = "/_serverFn/" + serverFnMeta.id;
  return Object.assign(splitImportFn, {
    url,
    serverFnMeta,
    [TSS_SERVER_FUNCTION]: true
  });
};
const filterSchema = z.object({
  model: z.string().optional(),
  category: z.string().optional(),
  sort: z.string().optional(),
  term: z.string().optional(),
  favoritesOnly: z.boolean().optional(),
  price: z.enum(["all", "free", "paid"]).optional()
});
const fetchCatalog_createServerFn_handler = createServerRpc({
  id: "0b589ddea47f63d290647a511b8efc8770beafa1ff85d9c891e0bcaa4bfc46a8",
  name: "fetchCatalog",
  filename: "src/data/server.ts"
}, (opts) => fetchCatalog.__executeServer(opts));
const fetchCatalog = createServerFn({
  method: "GET"
}).validator((data) => filterSchema.parse(data ?? {})).handler(fetchCatalog_createServerFn_handler, ({
  data
}) => ({
  prompts: listPrompts(data),
  counts: getCounts(1)
}));
const fetchPrompt_createServerFn_handler = createServerRpc({
  id: "bfd7a1b668ef001752a04735f8b97bbfcdcdfc4a96b59e01d0191f3740383d11",
  name: "fetchPrompt",
  filename: "src/data/server.ts"
}, (opts) => fetchPrompt.__executeServer(opts));
const fetchPrompt = createServerFn({
  method: "GET"
}).validator((data) => z.object({
  slug: z.string()
}).parse(data)).handler(fetchPrompt_createServerFn_handler, ({
  data
}) => getPrompt(data.slug, 1));
const fetchCart_createServerFn_handler = createServerRpc({
  id: "31822799ca72797e9f8fa37e54eabe02b229d279fbf1cfe6d2baeaba8af75b5e",
  name: "fetchCart",
  filename: "src/data/server.ts"
}, (opts) => fetchCart.__executeServer(opts));
const fetchCart = createServerFn({
  method: "GET"
}).handler(fetchCart_createServerFn_handler, () => getCartSummary(1));
const fetchAnalytics_createServerFn_handler = createServerRpc({
  id: "4fa70a6862997e9232e33338713e71bec02ff6bb1d5e778e868924581f0d475c",
  name: "fetchAnalytics",
  filename: "src/data/server.ts"
}, (opts) => fetchAnalytics.__executeServer(opts));
const fetchAnalytics = createServerFn({
  method: "GET"
}).handler(fetchAnalytics_createServerFn_handler, () => getAnalytics());
const favoritePrompt_createServerFn_handler = createServerRpc({
  id: "9c8c318ee5a9d40ec3282af3504a2d4e1a455beff966e9a96f7291022cb0264b",
  name: "favoritePrompt",
  filename: "src/data/server.ts"
}, (opts) => favoritePrompt.__executeServer(opts));
const favoritePrompt = createServerFn({
  method: "POST"
}).validator((data) => z.object({
  promptId: z.number()
}).parse(data)).handler(favoritePrompt_createServerFn_handler, ({
  data
}) => ({
  result: toggleFavorite(data.promptId, 1),
  counts: getCounts(1)
}));
const cartAdd_createServerFn_handler = createServerRpc({
  id: "6896c60d5516010a8b25b35fb0a3c7cbdbe76e3ca7b1fb0b48c8c357b33ae34e",
  name: "cartAdd",
  filename: "src/data/server.ts"
}, (opts) => cartAdd.__executeServer(opts));
const cartAdd = createServerFn({
  method: "POST"
}).validator((data) => z.object({
  promptId: z.number()
}).parse(data)).handler(cartAdd_createServerFn_handler, ({
  data
}) => addToCart(data.promptId, 1));
const cartRemove_createServerFn_handler = createServerRpc({
  id: "464edb90ce2e81fc17635ca77948e2d83642c3a1d4bf35b2ca01c2ec031d7eb2",
  name: "cartRemove",
  filename: "src/data/server.ts"
}, (opts) => cartRemove.__executeServer(opts));
const cartRemove = createServerFn({
  method: "POST"
}).validator((data) => z.object({
  promptId: z.number()
}).parse(data)).handler(cartRemove_createServerFn_handler, ({
  data
}) => removeFromCart(data.promptId, 1));
const checkoutCart_createServerFn_handler = createServerRpc({
  id: "5597c790ed3b86309fc1f389596503e282c5ec964a2f0203f19421aec46d9dd6",
  name: "checkoutCart",
  filename: "src/data/server.ts"
}, (opts) => checkoutCart.__executeServer(opts));
const checkoutCart = createServerFn({
  method: "POST"
}).handler(checkoutCart_createServerFn_handler, () => checkout(1));
export {
  cartAdd_createServerFn_handler,
  cartRemove_createServerFn_handler,
  checkoutCart_createServerFn_handler,
  favoritePrompt_createServerFn_handler,
  fetchAnalytics_createServerFn_handler,
  fetchCart_createServerFn_handler,
  fetchCatalog_createServerFn_handler,
  fetchPrompt_createServerFn_handler
};
