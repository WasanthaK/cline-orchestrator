# Product distribution

The initial distribution is a local npm tarball built from a reviewed repository commit. The package remains `private: true`; npm registry publication is not part of this distribution. A local build is not a production release approval.

## Build the tarball

Use Node.js 22.15 or newer and npm with lockfile-v3 support:

```bash
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
npm run verify:package
npm run verify:installed-package
npm pack
```

`npm ci` consumes the committed dependency lock, including resolved package integrity metadata. Install scripts are disabled for the source dependency installation. `npm pack` runs the product build explicitly through its prepack hook. If packaging with `--ignore-scripts`, run `npm run build` first.

The build cleans its fixed repository `dist` directory and compiles the runtime sources. Source typecheck/tests still use the full source configuration. Tests, live-proof programs and the CR3 developer preflight are excluded from the runtime build; the build fails if imports pull those excluded programs back into its output.

`verify:package` inspects npm's prospective tarball entries, requires the product/legacy/MCP compiled entrypoints and product documentation, rejects unexpected entries or test/proof programs, and checks the product binary shebang. CI runs this check after the locked source tests and runtime build. It does not install the package or start a listener. The separate `verify:installed-package` command tests installation, the real installed CLI shim, sanitized error handling, npm uninstall and preservation of external operator-owned state in a disposable Linux environment.

The package allowlist includes compiled JavaScript under `dist`, the README and this distribution guide. npm also includes package metadata and applicable standard license files. It excludes source TypeScript, tests, proof programs, build scripts/configuration, the master plan, dependency directories and operator configuration/registry/secret/task data. Installed runtime dependencies are declared in package metadata and are not bundled in the tarball.

The source lock pins the build dependency graph. Consumer installation resolves the tarball's declared runtime dependencies through npm; the source lock is not an embedded consumer lock. This slice does not claim offline installation or byte-identical builds across arbitrary Node/npm/platform versions. A release candidate needs its exact commit, build environment, artifact checksum and runtime dependency evidence recorded separately.

## Install into an isolated user prefix

For a disposable local proof, choose a new prefix directory owned by your user:

```bash
npm install --global --prefix /path/to/disposable-prefix --ignore-scripts /absolute/path/cline-orchestrator-0.1.0.tgz
```

On POSIX, the executable is under `<prefix>/bin/cline-orchestrator`. On Windows, npm places `cline-orchestrator.cmd` in the prefix itself. Add the prefix's executable directory to your user PATH only when selecting it as your installation. No administrator access, service registration or daemon startup is performed by this installation command.

Use the installed binary for `config`, `diagnose <workspace>`, `setup <workspace>` and `status <workspace>`. Explicit setup mutations remain separate interactive commands documented in the README. The product setup path is loopback-only and uses reference names for provider credentials. Installation alone grants no task or workspace authority.

## Remove the package

```bash
npm uninstall --global --prefix /path/to/disposable-prefix cline-orchestrator
```

Keep operator-owned config files, workspace registry, secret provisioning and task/workspace data outside the package directory. npm removal manages the package and its executable shims; it does not remove externally stored operator data. Service installation/removal, shared-host runtime proof, package publication and production deployment remain separate actions.

## Evidence status

M18C1 establishes the locked source build and tarball contents (CI #1356). M18C2 adds disposable installed-package/run/removal acceptance pending exact-head CI. Windows/Linux platform acceptance is deferred to M18C3. Service installation, live daemon readiness and production release are not proven.

M18C2 initial consumer-install CI #1357 found an unavailable newer `@ai-sdk/openai` transitive version. Runtime packaging therefore declares the source-tested exact `4.0.89` dependency to constrain consumer resolution; this does not embed a consumer lockfile or guarantee offline installation.
