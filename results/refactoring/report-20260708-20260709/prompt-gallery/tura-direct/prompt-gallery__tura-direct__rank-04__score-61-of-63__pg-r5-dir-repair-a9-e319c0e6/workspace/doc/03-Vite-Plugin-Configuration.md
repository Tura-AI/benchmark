# Vite Plugin Configuration

Source: https://mintlify.wiki/TanStack/router/start/config/vite-plugin

Title: Vite Plugin Configuration

URL Source: https://mintlify.wiki/TanStack/router/start/config/vite-plugin

Markdown Content:
> ## Documentation Index
> 
> 
> Fetch the complete documentation index at: [https://mintlify.com/TanStack/router/llms.txt](https://mintlify.com/TanStack/router/llms.txt)
> 
> 
> Use this file to discover all available pages before exploring further.

The TanStack Start Vite plugin is the core integration that enables full-stack functionality in your application. It handles server functions, routing, SSR, and build configuration.

## Installation

The plugin is included with your framework-specific Start package:

```
npm install @tanstack/react-start
# or
npm install @tanstack/solid-start
# or
npm install @tanstack/vue-start
```

## Basic Setup

Add the plugin to your `vite.config.ts`:

## Configuration Options

The plugin accepts a configuration object with the following options:

### srcDirectory

Specify the source directory for your application.

```
tanstackStart({
  srcDirectory: 'src', // default: 'src'
})
```

### start

Configure the Start entry point.

```
tanstackStart({
  start: {
    entry: './src/start.tsx', // Custom start entry file
  },
})
```

### router

Configure router-specific options.

```
tanstackStart({
  router: {
    entry: './src/router.tsx', // Custom router entry
    basepath: '/', // Base path for routing
    routesDirectory: 'routes', // Routes directory relative to src
    generatedRouteTree: 'routeTree.gen.ts', // Generated route tree file
  },
})
```

#### Router Options

*   **entry**: Custom router entry file path
*   **basepath**: Base path for all routes (default: inherits from Vite’s `base` option)
*   **routesDirectory**: Directory containing route files (default: `'routes'`)
*   **generatedRouteTree**: Path for generated route tree file (default: `'routeTree.gen.ts'`)

### client

Configure client-side build options.

```
tanstackStart({
  client: {
    entry: './src/client.tsx', // Custom client entry
    base: '/_build', // Client asset base path (default: '/_build')
  },
})
```

### server

Configure server-side build options. See [Server Options](https://mintlify.wiki/TanStack/router/start/config/server-options) for details.

```
tanstackStart({
  server: {
    entry: './src/server.ts', // Custom server entry
    build: {
      staticNodeEnv: true, // Replace process.env.NODE_ENV at build time
    },
  },
})
```

### serverFns

Configure server function behavior.

```
tanstackStart({
  serverFns: {
    base: '/_serverFn', // Base path for server functions (default: '/_serverFn')
    generateFunctionId: ({ filename, functionName }) => {
      // Custom function ID generation
      return `${filename}:${functionName}`
    },
  },
})
```

#### serverFns Options

*   **base**: Base path for server function endpoints (default: `'/_serverFn'`)
*   **generateFunctionId**: Custom function to generate unique IDs for server functions

### pages

Define pages for prerendering and sitemap generation.

```
tanstackStart({
  pages: [
    {
      path: '/',
      sitemap: {
        priority: 1.0,
        changefreq: 'daily',
      },
    },
    {
      path: '/about',
      prerender: {
        enabled: true,
        outputPath: '/about.html',
      },
    },
  ],
})
```

### prerender

Configure static site generation. See [Static Generation](https://mintlify.wiki/TanStack/router/start/guides/static-generation) for details.

```
tanstackStart({
  prerender: {
    enabled: true,
    concurrency: 4, // Number of pages to prerender concurrently
    failOnError: true, // Fail build if prerendering errors
    autoStaticPathsDiscovery: true, // Auto-discover static paths
    maxRedirects: 5, // Maximum redirects to follow
    crawlLinks: true, // Crawl links to discover pages
    retryCount: 3, // Retry failed prerenders
    retryDelay: 1000, // Delay between retries (ms)
    headers: {
      'User-Agent': 'TanStack-Start-Prerenderer',
    },
    onSuccess: ({ page, html }) => {
      console.log(`Prerendered: ${page.path}`)
    },
  },
})
```

### sitemap

Configure sitemap generation.

```
tanstackStart({
  sitemap: {
    enabled: true,
    host: 'https://example.com',
    outputPath: 'sitemap.xml', // default: 'sitemap.xml'
  },
})
```

### spa

Configure Single Page Application (SPA) mode.

```
tanstackStart({
  spa: {
    enabled: true,
    maskPath: '/', // Path to use for SPA shell
    prerender: {
      outputPath: '/_shell',
      crawlLinks: false,
    },
  },
})
```

### dev

Configure development server options.

```
tanstackStart({
  dev: {
    ssrStyles: {
      enabled: true, // Enable SSR styles in development
      basepath: '/', // Base path for SSR styles
    },
  },
})
```

### importProtection

Configure import protection to prevent server code from being bundled in the client.

```
tanstackStart({
  importProtection: {
    enabled: true,
    behavior: 'error', // 'error' | 'mock'
    // or separate behavior for dev and build
    behavior: {
      dev: 'mock',
      build: 'error',
    },
    mockAccess: 'error', // 'error' | 'warn' | 'off'
    client: {
      specifiers: ['fs', 'path'], // Deny specific imports on client
      files: [/\.server\./], // Deny files matching pattern
      excludeFiles: [/node_modules/], // Exclude from checking
    },
    server: {
      specifiers: ['react-dom/client'], // Deny specific imports on server
    },
    onViolation: (violation) => {
      // Custom violation handler
      console.error('Import violation:', violation)
      return false // Return true to suppress error
    },
    maxTraceDepth: 50, // Maximum import chain depth to trace
    log: 'once', // 'once' | 'always'
  },
})
```

#### Import Protection Options

*   **enabled**: Enable import protection (default: `true`)
*   **behavior**: How to handle violations - `'error'` throws, `'mock'` creates mock exports
*   **mockAccess**: Control runtime diagnostics when mocked imports are accessed
*   **client**: Rules for client-side imports
    *   **specifiers**: Array of import specifiers to deny (strings or RegExp)
    *   **files**: Array of file patterns to deny (strings or RegExp)
    *   **excludeFiles**: Array of file patterns to exclude from checking

*   **server**: Rules for server-side imports
*   **onViolation**: Callback when a violation occurs
*   **maxTraceDepth**: Maximum depth to trace import chains
*   **log**: Control logging frequency for violations

### vite

Advanced Vite integration options.

```
tanstackStart({
  vite: {
    installDevServerMiddleware: true, // Install dev server middleware
  },
})
```

## Complete Example

Here’s a comprehensive configuration example:

```
import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'

export default defineConfig({
  plugins: [
    tanstackStart({
      srcDirectory: 'src',
      router: {
        basepath: '/',
        routesDirectory: 'routes',
      },
      client: {
        base: '/_build',
      },
      server: {
        build: {
          staticNodeEnv: true,
        },
      },
      serverFns: {
        base: '/_serverFn',
      },
      prerender: {
        enabled: true,
        concurrency: 4,
        crawlLinks: true,
      },
      sitemap: {
        enabled: true,
        host: 'https://example.com',
      },
      importProtection: {
        enabled: true,
        behavior: {
          dev: 'mock',
          build: 'error',
        },
        client: {
          specifiers: ['fs', 'path', 'crypto'],
        },
      },
    }),
  ],
})
```

## Environment Variables

The plugin automatically defines several environment variables that are replaced at build time:

*   `TSS_SERVER_FN_BASE`: Base path for server functions
*   `TSS_CLIENT_OUTPUT_DIR`: Client output directory
*   `TSS_ROUTER_BASEPATH`: Router base path
*   `TSS_SHELL`: Whether SPA shell is enabled (dev only)
*   `TSS_DEV_SERVER`: Whether running in dev server
*   `TSS_DEV_SSR_STYLES_ENABLED`: Whether SSR styles are enabled in dev
*   `TSS_DEV_SSR_STYLES_BASEPATH`: Base path for SSR styles in dev

These are available via `process.env.TSS_*` or `import.meta.env.TSS_*`.

## Next Steps
