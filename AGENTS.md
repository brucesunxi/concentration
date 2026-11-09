# User-authorized database scope

The user explicitly restricted database access on 2026-10-07. These limits apply to all agents working on this project and override broader deployment or product-development authorization.

- The only authorized Neon endpoint is `ep-winter-rain-b51yahyp`, with database `neondb`. Its pooled hostname is `ep-winter-rain-b51yahyp-pooler.c-7.us-east-2.aws.neon.tech`; its direct hostname is `ep-winter-rain-b51yahyp.c-7.us-east-2.aws.neon.tech`.
- Before any database connection, verify the exact endpoint and database without printing credentials. Use the existing limited application role where possible. A pasted owner connection string is not permission to expand privileges.
- Do not access any other Neon project, endpoint, or database, including read-only inspection. In particular, `ep-lucky-sunset-b5n639wa` and `ep-wild-dawn-b5nq28f8` are outside the authorized scope. The user explicitly withdrew any previous agent authorization for these endpoints. Connection strings pasted for identification do not grant permission to use them.
- Do not create, duplicate, delete, or reset Neon projects, branches, endpoints, or databases. Do not change account integrations, API keys, or database grants without a new explicit user request naming the action and resource.
- Do not delete any of the similarly named Neon projects. The user requested identification only and explicitly prohibited deletion.
- Git pushes, Vercel deployments, automated tests, and the ongoing product goal do not authorize provisioning additional database infrastructure. If an operation requires resources outside this scope, stop that operation and explain the specific missing authorization.
- Never commit or print database passwords or complete credential-bearing connection strings. Do not save credentials for unauthorized databases.
- If unauthorized endpoint credentials are found in agent-managed local configuration, remove only those credential entries without connecting to the endpoint, printing the values, or affecting other settings. This credential-cleanup authorization does not permit deleting databases, changing remote passwords, or altering the user's account permissions.

These instructions restrict agent behavior; they do not claim to revoke permissions in the user's Neon account. Report platform-level credential revocation only after it has actually been performed and verified.

# Development startup and cleanup notes

- Before development or cleanup, read the “打开本地应用” and “开发前检查与清理记录” sections in `README.md`.
- The 2026-10-14 cleanup retained `node_modules`. It removed only `.DS_Store`, Python bytecode caches, four duplicate candidate MP3 files under `dist/content-rule-candidates/`, and a duplicate image prompt. This cleanup requires no dependency reinstall, web rebuild, or audio generation before ordinary development.
- With dependencies installed and matching the current lockfile, use `npm run dev`. Run `npm ci` when dependencies are missing or dependency manifests / lockfiles have changed; it is not required for every development session.
- `npm run dev` still uses `DATABASE_URL` when it is set; `APP_MODE=local` does not force the embedded database. Before starting any service with a Neon connection, verify its endpoint and database under the database scope above without printing credentials.
- Python bytecode caches regenerate automatically. The retained candidate audio in `assets/content-rule-candidates/` is used directly by the content studio. Do not run voice-generation commands merely to restore deleted build copies.
- Do not treat `.focus-data/`, `dist/web-releases/`, `dist/mobile-native/`, QA evidence, native project files, signing material, or historical compatibility assets as disposable caches. Check references and retention requirements before proposing further cleanup.
