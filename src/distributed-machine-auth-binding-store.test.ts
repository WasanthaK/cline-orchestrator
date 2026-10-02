import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createDistributedMachineAuthenticationBinding,
  type DistributedMachineAuthenticationBindingV1,
} from "./distributed-machine-auth-bootstrap.js";
import {
  DistributedMachineAuthenticationBindingStoreError,
  FileDistributedMachineAuthenticationBindingStore,
} from "./distributed-machine-auth-binding-store.js";

const REG_A="11111111-1111-4111-8111-111111111111";
const REG_B="22222222-2222-4222-8222-222222222222";
const MACHINE_A="33333333-3333-4333-8333-333333333333";
const MACHINE_B="44444444-4444-4444-8444-444444444444";

function binding(
  registrationId=REG_A,
  machineId=MACHINE_A,
  revision=1,
): DistributedMachineAuthenticationBindingV1 {
  const {publicKey}=crypto.generateKeyPairSync("ed25519");
  const der=publicKey.export({format:"der",type:"spki"});
  assert.ok(Buffer.isBuffer(der));
  return createDistributedMachineAuthenticationBinding({
    registrationId,
    machineId,
    registrationRevision:revision,
    publicKeySpkiDerBase64:der.toString("base64"),
  });
}

async function fixture(): Promise<{dir:string; file:string; store:FileDistributedMachineAuthenticationBindingStore}> {
  const dir=await mkdtemp(path.join(os.tmpdir(),"m12w-bind-"));
  const file=path.join(dir,"machine-auth-bindings.json");
  return {dir,file,store:new FileDistributedMachineAuthenticationBindingStore(file)};
}

test("M12W binding store creates, reads, replaces and deletes canonical public bindings", async (t)=>{
  const {dir,file,store}=await fixture();
  t.after(()=>rm(dir,{recursive:true,force:true}));

  const first=binding();
  await store.put(first,{absent:true});
  assert.deepEqual(await store.get(REG_A),first);

  const second=binding(REG_B,MACHINE_B,1);
  await store.put(second,{absent:true});
  assert.deepEqual((await store.list()).map(x=>x.registrationId),[REG_A,REG_B]);

  const replacement=binding(REG_A,MACHINE_A,2);
  await store.put(replacement,{
    publicKeyFingerprint:first.publicKeyFingerprint,
    registrationRevision:first.registrationRevision,
  });
  assert.deepEqual(await store.get(REG_A),replacement);

  await store.delete(REG_B,{
    publicKeyFingerprint:second.publicKeyFingerprint,
    registrationRevision:1,
  });
  assert.deepEqual((await store.list()).map(x=>x.registrationId),[REG_A]);

  const fileStat=await stat(file);
  if(process.platform!=="win32") assert.equal(fileStat.mode & 0o777,0o600);
  const names=await readdir(dir);
  assert.deepEqual(names,["machine-auth-bindings.json"]);

  const raw=JSON.parse(await readFile(file,"utf8"));
  assert.deepEqual(raw.bindings.map((x:any)=>x.registrationId),[REG_A]);
  assert.equal(JSON.stringify(raw).includes("privateKey"),false);
});

test("M12W binding store optimistic expectations fail closed", async (t)=>{
  const {dir,store}=await fixture();
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const first=binding();
  await store.put(first,{absent:true});

  await assert.rejects(
    ()=>store.put(binding(REG_A,MACHINE_A,2),{absent:true}),
    (e:any)=>e instanceof DistributedMachineAuthenticationBindingStoreError && e.code==="binding_conflict",
  );
  await assert.rejects(
    ()=>store.put(binding(REG_A,MACHINE_A,2),{
      publicKeyFingerprint:"sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      registrationRevision:1,
    }),
    (e:any)=>e instanceof DistributedMachineAuthenticationBindingStoreError && e.code==="binding_conflict",
  );
  await assert.rejects(
    ()=>store.delete(REG_A,{
      publicKeyFingerprint:first.publicKeyFingerprint,
      registrationRevision:99,
    }),
    (e:any)=>e instanceof DistributedMachineAuthenticationBindingStoreError && e.code==="binding_conflict",
  );
  assert.deepEqual(await store.get(REG_A),first);
});

test("M12W binding store rejects corrupt roots, unsupported private-key fields and oversized state", async (t)=>{
  const {dir,file}=await fixture();
  t.after(()=>rm(dir,{recursive:true,force:true}));

  await writeFile(file,JSON.stringify({schemaVersion:1,bindings:"nope"}),{mode:0o600});
  await assert.rejects(
    ()=>new FileDistributedMachineAuthenticationBindingStore(file).list(),
    (e:any)=>e instanceof DistributedMachineAuthenticationBindingStoreError && e.code==="store_corrupt",
  );

  const bad={...binding(),privateKey:"forbidden"};
  await writeFile(file,JSON.stringify({schemaVersion:1,bindings:[bad]}),{mode:0o600});
  await assert.rejects(
    ()=>new FileDistributedMachineAuthenticationBindingStore(file).list(),
    (e:any)=>e instanceof DistributedMachineAuthenticationBindingStoreError && e.code==="store_corrupt",
  );

  await writeFile(file,Buffer.alloc(1024*1024+1,0x41),{mode:0o600});
  await assert.rejects(
    ()=>new FileDistributedMachineAuthenticationBindingStore(file).list(),
    (e:any)=>e instanceof DistributedMachineAuthenticationBindingStoreError && e.code==="store_corrupt",
  );
});

test("M12W binding store rejects symlink, non-regular and unsafe POSIX mode", async (t)=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"m12w-bind-path-"));
  t.after(()=>rm(root,{recursive:true,force:true}));

  const target=path.join(root,"target.json");
  await writeFile(target,JSON.stringify({schemaVersion:1,bindings:[]}),{mode:0o600});
  const link=path.join(root,"machine-auth-bindings.json");
  await symlink(target,link);
  await assert.rejects(
    ()=>new FileDistributedMachineAuthenticationBindingStore(link).list(),
    (e:any)=>e instanceof DistributedMachineAuthenticationBindingStoreError && e.code==="store_path_invalid",
  );
  await rm(link);

  await mkdir(link);
  await assert.rejects(
    ()=>new FileDistributedMachineAuthenticationBindingStore(link).list(),
    (e:any)=>e instanceof DistributedMachineAuthenticationBindingStoreError && e.code==="store_path_invalid",
  );
  await rm(link,{recursive:true,force:true});

  if(process.platform!=="win32"){
    await writeFile(link,JSON.stringify({schemaVersion:1,bindings:[]}),{mode:0o600});
    await chmod(link,0o622);
    await assert.rejects(
      ()=>new FileDistributedMachineAuthenticationBindingStore(link).list(),
      (e:any)=>e instanceof DistributedMachineAuthenticationBindingStoreError && e.code==="store_permissions_invalid",
    );
  }
});

test("M12W binding store requires exact absolute canonical file location and existing parent", async (t)=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"m12w-bind-loc-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  assert.throws(
    ()=>new FileDistributedMachineAuthenticationBindingStore("machine-auth-bindings.json"),
    (e:any)=>e instanceof DistributedMachineAuthenticationBindingStoreError && e.code==="store_path_invalid",
  );
  assert.throws(
    ()=>new FileDistributedMachineAuthenticationBindingStore(path.join(dir,"other.json")),
    (e:any)=>e instanceof DistributedMachineAuthenticationBindingStoreError && e.code==="store_path_invalid",
  );

  const missingParent=path.join(dir,"missing","machine-auth-bindings.json");
  await assert.rejects(
    ()=>new FileDistributedMachineAuthenticationBindingStore(missingParent).list(),
    (e:any)=>e instanceof DistributedMachineAuthenticationBindingStoreError && e.code==="store_path_invalid",
  );
});

test("M12W binding store rejects duplicate registration IDs in durable state", async (t)=>{
  const {dir,file}=await fixture();
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const one=binding();
  await writeFile(file,JSON.stringify({schemaVersion:1,bindings:[one,one]}),{mode:0o600});
  await assert.rejects(
    ()=>new FileDistributedMachineAuthenticationBindingStore(file).list(),
    (e:any)=>e instanceof DistributedMachineAuthenticationBindingStoreError && e.code==="store_corrupt",
  );
});
