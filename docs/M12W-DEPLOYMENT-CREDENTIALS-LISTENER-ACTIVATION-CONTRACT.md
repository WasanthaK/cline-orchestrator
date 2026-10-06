# M12W — Deployment Credentials, Durable Machine Binding, and Listener Activation Contract

Status: REVIEWED / DEFINED — NOT IMPLEMENTED
Date: 2026-10-02
Branch: `phase-1/bootstrap`

## Purpose

M12W is the final **software-only deployment substrate** before any real distributed listener or credential provisioning is performed.

It defines:

1. durable controller-side storage for M12Q machine public-key bindings;
2. strict local loaders for already-provisioned controller TLS identity and target Ed25519 signer material;
3. explicit listener bind configuration;
4. a short-lived one-shot local listener-activation permit;
5. an injectable listener activation adapter whose hosted proof performs no real bind;
6. exact enrollment / rotation / revocation ordering;
7. the separately gated first physical proof sequence.

M12W MUST NOT, by itself:

- generate or provision a TLS certificate/private key;
- generate or provision a target Ed25519 private key;
- mutate OS trust stores;
- mutate DNS, firewall, NAT, port forwarding or tunnels;
- call a real `listen()` in hosted proof;
- choose an implicit bind address or port;
- expose a public/wildcard bind;
- grant task/filesystem/Safety/writer-lease/credential-use/release authority;
- add controller push, takeover/recovery or target runtime auto-start.

The actual physical provisioning/bind/proof remains a later explicit-user-authorized action.

## Review conclusion: split software readiness from physical activation

M12W is software-only and must be completed/proven in hosted CI before physical activation.

A later physical slice (provisionally M12X) may execute the exact pre-reviewed sequence only after the user explicitly authorizes the credential/network actions immediately before they occur.

This separation prevents a code change or task from silently turning deployment readiness into a live network listener.

---

## 1. Durable M12Q machine-authentication binding store

### Why required

M12Q currently depends only on the lookup interface:

```ts
interface DistributedMachineAuthenticationBindingLookup {
  get(registrationId: string): Promise<DistributedMachineAuthenticationBindingV1>;
}
```

No durable production binding store exists yet.

M12W introduces a controller-local durable store for **public authentication metadata only**.

It stores no target private key and no M12C bearer/session.

### Store schema

Canonical root:

```ts
{
  schemaVersion: 1,
  bindings: DistributedMachineAuthenticationBindingV1[]
}
```

Properties:

- one binding per registration ID;
- maximum 256 bindings;
- exact existing M12Q binding schema only;
- bindings sorted canonically by registration ID on write;
- duplicate registration IDs rejected;
- unknown fields rejected;
- corrupt/oversized state fails closed;
- no automatic repair that discards ambiguous state.

### Store API

```ts
interface DistributedMachineAuthenticationBindingStore
  extends DistributedMachineAuthenticationBindingLookup {
  put(
    binding: DistributedMachineAuthenticationBindingV1,
    expected?: {
      absent?: true;
      publicKeyFingerprint?: string;
      registrationRevision?: number;
    }
  ): Promise<DistributedMachineAuthenticationBindingV1>;

  delete(
    registrationId: string,
    expected: {
      publicKeyFingerprint: string;
      registrationRevision: number;
    }
  ): Promise<void>;
}
```

Rules:

- `put(..., { absent: true })` is create-only;
- replacement requires exact expected current fingerprint + revision;
- delete requires exact expected current fingerprint + revision;
- stale expectations fail closed;
- all input/output reuses `assertDistributedMachineAuthenticationBinding`;
- the store grants no registration/task/session authority.

### Filesystem safety

The file-backed implementation follows the existing durable-store pattern but treats binding metadata as security-sensitive integrity state:

- configured absolute file path only;
- no path supplied by task/model/remote request;
- parent directory must already exist;
- reject symlink store path;
- reject non-regular existing store file;
- bounded file size;
- serialized in-process mutations;
- write temporary file in same directory;
- flush/close before replacement where supported;
- atomic same-filesystem rename/replace;
- owner-only write requirement;
- on POSIX, store file mode must not grant group/other write; newly created file uses `0600`;
- no secret/private-key material is written.

Platform-specific ACL strengthening may be a later hardening slice; M12W must not claim Windows ACL enforcement it has not proven.

---

## 2. Machine Ed25519 enrollment and rotation semantics

### Enrollment

Initial machine enrollment is:

1. create durable machine registration (existing M12B), producing registration revision 1;
2. generate/provision Ed25519 private key **locally on the target** through a separately authorized physical/admin action;
3. export only the target public SPKI DER;
4. controller creates exact M12Q authentication binding for that registration ID, machine ID and current registration revision;
5. durable binding store `put(..., { absent: true })`;
6. target stores only its private key + local signer reference;
7. controller stores only public binding metadata.

Registration creation does not mint a session. Binding creation does not mint a session.

### Rotation: compromised or intentionally changed target key

A key rotation MUST invalidate existing short-lived M12C sessions as well as future M12Q proof with the old key.

Safe order:

1. generate/provision new Ed25519 key on target locally, but do not delete the old key yet;
2. verify the new public key material locally;
3. controller updates the existing machine registration with the **same allowed capabilities** and expected current revision, causing the registration revision to increment;
4. that registration revision bump immediately makes existing M12C sessions stale and makes the old M12Q binding stale;
5. controller creates the new binding using the new registration revision and new public key;
6. durable binding store replaces the old binding using exact old fingerprint + old revision preconditions;
7. prove M12U possession with the new key;
8. only after successful proof may the target delete/archive the old private key through a separately authorized local action.

If step 6 fails after the registration revision bump, the machine remains unable to authenticate. This is the intended fail-closed state.

M12W does not implement a dual-key grace period.

### Revocation

Safe revocation order:

1. revoke the existing registration using its expected revision;
2. M12C/M12Q authorization fails immediately through existing registration currentness checks;
3. delete the public binding from the binding store using exact expected fingerprint/revision;
4. target private-key destruction is a separate local/admin action.

Failure to delete the public binding after registration revocation does not restore authority.

---

## 3. Controller TLS identity source

M12V accepts a trusted startup provider returning:

```ts
{
  privateKey: KeyObject,
  certificates: readonly (string | Buffer)[]
}
```

M12W defines a strict **read-only loader for already-provisioned material**. It does not issue or renew certificates.

### Local TLS identity config

```ts
{
  schemaVersion: 1,
  privateKeyPath: string,
  certificateChainPath: string,
  authority: "local_deployment_configuration_only",
  grantsCredentialAuthority: false,
  grantsTaskAuthority: false,
  grantsFilesystemAuthority: false,
  grantsSafetyPlanAuthority: false,
  grantsWriterLeaseAuthority: false,
  grantsReleaseAuthority: false
}
```

Rules:

- paths must be absolute canonical local paths from trusted process startup configuration;
- paths are not accepted from task/model/HTTP input;
- key and certificate files must exist and be regular files;
- reject symlinks;
- bounded file sizes;
- private key must parse as an unencrypted private `KeyObject`;
- certificate file must parse as a leaf-first PEM chain;
- loader returns material only in process memory;
- loader never logs file contents or PEM bytes;
- M12V preflight remains mandatory after load.

M12W explicitly does **not** support:

- passphrases;
- PFX/PKCS#12;
- remote secret-manager retrieval;
- ACME;
- automatic renewal;
- fallback certificate generation;
- self-signed fallback.

The first physical proof therefore requires a certificate that the target's system CA trust accepts and that matches the M12P controller origin.

---

## 4. TLS rotation ordering

M12P supports 1–3 SPKI pins. Rotation uses overlap and never a trust-gap.

Safe sequence:

1. obtain/provision the new system-CA-valid certificate/private key through a separately authorized process;
2. locally preflight the new identity with M12V;
3. add the **new** leaf-SPKI pin to target M12P profiles while retaining the current pin;
4. verify every intended target profile contains both old + new pins;
5. switch the controller TLS identity source to the new certificate/key;
6. activate/restart listener only through a fresh listener activation permit;
7. prove target TLS + M12U bootstrap + M12T pull using the new leaf;
8. remove the old M12P pin from targets only after all intended targets have proven the new identity;
9. retire/delete the old private key only through a separately authorized credential action.

Never switch controller identity before targets trust the new pin.

A compromised TLS private key may require emergency outage/revocation instead of overlap; M12W does not automate that policy.

---

## 5. Explicit listener bind configuration

M12W defines:

```ts
interface DistributedListenerBindingConfigV1 {
  schemaVersion: 1;
  profileId: string;
  controllerOrigin: string;
  bindAddress: string; // exact IP literal
  port: number;
  exposure: "loopback" | "private_network";
  authority: "listener_configuration_only";
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}
```

Validation:

- exact M12P profile ID + controller origin;
- `bindAddress` must be an exact IP literal;
- no hostname bind target;
- reject `0.0.0.0` and `::`;
- reject multicast;
- reject IPv4 broadcast;
- reject unspecified addresses;
- `loopback` requires loopback address;
- `private_network` requires private/local unicast address and MUST NOT accept globally routable public IPs in M12W;
- port is explicit integer 1–65535;
- port must equal the controller origin effective port (explicit URL port, otherwise 443);
- no default bind address;
- no default port;
- no DNS lookup performed to choose the bind address.

Public/global listener exposure remains a separately reviewed future decision.

---

## 6. One-shot listener activation permit

A valid bind config alone is not permission to open a socket.

M12W adds a short-lived process-local one-shot permit:

```ts
interface DistributedListenerActivationPermitV1 {
  schemaVersion: 1;
  permitId: string;
  profileId: string;
  controllerOrigin: string;
  bindAddress: string;
  port: number;
  leafSpkiSha256Pin: string;
  issuedAt: string;
  expiresAt: string;
  authority: "listener_activation_only";
  grantsTaskAuthority: false;
  grantsFilesystemAuthority: false;
  grantsSafetyPlanAuthority: false;
  grantsWriterLeaseAuthority: false;
  grantsCredentialAuthority: false;
  grantsReleaseAuthority: false;
}
```

Rules:

- process-local only;
- TTL 30–300 seconds, default 120 seconds;
- exact bind config + M12V preflight receipt binding;
- issued only by trusted local operator composition after local human confirmation;
- one-shot consumed **before** the bind attempt;
- failed bind burns the permit;
- restart loses all permits;
- no permit persistence;
- no remote endpoint can create, inspect or consume a permit;
- permit does not authorize firewall/DNS/NAT/tunnel mutation.

Hosted CI may create deterministic test permits only through injected trusted factories.

---

## 7. Listener activation adapter

M12W introduces a tiny adapter around the completed M12V unbound server.

Conceptual API:

```ts
activateDistributedListener({
  server,
  bindConfig,
  preflightReceipt,
  permit
}): Promise<DistributedListenerActivationReceiptV1>
```

Before invoking the injected bind primitive it must revalidate:

- `server.listening === false`;
- exact current M12P profile/bind config;
- exact preflight profile/origin;
- exact preflight leaf pin equals permit pin;
- exact permit bind address + port;
- unexpired/unconsumed permit.

Only then may it invoke exactly:

```ts
server.listen({
  host: bindAddress,
  port,
  exclusive: true
})
```

No overload without explicit host is allowed.

### Activation receipt

On successful activation:

```ts
{
  schemaVersion: 1,
  profileId: string,
  controllerOrigin: string,
  bindAddress: string,
  port: number,
  leafSpkiSha256Pin: string,
  listening: true,
  authority: "listener_state_evidence_only",
  grantsTaskAuthority: false,
  grantsFilesystemAuthority: false,
  grantsSafetyPlanAuthority: false,
  grantsWriterLeaseAuthority: false,
  grantsCredentialAuthority: false,
  grantsReleaseAuthority: false
}
```

The receipt contains no private key, bearer, Ed25519 key or task material.

### Hosted proof

Hosted M12W CI MUST inject/fake the bind primitive.

Production listener activation code may contain the narrowly-scoped `server.listen({host, port, exclusive:true})` call, but hosted tests MUST NOT invoke Node's real network bind.

No physical listener is opened while implementing M12W.

---

## 8. First physical proof sequence — later, separately authorized

The first live proof is staged and must stop on any mismatch.

### Phase P0 — inspect only

No mutation.

Confirm exact:

- controller machine;
- target machine;
- canonical controller origin;
- intended bind IP;
- effective port;
- existing TLS certificate source, hostname/SAN, expiry and system-CA trust;
- target signer/key storage choice;
- current machine registration and capability set;
- host firewall state for the exact port.

If suitable TLS identity or network prerequisites do not already exist, stop and request separate authorization for provisioning/mutation.

### Phase P1 — credential provisioning/enrollment

Requires explicit user authorization immediately before action.

- provision/load controller TLS identity;
- generate/provision target Ed25519 key locally;
- create/update controller public binding using the reviewed revision rules;
- do not bind listener yet;
- run M12V local preflight;
- configure target M12P profile/signature reference.

### Phase P2 — listener activation

Requires a new explicit user authorization immediately before bind.

- issue one local activation permit bound to exact profile/pin/address/port;
- call exact-address `listen()`;
- no wildcard bind;
- no firewall/DNS mutation.

If the existing firewall blocks traffic, stop. Do not alter it without another explicit authorization.

### Phase P3 — TLS proof

Read-only network proof from the target:

- target connects to exact canonical origin;
- prove system-CA validation;
- prove hostname/IP validation;
- prove exact M12P leaf-SPKI pin;
- confirm HTTP/1.1 ALPN;
- no bootstrap yet if TLS proof fails.

### Phase P4 — M12U bootstrap proof

- target requests challenge;
- signs using local Ed25519 signer;
- completes challenge;
- receives validated short-lived M12C bearer;
- verify controller audit contains no secret material.

### Phase P5 — M12S/M12T no-work pull

Use the new bearer to perform one target pull when no writer work is queued.

Expected result: M12T `204 No Content`.

This proves transport/auth without starting distributed writer execution.

### Phase P6 — bounded real delivery proof

This is **not automatically included** in listener activation.

Before dispatching real writer work, separately review whether delivery acknowledgement/reconciliation is required first. If that reliability boundary remains unresolved, stop after P5.

---

## 9. Physical rollback

If a live listener was activated:

1. stop accepting new connections;
2. close the listener;
3. verify `server.listening === false`;
4. do not remove certificates/keys/bindings automatically;
5. credential rollback/retirement requires its own explicit action;
6. firewall/DNS rollback is only needed if separately authorized mutations were made.

Listener shutdown does not revoke machine registration or M12C sessions by itself.

---

## Immutable M12W contract

M12W MUST export immutable contracts recording at minimum:

```ts
{
  schemaVersion: 1,
  durableMachineBindingStoreIncluded: true,
  machineBindingStoresPrivateKey: false,
  machineKeyRotationBumpsRegistrationRevision: true,
  tlsIdentityLoaderIsReadOnly: true,
  tlsProvisioningIncluded: false,
  automaticCertificateRenewalIncluded: false,
  selfSignedFallbackAllowed: false,
  bindAddressMustBeExplicitIp: true,
  wildcardBindAllowed: false,
  publicBindAllowed: false,
  bindPortMustMatchControllerOrigin: true,
  listenerActivationRequiresOneShotPermit: true,
  permitProcessLocalOnly: true,
  permitConsumedBeforeBind: true,
  hostedProofUsesRealNetworkBind: false,
  firewallMutationIncluded: false,
  dnsMutationIncluded: false,
  tunnelMutationIncluded: false,
  reverseProxyTrustEnabled: false,
  controllerPushEnabled: false,
  distributedTakeoverEnabled: false,
  invokesTargetRuntime: false,
  grantsTaskAuthority: false,
  grantsFilesystemAuthority: false,
  grantsSafetyPlanAuthority: false,
  grantsWriterLeaseAuthority: false,
  grantsCredentialAuthority: false,
  grantsReleaseAuthority: false
}
```

---

## Hosted implementation proof requirements

Before M12W can be marked complete, hosted CI must prove:

1. durable public binding store create/get/replace/delete;
2. strict exact binding schema and store root;
3. duplicate/corrupt/oversized store fails closed;
4. optimistic fingerprint/revision replacement/delete checks;
5. no private-key field accepted or persisted;
6. file-store symlink/non-regular-path rejection;
7. same-directory atomic replacement path;
8. new POSIX file mode is 0600 and writable-by-group/other existing files are rejected or safely tightened according to the implemented policy;
9. enrollment binding must exactly match current registration ID/machine ID/revision;
10. key-rotation helper/order bumps registration revision before binding replacement;
11. a post-bump binding failure leaves authentication fail-closed;
12. registration revision change invalidates prior M12C session through existing M12C currentness proof;
13. TLS identity loader accepts only exact configured absolute key/chain paths;
14. TLS loader rejects symlinks/non-regular/oversized/encrypted-or-invalid key material;
15. TLS loader logs/returns no path-derived credential bytes outside trusted return object;
16. M12V preflight remains mandatory after loader;
17. listener bind config rejects wildcard/public/multicast/mismatched-port input;
18. loopback/private exposure classification is exact;
19. activation permit is exact, short-lived, one-shot and restart/process-local only;
20. wrong pin/profile/origin/address/port or expired permit fails before bind primitive;
21. permit is consumed before attempted bind and remains burned on bind failure;
22. fake bind primitive receives exactly one explicit host/port/exclusive request;
23. production activation API has no overload that omits host;
24. activation receipt contains no credential/task material;
25. hosted CI opens no real listener/socket;
26. no firewall/DNS/NAT/tunnel mutation code is introduced;
27. no direct M12C/M12Q authority is introduced;
28. no M12H/M12I start path is introduced;
29. existing M12S–M12V tests remain green.

---

## Explicit non-goals / separately gated physical work

M12W implementation does not itself perform:

- TLS certificate issuance/renewal;
- target Ed25519 private-key generation/provisioning;
- OS trust-store changes;
- actual listener bind in hosted CI;
- firewall changes;
- DNS changes;
- NAT/port-forwarding;
- tunnel creation;
- public/global exposure;
- reverse proxy deployment;
- physical cross-machine network proof;
- delivery acknowledgement/reconciliation;
- distributed writer execution;
- takeover/recovery;
- push/merge/deploy/release authority.

Any real credential creation/provisioning or listener/network mutation requires explicit user authorization immediately before the action.
