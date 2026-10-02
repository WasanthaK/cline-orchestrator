import assert from "node:assert/strict";
import crypto from "node:crypto";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DISTRIBUTED_DEPLOYMENT_LISTENER_CONTRACT,
  DistributedDeploymentListenerError,
  DistributedListenerActivationController,
  DistributedListenerActivationPermitIssuer,
  createDistributedListenerBindingConfig,
  enrollDistributedMachineAuthenticationPublicKey,
  loadDistributedLocalTlsIdentity,
  rotateDistributedMachineAuthenticationPublicKey,
  type DistributedListenerBindPrimitive,
  type DistributedLocalTlsIdentityConfigV1,
} from "./distributed-deployment-listener.js";
import {
  createDistributedMachineAuthenticationBinding,
  type DistributedMachineAuthenticationBindingV1,
} from "./distributed-machine-auth-bootstrap.js";
import {
  DistributedMachineTransportError,
  DistributedMachineTransportGateway,
} from "./distributed-machine-transport.js";
import type { DistributedMachineRegistrationV1 } from "./distributed-control-contract.js";
import type { DistributedSecureTransportProfileV1 } from "./distributed-secure-transport-profile.js";
import type { DistributedSharedTlsIdentityPreflightReceiptV1 } from "./distributed-shared-unbound-https.js";

const TEST_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC1NoM6avK+uN0C
RtrX/8pSjs2tM9UmMsxlMpqeoXBi/XdL8FlbBy2/8+eiD75U2uHqRi7AjWVpsW2m
OfZ7IjS6/prv6lgGaybfv3A+A6+/64P/PCn2wq8HahfgsO0PH1RMuETUm8L2R8mx
gnYQWwaH8Di9XU1b/+GYHa5uZRsEv9kcvQtHNZxQGFIaYDIsJuIu0ojp69QyqEbq
M3OBzA8PaBUcKpC+sPfrdBsgnQpQlhCffMd+rhSau8p4vVUHXkG/9ONoWLrhR8II
RHZYX4Q7p7poeeMHmypngGUidvKt612sOr30voSU36HYCmpPPFQwW3WqqDShUkn/
T/LvB/8jAgMBAAECggEAVtjuYaP5/L/6Y+nzXkvf+lsoZZcO04TLAsES622xwC97
6jAhkwfIvFM3syrabC6O0UmbhHr/nH0FcQIch/znyqrVNKBaWZEnC1rjf0UjCNbl
5wA9mF7LpcEJ+oywwGuiajZx/nc8I+5Z0rIUxVfqtGHDv7Wkqq/ivZWUEKJyJX7A
3W6em22XLCuKUIiFg8Xq/QGNJAjchMO+9ukbj/3VIvv1yc9AN2TNG7VG2fJUE4VZ
wBY1c7TahHiLtyMyOJJaVSx+G5x53eOtUmLJ1HZwXl1fodCUN6xHwPjkGxWl/Wb8
fYtHNoy9r4UnIU5ZIa4RngBUq17WiGepWw19xgEN0QKBgQDw9LGO7Mf/0CndlRDL
h5mcqB+hJCH9oP0owlgAYezoEBnBtY6RKFJnzM5lQwEWLVKLButEhXovzYHRfx/k
/j+zkGeC+8KqNqY9yJSjuuhjpp9jABwYhF19OPsLmTONltvt2Mj0axNod0VA2vfM
iPEM6Z0wv48LNUrAaUNVLLSeSQKBgQDAhuvWQNFNwFKvucCDfC/YEK7UMssphR9j
JxlAVnXxuhdDPX1YEorl05gWGN7HmKkXcCA06qCHxNS1d4Aqiba365pK/t39WMdj
8IcocCmZznzenYOmZ1yvj0Mu4GLjTwvmfkw7Sbg/HrqoZldQRV4J3IzndWqzU7To
yWHv+kOiCwKBgQDoCUufrkdfAo/+cRlOVlPIN2LWI9yTyN9hy91A6Qxh4XdcQkF7
adAJY4Hyo9a9C4IsncocH0muFQIJw5jsRScE/W+hBF7O2Xe3kZwKG+jEZeWhSa7E
sVryRtgCsFKj6/34isXiEecLt6e6L+NnVQyEecfE9QOEMJq+td+Ae1+n+QKBgAXU
0FXX9r71IUwDQ0p4O3a+4py4wSCL0KyPJZumQsJEkanOtfox7ZUSeJvKuwyumgiE
s+UGakBSfOLWMMKZEzi04SJ+X7jptHhZc66M3yWydGPFv5QNs2f53d4Qm84oucKM
dsCg9fyrcJnjJ6fdwgBodrgX/VhbI7KdTuMW4G+LAoGBAMPA22OfuceG9uINpmH/
MzFQ8ieTnnDMiSeplmiBwHMVsvDjAJwcNQzMV3QHCtM9aokN8yrWDvI7BB3Ig7n3
IBZAmBjeRiT72cXO6J0ft4Gfv5sGEgLEIRoJztC41ur4ziq20lxMgEQinoNnMczm
wNOSfDCIJXvrnyecpevvLwDn
-----END PRIVATE KEY-----`;

const TEST_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIDajCCAlKgAwIBAgIUF5x+13ketbgbWJVTnj+cLFdJ6gkwDQYJKoZIhvcNAQEL
BQAwITEfMB0GA1UEAwwWY29udHJvbGxlci5leGFtcGxlLmNvbTAeFw0yNjEwMDIw
OTIwNTFaFw0zNjA5MjkwOTIwNTFaMCExHzAdBgNVBAMMFmNvbnRyb2xsZXIuZXhh
bXBsZS5jb20wggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC1NoM6avK+
uN0CRtrX/8pSjs2tM9UmMsxlMpqeoXBi/XdL8FlbBy2/8+eiD75U2uHqRi7AjWVp
sW2mOfZ7IjS6/prv6lgGaybfv3A+A6+/64P/PCn2wq8HahfgsO0PH1RMuETUm8L2
R8mxgnYQWwaH8Di9XU1b/+GYHa5uZRsEv9kcvQtHNZxQGFIaYDIsJuIu0ojp69Qy
qEbqM3OBzA8PaBUcKpC+sPfrdBsgnQpQlhCffMd+rhSau8p4vVUHXkG/9ONoWLrh
R8IIRHZYX4Q7p7poeeMHmypngGUidvKt612sOr30voSU36HYCmpPPFQwW3WqqDSh
Ukn/T/LvB/8jAgMBAAGjgZkwgZYwHQYDVR0OBBYEFAZZtcD6+1pWjHAYK9UB2h4g
gOZuMB8GA1UdIwQYMBaAFAZZtcD6+1pWjHAYK9UB2h4ggOZuMCEGA1UdEQQaMBiC
FmNvbnRyb2xsZXIuZXhhbXBsZS5jb20wDAYDVR0TAQH/BAIwADAOBgNVHQ8BAf8E
BAMCBaAwEwYDVR0lBAwwCgYIKwYBBQUHAwEwDQYJKoZIhvcNAQELBQADggEBAIgx
SWMzFCqcR8RPgOtFtyA/9+T6IuQy5PYG3IgUFibMscWwD0pCQaGEdxJBBtenUReX
zL/dCcomACuWvWu6EtuaYu2eIKao39xnKRXxzVXv1E86J9jbEBw09zGUNtFhPbmY
FAdppN4Keh98840z3R+D0zSUn0apGkhTFkjlAcMU41eIlEjoE7E7QyLj8nC2nI9Q
0S2076dN2N1KKTuIsNfLZV0gXqUlzKWQ0U64D0FJqwlpOT6Fv1UCLhmbaf5z1fgG
ftFbJ6SHOedYSnzbfKB/B8vV2XL+NDBwJajpYJKwkMnd53JV0Ds3zR4OQ5sE5fFy
zZQrBfUV/TtGC7Mb76A=
-----END CERTIFICATE-----`;

const PROFILE_ID="11111111-1111-4111-8111-111111111111";
const REGISTRATION_ID="22222222-2222-4222-8222-222222222222";
const MACHINE_ID="33333333-3333-4333-8333-333333333333";
const PERMIT_ID="44444444-4444-4444-8444-444444444444";
const SESSION_ID="55555555-5555-4555-8555-555555555555";
const REQUEST_ID="66666666-6666-4666-8666-666666666666";
const NOW=new Date("2026-10-03T00:00:00.000Z");

function profile(origin="https://controller.example.com:8443"):DistributedSecureTransportProfileV1{
  return {
    schemaVersion:1,
    profileId:PROFILE_ID,
    controllerOrigin:origin,
    serverSpkiSha256Pins:["sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="],
    connectTimeoutMs:5000,
    maxResponseBytes:65536,
    serverAuthentication:"system_ca_plus_spki_sha256_pin",
    authority:"transport_configuration_only",
    networkIoEnabled:false,
    grantsTaskAuthority:false,
    grantsFilesystemAuthority:false,
    grantsSafetyPlanAuthority:false,
    grantsWriterLeaseAuthority:false,
    grantsCredentialAuthority:false,
    grantsReleaseAuthority:false,
  };
}

function preflight(origin="https://controller.example.com:8443"):DistributedSharedTlsIdentityPreflightReceiptV1{
  return {
    schemaVersion:1,
    profileId:PROFILE_ID,
    controllerOrigin:origin,
    leafSpkiSha256Pin:"sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    certificateValidFrom:"2026-10-02T00:00:00.000Z",
    certificateValidTo:"2027-10-02T00:00:00.000Z",
    hostnameOrIpMatched:true,
    privateKeyMatched:true,
    authority:"deployment_readiness_evidence_only",
    grantsTaskAuthority:false,
    grantsFilesystemAuthority:false,
    grantsSafetyPlanAuthority:false,
    grantsWriterLeaseAuthority:false,
    grantsCredentialAuthority:false,
    grantsReleaseAuthority:false,
  };
}

function registration(revision=1):DistributedMachineRegistrationV1{
  return {
    schemaVersion:1,
    registrationId:REGISTRATION_ID,
    machineId:MACHINE_ID,
    revision,
    createdAt:"2026-10-02T00:00:00.000Z",
    updatedAt:new Date(Date.parse("2026-10-02T00:00:00.000Z")+revision-1).toISOString(),
    allowedCapabilities:["accept_writer_candidates"],
    authority:"identity_only",
  };
}

function edPublic():string{
  const {publicKey}=crypto.generateKeyPairSync("ed25519");
  const der=publicKey.export({format:"der",type:"spki"});
  assert.ok(Buffer.isBuffer(der));
  return der.toString("base64");
}

function tlsConfig(keyPath:string,certPath:string):DistributedLocalTlsIdentityConfigV1{
  return {
    schemaVersion:1,
    privateKeyPath:keyPath,
    certificateChainPath:certPath,
    authority:"local_deployment_configuration_only",
    grantsCredentialAuthority:false,
    grantsTaskAuthority:false,
    grantsFilesystemAuthority:false,
    grantsSafetyPlanAuthority:false,
    grantsWriterLeaseAuthority:false,
    grantsReleaseAuthority:false,
  };
}

function expectCode(code:DistributedDeploymentListenerError["code"]){
  return (error:unknown)=>{
    assert.ok(error instanceof DistributedDeploymentListenerError);
    assert.equal(error.code,code);
    return true;
  };
}

test("M12W immutable contract remains software-only and non-authorizing",()=>{
  assert.deepEqual(DISTRIBUTED_DEPLOYMENT_LISTENER_CONTRACT,{
    schemaVersion:1,
    durableMachineBindingStoreIncluded:true,
    machineBindingStoresPrivateKey:false,
    machineKeyRotationBumpsRegistrationRevision:true,
    tlsIdentityLoaderIsReadOnly:true,
    tlsProvisioningIncluded:false,
    automaticCertificateRenewalIncluded:false,
    selfSignedFallbackAllowed:false,
    bindAddressMustBeExplicitIp:true,
    wildcardBindAllowed:false,
    publicBindAllowed:false,
    bindPortMustMatchControllerOrigin:true,
    listenerActivationRequiresOneShotPermit:true,
    permitProcessLocalOnly:true,
    permitConsumedBeforeBind:true,
    hostedProofUsesRealNetworkBind:false,
    firewallMutationIncluded:false,
    dnsMutationIncluded:false,
    tunnelMutationIncluded:false,
    reverseProxyTrustEnabled:false,
    controllerPushEnabled:false,
    distributedTakeoverEnabled:false,
    invokesTargetRuntime:false,
    grantsTaskAuthority:false,
    grantsFilesystemAuthority:false,
    grantsSafetyPlanAuthority:false,
    grantsWriterLeaseAuthority:false,
    grantsCredentialAuthority:false,
    grantsReleaseAuthority:false,
  });
});

test("M12W TLS loader reads only strict local regular files and returns parsed in-memory identity",async(t)=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"m12w-tls-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const keyPath=path.join(dir,"controller-key.pem");
  const certPath=path.join(dir,"controller-chain.pem");
  await writeFile(keyPath,TEST_KEY_PEM,{mode:0o600});
  await writeFile(certPath,TEST_CERT_PEM,{mode:0o644});

  const loaded=await loadDistributedLocalTlsIdentity(tlsConfig(keyPath,certPath));
  assert.equal(loaded.privateKey.type,"private");
  assert.equal(loaded.certificates.length,1);
  assert.equal(loaded.certificates[0]?.includes("BEGIN CERTIFICATE"),true);
  assert.equal(JSON.stringify(loaded.certificates).includes("PRIVATE KEY"),false);

  await assert.rejects(
    ()=>loadDistributedLocalTlsIdentity({...tlsConfig(keyPath,certPath),privateKeyPath:"relative.pem"}),
    expectCode("credential_path_invalid"),
  );

  if(process.platform!=="win32"){
    await chmod(keyPath,0o644);
    await assert.rejects(
      ()=>loadDistributedLocalTlsIdentity(tlsConfig(keyPath,certPath)),
      expectCode("credential_file_invalid"),
    );
    await chmod(keyPath,0o600);
  }

  const link=path.join(dir,"key-link.pem");
  await symlink(keyPath,link);
  await assert.rejects(
    ()=>loadDistributedLocalTlsIdentity(tlsConfig(link,certPath)),
    expectCode("credential_file_invalid"),
  );

  const invalidKey=path.join(dir,"invalid-key.pem");
  await writeFile(invalidKey,"not a key",{mode:0o600});
  await assert.rejects(
    ()=>loadDistributedLocalTlsIdentity(tlsConfig(invalidKey,certPath)),
    expectCode("private_key_invalid"),
  );

  const huge=path.join(dir,"huge-key.pem");
  await writeFile(huge,Buffer.alloc(64*1024+1),{mode:0o600});
  await assert.rejects(
    ()=>loadDistributedLocalTlsIdentity(tlsConfig(huge,certPath)),
    expectCode("credential_file_invalid"),
  );
});

test("M12W bind config allows only explicit loopback/private IP and exact origin port",()=>{
  assert.deepEqual(
    createDistributedListenerBindingConfig(profile(),{
      bindAddress:"127.0.0.1",port:8443,exposure:"loopback",
    }).bindAddress,
    "127.0.0.1",
  );
  assert.equal(
    createDistributedListenerBindingConfig(profile(),{
      bindAddress:"192.168.1.20",port:8443,exposure:"private_network",
    }).exposure,
    "private_network",
  );
  assert.equal(
    createDistributedListenerBindingConfig(profile(),{
      bindAddress:"fd00::20",port:8443,exposure:"private_network",
    }).bindAddress,
    "fd00::20",
  );

  for(const input of [
    {bindAddress:"0.0.0.0",port:8443,exposure:"private_network"},
    {bindAddress:"::",port:8443,exposure:"private_network"},
    {bindAddress:"8.8.8.8",port:8443,exposure:"private_network"},
    {bindAddress:"224.0.0.1",port:8443,exposure:"private_network"},
    {bindAddress:"192.168.1.20",port:443,exposure:"private_network"},
    {bindAddress:"192.168.1.20",port:8443,exposure:"loopback"},
  ] as const){
    assert.throws(
      ()=>createDistributedListenerBindingConfig(profile(),input as any),
      expectCode("bind_invalid"),
    );
  }
});

test("M12W enrollment binds only the exact current registration",async()=>{
  let stored:DistributedMachineAuthenticationBindingV1|undefined;
  const result=await enrollDistributedMachineAuthenticationPublicKey(
    REGISTRATION_ID,
    edPublic(),
    {
      registrations:{async get(){return registration(1);}},
      bindings:{async put(binding,expected){
        assert.deepEqual(expected,{absent:true});
        stored=structuredClone(binding);
        return structuredClone(binding);
      }},
    },
  );
  assert.equal(result.registrationId,REGISTRATION_ID);
  assert.equal(result.machineId,MACHINE_ID);
  assert.equal(result.registrationRevision,1);
  assert.deepEqual(result,stored);
});

test("M12W rotation bumps registration revision before replacing public binding and failure stays fail-closed",async()=>{
  const first=createDistributedMachineAuthenticationBinding({
    registrationId:REGISTRATION_ID,
    machineId:MACHINE_ID,
    registrationRevision:1,
    publicKeySpkiDerBase64:edPublic(),
  });
  let current=registration(1);
  const events:string[]=[];
  let binding=first;

  const replacement=await rotateDistributedMachineAuthenticationPublicKey(
    {
      registrationId:REGISTRATION_ID,
      expectedRegistrationRevision:1,
      expectedCurrentFingerprint:first.publicKeyFingerprint,
      newPublicKeySpkiDerBase64:edPublic(),
    },
    {
      registrations:{
        async get(){return structuredClone(current);},
        async update(_id,request){
          events.push("registration-update");
          assert.equal(request.expectedRevision,1);
          current={...current,revision:2,updatedAt:"2026-10-02T00:00:01.000Z"};
          return structuredClone(current);
        },
      },
      bindings:{
        async get(){return structuredClone(binding);},
        async put(next,expected){
          events.push("binding-put");
          assert.deepEqual(expected,{
            publicKeyFingerprint:first.publicKeyFingerprint,
            registrationRevision:1,
          });
          binding=structuredClone(next);
          return structuredClone(next);
        },
      },
    },
  );
  assert.deepEqual(events,["registration-update","binding-put"]);
  assert.equal(replacement.registrationRevision,2);

  current=registration(1);
  binding=first;
  await assert.rejects(
    ()=>rotateDistributedMachineAuthenticationPublicKey(
      {
        registrationId:REGISTRATION_ID,
        expectedRegistrationRevision:1,
        expectedCurrentFingerprint:first.publicKeyFingerprint,
        newPublicKeySpkiDerBase64:edPublic(),
      },
      {
        registrations:{
          async get(){return structuredClone(current);},
          async update(){
            current={...current,revision:2,updatedAt:"2026-10-02T00:00:01.000Z"};
            return structuredClone(current);
          },
        },
        bindings:{
          async get(){return structuredClone(binding);},
          async put(){throw new Error("store failure");},
        },
      },
    ),
    expectCode("binding_rotation_failed"),
  );
  assert.equal(current.revision,2);
  assert.equal(binding.registrationRevision,1);
});

test("M12W registration revision bump invalidates an already-issued M12C session",async()=>{
  let current=registration(1);
  const gateway=new DistributedMachineTransportGateway(
    {async get(){return structuredClone(current);}},
    {
      now:()=>new Date(NOW),
      idFactory:()=>SESSION_ID,
      tokenFactory:()=>`dmt_${"x".repeat(48)}`,
    },
  );
  const issued=await gateway.issue(REGISTRATION_ID,{
    capabilities:["accept_writer_candidates"],
    ttlMs:60_000,
  });
  current={...current,revision:2,updatedAt:"2026-10-02T00:00:01.000Z"};
  await assert.rejects(
    ()=>gateway.authorize(issued.token,REQUEST_ID,"accept_writer_candidates"),
    (e:any)=>e instanceof DistributedMachineTransportError && e.code==="session_stale",
  );
});

test("M12W one-shot permit is exact, short-lived and consumed before fake bind",async()=>{
  const bind=createDistributedListenerBindingConfig(profile(),{
    bindAddress:"127.0.0.1",port:8443,exposure:"loopback",
  });
  const issuer=new DistributedListenerActivationPermitIssuer({
    now:()=>new Date(NOW),
    idFactory:()=>PERMIT_ID,
  });
  const permit=issuer.issue(bind,preflight(),120_000);

  const calls:any[]=[];
  const fakeBinder:DistributedListenerBindPrimitive={
    async bind(_server,request){calls.push(structuredClone(request));},
  };
  const controller=new DistributedListenerActivationController(issuer,fakeBinder);
  const server=https.createServer();

  const receipt=await controller.activate({
    server,
    bindConfig:bind,
    preflight:preflight(),
    permit,
  });
  assert.deepEqual(calls,[{host:"127.0.0.1",port:8443,exclusive:true}]);
  assert.equal(receipt.listening,true);
  assert.equal(server.listening,false,"fake hosted proof must not open a real listener");
  assert.equal(JSON.stringify(receipt).includes("PRIVATE KEY"),false);

  await assert.rejects(
    ()=>controller.activate({server,bindConfig:bind,preflight:preflight(),permit}),
    expectCode("permit_replayed"),
  );
});

test("M12W permit mismatch/expiry fails before fake bind and failed bind burns permit",async()=>{
  const bind=createDistributedListenerBindingConfig(profile(),{
    bindAddress:"127.0.0.1",port:8443,exposure:"loopback",
  });
  const clock={value:new Date(NOW)};
  let seq=0;
  const issuer=new DistributedListenerActivationPermitIssuer({
    now:()=>new Date(clock.value),
    idFactory:()=>[
      "77777777-7777-4777-8777-777777777777",
      "88888888-8888-4888-8888-888888888888",
    ][seq++]!,
  });
  const expired=issuer.issue(bind,preflight(),30_000);
  clock.value=new Date(NOW.getTime()+30_000);
  let calls=0;
  const binder:DistributedListenerBindPrimitive={async bind(){calls++;}};
  const controller=new DistributedListenerActivationController(issuer,binder);
  await assert.rejects(
    ()=>controller.activate({
      server:https.createServer(),
      bindConfig:bind,
      preflight:preflight(),
      permit:expired,
    }),
    expectCode("permit_expired"),
  );
  assert.equal(calls,0);

  clock.value=new Date(NOW);
  const burn=issuer.issue(bind,preflight(),30_000);
  const failing=new DistributedListenerActivationController(issuer,{
    async bind(){throw new Error("bind failure");},
  });
  await assert.rejects(
    ()=>failing.activate({
      server:https.createServer(),
      bindConfig:bind,
      preflight:preflight(),
      permit:burn,
    }),
    expectCode("bind_failed"),
  );
  await assert.rejects(
    ()=>controller.activate({
      server:https.createServer(),
      bindConfig:bind,
      preflight:preflight(),
      permit:burn,
    }),
    expectCode("permit_replayed"),
  );
});
