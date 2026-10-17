/** Server-rendered native operator Settings screen. No JavaScript or network. */
import { type AdvisorSettingsViewV1 } from "./recovery-advisor-settings.js";
import type { AdvisorCredentialReadinessV1 } from "./native-advisor-credential.js";
function esc(v: unknown): string {
  return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
const checked = (condition: boolean) => condition ? " checked" : "";
const selected = (condition: boolean) => condition ? " selected" : "";
export function renderAdvisorSettingsForm(
  view: AdvisorSettingsViewV1, csrf: string, projectLabel: string,
  notice?: "saved" | "needs_refresh", projectId?: string,
  credential?: AdvisorCredentialReadinessV1,
): string {
  if (!view || view.schemaVersion!==1 || view.externalCallsEnabled!==false
    || view.grantsAuthority!==false || !/^[a-f0-9]{64}$/.test(csrf)
    || !/^[a-f0-9]{64}$/.test(view.revision)
    || typeof projectLabel!=="string" || projectLabel.length>100
    || (projectId !== undefined && (projectId !== view.projectId
      || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(projectId))))
    throw new Error("invalid_settings_view");
  return '<section aria-label="Recovery advisor settings">'
    + '<h2>AI recovery help</h2>'
    + '<p>Choose how Cline Orchestrator should handle development interruptions. '
    + 'Advice is separate from permission to run commands or change code.</p>'
    + (notice==="saved" ? '<p role="status">Settings saved. External consultations are not connected yet.</p>' :
      notice==="needs_refresh" ? '<p role="alert">Settings changed. Refresh and try again.</p>' : '')
    + '<p><strong>Project:</strong> '+esc(projectLabel)
    + (projectId ? ' · <a href="/operator/advisor-settings">Change project</a>' : '')+'</p>'
    + (view.expired ? '<p role="status">Your previous consent expired. AI advice remains off until you renew it.</p>' : '')
    + (view.stopLatched ? '<p role="alert">Emergency Stop is active for this project. '
      + 'New consultations are blocked. Cancellation of in-flight requests was requested; '
      + 'data already sent cannot be recalled. Re-enabling requires a separate trusted reset.</p>' : '')
    + (view.stopLatched && projectId
      ? '<form method="post" action="/operator/advisor-reset">'
        + '<input type="hidden" name="csrf" value="'+esc(csrf)+'">'
        + '<input type="hidden" name="revision" value="'+esc(view.revision)+'">'
        + '<input type="hidden" name="project" value="'+esc(projectId)+'">'
        + '<button type="submit">Reset Stop (leave AI advice off)</button></form>'
      : '')
    + '<form method="post" action="/operator/advisor-settings">'
    + '<input type="hidden" name="csrf" value="'+esc(csrf)+'">'
    + '<input type="hidden" name="revision" value="'+esc(view.revision)+'">'
    + (projectId ? '<input type="hidden" name="project" value="'+esc(projectId)+'">' : '')
    + '<section aria-label="Advisor connection readiness"><h3>Connection readiness</h3>'
    + (credential && credential.schemaVersion===1
       && credential.externalCallsEnabled===false && credential.grantsAuthority===false
       && credential.validatedWithProvider===false
      ? (credential.state==="reference_present_unverified"
          ? '<p role="status">Credential reference found, but not verified with the provider.</p>'
          : '<p role="status">Advisor credential has not been configured in the native host.</p>')
      : '<p role="status">Credential status unavailable.</p>')
    + '<p>The native host uses the dedicated ORCH_RECOVERY_ADVISOR_API_KEY reference. '
    + 'The value is never entered in this form or displayed. External calls remain disabled.</p>'
    + '</section>'
    + '<fieldset><legend>When Cline needs help</legend>'
    + '<label class="option"><input type="radio" name="mode" value="off"'
    + checked(view.mode==="off")+'><strong>Off</strong> — Do not contact an external advisor</label>'
    + '<label class="option"><input type="radio" name="mode" value="automatic_advice"'
    + checked(view.mode==="automatic_advice")+'><strong>Automatic advice</strong> — Ask for guidance '
    + 'within your limits, without repeatedly prompting you</label>'
    + '<label class="option"><input type="radio" name="mode" value="ask_before_consulting"'
    + checked(view.mode==="ask_before_consulting")+'><strong>Ask me first</strong> — Review each consultation</label>'
    + '</fieldset>'
    + '<fieldset><legend>Usage limits</legend>'
    + '<label>Maximum estimated cost per consultation <select name="cents">'
    + [10,50,100,500].map(c=>'<option value="'+c+'"'+selected(view.maxEstimatedCentsPerIncident===c)+'>'
      +(c/100).toFixed(2)+' USD</option>').join('')+'</select></label>'
    + '<label>Recheck permission after <select name="days">'
    + [7,30].map(d=>'<option value="'+d+'"'+selected(view.durationDays===d)+'>'
      +d+' days</option>').join('')+'</select></label>'
    + '</fieldset>'
    + '<fieldset><legend>Privacy</legend>'
    + '<p>Only incident metadata may be sent to OpenAI. No source code, prompts, file paths or API keys.</p>'
    + '<label><input type="checkbox" name="acknowledge" value="yes">'
    + ' I allow incident metadata to be sent externally when advice is enabled.</label>'
    + '<p>Human questions, safety approvals, expired permission and exceeded limits '
    + 'still require your attention.</p>'
    + '</fieldset>'
    + '<p><button type="submit">Save settings</button> <a href="/operator">Back to operator control</a></p>'
    + '</form>'
    + (!view.stopLatched && projectId && view.mode!=="off"
      ? '<form method="post" action="/operator/advisor-stop">'
        + '<input type="hidden" name="csrf" value="'+esc(csrf)+'">'
        + '<input type="hidden" name="project" value="'+esc(projectId)+'">'
        + '<button class="danger" type="submit">Stop AI advisor now</button></form>'
      : '')
    + '<p class="minor">External advice is not active in the installed supervisor yet. '
    + 'Saving this preference does not enable network calls or execute recovery actions.</p>'
    + '</section>';
}
