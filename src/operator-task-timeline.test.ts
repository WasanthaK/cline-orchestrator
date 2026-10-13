import assert from "node:assert/strict";
import test from "node:test";
import { projectTaskTimeline, TASK_EVENT_TIMELINE_LIMITS } from "./operator-task-timeline.js";
import type { PublicTaskEvent } from "./machine-orchestrator.js";

const id="11111111-2222-3333-4444-555555555555";
const date="2026-10-13T01:00:00.000Z";
function e(type:PublicTaskEvent["type"], i=0):PublicTaskEvent {
 return {eventId:"private-event-id",taskId:id,type,timestamp:new Date(Date.parse(date)+i*1000).toISOString(),
   message:"Bearer PRIVATE_SECRET C:\\workspace\\source",status:"running"};
}
test("UX-2C projects safe timestamp and event labels; excludes raw message and event ids",()=>{
 const value=projectTaskTimeline(id,[e("run_started"),e("validation_failed",1)],date);
 assert.equal(value.availability,"available");
 assert.deepEqual(value.events.map(x=>x.label),["Validation failed","Run started"]);
 assert.equal(value.totalObserved,2);
 assert.doesNotMatch(JSON.stringify(value),/PRIVATE_SECRET|private-event-id|workspace|source/);
});
test("UX-2C rejects cross-task events, malformed times and unexpected types",()=>{
 assert.equal(projectTaskTimeline(id,[{...e("completed"),taskId:"different"}],date).availability,"unavailable");
 assert.equal(projectTaskTimeline(id,[{...e("completed"),timestamp:"not-a-date"}],date).availability,"unavailable");
 assert.equal(projectTaskTimeline(id,[{...e("completed"),type:"credential_exposed" as never}],date).availability,"unavailable");
});
test("UX-2C bounds recent event history and fails closed if underlying source is excessive",()=>{
 const many=Array.from({length:45},(_,i)=>e("run_started",i));
 const view=projectTaskTimeline(id,many,date);
 assert.equal(view.events.length,TASK_EVENT_TIMELINE_LIMITS.maxShownEvents);
 assert.equal(view.truncated,true);
 assert.equal(view.totalObserved,45);
 assert.equal(projectTaskTimeline(id,Array.from({length:1001},(_,i)=>e("run_started",i)),date).reason,"history_over_limit");
});
