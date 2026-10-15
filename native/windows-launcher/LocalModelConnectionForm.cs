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
    private readonly Button close = new() { Text = "Close", AutoSize = true };
    private bool checking;

    internal LocalModelConnectionForm()
    {
        Text = "Cline Orchestrator — Connect local model";
        Width = 645;
        Height = 530;
        MinimumSize = new Size(530, 470);
        StartPosition = FormStartPosition.CenterParent;
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
        actions.Controls.Add(close);
        table.Controls.Add(actions, 0, 7);
        table.SetColumnSpan(actions, 2);

        var notice = new Label
        {
            Text = "Next step: explicitly confirmed configuration and workspace registration (M19C2).",
            Dock = DockStyle.Fill, AutoSize = false,
        };
        table.Controls.Add(notice, 0, 8);
        table.SetColumnSpan(notice, 2);
        Controls.Add(table);

        check.Click += async (_, _) => await CheckConnectionAsync();
        close.Click += (_, _) => Close();
    }

    private static void AddField(TableLayoutPanel table, string title, Control control, int row)
    {
        table.Controls.Add(new Label { Text = title, Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft }, 0, row);
        table.Controls.Add(control, 1, row);
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
                status.Text = ok ? "Connected. The selected model is available. Configuration has NOT been saved."
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
}
