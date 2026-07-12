# File-Based Routing

Source: https://tanstack.com/router/v1/docs/routing/file-based-routing

`                          |
| ʦ `index.tsx`           | `/` (exact)               | ``               |
| ʦ `about.tsx`           | `/about`                  | ``                   |
| ʦ `posts.tsx`           | `/posts`                  | ``                   |
| 📂 `posts`              |                           |                                   |
| ┄ ʦ `index.tsx`         | `/posts` (exact)          | ``       |
| ┄ ʦ `$postId.tsx`       | `/posts/$postId`          | ``             |
| 📂 `posts_`             |                           |                                   |
| ┄ 📂 `$postId`          |                           |                                   |
| ┄ ┄ ʦ `edit.tsx`        | `/posts/$postId/edit`     | ``                |
| ʦ `settings.tsx`        | `/settings`               | ``                |
| 📂 `settings`           |                           | ``                |
| ┄ ʦ `profile.tsx`       | `/settings/profile`       | ``       |
| ┄ ʦ `notifications.tsx` | `/settings/notifications` | `` |
| ʦ `_pathlessLayout.tsx` |                           | ``          |
| 📂 `_pathlessLayout`    |                           |                                   |
| ┄ ʦ `route-a.tsx`       | `/route-a`                | ``  |
| ┄ ʦ `route-b.tsx`       | `/route-b`                | ``  |
| 📂 `files`              |                           |                                   |
| ┄ ʦ `$.tsx`             | `/files/$`                | ``                   |
| 📂 `account`            |                           |                                   |
| ┄ ʦ `route.tsx`         | `/account`                | ``                 |
| ┄ ʦ `overview.tsx`      | `/account/overview`       | ``       |

## Flat Routes

Flat routing gives you the ability to use `.`s to denote route nesting levels.

This can be useful when you have a large number of uniquely deeply nested routes and want to avoid creating directories for each one:

See the example below:

| Filename                        | Route Path                | Component Output                  |
| ------------------------------- | ------------------------- | --------------------------------- |
| ʦ `__root.tsx`                  |                           | ``                          |
| ʦ `index.tsx`                   | `/` (exact)               | ``               |
| ʦ `about.tsx`                   | `/about`                  | ``                   |
| ʦ `posts.tsx`                   | `/posts`                  | ``                   |
| ʦ `posts.index.tsx`             | `/posts` (exact)          | ``       |
| ʦ `posts.$postId.tsx`           | `/posts/$postId`          | ``             |
| ʦ `posts_.$postId.edit.tsx`     | `/posts/$postId/edit`     | ``                |
| ʦ `settings.tsx`                | `/settings`               | ``                |
| ʦ `settings.profile.tsx`        | `/settings/profile`       | ``       |
| ʦ `settings.notifications.tsx`  | `/settings/notifications` | `` |
| ʦ `_pathlessLayout.tsx`         |                           | ``          |
| ʦ `_pathlessLayout.route-a.tsx` | `/route-a`                | ``  |
| ʦ `_pathlessLayout.route-b.tsx` | `/route-b`                | ``  |
| ʦ `files.$.tsx`                 | `/files/$`                | ``                   |
| ʦ `account.tsx`                 | `/account`                | ``                 |
| ʦ `account.overview.tsx`        | `/account/overview`       | ``       |

## Mixed Flat and Directory Routes

It's extremely likely that a 100% directory or flat route structure won't be the best fit for your project, which is why TanStack Router allows you to mix both flat and directory routes together to create a route tree that uses the best of both worlds where it makes sense:

See the example below:

| Filename                       | Route Path                | Component Output                  |
| ------------------------------ | ------------------------- | --------------------------------- |
| ʦ `__root.tsx`                 |                           | ``                          |
| ʦ `index.tsx`                  | `/` (exact)               | ``               |
| ʦ `about.tsx`                  | `/about`                  | ``                   |
| ʦ `posts.tsx`                  | `/posts`                  | ``                   |
| 📂 `posts`                     |                           |                                   |
| ┄ ʦ `index.tsx`                | `/posts` (exact)          | ``       |
| ┄ ʦ `$postId.tsx`              | `/posts/$postId`          | ``             |
| ┄ ʦ `$postId.edit.tsx`         | `/posts/$postId/edit`     | ``   |
| ʦ `settings.tsx`               | `/settings`               | ``                |
| ʦ `settings.profile.tsx`       | `/settings/profile`       | ``       |
| ʦ `settings.notifications.tsx` | `/settings/notifications` | `` |
| ʦ `account.tsx`                | `/account`                | ``                 |
| ʦ `account.overview.tsx`       | `/account/overview`       | ``       |

Both flat and directory routes can be mixed together to create a route tree that uses the best of both worlds where it makes sense.

> [!TIP]
> If you find that the default file-based routing structure doesn't fit your needs, you can always use [Virtual File Routes](./virtual-file-routes.md) to control the source of your routes whilst still getting the awesome performance benefits of file-based routing.

## Getting started with File-Based Routing

To get started with file-based routing, you'll need to configure your project's bundler to use the TanStack Router Plugin or the TanStack Router CLI.

To enable file-based routing, you'll need to be using React with a supported bundler. See if your bundler is listed in the configuration guides below.

# React

- [Installation with Vite](../installation/with-vite)
- [Installation with Rspack/Rsbuild](../installation/with-rspack)
- [Installation with Webpack](../installation/with-webpack)
- [Installation with Esbuild](../installation/with-esbuild)

# Solid

- [Installation with Vite](../installation/with-vite)
- [Installation with Rspack/Rsbuild](../installation/with-rspack)
- [Installation with Webpack](../installation/with-webpack)
- [Installation with Esbuild](../installation/with-esbuild)

When using TanStack Router's file-based routing through one of the supported bundlers, our plugin will **automatically generate your route configuration through your bundler's dev and build processes**. It is the easiest way to use TanStack Router's route generation features.

If your bundler is not yet supported, you can reach out to us on Discord or GitHub to let us know.
