using System.Diagnostics;
using System.Drawing;
using System.Text.Json;
using System.Windows.Forms;

namespace ClineOrchestrator.Launcher;

/// <summary>Native-only saved-provider editor. Never authorizes a browser action.</summary>
internal sealed class EditSavedSettingsForm : Form
{
    private readonly ComboBox provider = new() { DropDownStyle = ComboBoxStyle.DropDownList, Dock = DockStyle.Fill };
    private readonly TextBox model = new() { Dock = DockStyle.Fill };
    private readonly TextBox endpoint = new() { Dock = DockStyle.Fill };
    private readonly Label state = new() { Dock = DockStyle.Fill, Text = "Loading saved settings..." };
    private readonly Label recoveryStatus = new() { Dock = DockStyle.Fill, Text = "Recovery: Unknown" };
    private readonly Button review = new() { Text = "Review update", Enabled = false, AutoSize = true };
    private readonly Button refresh = new() { Text = "Refresh saved settings", AutoSize = true };
    private readonly Button testSaved = new() { Text = "Test saved model", Enabled = false, AutoSize = true };
    private readonly Button restore = new() { Text = "Restore selected model", Enabled = false, AutoSize = true };
    private readonly ComboBox restoreChoices = new() { DropDownStyle = ComboBoxStyle.DropDownList, Dock = DockStyle.Fill };
    private sealed record RestoreOption(string Revision, string ProviderId, string ModelId, string BaseUrl)
    {
        public override string ToString() => ModelId + "  (" + Revision[..8] + ")";
    }
    private readonly Button close = new() { Text = "Close", AutoSize = true };
    private string? revision;
    private bool busy;
    private string? loadedSelection;

    internal EditSavedSettingsForm()
    {
        Text = "Cline Orchestrator — Edit saved local model";
        Width = 730; Height = 515;
        MinimumSize = new Size(650, 465);
        StartPosition = FormStartPosition.CenterParent;
        CancelButton = close;
        NativeAccessibility.Name(provider, "Saved model provider", "Keyboard and screen-reader control. No task authority is granted by this control.");
        NativeAccessibility.Name(model, "Saved model ID", "Keyboard and screen-reader control. No task authority is granted by this control.");
        NativeAccessibility.Name(endpoint, "Saved model endpoint", "Keyboard and screen-reader control. No task authority is granted by this control.");
        NativeAccessibility.Name(review, "Review settings update", "Keyboard and screen-reader control. This action requires separate confirmation.");
        NativeAccessibility.Name(refresh, "Refresh saved settings", "Keyboard and screen-reader control. No task authority is granted by this control.");
        NativeAccessibility.Name(testSaved, "Test saved model", "Sends one harmless local prompt against an unchanged saved revision. No task.");
        NativeAccessibility.Name(restoreChoices, "Verified previous model selections", "Keyboard and screen-reader control. No task authority is granted by this control.");
        NativeAccessibility.Name(restore, "Restore selected model", "Keyboard and screen-reader control. This action requires separate confirmation.");
        NativeAccessibility.Name(close, "Close saved model editor", "Keyboard and screen-reader control. No task authority is granted by this control.");
        state.AccessibleName = "Saved model status";
        recoveryStatus.AccessibleName = "Previous configuration verification";
        provider.Items.Add("OpenAI-compatible (llama.cpp)");
        provider.Items.Add("Ollama OpenAI-compatible endpoint");
        provider.SelectedIndex = 0;
        var table = new TableLayoutPanel {
            Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 8, Padding = new Padding(18),
        };
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 170));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        for (int i = 0; i < 3; i++) table.RowStyles.Add(new RowStyle(SizeType.Absolute, 46));
        table.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        table.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
        table.RowStyles.Add(new RowStyle(SizeType.Absolute, 44));
        table.RowStyles.Add(new RowStyle(SizeType.Absolute, 52));
        table.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
        table.Controls.Add(new Label { Text = "Provider", Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft }, 0, 0);
        table.Controls.Add(provider, 1, 0);
        table.Controls.Add(new Label { Text = "Model ID", Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft }, 0, 1);
        table.Controls.Add(model, 1, 1);
        table.Controls.Add(new Label { Text = "Local API URL", Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft }, 0, 2);
        table.Controls.Add(endpoint, 1, 2);
        table.Controls.Add(state, 0, 3); table.SetColumnSpan(state, 2);
        table.Controls.Add(recoveryStatus, 0, 4); table.SetColumnSpan(recoveryStatus, 2);
        table.Controls.Add(new Label { Text = "Verified previous model", Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.MiddleLeft }, 0, 5);
        table.Controls.Add(restoreChoices, 1, 5);
        var actions = new FlowLayoutPanel { Dock = DockStyle.Fill };
        actions.Controls.Add(refresh); actions.Controls.Add(testSaved); actions.Controls.Add(review); actions.Controls.Add(restore); actions.Controls.Add(close);
        table.Controls.Add(actions, 0, 6); table.SetColumnSpan(actions, 2);
        table.Controls.Add(new Label {
            Dock = DockStyle.Fill, Text = "Updates need model verification and fresh one-time consent. Previous settings are preserved.",
        }, 0, 7);
        table.SetColumnSpan(table.GetControlFromPosition(0, 7)!, 2);
        Controls.Add(table);
        refresh.Click += async (_, _) => await RefreshAsync();
        review.Click += async (_, _) => await UpdateAsync();
        testSaved.Click += async (_, _) => await TestSavedAsync();
        provider.SelectedIndexChanged += (_, _) => UpdateProbeEnabled();
        model.TextChanged += (_, _) => UpdateProbeEnabled();
        endpoint.TextChanged += (_, _) => UpdateProbeEnabled();
        restore.Click += async (_, _) => await RestoreAsync();
        restoreChoices.SelectedIndexChanged += (_, _) => restore.Enabled = !busy && revision is not null
            && restoreChoices.SelectedItem is RestoreOption;
        close.Click += (_, _) => Close();
        Shown += async (_, _) => await RefreshAsync();
    }

    private ProcessStartInfo Command(string command, params string[] args)
    {
        string root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, ".."));
        string node = Path.Combine(root, "runtime", "node.exe");
        string entry = Path.Combine(root, "app", "node_modules", "cline-orchestrator", "dist", "product-cli.js");
        if (!File.Exists(node) || !File.Exists(entry)) throw new InvalidOperationException();
        var psi = new ProcessStartInfo(node) {
            WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, RedirectStandardError = true,
            RedirectStandardInput = true,
        };
        psi.ArgumentList.Add(entry); psi.ArgumentList.Add(command);
        foreach (string arg in args) psi.ArgumentList.Add(arg);
        foreach (string key in psi.Environment.Keys.Cast<string>().ToArray())
            if (key.StartsWith("ORCH_", StringComparison.OrdinalIgnoreCase))
                psi.Environment.Remove(key);
        return psi;
    }

    private async Task RefreshAsync()
    {
        if (busy) return;
        busy = true; review.Enabled = false; refresh.Enabled = false; restore.Enabled = false;
        restoreChoices.Items.Clear();
        revision = null; loadedSelection = null; testSaved.Enabled = false;
        state.Text = "Inspecting current local settings...";
        recoveryStatus.Text = "Recovery evidence: Unknown";
        try
        {
            using var child = Process.Start(Command("settings-desktop")) ?? throw new InvalidOperationException();
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
            try
            {
                var stdout = child.StandardOutput.ReadToEndAsync(timeout.Token);
                var stderr = child.StandardError.ReadToEndAsync(timeout.Token);
                await child.WaitForExitAsync(timeout.Token);
                string json = await stdout; _ = await stderr;
                if (child.ExitCode != 0 || json.Length > 8192) throw new InvalidOperationException();
                using var document = JsonDocument.Parse(json);
                var result = document.RootElement;
                if (result.GetProperty("schemaVersion").GetInt32() != 1
                    || result.GetProperty("command").GetString() != "settings-desktop"
                    || !result.GetProperty("readOnly").GetBoolean()
                    || result.GetProperty("grantsAuthority").GetBoolean()) throw new InvalidOperationException();
                if (result.GetProperty("status").GetString() != "configured") {
                    state.Text = "No safely editable settings found. Use first-run setup if not yet configured.";
                    return;
                }
                string rev = result.GetProperty("revision").GetString() ?? "";
                if (rev.Length != 64 || !rev.All(Uri.IsHexDigit)) throw new InvalidOperationException();
                var selection = result.GetProperty("selection");
                string selectedProvider = selection.GetProperty("providerId").GetString() ?? "";
                string selectedModel = selection.GetProperty("modelId").GetString() ?? "";
                string selectedUrl = selection.GetProperty("baseUrl").GetString() ?? "";
                if (selectedProvider is not ("openai-compatible" or "ollama-openai")
                    || selectedModel.Length is < 1 or > 160 || selectedUrl.Length is < 1 or > 250)
                    throw new InvalidOperationException();
                provider.SelectedIndex = selectedProvider == "ollama-openai" ? 1 : 0;
                model.Text = selectedModel; endpoint.Text = selectedUrl;
                revision = rev;
                loadedSelection = SelectedValues();
                state.Text = "Saved local settings loaded. Review changes before approving; updates never start tasks.";
                review.Enabled = true;
                await ReadRecoveryStatusAsync();
                await ReadRestoreChoicesAsync();
            }
            catch {
                try { if (!child.HasExited) child.Kill(entireProcessTree: true); } catch { }
                throw;
            }
        }
        catch { state.Text = "Saved settings could not be verified. No changes made."; }
        finally {
            busy = false; refresh.Enabled = true;
            restore.Enabled = revision is not null && restoreChoices.SelectedItem is RestoreOption;
            UpdateProbeEnabled();
        }
    }

    // Recovery status has no restore control or write permission.
    private async Task ReadRecoveryStatusAsync()
    {
        recoveryStatus.Text = "Recovery evidence: Unknown";
        try
        {
            using var child = Process.Start(Command("recovery-desktop"))
                ?? throw new InvalidOperationException();
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
            try
            {
                var stdout = child.StandardOutput.ReadToEndAsync(timeout.Token);
                var stderr = child.StandardError.ReadToEndAsync(timeout.Token);
                await child.WaitForExitAsync(timeout.Token);
                string json = await stdout; _ = await stderr;
                if (child.ExitCode != 0 || json.Length > 8192)
                    throw new InvalidOperationException();
                using var parsed = JsonDocument.Parse(json);
                var record = parsed.RootElement;
                if (record.GetProperty("schemaVersion").GetInt32() != 1
                    || record.GetProperty("command").GetString() != "recovery-desktop"
                    || !record.GetProperty("readOnly").GetBoolean()
                    || record.GetProperty("grantsAuthority").GetBoolean()
                    || record.GetProperty("restorationAvailable").GetBoolean())
                    throw new InvalidOperationException();
                string? status = record.GetProperty("status").GetString();
                recoveryStatus.Text = status switch
                {
                    "no_previous_version" when record.GetProperty("verifiedCount").GetInt32() == 0
                        => "Recovery: No saved previous versions (verified)",
                    "verified_versions" when record.GetProperty("verifiedCount").GetInt32() is > 0 and <= 32
                        => $"Recovery: {record.GetProperty("verifiedCount").GetInt32()} verified previous version(s); restore not enabled",
                    "needs_attention" => "Recovery: Previous versions need attention; no restore action",
                    "unavailable" => "Recovery: Verification unavailable",
                    _ => throw new InvalidOperationException(),
                };
            }
            catch {
                try { if (!child.HasExited) child.Kill(entireProcessTree: true); }
                catch { /* Only our owned child. */ }
                throw;
            }
        }
        catch { recoveryStatus.Text = "Recovery evidence: Unknown"; }
    }

    private async Task ReadRestoreChoicesAsync()
    {
        restore.Enabled = false;
        restoreChoices.Items.Clear();
        try
        {
            using var child = Process.Start(Command("restore-choices-desktop"))
                ?? throw new InvalidOperationException();
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
            try
            {
                var stdout = child.StandardOutput.ReadToEndAsync(timeout.Token);
                var stderr = child.StandardError.ReadToEndAsync(timeout.Token);
                await child.WaitForExitAsync(timeout.Token);
                string json = await stdout; _ = await stderr;
                if (child.ExitCode != 0 || json.Length > 8192) throw new InvalidOperationException();
                using var parsed = JsonDocument.Parse(json);
                var result = parsed.RootElement;
                if (result.GetProperty("schemaVersion").GetInt32() != 1
                    || result.GetProperty("command").GetString() != "restore-choices-desktop"
                    || !result.GetProperty("readOnly").GetBoolean()
                    || result.GetProperty("grantsAuthority").GetBoolean()
                    || result.GetProperty("currentRevision").GetString() != revision)
                    throw new InvalidOperationException();
                string? status = result.GetProperty("status").GetString();
                if (status == "none") return;
                if (status != "available") throw new InvalidOperationException();
                var choices = result.GetProperty("choices");
                if (choices.ValueKind != JsonValueKind.Array || choices.GetArrayLength() is < 1 or > 32)
                    throw new InvalidOperationException();
                foreach (var item in choices.EnumerateArray())
                {
                    string digest = item.GetProperty("revision").GetString() ?? "";
                    var selection = item.GetProperty("selection");
                    string providerId = selection.GetProperty("providerId").GetString() ?? "";
                    string modelId = selection.GetProperty("modelId").GetString() ?? "";
                    string baseUrl = selection.GetProperty("baseUrl").GetString() ?? "";
                    if (digest.Length != 64 || !digest.All(Uri.IsHexDigit)
                        || providerId is not ("openai-compatible" or "ollama-openai")
                        || modelId.Length is < 1 or > 160 || baseUrl.Length is < 1 or > 250)
                        throw new InvalidOperationException();
                    restoreChoices.Items.Add(new RestoreOption(digest, providerId, modelId, baseUrl));
                }
                if (restoreChoices.Items.Count > 0) restoreChoices.SelectedIndex = 0;
            }
            catch {
                try { if (!child.HasExited) child.Kill(entireProcessTree: true); } catch { }
                throw;
            }
        }
        catch {
            restoreChoices.Items.Clear();
            recoveryStatus.Text = "Recovery: Previous versions cannot be selected safely; refresh";
        }
    }

    private async Task RestoreAsync()
    {
        if (busy || revision is null || restoreChoices.SelectedItem is not RestoreOption selected) return;
        busy = true; restore.Enabled = false; review.Enabled = false; refresh.Enabled = false;
        string currentRevision = revision;
        revision = null;
        bool success = false;
        try
        {
            using var child = Process.Start(Command("restore-model-desktop", currentRevision, selected.Revision))
                ?? throw new InvalidOperationException();
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(85));
            try
            {
                var stderr = child.StandardError.ReadToEndAsync(timeout.Token);
                string? line = await child.StandardOutput.ReadLineAsync(timeout.Token);
                if (line is null || line.Length > 8192) throw new InvalidOperationException();
                using var reviewDoc = JsonDocument.Parse(line);
                var proposal = reviewDoc.RootElement;
                var choice = proposal.GetProperty("selection");
                if (proposal.GetProperty("schemaVersion").GetInt32() != 1
                    || proposal.GetProperty("kind").GetString() != "settings-restore-review"
                    || proposal.GetProperty("action").GetString() != "restore_provider"
                    || proposal.GetProperty("destination").GetString() != "local_app_data_config"
                    || proposal.GetProperty("grantsAuthority").GetBoolean()
                    || proposal.GetProperty("currentRevision").GetString() != currentRevision
                    || proposal.GetProperty("selectedBackupRevision").GetString() != selected.Revision
                    || proposal.GetProperty("requiresExactReply").GetString() != "RESTORE CONFIG"
                    || choice.GetProperty("providerId").GetString() != selected.ProviderId
                    || choice.GetProperty("modelId").GetString() != selected.ModelId
                    || choice.GetProperty("baseUrl").GetString() != selected.BaseUrl
                    || !DateTimeOffset.TryParse(proposal.GetProperty("expiresAt").GetString(), out var expiry)
                    || expiry <= DateTimeOffset.UtcNow || expiry > DateTimeOffset.UtcNow.AddSeconds(65))
                    throw new InvalidOperationException();
                bool approved = MessageBox.Show(this,
                    "Restore this previously saved local model?\n\nModel: " + selected.ModelId
                    + "\nProvider: " + selected.ProviderId + "\nEndpoint: " + selected.BaseUrl
                    + "\n\nOnly the model connection fields will change. Current runtime and Safety settings"
                    + " are retained, and current settings are preserved as another previous version."
                    + "\nNo task or model will be started.",
                    "Confirm previous local model", MessageBoxButtons.YesNo,
                    MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) == DialogResult.Yes;
                await child.StandardInput.WriteLineAsync(approved ? "RESTORE CONFIG" : "CANCEL");
                await child.StandardInput.FlushAsync(timeout.Token);
                child.StandardInput.Close();
                string? receiptLine = await child.StandardOutput.ReadLineAsync(timeout.Token);
                await child.WaitForExitAsync(timeout.Token);
                _ = await stderr;
                if (child.ExitCode != 0 || receiptLine is null || receiptLine.Length > 8192)
                    throw new InvalidOperationException();
                using var receiptDoc = JsonDocument.Parse(receiptLine);
                var receipt = receiptDoc.RootElement;
                if (receipt.GetProperty("schemaVersion").GetInt32() != 1
                    || receipt.GetProperty("kind").GetString() != "settings-restore-result"
                    || receipt.GetProperty("grantsAuthority").GetBoolean()
                    || receipt.GetProperty("configSaved").GetBoolean() != approved)
                    throw new InvalidOperationException();
                success = approved;
                state.Text = approved ? "Previous model restored safely. Review current settings."
                    : "Restoration cancelled; current settings unchanged.";
            }
            catch {
                try { if (!child.HasExited) child.Kill(entireProcessTree: true); } catch { }
                throw;
            }
        }
        catch { state.Text = "Restoration was not verified. Refresh current settings before retrying."; }
        finally { busy = false; refresh.Enabled = true; }
        if (success) await RefreshAsync();
    }

    private string SelectedValues() => (provider.SelectedIndex == 1 ? "ollama-openai" : "openai-compatible")
        + "\n" + model.Text + "\n" + endpoint.Text;

    private void UpdateProbeEnabled()
    {
        testSaved.Enabled = !busy && revision is not null
            && loadedSelection is not null && SelectedValues() == loadedSelection;
    }

    private async Task TestSavedAsync()
    {
        if (!testSaved.Enabled || busy || revision is null) return;
        string expectedRevision = revision;
        busy = true; testSaved.Enabled = false; refresh.Enabled = false;
        review.Enabled = false; restore.Enabled = false;
        state.Text = "Testing the currently saved local model without changing settings...";
        try
        {
            using var child = Process.Start(Command("test-saved-model-desktop", expectedRevision))
                ?? throw new InvalidOperationException();
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(40));
            try
            {
                var stdout = child.StandardOutput.ReadToEndAsync(timeout.Token);
                var stderr = child.StandardError.ReadToEndAsync(timeout.Token);
                await child.WaitForExitAsync(timeout.Token);
                string raw = await stdout; _ = await stderr;
                if (child.ExitCode != 0 || raw.Length > 4096) throw new InvalidOperationException();
                using var parsed = JsonDocument.Parse(raw);
                var result = parsed.RootElement;
                if (result.GetProperty("schemaVersion").GetInt32() != 1
                    || result.GetProperty("command").GetString() != "test-saved-model-desktop"
                    || result.GetProperty("configSaved").GetBoolean()
                    || result.GetProperty("grantsAuthority").GetBoolean()
                    || result.GetProperty("taskStarted").GetBoolean()
                    || result.GetProperty("modelStarted").GetBoolean()
                    || result.GetProperty("modelAuthenticityVerified").GetBoolean())
                    throw new InvalidOperationException();
                var statusCode = result.GetProperty("status").GetString();
                bool observed = result.GetProperty("inferenceResponseObserved").GetBoolean();
                if (observed != (statusCode == "response_observed")) throw new InvalidOperationException();
                state.Text = observed
                    ? "Saved model responded. This is not a Cline task or real-model authenticity proof."
                    : "No valid saved-model response. Check the local server and try again.";
            }
            catch {
                try { if (!child.HasExited) child.Kill(entireProcessTree: true); } catch { }
                throw;
            }
        }
        catch { state.Text = "Saved-model test could not be verified. Refresh settings before retrying."; }
        finally {
            busy = false; refresh.Enabled = true;
            review.Enabled = revision is not null;
            restore.Enabled = revision is not null && restoreChoices.SelectedItem is RestoreOption;
            UpdateProbeEnabled();
        }
    }

    private async Task UpdateAsync()
    {
        if (busy || revision is null) return;
        busy = true; review.Enabled = false; refresh.Enabled = false;
        string selectedProvider = provider.SelectedIndex == 1 ? "ollama-openai" : "openai-compatible";
        string selectedModel = model.Text, selectedUrl = endpoint.Text, currentRevision = revision;
        revision = null;
        try
        {
            using var child = Process.Start(Command("update-settings-desktop",
                currentRevision, selectedProvider, selectedModel, selectedUrl)) ?? throw new InvalidOperationException();
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(85));
            try
            {
                var stderr = child.StandardError.ReadToEndAsync(timeout.Token);
                string? line = await child.StandardOutput.ReadLineAsync(timeout.Token);
                if (line is null || line.Length > 8192) throw new InvalidOperationException();
                using var reviewDoc = JsonDocument.Parse(line);
                var proposal = reviewDoc.RootElement;
                if (proposal.GetProperty("schemaVersion").GetInt32() != 1
                    || proposal.GetProperty("kind").GetString() != "settings-revision-review"
                    || proposal.GetProperty("action").GetString() != "update_config"
                    || proposal.GetProperty("destination").GetString() != "local_app_data_config"
                    || proposal.GetProperty("grantsAuthority").GetBoolean()
                    || proposal.GetProperty("previousRevision").GetString() != currentRevision
                    || proposal.GetProperty("requiresExactReply").GetString() != "UPDATE CONFIG"
                    || proposal.GetProperty("selection").GetProperty("providerId").GetString() != selectedProvider
                    || proposal.GetProperty("selection").GetProperty("modelId").GetString() != selectedModel
                    || proposal.GetProperty("selection").GetProperty("baseUrl").GetString() != selectedUrl
                    || !DateTimeOffset.TryParse(proposal.GetProperty("expiresAt").GetString(), out var expiry)
                    || expiry <= DateTimeOffset.UtcNow || expiry > DateTimeOffset.UtcNow.AddSeconds(65))
                    throw new InvalidOperationException();
                bool approved = MessageBox.Show(this,
                    "Update saved local model settings?\n\nProvider: " + selectedProvider
                    + "\nModel: " + selectedModel + "\nEndpoint: " + selectedUrl
                    + "\n\nPrevious configuration will be kept. Automatic Cline approvals remain disabled."
                    + "\nA fresh revision and local model check will be required before saving.",
                    "Confirm local settings update", MessageBoxButtons.YesNo,
                    MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) == DialogResult.Yes;
                await child.StandardInput.WriteLineAsync(approved ? "UPDATE CONFIG" : "CANCEL");
                await child.StandardInput.FlushAsync(timeout.Token);
                child.StandardInput.Close();
                string? receiptLine = await child.StandardOutput.ReadLineAsync(timeout.Token);
                await child.WaitForExitAsync(timeout.Token);
                _ = await stderr;
                if (child.ExitCode != 0 || receiptLine is null || receiptLine.Length > 8192)
                    throw new InvalidOperationException();
                using var receiptDoc = JsonDocument.Parse(receiptLine);
                var receipt = receiptDoc.RootElement;
                if (receipt.GetProperty("kind").GetString() != "settings-revision-result"
                    || receipt.GetProperty("grantsAuthority").GetBoolean()
                    || receipt.GetProperty("configSaved").GetBoolean() != approved) throw new InvalidOperationException();
                state.Text = approved ? "Saved settings updated. Previous version retained; no task launched."
                    : "Update cancelled. Original settings preserved.";
            }
            catch {
                try { if (!child.HasExited) child.Kill(entireProcessTree: true); } catch { }
                throw;
            }
        }
        catch { state.Text = "Update not completed. Refresh current settings before retrying."; }
        finally { busy = false; refresh.Enabled = true; }
    }
}
