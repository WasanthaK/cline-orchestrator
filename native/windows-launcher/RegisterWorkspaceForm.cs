using System.Diagnostics;
using System.Drawing;
using System.Text.Json;
using System.Windows.Forms;

namespace ClineOrchestrator.Launcher;

/// <summary>
/// M19C2B2 native-only workspace/Safety registration. It doesn't access task
/// controls or add routes to the passive browser viewer.
/// </summary>
internal sealed class RegisterWorkspaceForm : Form
{
    private sealed record ProjectChoice(string Id, string Name)
    {
        public override string ToString() => Name;
    }

    private readonly ComboBox projects = new()
    { DropDownStyle = ComboBoxStyle.DropDownList, Dock = DockStyle.Fill };
    private readonly TextBox displayName = new() { Dock = DockStyle.Fill, MaxLength = 120 };
    private readonly TextBox rootPath = new() { Dock = DockStyle.Fill, MaxLength = 1024 };
    private readonly TextBox profile = new() { Dock = DockStyle.Fill, MaxLength = 160 };
    private readonly NumericUpDown maxFiles = new()
    { Dock = DockStyle.Left, Minimum = 0, Maximum = 100, Value = 1 };
    private readonly TextBox allow = MultiLine();
    private readonly TextBox protect = MultiLine();
    private readonly TextBox validate = MultiLine();
    private readonly Label status = new() { Dock = DockStyle.Fill, AutoSize = false,
        Text = "Choose a project, folder and explicit Safety rules. No task will be started." };
    private readonly Button refresh = new() { Text = "Refresh projects", AutoSize = true };
    private readonly Button browse = new() { Text = "Browse folder", AutoSize = true };
    private readonly Button register = new() { Text = "Review workspace and Safety", AutoSize = true };
    private readonly Button close = new() { Text = "Close", AutoSize = true };
    private bool busy;

    private static TextBox MultiLine() => new()
    {
        Dock = DockStyle.Fill, Multiline = true, ScrollBars = ScrollBars.Vertical,
        AcceptsReturn = true, MaxLength = 2400,
    };

    internal RegisterWorkspaceForm()
    {
        Text = "Cline Orchestrator — Register workspace";
        Width = 850; Height = 800;
        MinimumSize = new Size(670, 610);
        StartPosition = FormStartPosition.CenterParent;
        var table = new TableLayoutPanel
        { Dock = DockStyle.Fill, Padding = new Padding(16), ColumnCount = 2, RowCount = 12 };
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 200));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        table.RowStyles.Add(new RowStyle(SizeType.Absolute, 60));
        table.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
        table.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
        table.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
        table.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
        table.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
        table.RowStyles.Add(new RowStyle(SizeType.Percent, 25));
        table.RowStyles.Add(new RowStyle(SizeType.Percent, 25));
        table.RowStyles.Add(new RowStyle(SizeType.Percent, 25));
        table.RowStyles.Add(new RowStyle(SizeType.Percent, 25));
        table.RowStyles.Add(new RowStyle(SizeType.Absolute, 68));
        table.RowStyles.Add(new RowStyle(SizeType.Absolute, 45));

        var heading = new Label
        {
            Text = "Step 3 — Register a safe workspace\nReview every path and command before confirming. No task starts now.",
            Dock = DockStyle.Fill, AutoSize = false,
            Font = new Font("Segoe UI", 10, FontStyle.Bold),
        };
        table.Controls.Add(heading, 0, 0); table.SetColumnSpan(heading, 2);
        var projectRow = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.LeftToRight };
        projects.Width = 410;
        projectRow.Controls.Add(projects); projectRow.Controls.Add(refresh);
        AddField(table, "Project", projectRow, 1);
        AddField(table, "Workspace name", displayName, 2);
        var folder = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.LeftToRight };
        rootPath.Width = 410;
        folder.Controls.Add(rootPath); folder.Controls.Add(browse);
        AddField(table, "Workspace folder", folder, 3);
        AddField(table, "Model worker profile ID", profile, 4);
        AddField(table, "Maximum files changed", maxFiles, 5);
        AddField(table, "Allowed file patterns", allow, 6);
        AddField(table, "Protected file patterns", protect, 7);
        AddField(table, "Validation commands", validate, 8);
        var examples = new Label
        {
            Text = "Enter one rule per line. Examples: allowed test/**, protected src/**, validation npm test. "
                + "Validation commands can execute during an approved task; choose only commands you trust. "
                + "Policy version: v1. No broad access defaults are added.",
            Dock = DockStyle.Fill, AutoSize = false,
        };
        table.Controls.Add(examples, 0, 9); table.SetColumnSpan(examples, 2);
        table.Controls.Add(status, 0, 10); table.SetColumnSpan(status, 2);
        var actions = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.LeftToRight };
        actions.Controls.Add(register); actions.Controls.Add(close);
        table.Controls.Add(actions, 0, 11); table.SetColumnSpan(actions, 2);
        Controls.Add(table);

        browse.Click += (_, _) =>
        {
            using var picker = new FolderBrowserDialog
            { Description = "Choose a project-owned workspace directory" };
            if (picker.ShowDialog(this) == DialogResult.OK)
                rootPath.Text = picker.SelectedPath;
        };
        refresh.Click += async (_, _) => await LoadProjectsAsync();
        register.Click += async (_, _) => await RegisterAsync();
        close.Click += (_, _) => Close();
        Shown += async (_, _) => await LoadProjectsAsync();
    }

    private static void AddField(TableLayoutPanel table, string caption, Control input, int row)
    {
        table.Controls.Add(new Label
        { Text = caption, Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft }, 0, row);
        table.Controls.Add(input, 1, row);
    }

    private static string[] Lines(string value) => value.Replace("\r", "").Split('\n')
        .Select(x => x.Trim()).Where(x => x.Length > 0).ToArray();

    private static ProcessStartInfo NodeCommand(string command)
    {
        var root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, ".."));
        var node = Path.Combine(root, "runtime", "node.exe");
        var entry = Path.Combine(root, "app", "node_modules",
            "cline-orchestrator", "dist", "product-cli.js");
        if (!File.Exists(node) || !File.Exists(entry)) throw new InvalidOperationException();
        var psi = new ProcessStartInfo(node)
        {
            WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        psi.ArgumentList.Add(entry); psi.ArgumentList.Add(command);
        foreach (string key in psi.Environment.Keys.Cast<string>().ToArray())
            if (key.StartsWith("ORCH_", StringComparison.OrdinalIgnoreCase))
                psi.Environment.Remove(key);
        return psi;
    }

    private async Task LoadProjectsAsync()
    {
        if (busy) return;
        busy = true;
        refresh.Enabled = false; register.Enabled = false;
        projects.Items.Clear();
        status.Text = "Reading registered local projects...";
        try
        {
            using var child = Process.Start(NodeCommand("list-projects-desktop"))
                ?? throw new InvalidOperationException();
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(12));
            try
            {
                var stdout = child.StandardOutput.ReadToEndAsync(timeout.Token);
                var stderr = child.StandardError.ReadToEndAsync(timeout.Token);
                await child.WaitForExitAsync(timeout.Token);
                string text = await stdout; _ = await stderr;
                if (child.ExitCode != 0 || text.Length > 20_000) throw new InvalidOperationException();
                using var parsed = JsonDocument.Parse(text);
                var result = parsed.RootElement;
                if (result.GetProperty("kind").GetString() != "local-projects"
                    || result.GetProperty("grantsAuthority").GetBoolean())
                    throw new InvalidOperationException();
                foreach (var project in result.GetProperty("projects").EnumerateArray())
                {
                    string? id = project.GetProperty("projectId").GetString();
                    string? name = project.GetProperty("displayName").GetString();
                    if (Guid.TryParse(id, out _) && name is { Length: > 0 and <= 120 })
                        projects.Items.Add(new ProjectChoice(id!, name));
                }
                if (projects.Items.Count > 0)
                {
                    projects.SelectedIndex = 0;
                    status.Text = "Projects loaded. Select a workspace folder and explicit Safety rules.";
                }
                else status.Text = "No projects registered. Use Register project first.";
            }
            catch
            {
                try { if (!child.HasExited) child.Kill(entireProcessTree: true); }
                catch { /* Owned child only */ }
                throw;
            }
        }
        catch { status.Text = "Could not read project registry. Inspect local configuration."; }
        finally
        {
            busy = false; refresh.Enabled = true;
            register.Enabled = projects.SelectedItem is ProjectChoice;
        }
    }

    private async Task RegisterAsync()
    {
        if (busy || projects.SelectedItem is not ProjectChoice chosen) return;
        string[] allowed = Lines(allow.Text);
        string[] protectedPaths = Lines(protect.Text);
        string[] commands = Lines(validate.Text);
        if (string.IsNullOrWhiteSpace(displayName.Text) || string.IsNullOrWhiteSpace(rootPath.Text)
            || string.IsNullOrWhiteSpace(profile.Text)
            || allowed.Length == 0 || protectedPaths.Length == 0 || commands.Length == 0)
        {
            status.Text = "Workspace, model profile, allowed/protected paths and validation commands are all required.";
            return;
        }
        var registration = new
        {
            projectId = chosen.Id,
            displayName = displayName.Text.Trim(),
            root = rootPath.Text.Trim(),
            safetyProfile = new
            {
                policyVersion = "v1",
                workerProfileId = profile.Text.Trim(),
                maxChangedFiles = (int)maxFiles.Value,
                allowedPathPatterns = allowed,
                protectedPathPatterns = protectedPaths,
                validationCommands = commands,
            },
        };
        string request = JsonSerializer.Serialize(registration);
        if (request.Length > 20_000)
        {
            status.Text = "Safety review is too large; shorten the paths and commands.";
            return;
        }

        busy = true; register.Enabled = false; refresh.Enabled = false;
        status.Text = "Verifying the canonical folder and project/Safety scope...";
        try
        {
            using var child = Process.Start(NodeCommand("setup-workspace-desktop"))
                ?? throw new InvalidOperationException();
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(90));
            try
            {
                Task<string> stderr = child.StandardError.ReadToEndAsync(timeout.Token);
                await child.StandardInput.WriteLineAsync(request);
                await child.StandardInput.FlushAsync(timeout.Token);
                var reviewLine = await child.StandardOutput.ReadLineAsync(timeout.Token);
                if (reviewLine is null || reviewLine.Length > 24_000) throw new InvalidOperationException();
                using var parsed = JsonDocument.Parse(reviewLine);
                var review = parsed.RootElement;
                if (review.GetProperty("kind").GetString() != "workspace-review"
                    || review.GetProperty("action").GetString() != "register_workspace"
                    || review.GetProperty("destination").GetString() != "local_user_workspace_registry"
                    || review.GetProperty("grantsAuthority").GetBoolean()
                    || review.GetProperty("requiresExactReply").GetString() != "REGISTER WORKSPACE"
                    || !DateTimeOffset.TryParse(review.GetProperty("expiresAt").GetString(), out var expiry)
                    || expiry <= DateTimeOffset.UtcNow
                    || expiry > DateTimeOffset.UtcNow.AddSeconds(65))
                    throw new InvalidOperationException();

                var reviewed = review.GetProperty("registration");
                var safety = reviewed.GetProperty("safetyProfile");
                if (reviewed.GetProperty("projectId").GetString() != chosen.Id
                    || reviewed.GetProperty("displayName").GetString() != registration.displayName
                    || safety.GetProperty("policyVersion").GetString() != "v1"
                    || safety.GetProperty("workerProfileId").GetString() != registration.safetyProfile.workerProfileId
                    || safety.GetProperty("maxChangedFiles").GetInt32() != registration.safetyProfile.maxChangedFiles
                    || !SameStrings(safety.GetProperty("allowedPathPatterns"), allowed)
                    || !SameStrings(safety.GetProperty("protectedPathPatterns"), protectedPaths)
                    || !SameStrings(safety.GetProperty("validationCommands"), commands))
                    throw new InvalidOperationException();

                string canonical = review.GetProperty("canonicalRoot").GetString()
                    ?? throw new InvalidOperationException();
                if (!Path.IsPathFullyQualified(canonical) || canonical.Length > 1024)
                    throw new InvalidOperationException();

                var message = "Register this workspace and exact Safety scope?\n\n"
                    + "Project: " + chosen.Name + "\nWorkspace: " + registration.displayName
                    + "\nCanonical folder: " + canonical
                    + "\nWorker: " + registration.safetyProfile.workerProfileId
                    + "\nPolicy: v1 | Maximum changed files: " + maxFiles.Value
                    + "\nAllowed:\n" + string.Join("\n", allowed)
                    + "\nProtected:\n" + string.Join("\n", protectedPaths)
                    + "\nValidation commands:\n" + string.Join("\n", commands)
                    + "\n\nNo task or model will start. Commands may execute in a separately authorized future task.";
                using var reviewDialog = new WorkspaceSafetyReviewForm(message);
                bool approved = reviewDialog.ShowDialog(this) == DialogResult.Yes;
                await child.StandardInput.WriteLineAsync(approved ? "REGISTER WORKSPACE" : "CANCEL");
                await child.StandardInput.FlushAsync(timeout.Token);
                child.StandardInput.Close();
                var receiptLine = await child.StandardOutput.ReadLineAsync(timeout.Token);
                await child.WaitForExitAsync(timeout.Token);
                _ = await stderr;
                if (child.ExitCode != 0 || receiptLine is null || receiptLine.Length > 8192)
                    throw new InvalidOperationException();
                using var receiptDoc = JsonDocument.Parse(receiptLine);
                var receipt = receiptDoc.RootElement;
                if (receipt.GetProperty("kind").GetString() != "workspace-result"
                    || receipt.GetProperty("grantsAuthority").GetBoolean())
                    throw new InvalidOperationException();
                string? outcome = receipt.GetProperty("outcome").GetString();
                if (approved && outcome == "registered"
                    && Guid.TryParse(receipt.GetProperty("workspaceId").GetString(), out var workspaceId))
                    status.Text = "Workspace registered: " + workspaceId
                        + ". No Cline task or daemon started.";
                else if (!approved && outcome == "cancelled")
                    status.Text = "Workspace registration cancelled; no new workspace created.";
                else throw new InvalidOperationException();
            }
            catch
            {
                try { if (!child.HasExited) child.Kill(entireProcessTree: true); }
                catch { /* Only owned child */ }
                throw;
            }
        }
        catch { status.Text = "Registration not verified. Inspect registry and workspace before retrying."; }
        finally
        {
            busy = false; register.Enabled = projects.SelectedItem is ProjectChoice;
            refresh.Enabled = true;
        }
    }

    private static bool SameStrings(JsonElement actual, string[] selected)
    {
        if (actual.ValueKind != JsonValueKind.Array || actual.GetArrayLength() != selected.Length)
            return false;
        int i = 0;
        foreach (var item in actual.EnumerateArray())
            if (item.ValueKind != JsonValueKind.String || item.GetString() != selected[i++])
                return false;
        return true;
    }
}
