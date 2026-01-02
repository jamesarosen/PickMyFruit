# Pick My Fruit - Web Application

This is the main web application for Pick My Fruit, built with Solid JS and TanStack Router.

## 🚀 Project Structure

```text
/
├── public/          # Static assets (images, fonts, etc.)
├── src/
│   ├── components/  # Reusable UI components
│   ├── routes/      # Page components and routing
│   ├── styles/      # Global styles and CSS
│   └── main.tsx     # Application entry point
├── index.html       # HTML entry point
├── vite.config.ts   # Vite configuration
└── package.json
```

- Routes are defined in `src/routes/` using TanStack Router's file-based routing
- Components are Solid JS components in `src/components/`
- Static assets like images can be placed in the `public/` directory

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command          | Action                                       |
| :--------------- | :------------------------------------------- |
| `pnpm install`   | Installs dependencies                        |
| `pnpm dev`       | Starts local dev server at `localhost:5173`  |
| `pnpm build`     | Build your production site to `./dist/`      |
| `pnpm preview`   | Preview your build locally, before deploying |
| `pnpm lint`      | Run ESLint to check code quality             |
| `pnpm typecheck` | Run TypeScript compiler to check types       |
| `pnpm format`    | Format code with Prettier                    |

## 🛠️ Tech Stack

- [Solid JS](https://www.solidjs.com/) - Reactive UI library
- [TanStack Router](https://tanstack.com/router) - Type-safe routing
- [Vite](https://vitejs.dev/) - Build tool and dev server
- [TypeScript](https://www.typescriptlang.org/) - Type safety
