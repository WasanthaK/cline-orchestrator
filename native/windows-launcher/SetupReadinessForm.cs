using System.Diagnostics;
using System.Drawing;
using System.Text.Json;
using System.Windows.Forms;

namespace ClineOrchestrator.Launcher;

/// <summary>
/// Read-only first-run overview. The only setup actions are explicit separate
/// native dialogs, each retaining its own trusted local confirmation.
/// </summary>
internal sealed class SetupReadinessForm : Form
{
    private readonly Label headline = new()
    {
        Dock = DockStyle.Top, Height = 76,
        Padding = new Padding(18, 10, 18, 6),
        Font = new Font("Segoe UI", 12, FontStyle.Bold),
        Text = "Checking your local setup...",
    };
    private readonly Label context = new()
    {
        Dock = DockStyle.Top, Height = 52,
        Padding = new Padding(18, 5, 18, 5),
        Text = "Setup status is not permission to execute tasks. Task execution always requires separate approval.",
    };
    private readonly Label[] states = new Label[4];
    private readonly Button[] setup = new Button[4];
    private readonly Button refresh = new() { Text = "Refresh status", AutoSize = true };
    private readonly Button close = new() { Text = "Close", AutoSize = true };
    private readonly Label counts = new() { Dock = DockStyle.Bottom, Height = 39, Padding = new Padding(18, 4, 18, 5) };
    private bool loading;

    internal SetupReadinessForm()
    {
        Text = "Cline Orchestrator — Setup status";
        Width = 745;
        Height = 540;
        MinimumSize = new Size(620, 490);
        StartPosition = FormStartPosition.CenterParent;
        CancelButton = close;
        NativeAccessibility.Name(refresh, "Refresh setup status", "Keyboard and screen-reader control. No task authority is granted by this control.");
        NativeAccessibility.Name(close, "Close setup status", "Keyboard and screen-reader control. No task authority is granted by this control.");
        headline.AccessibleName = "Local setup headline";
        counts.AccessibleName = "Project and workspace counts";

        var body = new TableLayoutPanel
        {
            Dock = DockStyle.Fill, Padding = new Padding(18, 10, 18, 10),
            ColumnCount = 3, RowCount = 5,
        };
        body.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 174));
        body.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        body.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 152));
        for (int i = 0; i < 4; i++)
            body.RowStyles.Add(new RowStyle(SizeType.Percent, 25));
        body.RowStyles.Add(new RowStyle(SizeType.Absolute, 56));

        string[] labels =
        {
            "1. Local model", "2. Provider settings",
            "3. Project registration", "4. Workspace and Safety",
        };
        string[] actionLabels =
        {
            "Connect model", "Review model settings",
            "Register project", "Register workspace",
        };
        for (int i = 0; i < labels.Length; i++)
        {
            var label = new Label
            {
                Text = labels[i], AutoSize = false, Dock = DockStyle.Fill,
                Font = new Font("Segoe UI", 10, FontStyle.Bold),
                TextAlign = ContentAlignment.MiddleLeft,
            };
            states[i] = new Label
            {
                Text = "Not checked", AutoSize = false, Dock = DockStyle.Fill,
                TextAlign = ContentAlignment.MiddleLeft,
            };
            setup[i] = new Button
            {
                Text = actionLabels[i], AutoSize = false, Dock = DockStyle.Fill,
                Margin = new Padding(3, 15, 3, 15),
            };
            NativeAccessibility.Name(setup[i], i switch {
                0 => "Connect local model",
                1 => "Review model settings",
                2 => "Register project",
                _ => "Register safe workspace",
            }, "Opens a separate confirmed setup step; no task permission.");
            states[i].AccessibleName = labels[i] + " readiness";
            body.Controls.Add(label, 0, i);
            body.Controls.Add(states[i], 1, i);
            body.Controls.Add(setup[i], 2, i);
        }

        setup[0].Click += async (_, _) =>
        {
            using var dialog = new LocalModelConnectionForm();
            dialog.ShowDialog(this);
            await RefreshAsync();
        };
        setup[1].Click += async (_, _) =>
        {
            using var dialog = new EditSavedSettingsForm();
            dialog.ShowDialog(this);
            await RefreshAsync();
        };
        setup[2].Click += async (_, _) =>
        {
            using var dialog = new RegisterProjectForm();
            dialog.ShowDialog(this);
            await RefreshAsync();
        };
        setup[3].Click += async (_, _) =>
        {
            using var dialog = new RegisterWorkspaceForm();
            dialog.ShowDialog(this);
            await RefreshAsync();
        };

        var actions = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill, FlowDirection = FlowDirection.RightToLeft,
            Padding = new Padding(0, 8, 0, 4),
        };
        actions.Controls.Add(close);
        actions.Controls.Add(refresh);
        body.Controls.Add(actions, 0, 4);
        body.SetColumnSpan(actions, 3);
        close.Click += (_, _) => Close();
        refresh.Click += async (_, _) => await RefreshAsync();

        Controls.Add(body);
        Controls.Add(counts);
        Controls.Add(context);
        Controls.Add(headline);
        Shown += async (_, _) => await RefreshAsync();
    }

    private async Task RefreshAsync()
    {
        if (loading || Disposing || IsDisposed) return;
        loading = true;
        refresh.Enabled = false;
        foreach (var item in setup) item.Enabled = false;
        headline.Text = "Checking local setup...";
        foreach (var state in states) state.Text = "Checking";
        try
        {
            string root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, ".."));
            string node = Path.Combine(root, "runtime", "node.exe");
            string entry = Path.Combine(root, "app", "node_modules",
                "cline-orchestrator", "dist", "product-cli.js");
            if (!File.Exists(node) || !File.Exists(entry)) throw new InvalidOperationException();

            var psi = new ProcessStartInfo(node)
            {
                WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true,
            };
            psi.ArgumentList.Add(entry);
            psi.ArgumentList.Add("readiness-desktop");
            foreach (string key in psi.Environment.Keys.Cast<string>().ToArray())
                if (key.StartsWith("ORCH_", StringComparison.OrdinalIgnoreCase))
                    psi.Environment.Remove(key);
            using var child = Process.Start(psi) ?? throw new InvalidOperationException();
            using var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(20));
            try
            {
                Task<string> stdout = child.StandardOutput.ReadToEndAsync(cancellation.Token);
                Task<string> stderr = child.StandardError.ReadToEndAsync(cancellation.Token);
                await child.WaitForExitAsync(cancellation.Token);
                string json = await stdout;
                _ = await stderr; // Raw filesystem/endpoint details are never rendered.
                if (child.ExitCode != 0 || json.Length > 8192)
                    throw new InvalidOperationException();
                using var parsed = JsonDocument.Parse(json);
                var doc = parsed.RootElement;
                if (doc.GetProperty("schemaVersion").GetInt32() != 1
                    || doc.GetProperty("command").GetString() != "readiness-desktop"
                    || doc.GetProperty("grantsAuthority").GetBoolean()
                    || !doc.GetProperty("readOnly").GetBoolean()
                    || doc.GetProperty("setupCompleteIsTaskAuthority").GetBoolean())
                    throw new InvalidOperationException();

                var allSteps = doc.GetProperty("steps");
                string[] ids = { "model", "settings", "project", "workspace" };
                if (allSteps.ValueKind != JsonValueKind.Array || allSteps.GetArrayLength() != 4)
                    throw new InvalidOperationException();
                for (int i = 0; i < ids.Length; i++)
                {
                    var step = allSteps[i];
                    if (step.GetProperty("id").GetString() != ids[i])
                        throw new InvalidOperationException();
                    string? code = step.GetProperty("state").GetString();
                    states[i].Text = code switch
                    {
                        "ready" => "Ready",
                        "needed" => i switch
                        {
                            0 => "Check model connectivity",
                            1 => "Save provider settings",
                            2 => "Create a local project",
                            _ => "Register a workspace with Safety rules",
                        },
                        "attention" => i switch
                        {
                            0 => "Model unreachable or unsafe endpoint",
                            1 => "Settings need attention",
                            2 => "Registry needs attention",
                            _ => "Workspace or Safety needs attention",
                        },
                        _ => throw new InvalidOperationException(),
                    };
                }
                var status = doc.GetProperty("status").GetString();
                headline.Text = status switch
                {
                    "setup_complete" => "Local setup complete — task permission remains separate",
                    "needs_setup" => "Finish these local setup steps",
                    "attention" => "Local setup needs attention",
                    _ => throw new InvalidOperationException(),
                };
                int projectCount = doc.GetProperty("projectCount").GetInt32();
                int workspaceCount = doc.GetProperty("workspaceCount").GetInt32();
                if (projectCount is < 0 or > 999 || workspaceCount is < 0 or > 999)
                    throw new InvalidOperationException();
                counts.Text = $"Registered projects: {projectCount}   •   Workspaces: {workspaceCount}   •   Read-only assessment";
            }
            catch
            {
                try { if (!child.HasExited) child.Kill(entireProcessTree: true); }
                catch { /* Only the owned child is terminated. */ }
                throw;
            }
        }
        catch
        {
            headline.Text = "Local setup could not be checked";
            foreach (var state in states) state.Text = "Not verified";
            counts.Text = "No setup changes were made. Check installation and local state.";
        }
        finally
        {
            if (!IsDisposed && !Disposing)
            {
                loading = false;
                refresh.Enabled = true;
                foreach (var item in setup) item.Enabled = true;
            }
        }
    }
}
