import { T as TSS_SERVER_FUNCTION, c as createServerFn } from "../server.js";
import { z } from "zod";
import { g as getCart, a as getFilterCounts, l as listCategories, b as listPrompts, d as getPrompt, t as toggleFavorite, e as addToCart, r as removeFromCart, f as checkout, c as getAnalytics } from "./queries-R7sLH0o3.js";
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
const catalogSchema = z.object({
  model: z.enum(["all", "GPT-4o", "Claude", "Midjourney", "Flux"]).optional(),
  category: z.string().optional(),
  sort: z.enum(["featured", "newest", "popular"]).optional(),
  term: z.string().optional(),
  favoritesOnly: z.boolean().optional(),
  priceMode: z.enum(["all", "free", "paid"]).optional()
});
const idSchema = z.object({
  promptId: z.number().int().positive()
});
const getCatalogFn_createServerFn_handler = createServerRpc({
  id: "22280aa419ab6fe111f40373b7a5bcd703591f084b854a2961084956e87eb10d",
  name: "getCatalogFn",
  filename: "src/server/functions.ts"
}, (opts) => getCatalogFn.__executeServer(opts));
const getCatalogFn = createServerFn({
  method: "GET"
}).validator((data) => catalogSchema.parse(data ?? {})).handler(getCatalogFn_createServerFn_handler, ({
  data
}) => ({
  prompts: listPrompts(data),
  categories: listCategories(),
  counts: getFilterCounts(),
  cart: getCart()
}));
const getPromptFn_createServerFn_handler = createServerRpc({
  id: "521f90fb1eb33240989f6de95c778a66a174f1297fbc3dc2abe27b749bdf966b",
  name: "getPromptFn",
  filename: "src/server/functions.ts"
}, (opts) => getPromptFn.__executeServer(opts));
const getPromptFn = createServerFn({
  method: "GET"
}).validator((data) => z.object({
  slug: z.string()
}).parse(data)).handler(getPromptFn_createServerFn_handler, ({
  data
}) => getPrompt(data.slug));
const toggleFavoriteFn_createServerFn_handler = createServerRpc({
  id: "469896283cff030cc9bc742d5b57d0523e86f532c737dc6c2de8e8212111ef87",
  name: "toggleFavoriteFn",
  filename: "src/server/functions.ts"
}, (opts) => toggleFavoriteFn.__executeServer(opts));
const toggleFavoriteFn = createServerFn({
  method: "POST"
}).validator((data) => idSchema.parse(data)).handler(toggleFavoriteFn_createServerFn_handler, ({
  data
}) => ({
  isFavorite: toggleFavorite(data.promptId)
}));
const addToCartFn_createServerFn_handler = createServerRpc({
  id: "13799a03ae7e7b916d209dbe27de59c54730206602ac449aa88230f3f2f3850c",
  name: "addToCartFn",
  filename: "src/server/functions.ts"
}, (opts) => addToCartFn.__executeServer(opts));
const addToCartFn = createServerFn({
  method: "POST"
}).validator((data) => idSchema.parse(data)).handler(addToCartFn_createServerFn_handler, ({
  data
}) => addToCart(data.promptId));
const removeFromCartFn_createServerFn_handler = createServerRpc({
  id: "9cd9c31ab345fa0967ecdfc52dfda96db12aa517a28776ddd9c56ba22208f130",
  name: "removeFromCartFn",
  filename: "src/server/functions.ts"
}, (opts) => removeFromCartFn.__executeServer(opts));
const removeFromCartFn = createServerFn({
  method: "POST"
}).validator((data) => idSchema.parse(data)).handler(removeFromCartFn_createServerFn_handler, ({
  data
}) => removeFromCart(data.promptId));
const getCartFn_createServerFn_handler = createServerRpc({
  id: "13dd8f8d8da9e853736e64202f2ebfd2a0f118c2db4a90aed3bd3dfd037517b5",
  name: "getCartFn",
  filename: "src/server/functions.ts"
}, (opts) => getCartFn.__executeServer(opts));
const getCartFn = createServerFn({
  method: "GET"
}).handler(getCartFn_createServerFn_handler, () => getCart());
const checkoutFn_createServerFn_handler = createServerRpc({
  id: "d0e4d1410ee7278af658890a54f5561caddf0137bad34573e64966a4f328ca79",
  name: "checkoutFn",
  filename: "src/server/functions.ts"
}, (opts) => checkoutFn.__executeServer(opts));
const checkoutFn = createServerFn({
  method: "POST"
}).handler(checkoutFn_createServerFn_handler, () => checkout());
const getAnalyticsFn_createServerFn_handler = createServerRpc({
  id: "2aac43ce6a2882cb9124d98454a3954aba15ec4c6fa224b19fb952d642f612b7",
  name: "getAnalyticsFn",
  filename: "src/server/functions.ts"
}, (opts) => getAnalyticsFn.__executeServer(opts));
const getAnalyticsFn = createServerFn({
  method: "GET"
}).handler(getAnalyticsFn_createServerFn_handler, () => getAnalytics());
export {
  addToCartFn_createServerFn_handler,
  checkoutFn_createServerFn_handler,
  getAnalyticsFn_createServerFn_handler,
  getCartFn_createServerFn_handler,
  getCatalogFn_createServerFn_handler,
  getPromptFn_createServerFn_handler,
  removeFromCartFn_createServerFn_handler,
  toggleFavoriteFn_createServerFn_handler
};
