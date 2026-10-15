# M19E3A — Disposable Windows install lifecycle and upgrade refusal

Status: stacked review candidate on M19E2 PR #63; unsigned developer preview only.

The Windows acceptance harness executes only on a disposable **GitHub-hosted Windows runner**. It tests three phases:

- **BeforeInstall:** an intentionally occupied target refuses a silent install without changing the unrelated marker, writing product bytes, or registering the uninstaller. An independent user-data snapshot is created only if the canonical external directory is absent.
- **AfterInstall:** the first approved CI installation is checked against the embedded manifest hashes. A second silent install must refuse to overwrite those installed binaries. SHA-256 hashes and external data remain unchanged.
- **AfterUninstall:** all four user-owned categories (local configuration, workspace registry, secret reference and task-history placeholders) remain byte-identical and all product-owned executable entries disappear.

No token, secret value, user file contents or full directory path is included in the public receipt.

**This does not implement upgrades or binary rollback.** The current installer refuses existing installations; the previously implemented local-model configuration restore is not a product-binary rollback. A separate future transaction design must cover immutable old version, candidate integrity and signing, explicit owner consent, process shutdown, two-version recovery, interrupted swap/crash detection and independently reviewed restoration before update authority is introduced.

Further M19E gates remain open: interactive clean VM install, real local llama.cpp task, validation/diff review, keyboard/accessibility acceptance, controlled restart, Linux support and separate M18F signing/release authorization. Nothing in M19E3A installs on the operator workstation or widens task, model, daemon, credential, service or publication authority.
