/**
 * M19R3K — fail-closed, durable emergency stop for one registered project.
 *
 * A one-way emergency latch independent of the normal settings lease. It
 * blocks future consultations, survives restart and can request cancellation
 * of in-flight HTTP. Re-enabling deliberately requires a later trusted,
 * explicit reset mechanism; saving "Automatic advice" cannot clear a stop.
 */
import { mkdir, lstat, open, readFile } from "node:fs/promises";
import path from "node:path";

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const STOP_FILE="recovery-advisor-stopped-v1.json";
export class AdvisorStopError extends Error {
  constructor(readonly code:"invalid"|"state_unavailable"|"state_corrupt") {
    super(code);this.name="AdvisorStopError";
  }
}
export interface AdvisorStopResultV1 {
  schemaVersion:1; status:"stopped"; persisted:true;
  cancellationRequested:true; deliveryCanBeRecalled:false;
  externalCallsEnabled:false; grantsAuthority:false;
}
export const ADVISOR_STOP_CONTRACT=Object.freeze({
  schemaVersion:1 as const, persistent:true as const,
  bypassesConsultationLock:true as const, reenableViaNormalSave:false as const,
  networkCalls:false as const, grantsAuthority:false as const,
});
export class DurableAdvisorStop {
  constructor(private readonly directory:string,private readonly projectId:string) {
    const absolute=path.resolve(directory);
    if(!path.isAbsolute(directory)||absolute===path.parse(absolute).root
      || directory.includes("\0")||!UUID.test(projectId))
      throw new AdvisorStopError("invalid");
  }
  private filename(){return path.join(path.resolve(this.directory),STOP_FILE);}
  private async prepare() {
    try {
      await mkdir(this.directory,{recursive:true,mode:0o700});
      const st=await lstat(this.directory);
      if(!st.isDirectory()||st.isSymbolicLink()
        || (process.platform!=="win32"&&(st.mode&0o077)!==0))
        throw new Error("unsafe");
    }catch{throw new AdvisorStopError("state_unavailable");}
  }
  /** Missing marker is the only healthy/unstopped state. Corrupt != clear. */
  async isStopped():Promise<boolean> {
    await this.prepare();
    try {
      const st=await lstat(this.filename());
      if(!st.isFile()||st.isSymbolicLink()||st.size>512
        || (process.platform!=="win32"&&(st.mode&0o077)!==0))
        throw new AdvisorStopError("state_corrupt");
      const value:unknown=JSON.parse(await readFile(this.filename(),"utf8"));
      if(!value||typeof value!=="object"||Array.isArray(value))
        throw new AdvisorStopError("state_corrupt");
      const obj=value as Record<string,unknown>;
      if(Object.keys(obj).sort().join("|")!=="projectId|schemaVersion|stopped"
        || obj.schemaVersion!==1||obj.projectId!==this.projectId||obj.stopped!==true)
        throw new AdvisorStopError("state_corrupt");
      return true;
    }catch(e){
      if((e as NodeJS.ErrnoException).code==="ENOENT")return false;
      if(e instanceof AdvisorStopError)throw e;
      throw new AdvisorStopError("state_unavailable");
    }
  }
  /** Idempotent concurrent stop; never waits for a live consultation lock. */
  async stopNow():Promise<AdvisorStopResultV1>{
    await this.prepare();
    let handle:Awaited<ReturnType<typeof open>>|undefined;
    try {
      handle=await open(this.filename(),"wx",0o600);
      await handle.writeFile(JSON.stringify({
        schemaVersion:1,projectId:this.projectId,stopped:true,
      }),"utf8");
      await handle.sync();
    }catch(e) {
      if((e as NodeJS.ErrnoException).code!=="EEXIST")
        throw new AdvisorStopError("state_unavailable");
    }finally{await handle?.close().catch(()=>undefined);}
    // A preexisting or partially written marker must never count as success.
    if(!await this.isStopped())throw new AdvisorStopError("state_unavailable");
    return Object.freeze({schemaVersion:1,status:"stopped",persisted:true,
      cancellationRequested:true,deliveryCanBeRecalled:false,
      externalCallsEnabled:false,grantsAuthority:false});
  }
  /** Optional per-process observer. Fail-closed on any state-read failure. */
  watch(intervalMs=100):{signal:AbortSignal;close:()=>void} {
    if(!Number.isSafeInteger(intervalMs)||intervalMs<50||intervalMs>1000)
      throw new AdvisorStopError("invalid");
    const abort=new AbortController();
    let reading=false,closed=false;
    const tick=async()=>{
      if(reading||closed||abort.signal.aborted)return;
      reading=true;
      try {if(await this.isStopped())abort.abort();}
      catch {abort.abort();}
      finally {reading=false;}
    };
    const timer=setInterval(()=>{void tick();},intervalMs);
    void tick();
    return {signal:abort.signal,close:()=>{closed=true;clearInterval(timer);}};
  }
}
