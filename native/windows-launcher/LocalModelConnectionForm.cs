using System.Diagnostics;
using System.Drawing;
using System.Text.Json;
using System.Windows.Forms;

namespace ClineOrchestrator.Launcher;

/// <summary>
/// M19C1: explicitly invoked, native first-run local model connection screen.
/// Calls only the installed metadata-only "check-provider" CLI route.
/// Configuration/registration/daemon/task mutations are not exposed.
/// </summary>
internal sealed class LocalModelConnectionForm : Form
{
    private readonly ComboBox provider = new() { DropDownStyle = ComboBoxStyle.DropDownList, Dock = DockStyle.Fill };
    private readonly TextBox endpoint = new() { Dock = DockStyle.Fill, Text = "http://127.0.0.1:8080/v1" };
    private readonly TextBox model = new() { Dock = DockStyle.Fill, Text = "qwen38-27b-192k" };
    private readonly Label status = new() { AutoSize = false, Dock = DockStyle.Fill, Text = "No connection checked yet." };
    private readonly ListBox models = new() { Dock = DockStyle.Fill, IntegralHeight = false };
    private readonly Button check = new() { Text = "Check connection", AutoSize = true };
    private readonly Button save = new() { Text = "Save verified settings", Enabled = false, AutoSize = true };
    private string? verifiedSelection;
    private readonly Button close = new() { Text = "Close", AutoSize = true };
    private bool checking;

    internal LocalModelConnectionForm()
    {
        Text = "Cline Orchestrator — Connect local model";
        Width = 645;
        Height = 530;
        MinimumSize = new Size(530, 470);
        StartPosition = FormStartPosition.CenterParent;
        CancelButton = close;
        NativeAccessibility.Name(provider, "Model provider", "Keyboard and screen-reader control. No task authority is granted by this control.");
        NativeAccessibility.Name(model, "Model ID", "Keyboard and screen-reader control. No task authority is granted by this control.");
        NativeAccessibility.Name(endpoint, "Local model API URL", "Keyboard and screen-reader control. No task authority is granted by this control.");
        NativeAccessibility.Name(models, "Discovered local models", "Keyboard and screen-reader control. No task authority is granted by this control.");
        NativeAccessibility.Name(check, "Check model connection", "Keyboard and screen-reader control. No task authority is granted by this control.");
        NativeAccessibility.Name(save, "Save verified settings", "Keyboard and screen-reader control. This action requires separate confirmation.");
        NativeAccessibility.Name(close, "Close model connection", "Keyboard and screen-reader control. No task authority is granted by this control.");
        status.AccessibleName = "Model connection status";
        provider.Items.Add("OpenAI-compatible (llama.cpp)");
        provider.Items.Add("Ollama OpenAI-compatible endpoint");
        provider.SelectedIndex = 0;

        var table = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(18),
            ColumnCount = 2,
            RowCount = 9,
            AutoSize = false,
        };
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 175));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        table.RowStyles.Add(new RowStyle(SizeType.Absolute, 58));
        table.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));
        table.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));
        table.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));
        table.RowStyles.Add(new RowStyle(SizeType.Absolute, 70));
        table.RowStyles.Add(new RowStyle(SizeType.Absolute, 44));
        table.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        table.RowStyles.Add(new RowStyle(SizeType.Absolute, 45));
        table.RowStyles.Add(new RowStyle(SizeType.Absolute, 38));

        var header = new Label
        {
            Text = "Step 1 — Verify a local model server\nThis does not save configuration or start a model.",
            Dock = DockStyle.Fill, AutoSize = false, Font = new Font("Segoe UI", 10, FontStyle.Bold),
        };
        table.Controls.Add(header, 0, 0);
        table.SetColumnSpan(header, 2);
        AddField(table, "Provider", provider, 1);
        AddField(table, "Model ID", model, 2);
        AddField(table, "Local API URL", endpoint, 3);
        status.Text = "Enter your model ID and loopback /v1 endpoint, then select Check connection.";
        table.Controls.Add(status, 0, 4);
        table.SetColumnSpan(status, 2);
        table.Controls.Add(new Label { Text = "Models reported by the server", Dock = DockStyle.Fill }, 0, 5);
        table.SetColumnSpan(table.GetControlFromPosition(0, 5)!, 2);
        table.Controls.Add(models, 0, 6);
        table.SetColumnSpan(models, 2);

        var actions = new FlowLayoutPanel { FlowDirection = FlowDirection.LeftToRight, Dock = DockStyle.Fill };
        actions.Controls.Add(check);
        actions.Controls.Add(save);
        actions.Controls.Add(close);
        table.Controls.Add(actions, 0, 7);
        table.SetColumnSpan(actions, 2);

        var notice = new Label
        {
            Text = "Settings are saved only after your confirmation; project/workspace setup follows.",
            Dock = DockStyle.Fill, AutoSize = false,
        };
        table.Controls.Add(notice, 0, 8);
        table.SetColumnSpan(notice, 2);
        Controls.Add(table);

        check.Click += async (_, _) => await CheckConnectionAsync();
        save.Click += async (_, _) => await SaveVerifiedSettingsAsync();
        provider.SelectedIndexChanged += (_, _) => InvalidateVerification();
        model.TextChanged += (_, _) => InvalidateVerification();
        endpoint.TextChanged += (_, _) => InvalidateVerification();
        close.Click += (_, _) => Close();
    }

    private static void AddField(TableLayoutPanel table, string title, Control control, int row)
    {
        table.Controls.Add(new Label { Text = title, Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft }, 0, row);
        table.Controls.Add(control, 1, row);
    }

    private string CurrentSelection() =>
        (provider.SelectedIndex == 1 ? "ollama-openai" : "openai-compatible")
        + "\n" + model.Text + "\n" + endpoint.Text;

    private void InvalidateVerification()
    {
        verifiedSelection = null;
        save.Enabled = false;
    }

    private async Task CheckConnectionAsync()
    {
        if (checking) return;
        checking = true;
        check.Enabled = false;
        provider.Enabled = false;
        model.Enabled = false;
        endpoint.Enabled = false;
        models.Items.Clear();
        InvalidateVerification();
        status.Text = "Checking available model metadata on localhost...";

        try
        {
            var root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, ".."));
            var node = Path.Combine(root, "runtime", "node.exe");
            var entry = Path.Combine(root, "app", "node_modules", "cline-orchestrator", "dist", "product-cli.js");
            if (!File.Exists(node) || !File.Exists(entry)) throw new InvalidOperationException();

            var psi = new ProcessStartInfo(node)
            {
                UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true,
                WorkingDirectory = root,
            };
            psi.ArgumentList.Add(entry);
            psi.ArgumentList.Add("check-provider");
            psi.ArgumentList.Add(provider.SelectedIndex == 1 ? "ollama-openai" : "openai-compatible");
            psi.ArgumentList.Add(model.Text);
            psi.ArgumentList.Add(endpoint.Text);
            foreach (string key in psi.Environment.Keys.Cast<string>().ToArray())
            {
                if (key.StartsWith("ORCH_", StringComparison.OrdinalIgnoreCase))
                    psi.Environment.Remove(key);
            }
            // No credentials, configuration selector, task argument or model prompt.
            using var process = Process.Start(psi) ?? throw new InvalidOperationException();
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(12));
            try
            {
                Task<string> stdout = process.StandardOutput.ReadToEndAsync(timeout.Token);
                Task<string> stderr = process.StandardError.ReadToEndAsync(timeout.Token);
                await process.WaitForExitAsync(timeout.Token);
                var payload = await stdout;
                _ = await stderr; // Deliberately do not reveal raw stderr to the UI.
                if (process.ExitCode != 0 || payload.Length > 20000) throw new InvalidOperationException();
                using var document = JsonDocument.Parse(payload);
                var result = document.RootElement;
                if (result.GetProperty("command").GetString() != "check-provider"
                    || result.GetProperty("grantsAuthority").GetBoolean()
                    || result.GetProperty("configSaved").GetBoolean()
                    || result.GetProperty("modelStarted").GetBoolean())
                    throw new InvalidOperationException();

                var ok = result.GetProperty("ok").GetBoolean();
                var code = result.GetProperty("code").GetString();
                if (result.TryGetProperty("availableModels", out var available)
                    && available.ValueKind == JsonValueKind.Array)
                {
                    foreach (var item in available.EnumerateArray())
                    {
                        if (item.ValueKind == JsonValueKind.String)
                            models.Items.Add(item.GetString() ?? "");
                    }
                }
                if (ok)
                {
                    verifiedSelection = CurrentSelection();
                    save.Enabled = true;
                }
                status.Text = ok ? "Model verified. Choose Save verified settings to review a create-only configuration."
                    : code == "model_not_found" ? "Server reached, but selected model was not reported. Check the model ID."
                    : code == "provider_unreachable" ? "Unable to reach the local model server. Check that it is running."
                    : "Local model metadata could not be verified. Check the endpoint.";
            }
            catch
            {
                try { if (!process.HasExited) process.Kill(entireProcessTree: true); }
                catch { /* Only the child created by this window is eligible for termination. */ }
                throw;
            }
        }
        catch
        {
            status.Text = "Connection check unavailable. Use a running local server at http://127.0.0.1:PORT/v1.";
        }
        finally
        {
            if (!IsDisposed && !Disposing)
            {
                checking = false;
                check.Enabled = true;
                provider.Enabled = true;
                model.Enabled = true;
                endpoint.Enabled = true;
            }
        }
    }

    private async Task SaveVerifiedSettingsAsync()
    {
        if (checking || verifiedSelection is null || verifiedSelection != CurrentSelection()) return;
        checking = true;
        save.Enabled = false;
        check.Enabled = false;
        provider.Enabled = false;
        model.Enabled = false;
        endpoint.Enabled = false;

        try
        {
            var stateDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "ClineOrchestrator");
            if (Directory.Exists(stateDir) &&
                (File.GetAttributes(stateDir) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidOperationException("User settings directory is a link.");
            if (!Directory.Exists(stateDir)) Directory.CreateDirectory(stateDir);
            var dest = Path.Combine(stateDir, "config.json");
            if (File.Exists(dest) || Directory.Exists(dest))
            {
                status.Text = "A configuration already exists. It was not replaced; settings changes need a separate review.";
                return;
            }

            var root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, ".."));
            var node = Path.Combine(root, "runtime", "node.exe");
            var entry = Path.Combine(root, "app", "node_modules", "cline-orchestrator", "dist", "product-cli.js");
            if (!File.Exists(node) || !File.Exists(entry)) throw new InvalidOperationException();

            string selectedProvider = provider.SelectedIndex == 1 ? "ollama-openai" : "openai-compatible";
            string selectedModel = model.Text;
            string selectedEndpoint = endpoint.Text;
            var psi = new ProcessStartInfo(node)
            {
                UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardInput = true, RedirectStandardOutput = true,
                RedirectStandardError = true, WorkingDirectory = root,
            };
            psi.ArgumentList.Add(entry);
            psi.ArgumentList.Add("setup-config-desktop");
            psi.ArgumentList.Add(selectedProvider);
            psi.ArgumentList.Add(selectedModel);
            psi.ArgumentList.Add(selectedEndpoint);
            foreach (string key in psi.Environment.Keys.Cast<string>().ToArray())
                if (key.StartsWith("ORCH_", StringComparison.OrdinalIgnoreCase))
                    psi.Environment.Remove(key);

            using var process = Process.Start(psi) ?? throw new InvalidOperationException();
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(85));
            try
            {
                var stderr = process.StandardError.ReadToEndAsync(timeout.Token);
                var reviewLine = await process.StandardOutput.ReadLineAsync(timeout.Token);
                if (reviewLine is null || reviewLine.Length > 8192) throw new InvalidOperationException();
                using var reviewDoc = JsonDocument.Parse(reviewLine);
                var review = reviewDoc.RootElement;
                if (review.GetProperty("kind").GetString() != "config-review"
                    || review.GetProperty("action").GetString() != "write_config"
                    || review.GetProperty("destination").GetString() != "local_app_data_config"
                    || review.GetProperty("grantsAuthority").GetBoolean()
                    || review.GetProperty("providerId").GetString() != selectedProvider
                    || review.GetProperty("modelId").GetString() != selectedModel
                    || review.GetProperty("baseUrl").GetString() != selectedEndpoint
                    || review.GetProperty("requiresExactReply").GetString() != "CREATE CONFIG"
                    || !DateTimeOffset.TryParse(review.GetProperty("expiresAt").GetString(), out var expiry)
                    || expiry <= DateTimeOffset.UtcNow || expiry > DateTimeOffset.UtcNow.AddSeconds(65))
                    throw new InvalidOperationException();

                var text = "Create this NEW settings file?\n\n"
                    + dest + "\n\nProvider: " + selectedProvider
                    + "\nModel: " + selectedModel
                    + "\nEndpoint: " + selectedEndpoint
                    + "\n\nAutomatic command and edit approvals will remain disabled."
                    + "\nNo existing configuration will be overwritten.";
                bool approved = MessageBox.Show(this, text, "Confirm local settings creation",
                    MessageBoxButtons.YesNo, MessageBoxIcon.Question,
                    MessageBoxDefaultButton.Button2) == DialogResult.Yes;
                await process.StandardInput.WriteLineAsync(approved ? "CREATE CONFIG" : "CANCEL");
                await process.StandardInput.FlushAsync(timeout.Token);
                process.StandardInput.Close();
                var receiptLine = await process.StandardOutput.ReadLineAsync(timeout.Token);
                await process.WaitForExitAsync(timeout.Token);
                _ = await stderr;
                if (process.ExitCode != 0 || receiptLine is null || receiptLine.Length > 8192)
                    throw new InvalidOperationException();
                using var receiptDoc = JsonDocument.Parse(receiptLine);
                var receipt = receiptDoc.RootElement;
                if (receipt.GetProperty("kind").GetString() != "config-result"
                    || receipt.GetProperty("destination").GetString() != "local_app_data_config"
                    || receipt.GetProperty("grantsAuthority").GetBoolean())
                    throw new InvalidOperationException();
                var saved = receipt.GetProperty("configSaved").GetBoolean();
                if (saved != approved) throw new InvalidOperationException();

                status.Text = saved
                    ? "Settings created. No task or daemon started. Project/workspace setup is next."
                    : "Configuration creation cancelled; nothing was saved.";
                InvalidateVerification();
            }
            catch
            {
                try { if (!process.HasExited) process.Kill(entireProcessTree: true); }
                catch { /* Never look up or terminate a process by name or port. */ }
                throw;
            }
        }
        catch
        {
            status.Text = "Settings not saved. Review the local model and settings folder before retrying.";
            InvalidateVerification();
        }
        finally
        {
            if (!IsDisposed && !Disposing)
            {
                checking = false;
                check.Enabled = true;
                provider.Enabled = true;
                model.Enabled = true;
                endpoint.Enabled = true;
            }
        }
    }
}
