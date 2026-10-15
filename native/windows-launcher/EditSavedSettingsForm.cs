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
    private readonly Button review = new() { Text = "Review update", Enabled = false, AutoSize = true };
    private readonly Button refresh = new() { Text = "Refresh saved settings", AutoSize = true };
    private readonly Button close = new() { Text = "Close", AutoSize = true };
    private string? revision;
    private bool busy;

    internal EditSavedSettingsForm()
    {
        Text = "Cline Orchestrator — Edit saved local model";
        Width = 670; Height = 390;
        MinimumSize = new Size(580, 340);
        StartPosition = FormStartPosition.CenterParent;
        provider.Items.Add("OpenAI-compatible (llama.cpp)");
        provider.Items.Add("Ollama OpenAI-compatible endpoint");
        provider.SelectedIndex = 0;
        var table = new TableLayoutPanel {
            Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 6, Padding = new Padding(18),
        };
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 170));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        for (int i = 0; i < 3; i++) table.RowStyles.Add(new RowStyle(SizeType.Absolute, 46));
        table.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        table.RowStyles.Add(new RowStyle(SizeType.Absolute, 46));
        table.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
        table.Controls.Add(new Label { Text = "Provider", Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft }, 0, 0);
        table.Controls.Add(provider, 1, 0);
        table.Controls.Add(new Label { Text = "Model ID", Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft }, 0, 1);
        table.Controls.Add(model, 1, 1);
        table.Controls.Add(new Label { Text = "Local API URL", Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft }, 0, 2);
        table.Controls.Add(endpoint, 1, 2);
        table.Controls.Add(state, 0, 3); table.SetColumnSpan(state, 2);
        var actions = new FlowLayoutPanel { Dock = DockStyle.Fill };
        actions.Controls.Add(refresh); actions.Controls.Add(review); actions.Controls.Add(close);
        table.Controls.Add(actions, 0, 4); table.SetColumnSpan(actions, 2);
        table.Controls.Add(new Label {
            Dock = DockStyle.Fill, Text = "Updates need model verification and fresh one-time consent. Previous settings are preserved.",
        }, 0, 5);
        table.SetColumnSpan(table.GetControlFromPosition(0, 5)!, 2);
        Controls.Add(table);
        refresh.Click += async (_, _) => await RefreshAsync();
        review.Click += async (_, _) => await UpdateAsync();
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
        busy = true; review.Enabled = false; refresh.Enabled = false;
        revision = null;
        state.Text = "Inspecting current local settings...";
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
                state.Text = "Saved local settings loaded. Review changes before approving; updates never start tasks.";
                review.Enabled = true;
            }
            catch {
                try { if (!child.HasExited) child.Kill(entireProcessTree: true); } catch { }
                throw;
            }
        }
        catch { state.Text = "Saved settings could not be verified. No changes made."; }
        finally { busy = false; refresh.Enabled = true; }
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
