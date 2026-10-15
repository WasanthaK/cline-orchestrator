using System.Diagnostics;
using System.Drawing;
using System.Text.Json;
using System.Windows.Forms;

namespace ClineOrchestrator.Launcher;

/// <summary>
/// M19D1 read-only native operations entry point. Task records and independent
/// evidence remain in the authenticated passive viewer; no web mutation bridge.
/// </summary>
internal sealed class OperationsCenterForm : Form
{
    private readonly Func<bool> viewerAvailable;
    private readonly Action<string> openViewerSection;
    private readonly Label heading = new() { Dock = DockStyle.Fill, Font = new Font("Segoe UI", 13, FontStyle.Bold), Text = "Checking your local operations..." };
    private readonly Label setup = new() { Dock = DockStyle.Fill, Text = "Setup: Not verified" };
    private readonly Label model = new() { Dock = DockStyle.Fill, Text = "Model: Not verified" };
    private readonly Label workspace = new() { Dock = DockStyle.Fill, Text = "Workspace & Safety: Not verified" };
    private readonly Label history = new() { Dock = DockStyle.Fill, Text = "Task history: Unknown" };
    private readonly Label coverage = new() { Dock = DockStyle.Fill, Text = "Data sources: Not verified" };
    private readonly Label note = new() {
        Dock = DockStyle.Fill, ForeColor = SystemColors.GrayText,
        Text = "Read-only view. Task execution and permissions always require separate approval. Missing data is not a healthy zero.",
    };
    private readonly Button refresh = new() { Text = "Refresh", AutoSize = true };
    private readonly Button taskHistory = new() { Text = "Task history and evidence", AutoSize = true };
    private readonly Button dataQuality = new() { Text = "Data quality details", AutoSize = true };
    private readonly Button settings = new() { Text = "Setup & settings", AutoSize = true };
    private readonly Button editSettings = new() { Text = "Edit saved model", AutoSize = true };
    private readonly Button close = new() { Text = "Close", AutoSize = true };
    private bool loading;

    internal OperationsCenterForm(Func<bool> viewerAvailable, Action<string> openViewerSection)
    {
        this.viewerAvailable = viewerAvailable;
        this.openViewerSection = openViewerSection;
        Text = "Cline Orchestrator — Operations & settings";
        Width = 790;
        Height = 515;
        MinimumSize = new Size(620, 470);
        StartPosition = FormStartPosition.CenterParent;

        var body = new TableLayoutPanel {
            Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 8,
            Padding = new Padding(20, 16, 20, 16),
        };
        body.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        body.RowStyles.Add(new RowStyle(SizeType.Absolute, 57));
        for (int i = 1; i <= 5; i++) body.RowStyles.Add(new RowStyle(SizeType.Absolute, 45));
        body.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        body.RowStyles.Add(new RowStyle(SizeType.Absolute, 72));
        body.Controls.Add(heading, 0, 0);
        body.Controls.Add(setup, 0, 1);
        body.Controls.Add(model, 0, 2);
        body.Controls.Add(workspace, 0, 3);
        body.Controls.Add(history, 0, 4);
        body.Controls.Add(coverage, 0, 5);
        body.Controls.Add(note, 0, 6);
        var actions = new FlowLayoutPanel {
            Dock = DockStyle.Fill, WrapContents = true, FlowDirection = FlowDirection.LeftToRight,
        };
        actions.Controls.Add(refresh);
        actions.Controls.Add(taskHistory);
        actions.Controls.Add(dataQuality);
        actions.Controls.Add(settings);
        actions.Controls.Add(editSettings);
        actions.Controls.Add(close);
        body.Controls.Add(actions, 0, 7);
        Controls.Add(body);

        refresh.Click += async (_, _) => await RefreshAsync();
        taskHistory.Click += (_, _) => OpenSection("tasks");
        dataQuality.Click += (_, _) => OpenSection("sources");
        settings.Click += async (_, _) => {
            using var dialog = new SetupReadinessForm();
            dialog.ShowDialog(this);
            await RefreshAsync();
        };
        editSettings.Click += async (_, _) => {
            using var dialog = new EditSavedSettingsForm();
            dialog.ShowDialog(this);
            await RefreshAsync();
        };
        close.Click += (_, _) => Close();
        Shown += async (_, _) => await RefreshAsync();
        UpdateViewerButtons();
    }

    private void UpdateViewerButtons()
    {
        bool available = viewerAvailable();
        taskHistory.Enabled = available;
        dataQuality.Enabled = available;
    }

    private void OpenSection(string section)
    {
        if (!viewerAvailable()) { UpdateViewerButtons(); return; }
        // Only hard-coded fragments can cross to the read-only viewer.
        if (section is "tasks" or "sources") openViewerSection(section);
    }

    private static string StepState(JsonElement steps, int index, string id)
    {
        var item = steps[index];
        if (item.GetProperty("id").GetString() != id) throw new InvalidOperationException();
        return item.GetProperty("state").GetString() switch {
            "ready" => "Ready",
            "needed" => "Setup needed",
            "attention" => "Needs attention",
            _ => throw new InvalidOperationException(),
        };
    }

    private async Task RefreshAsync()
    {
        if (loading || IsDisposed || Disposing) return;
        loading = true;
        refresh.Enabled = false;
        heading.Text = "Checking local status...";
        setup.Text = "Setup: Checking";
        model.Text = "Model: Checking";
        workspace.Text = "Workspace & Safety: Checking";
        history.Text = "Task history: Unknown";
        coverage.Text = "Other data sources: Unknown";
        try
        {
            string root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, ".."));
            string node = Path.Combine(root, "runtime", "node.exe");
            string entry = Path.Combine(root, "app", "node_modules", "cline-orchestrator", "dist", "product-cli.js");
            if (!File.Exists(node) || !File.Exists(entry)) throw new InvalidOperationException();
            var psi = new ProcessStartInfo(node) {
                WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true,
            };
            psi.ArgumentList.Add(entry);
            psi.ArgumentList.Add("operations-desktop");
            foreach (string key in psi.Environment.Keys.Cast<string>().ToArray())
                if (key.StartsWith("ORCH_", StringComparison.OrdinalIgnoreCase))
                    psi.Environment.Remove(key);
            using var child = Process.Start(psi) ?? throw new InvalidOperationException();
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(22));
            try
            {
                Task<string> stdout = child.StandardOutput.ReadToEndAsync(timeout.Token);
                Task<string> stderr = child.StandardError.ReadToEndAsync(timeout.Token);
                await child.WaitForExitAsync(timeout.Token);
                string json = await stdout;
                _ = await stderr;
                if (child.ExitCode != 0 || json.Length > 8192) throw new InvalidOperationException();
                using var parsed = JsonDocument.Parse(json);
                var result = parsed.RootElement;
                if (result.GetProperty("schemaVersion").GetInt32() != 1
                    || result.GetProperty("command").GetString() != "operations-desktop"
                    || !result.GetProperty("readOnly").GetBoolean()
                    || result.GetProperty("grantsAuthority").GetBoolean()
                    || !result.GetProperty("viewerRequiredForTaskDrilldown").GetBoolean()
                    || result.GetProperty("additionalSources").GetString() != "not_connected")
                    throw new InvalidOperationException();

                var setupResult = result.GetProperty("setup");
                var steps = setupResult.GetProperty("steps");
                if (steps.ValueKind != JsonValueKind.Array || steps.GetArrayLength() != 4)
                    throw new InvalidOperationException();
                var status = setupResult.GetProperty("status").GetString();
                heading.Text = status switch {
                    "setup_complete" => "Local setup complete — operations overview",
                    "needs_setup" => "Finish local setup — operations overview",
                    "attention" => "Local setup needs attention",
                    _ => throw new InvalidOperationException(),
                };
                int projectCount = setupResult.GetProperty("projectCount").GetInt32();
                int workspaceCount = setupResult.GetProperty("workspaceCount").GetInt32();
                if (projectCount is < 0 or > 999 || workspaceCount is < 0 or > 999)
                    throw new InvalidOperationException();
                setup.Text = $"Provider settings: {StepState(steps, 1, "settings")}   •   Projects: {projectCount}";
                model.Text = $"Local model: {StepState(steps, 0, "model")}";
                _ = StepState(steps, 2, "project");
                workspace.Text = $"Workspace & Safety: {StepState(steps, 3, "workspace")}   •   Workspaces: {workspaceCount}";
                var historyResult = result.GetProperty("history");
                if (historyResult.GetProperty("scope").GetString() != "bounded_current_sample")
                    throw new InvalidOperationException();
                var source = historyResult.GetProperty("state").GetString();
                history.Text = source switch {
                    "available" => ReadCounts(historyResult.GetProperty("counts")),
                    "incomplete" => "Task history: Incomplete or stale — counts unknown; inspect dashboard",
                    "unavailable" => "Task history: Unavailable — counts unknown; inspect dashboard",
                    _ => throw new InvalidOperationException(),
                };
                coverage.Text = "Other sources: Not connected (workflow, incident and writer coverage unknown)";
                note.Text = "Counts describe only the currently observed bounded task sample, not all-time history or a success rate. No task actions are available here.";
            }
            catch
            {
                try { if (!child.HasExited) child.Kill(entireProcessTree: true); }
                catch { /* Only terminate the process owned by this window. */ }
                throw;
            }
        }
        catch
        {
            heading.Text = "Operations status could not be verified";
            setup.Text = "Provider settings: Unknown";
            model.Text = "Local model: Unknown";
            workspace.Text = "Workspace & Safety: Unknown";
            history.Text = "Task history: Unknown — no health claim";
            coverage.Text = "Other data sources: Unknown";
            note.Text = "No settings or tasks were changed. Check the installation and reopen this screen.";
        }
        finally
        {
            if (!IsDisposed && !Disposing) {
                loading = false;
                refresh.Enabled = true;
                UpdateViewerButtons();
            }
        }
    }

    private static string ReadCounts(JsonElement counts)
    {
        int sample = counts.GetProperty("sampled").GetInt32();
        int active = counts.GetProperty("active").GetInt32();
        int review = counts.GetProperty("needsAttention").GetInt32();
        int completed = counts.GetProperty("completed").GetInt32();
        if (sample is < 0 or > 100 || active < 0 || review < 0 || completed < 0
            || active > sample || review > sample || completed > sample)
            throw new InvalidOperationException();
        return $"Tasks in sample: {sample}   •   Active: {active}   •   Needs attention: {review}   •   Completed: {completed}";
    }
}
