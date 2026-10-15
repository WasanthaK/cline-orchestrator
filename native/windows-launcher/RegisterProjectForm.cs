using System.Diagnostics;
using System.Drawing;
using System.Text.Json;
using System.Windows.Forms;

namespace ClineOrchestrator.Launcher;

/// <summary>
/// M19C2B1: explicit project registration with the existing trusted registry
/// service. The read-only viewer gains no mutation route or task authority.
/// </summary>
internal sealed class RegisterProjectForm : Form
{
    private readonly TextBox name = new() { Dock = DockStyle.Fill, MaxLength = 120 };
    private readonly TextBox projectId = new() { Dock = DockStyle.Fill, ReadOnly = true };
    private readonly Label status = new()
    {
        Dock = DockStyle.Fill, AutoSize = false,
        Text = "Create a project in your local workspace registry. No workspace or task is started.",
    };
    private readonly Button create = new() { Text = "Review and register", AutoSize = true };
    private readonly Button copyId = new() { Text = "Copy project ID", AutoSize = true, Enabled = false };
    private readonly Button close = new() { Text = "Close", AutoSize = true };
    private bool busy;

    internal RegisterProjectForm()
    {
        Text = "Cline Orchestrator — Register project";
        Width = 620; Height = 330;
        MinimumSize = new Size(540, 310);
        StartPosition = FormStartPosition.CenterParent;
        var table = new TableLayoutPanel
        {
            Dock = DockStyle.Fill, Padding = new Padding(18),
            ColumnCount = 2, RowCount = 5,
        };
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 132));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        table.RowStyles.Add(new RowStyle(SizeType.Absolute, 70));
        table.RowStyles.Add(new RowStyle(SizeType.Absolute, 44));
        table.RowStyles.Add(new RowStyle(SizeType.Absolute, 44));
        table.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        table.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));

        table.Controls.Add(new Label
        {
            Text = "Step 2 — Register a local project\nThe registration is reviewed and explicitly confirmed.",
            Dock = DockStyle.Fill, Font = new Font("Segoe UI", 10, FontStyle.Bold),
        }, 0, 0);
        table.SetColumnSpan(table.GetControlFromPosition(0, 0)!, 2);
        table.Controls.Add(new Label { Text = "Project name", Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.MiddleLeft }, 0, 1);
        table.Controls.Add(name, 1, 1);
        table.Controls.Add(new Label { Text = "Registered ID", Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.MiddleLeft }, 0, 2);
        table.Controls.Add(projectId, 1, 2);
        table.Controls.Add(status, 0, 3);
        table.SetColumnSpan(status, 2);

        var actions = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill, FlowDirection = FlowDirection.LeftToRight,
        };
        actions.Controls.Add(create);
        actions.Controls.Add(copyId);
        actions.Controls.Add(close);
        table.Controls.Add(actions, 0, 4);
        table.SetColumnSpan(actions, 2);
        Controls.Add(table);

        name.TextChanged += (_, _) => { projectId.Clear(); copyId.Enabled = false; };
        create.Click += async (_, _) => await RegisterAsync();
        copyId.Click += (_, _) =>
        {
            if (Guid.TryParse(projectId.Text, out _))
            {
                try { Clipboard.SetText(projectId.Text); }
                catch { status.Text = "Clipboard unavailable. Copy the registered ID manually."; }
            }
        };
        close.Click += (_, _) => Close();
    }

    private async Task RegisterAsync()
    {
        if (busy) return;
        string selected = name.Text.Trim();
        if (selected.Length == 0 || selected.Length > 120)
        {
            status.Text = "Enter a project name of 1–120 characters.";
            return;
        }
        busy = true;
        create.Enabled = false;
        name.Enabled = false;
        projectId.Clear();
        copyId.Enabled = false;
        status.Text = "Checking registry and preparing local registration review...";
        try
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
            psi.ArgumentList.Add(entry);
            psi.ArgumentList.Add("setup-project-desktop");
            psi.ArgumentList.Add(selected);
            foreach (string key in psi.Environment.Keys.Cast<string>().ToArray())
                if (key.StartsWith("ORCH_", StringComparison.OrdinalIgnoreCase))
                    psi.Environment.Remove(key);

            using var child = Process.Start(psi) ?? throw new InvalidOperationException();
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(85));
            try
            {
                Task<string> stderr = child.StandardError.ReadToEndAsync(timeout.Token);
                var reviewLine = await child.StandardOutput.ReadLineAsync(timeout.Token);
                if (reviewLine is null || reviewLine.Length > 4096) throw new InvalidOperationException();
                using var document = JsonDocument.Parse(reviewLine);
                var review = document.RootElement;
                if (review.GetProperty("kind").GetString() != "project-review"
                    || review.GetProperty("action").GetString() != "register_project"
                    || review.GetProperty("destination").GetString() != "local_user_workspace_registry"
                    || review.GetProperty("requiresExactReply").GetString() != "REGISTER PROJECT"
                    || review.GetProperty("grantsAuthority").GetBoolean()
                    || review.GetProperty("projectName").GetString() != selected
                    || !DateTimeOffset.TryParse(review.GetProperty("expiresAt").GetString(), out var expiry)
                    || expiry <= DateTimeOffset.UtcNow
                    || expiry > DateTimeOffset.UtcNow.AddSeconds(65))
                    throw new InvalidOperationException();

                var location = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "cline-orchestrator", "workspace-registry.json");
                var prompt = "Register this local project?\n\n"
                    + "Project: " + selected + "\nRegistry: " + location
                    + "\n\nThis does not register a workspace, start Cline, or grant file access.";
                bool approved = MessageBox.Show(this, prompt, "Confirm project registration",
                    MessageBoxButtons.YesNo, MessageBoxIcon.Question,
                    MessageBoxDefaultButton.Button2) == DialogResult.Yes;

                await child.StandardInput.WriteLineAsync(approved ? "REGISTER PROJECT" : "CANCEL");
                await child.StandardInput.FlushAsync(timeout.Token);
                child.StandardInput.Close();
                var receiptLine = await child.StandardOutput.ReadLineAsync(timeout.Token);
                await child.WaitForExitAsync(timeout.Token);
                _ = await stderr;
                if (child.ExitCode != 0 || receiptLine is null || receiptLine.Length > 4096)
                    throw new InvalidOperationException();
                using var receiptDoc = JsonDocument.Parse(receiptLine);
                var receipt = receiptDoc.RootElement;
                if (receipt.GetProperty("kind").GetString() != "project-result"
                    || receipt.GetProperty("grantsAuthority").GetBoolean())
                    throw new InvalidOperationException();
                var outcome = receipt.GetProperty("outcome").GetString();
                if (approved && outcome == "created"
                    && Guid.TryParse(receipt.GetProperty("projectId").GetString(), out var id))
                {
                    projectId.Text = id.ToString();
                    copyId.Enabled = true;
                    status.Text = "Project registered. Keep the ID for the next workspace/Safety setup step.";
                }
                else if (!approved && outcome == "cancelled")
                    status.Text = "Registration cancelled. No project was added.";
                else throw new InvalidOperationException();
            }
            catch
            {
                try { if (!child.HasExited) child.Kill(entireProcessTree: true); }
                catch { /* Only the child we started can be terminated. */ }
                throw;
            }
        }
        catch
        {
            status.Text = "Registration not verified. Inspect the local registry before retrying.";
        }
        finally
        {
            if (!IsDisposed && !Disposing)
            {
                busy = false;
                create.Enabled = true;
                name.Enabled = true;
            }
        }
    }
}
